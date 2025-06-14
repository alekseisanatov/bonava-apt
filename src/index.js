const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dotenv = require('dotenv');
const { scrapeBonavaApartments } = require('./scraper');
const Database = require('./database');

// Load environment variables
dotenv.config();

// Check if bot token exists
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is not set in environment variables!');
  process.exit(1);
}

console.log('Initializing bot with token:', process.env.TELEGRAM_BOT_TOKEN.substring(0, 5) + '...');

// Initialize bot with webhook mode
const port = process.env.PORT || 8080;
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
console.log('Initializing database...');
const db = new Database(path.join(__dirname, '../apartments.db'));

// Initialize database table
db.initialize().then(() => {
  console.log('Database initialized successfully');
}).catch(error => {
  console.error('Error initializing database:', error);
});

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
    await bot.sendMessage(chatId, 'Начинаю синхронизацию и загрузку квартир...');

    console.log('Starting sync...');
    await performSync();

    console.log('Showing room selection buttons...');
    // Show room selection buttons
    const keyboard = {
      inline_keyboard: [
        [{ text: '2 Комнаты', callback_data: 'rooms_2' }],
        [{ text: '3 Комнаты', callback_data: 'rooms_3' }],
        [{ text: '4 Комнаты', callback_data: 'rooms_4' }]
      ]
    };

    await bot.sendMessage(chatId, 'Пожалуйста, выберите количество комнат:', { reply_markup: keyboard });
    console.log('Room selection buttons sent successfully');
  } catch (error) {
    console.error('Error in /start command:', error);
    await bot.sendMessage(chatId, 'Извините, что-то пошло не так. Пожалуйста, попробуйте позже.');
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
        [{ text: '2 Комнаты', callback_data: 'rooms_2' }],
        [{ text: '3 Комнаты', callback_data: 'rooms_3' }],
        [{ text: '4 Комнаты', callback_data: 'rooms_4' }]
      ]
    };

    await bot.editMessageText('Пожалуйста, выберите количество комнат:', {
      chat_id: chatId,
      message_id: callbackQuery.message.message_id,
      reply_markup: keyboard
    });
  }
  else if (data.startsWith('rooms_')) {
    const roomsCount = parseInt(data.split('_')[1]);

    // Get unique projects for this room count
    const projects = await getProjects();

    // Create project selection keyboard
    const keyboard = {
      inline_keyboard: [
        [{ text: 'Все проекты', callback_data: `project_all_${roomsCount}` }],
        ...projects.map(project => [{
          text: project,
          callback_data: `project_${project}_${roomsCount}`
        }]),
        [{ text: '« Назад к комнатам', callback_data: 'back_to_rooms' }]
      ]
    };

    await bot.editMessageText('Выберите проект:', {
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
          { text: 'Цена ↑', callback_data: `sort_price_asc_${project}_${roomsCount}` },
          { text: 'Цена ↓', callback_data: `sort_price_desc_${project}_${roomsCount}` }
        ],
        [
          { text: 'Площадь ↑', callback_data: `sort_sqMeters_asc_${project}_${roomsCount}` },
          { text: 'Площадь ↓', callback_data: `sort_sqMeters_desc_${project}_${roomsCount}` }
        ],
        [{ text: '« Назад к проектам', callback_data: `rooms_${roomsCount}` }]
      ]
    };

    await bot.editMessageText('Выберите сортировку:', {
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
      await bot.sendMessage(chatId, 'Квартиры с такими параметрами не найдены.');
      return;
    }

    // Send each apartment as a separate message
    for (const apt of apartments) {
      const message = `
🏠 ${apt.plan}
💰 ${apt.price}€
📐 ${apt.sqMeters}м²
🏢 Этаж: ${apt.floor}
🏗 Проект: ${apt.projectName}
🔗 ${apt.link}
      `;

      try {
        if (apt.imageUrl) {
          await bot.sendPhoto(chatId, apt.imageUrl, {
            caption: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
          });
        } else {
          await bot.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
          });
        }
      } catch (error) {
        console.error('Error sending apartment message:', error);
        // If photo sending fails, fall back to text message
        await bot.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });
      }
    }

    // Show filter options again
    const keyboard = {
      inline_keyboard: [
        [
          { text: 'Изменить количество комнат', callback_data: 'back_to_rooms' },
          { text: 'Изменить проект', callback_data: `rooms_${roomsCount}` }
        ],
        [
          { text: 'Изменить сортировку', callback_data: `project_${project}_${roomsCount}` }
        ]
      ]
    };

    await bot.sendMessage(chatId, 'Что бы вы хотели сделать?', { reply_markup: keyboard });
  }
});

// Add sync command handler
bot.onText(/\/sync/, async (msg) => {
  console.log('Received /sync command from user:', msg.chat.id);
  const chatId = msg.chat.id;

  try {
    await bot.sendMessage(chatId, '🔄 Starting sync process...');
    console.log('Starting sync process...');

    const apartments = await scrapeBonavaApartments();
    console.log(`Scraped ${apartments.length} apartments`);

    if (apartments.length === 0) {
      await bot.sendMessage(chatId, '❌ No apartments found during sync');
      return;
    }

    await bot.sendMessage(chatId, `Found ${apartments.length} apartments. Saving to database...`);
    console.log('Attempting to save apartments...');

    try {
      await db.saveApartments(apartments);
      console.log('Apartments saved successfully');
      await bot.sendMessage(chatId, '✅ Sync completed successfully!');
    } catch (error) {
      console.error('Error saving apartments:', error);
      await bot.sendMessage(chatId, '❌ Error saving apartments to database');
    }
  } catch (error) {
    console.error('Error during sync:', error);
    await bot.sendMessage(chatId, '❌ Error during sync process');
  }
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
        await db.saveApartments(apartments);
        console.log('Apartments saved to database');

        // Verify the save by checking the database
        db.db.all('SELECT COUNT(*) as count FROM apartments', (err, rows) => {
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

// Set up cron job for daily sync
cron.schedule('0 0 * * *', async () => {
  console.log('Running scheduled sync...');
  try {
    await performSync();
    console.log('Scheduled sync completed successfully');
  } catch (error) {
    console.error('Error in scheduled sync:', error);
  }
});

// Add getProjects function
async function getProjects() {
  return new Promise((resolve, reject) => {
    db.db.all('SELECT DISTINCT projectName FROM apartments ORDER BY projectName', (err, rows) => {
      if (err) {
        console.error('Error getting projects:', err);
        reject(err);
      } else {
        console.log('Found projects:', rows.map(r => r.projectName));
        resolve(rows.map(r => r.projectName));
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

    db.db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Log server start
console.log(`Server is running on port ${port}`); 