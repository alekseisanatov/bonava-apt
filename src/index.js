const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dotenv = require('dotenv');
const { scrapeBonavaApartments } = require('./scraper');
const { initDatabase, saveApartments, getApartmentsByRooms } = require('./database');

// Load environment variables
dotenv.config();

// Check if bot token exists
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is not set in environment variables!');
  process.exit(1);
}

console.log('Initializing bot with token:', process.env.TELEGRAM_BOT_TOKEN.substring(0, 5) + '...');

// Initialize database connection
const db = new sqlite3.Database(path.join(__dirname, '../apartments.db'));

// Initialize Express app
const app = express();
const port = process.env.PORT || 8080;

// Initialize bot with webhook mode
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  webHook: {
    port: port
  }
});

// Set up webhook
console.log('Setting up webhook...');
const webhookUrl = `${process.env.WEBHOOK_URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`;
console.log('Webhook URL:', webhookUrl);

// Set webhook with basic configuration
bot.setWebHook(webhookUrl, {
  max_connections: 100,
  allowed_updates: ['message', 'callback_query']
}).then(() => {
  console.log('Webhook set successfully');
  return bot.getWebHookInfo();
}).then(info => {
  console.log('Webhook info:', info);
}).catch(error => {
  console.error('Error setting webhook:', error);
});

// Add logging for all incoming messages
bot.on('message', (msg) => {
  console.log('Received message:', msg);
});

// Add error handler for webhook
bot.on('webhook_error', (error) => {
  console.error('Webhook error:', error);
});

// Initialize database
initDatabase().then(() => {
  console.log('Database initialized successfully');
}).catch(error => {
  console.error('Error initializing database:', error);
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Bot is running!');
});

// Start Express server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Function to perform sync
async function performSync() {
  try {
    console.log('Starting sync...');
    const apartments = await scrapeBonavaApartments();
    console.log(`Found ${apartments.length} apartments`);

    if (apartments.length > 0) {
      console.log('Sample apartment data:', JSON.stringify(apartments[0], null, 2));
      try {
        await saveApartments(apartments);
        console.log('Apartments saved to database');

        // Verify the save by checking the database
        db.all('SELECT COUNT(*) as count FROM apartments', (err, rows) => {
          if (err) {
            console.error('Error checking database:', err);
          } else {
            console.log('Current apartment count in database:', rows[0].count);
          }
        });
      } catch (saveError) {
        console.error('Error saving apartments:', saveError);
      }
    } else {
      console.log('No apartments found to save');
    }
  } catch (error) {
    console.error('Error in sync:', error);
  }
}

// Schedule sync every 5 minutes
cron.schedule('*/5 * * * *', () => {
  console.log('Running scheduled sync...');
  performSync();
});

// Helper function to get unique projects
async function getUniqueProjects() {
  return new Promise((resolve, reject) => {
    db.all('SELECT DISTINCT projectName FROM apartments ORDER BY projectName', (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows.map(row => row.projectName));
      }
    });
  });
}

// Helper function to get apartments with filters
async function getFilteredApartments(filters) {
  return new Promise((resolve, reject) => {
    let query = 'SELECT * FROM apartments WHERE 1=1';
    const params = [];

    if (filters.roomsCount) {
      query += ' AND roomsCount = ?';
      params.push(filters.roomsCount);
    }

    if (filters.projectName && filters.projectName !== 'All') {
      query += ' AND projectName = ?';
      params.push(filters.projectName);
    }

    // Add sorting
    if (filters.sortBy) {
      query += ` ORDER BY ${filters.sortBy} ${filters.sortOrder || 'ASC'}`;
    } else {
      query += ' ORDER BY createdAt DESC';
    }

    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Command handlers with more logging
bot.onText(/\/test/, (msg) => {
  console.log('Received /test command from user:', msg.chat.id);
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, '👋 Hello! The bot is working!')
    .then(() => console.log('Test message sent successfully'))
    .catch(error => console.error('Error sending test message:', error));
});

bot.onText(/\/webhook/, async (msg) => {
  console.log('Received /webhook command from user:', msg.chat.id);
  const chatId = msg.chat.id;
  try {
    const webhookInfo = await bot.getWebHookInfo();
    console.log('Webhook info:', webhookInfo);
    await bot.sendMessage(chatId, `Webhook status:\n${JSON.stringify(webhookInfo, null, 2)}`);
    console.log('Webhook status message sent successfully');
  } catch (error) {
    console.error('Error getting webhook info:', error);
    await bot.sendMessage(chatId, 'Error checking webhook status');
  }
});

bot.onText(/\/start/, async (msg) => {
  console.log('Received /start command from user:', msg.chat.id);
  const chatId = msg.chat.id;

  try {
    console.log('Sending initial message...');
    await bot.sendMessage(chatId, 'Starting sync and loading apartments...');

    console.log('Starting sync...');
    await performSync();

    console.log('Showing room selection buttons...');
    // Show room selection buttons
    const keyboard = {
      inline_keyboard: [
        [{ text: '2 Rooms', callback_data: 'rooms_2' }],
        [{ text: '3 Rooms', callback_data: 'rooms_3' }],
        [{ text: '4 Rooms', callback_data: 'rooms_4' }]
      ]
    };

    await bot.sendMessage(chatId, 'Please select number of rooms:', { reply_markup: keyboard });
    console.log('Room selection buttons sent successfully');
  } catch (error) {
    console.error('Error in /start command:', error);
    await bot.sendMessage(chatId, 'Sorry, something went wrong. Please try again later.');
  }
});

// Handle callback queries
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (data === 'back_to_rooms') {
    // Show room selection buttons
    const keyboard = {
      inline_keyboard: [
        [{ text: '2 Rooms', callback_data: 'rooms_2' }],
        [{ text: '3 Rooms', callback_data: 'rooms_3' }],
        [{ text: '4 Rooms', callback_data: 'rooms_4' }]
      ]
    };

    await bot.editMessageText('Please select number of rooms:', {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      reply_markup: keyboard
    });
  }
  else if (data.startsWith('rooms_')) {
    const roomsCount = parseInt(data.split('_')[1]);

    // Get unique projects for this room count
    const projects = await getUniqueProjects();

    // Create project selection keyboard
    const keyboard = {
      inline_keyboard: [
        [{ text: 'All Projects', callback_data: `project_all_${roomsCount}` }],
        ...projects.map(project => [{
          text: project,
          callback_data: `project_${project}_${roomsCount}`
        }]),
        [{ text: '« Back to Rooms', callback_data: 'back_to_rooms' }]
      ]
    };

    await bot.editMessageText('Select project:', {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      reply_markup: keyboard
    });
  }
  else if (data.startsWith('project_')) {
    const [_, project, roomsCount] = data.split('_');

    // Create sorting options keyboard
    const keyboard = {
      inline_keyboard: [
        [
          { text: 'Price ↑', callback_data: `sort_price_asc_${project}_${roomsCount}` },
          { text: 'Price ↓', callback_data: `sort_price_desc_${project}_${roomsCount}` }
        ],
        [
          { text: 'Size ↑', callback_data: `sort_sqMeters_asc_${project}_${roomsCount}` },
          { text: 'Size ↓', callback_data: `sort_sqMeters_desc_${project}_${roomsCount}` }
        ],
        [{ text: '« Back to Projects', callback_data: `rooms_${roomsCount}` }]
      ]
    };

    await bot.editMessageText('Select sorting:', {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      reply_markup: keyboard
    });
  }
  else if (data.startsWith('sort_')) {
    const [_, field, order, project, roomsCount] = data.split('_');

    // Get filtered apartments
    const filters = {
      roomsCount: parseInt(roomsCount),
      projectName: project === 'all' ? null : project,
      sortBy: field,
      sortOrder: order
    };

    const apartments = await getFilteredApartments(filters);

    if (apartments.length === 0) {
      await bot.sendMessage(chatId, 'No apartments found with these filters.');
      return;
    }

    // Send each apartment as a separate message
    for (const apt of apartments) {
      const message = `
🏠 ${apt.plan}
💰 ${apt.price}€
📐 ${apt.sqMeters}m²
🏢 Floor: ${apt.floor}
🏗 Project: ${apt.projectName}
🔗 ${apt.link}
      `;

      await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    }

    // Show filter options again
    const keyboard = {
      inline_keyboard: [
        [
          { text: 'Change Room Count', callback_data: 'back_to_rooms' },
          { text: 'Change Project', callback_data: `rooms_${roomsCount}` }
        ],
        [
          { text: 'Change Sorting', callback_data: `project_${project}_${roomsCount}` }
        ]
      ]
    };

    await bot.sendMessage(chatId, 'What would you like to do?', { reply_markup: keyboard });
  }
});

// Keep the /sync command for manual syncs
bot.onText(/\/sync/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Starting manual sync...');
  await performSync();
  bot.sendMessage(chatId, 'Sync completed!');
}); 