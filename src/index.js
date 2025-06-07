require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const express = require('express');
const { scrapeBonavaApartments } = require('./scraper');
const { initDatabase, saveApartments, getApartmentsByRooms } = require('./database');

// Initialize express app
const app = express();
const port = process.env.PORT || 3000;

// Initialize bot with your token
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// Initialize database
initDatabase().catch(console.error);

// Schedule daily scraping at 1 AM
cron.schedule('0 1 * * *', async () => {
  try {
    console.log('Starting daily scraping...');
    const apartments = await scrapeBonavaApartments();
    await saveApartments(apartments);
    console.log('Daily scraping completed successfully');
  } catch (error) {
    console.error('Error in daily scraping:', error);
  }
});

// Function to perform sync
async function performSync(chatId) {
  try {
    await bot.sendMessage(chatId, '🔄 Начинаю синхронизацию данных...');
    const apartments = await scrapeBonavaApartments();
    await saveApartments(apartments);
    await bot.sendMessage(chatId, `✅ Синхронизация завершена! Найдено ${apartments.length} квартир.`);
    return true;
  } catch (error) {
    console.error('Error in sync:', error);
    await bot.sendMessage(chatId, '❌ Ошибка во время синхронизации. Пожалуйста, попробуйте позже.');
    return false;
  }
}

// Function to get unique projects
async function getUniqueProjects(roomsCount) {
  const apartments = await getApartmentsByRooms(roomsCount);
  const projects = [...new Set(apartments.map(apt => apt.projectName))];
  return projects;
}

// Function to sort apartments
async function getSortedApartments(roomsCount, sortBy, order) {
  const apartments = await getApartmentsByRooms(roomsCount);

  return apartments.sort((a, b) => {
    if (sortBy === 'price') {
      return order === 'asc' ? a.price - b.price : b.price - a.price;
    } else if (sortBy === 'sqMeters') {
      return order === 'asc' ? a.sqMeters - b.sqMeters : b.sqMeters - a.sqMeters;
    }
    return 0;
  });
}

// Function to get apartments by project
async function getApartmentsByProject(roomsCount, projectName) {
  const apartments = await getApartmentsByRooms(roomsCount);
  return apartments.filter(apt => apt.projectName === projectName);
}

// Function to show room selection menu
async function showRoomSelection(chatId) {
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '2 Комнаты', callback_data: 'rooms_2' }],
        [{ text: '3 Комнаты', callback_data: 'rooms_3' }],
        [{ text: '4 Комнаты', callback_data: 'rooms_4' }]
      ]
    }
  };

  await bot.sendMessage(chatId, 'Выберите количество комнат:', keyboard);
}

// Command to show available options
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  // First perform sync
  const syncSuccess = await performSync(chatId);

  if (syncSuccess) {
    await showRoomSelection(chatId);
  }
});

// Handle button clicks
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (data === 'start_over') {
    await showRoomSelection(chatId);
    return;
  }

  if (data.startsWith('rooms_')) {
    const roomsCount = parseInt(data.split('_')[1]);

    // Show filter options
    const filterKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏢 По проекту', callback_data: `filter_project_${roomsCount}` }],
          [{ text: '💰 По цене', callback_data: `filter_price_${roomsCount}` }],
          [{ text: '📏 По площади', callback_data: `filter_sqm_${roomsCount}` }],
          [{ text: '📋 Показать все', callback_data: `show_all_${roomsCount}` }],
          [{ text: '🔄 Начать заново', callback_data: 'start_over' }]
        ]
      }
    };

    await bot.sendMessage(chatId, 'Выберите способ фильтрации:', filterKeyboard);
  }
  else if (data.startsWith('filter_project_')) {
    const roomsCount = parseInt(data.split('_')[2]);
    const projects = await getUniqueProjects(roomsCount);

    const projectButtons = projects.map(project => [{
      text: project,
      callback_data: `project_${roomsCount}_${project}`
    }]);

    projectButtons.push([
      { text: '📋 Все проекты', callback_data: `show_all_${roomsCount}` },
      { text: '🔄 Начать заново', callback_data: 'start_over' }
    ]);

    const keyboard = {
      reply_markup: {
        inline_keyboard: projectButtons
      }
    };

    await bot.sendMessage(chatId, 'Выберите проект:', keyboard);
  }
  else if (data.startsWith('filter_price_')) {
    const roomsCount = parseInt(data.split('_')[2]);
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬆️ По возрастанию', callback_data: `sort_price_${roomsCount}_asc` }],
          [{ text: '⬇️ По убыванию', callback_data: `sort_price_${roomsCount}_desc` }],
          [{ text: '🔄 Начать заново', callback_data: 'start_over' }]
        ]
      }
    };

    await bot.sendMessage(chatId, 'Выберите порядок сортировки цены:', keyboard);
  }
  else if (data.startsWith('filter_sqm_')) {
    const roomsCount = parseInt(data.split('_')[2]);
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '⬆️ По возрастанию', callback_data: `sort_sqm_${roomsCount}_asc` }],
          [{ text: '⬇️ По убыванию', callback_data: `sort_sqm_${roomsCount}_desc` }],
          [{ text: '🔄 Начать заново', callback_data: 'start_over' }]
        ]
      }
    };

    await bot.sendMessage(chatId, 'Выберите порядок сортировки площади:', keyboard);
  }
  else if (data.startsWith('project_')) {
    const [_, roomsCount, projectName] = data.split('_');
    const apartments = await getApartmentsByProject(parseInt(roomsCount), projectName);
    await displayApartments(chatId, apartments);
  }
  else if (data.startsWith('sort_price_') || data.startsWith('sort_sqm_')) {
    const [_, sortType, roomsCount, order] = data.split('_');
    const apartments = await getSortedApartments(
      parseInt(roomsCount),
      sortType === 'price' ? 'price' : 'sqMeters',
      order
    );
    await displayApartments(chatId, apartments);
  }
  else if (data.startsWith('show_all_')) {
    const roomsCount = parseInt(data.split('_')[2]);
    const apartments = await getApartmentsByRooms(roomsCount);
    await displayApartments(chatId, apartments);
  }
});

// Function to display apartments
async function displayApartments(chatId, apartments) {
  if (apartments.length === 0) {
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Начать заново', callback_data: 'start_over' }]
        ]
      }
    };
    await bot.sendMessage(chatId, 'Квартиры не найдены.', keyboard);
    return;
  }

  for (const apartment of apartments) {
    const statusIcon = apartment.status.toLowerCase().includes('Pieejams') ? '🟢' : '🔴';
    const tagIcon = apartment.tag ? '🏷️' : '';

    const message = `
🏢 Проект: ${apartment.projectName}
🏠 Адрес: ${apartment.plan}
💰 Цена: €${apartment.price.toLocaleString()}
🛏 Кол-во Комнат: ${apartment.roomsCount}
📏 Площадь: ${apartment.sqMeters}m²
🏢 Этаж: ${apartment.floor}
${statusIcon} Статус: ${apartment.status}
${tagIcon} Тег: ${apartment.tag}
🔗 [Посмотреть на сайте](${apartment.link})
    `;

    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Начать заново', callback_data: 'start_over' }]
        ]
      }
    };

    await bot.sendPhoto(chatId, apartment.imageUrl, {
      caption: message,
      parse_mode: 'Markdown',
      ...keyboard
    });
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Bot is running!');
});

// Webhook endpoint
app.post('/webhook', express.json(), (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Start the server
app.listen(port, async () => {
  console.log(`Server is running on port ${port}`);

  // Set webhook
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  console.log('Render URL:', renderUrl);

  if (renderUrl) {
    // Remove any trailing slashes and ensure proper URL format
    const cleanUrl = renderUrl.replace(/\/$/, '');
    const webhookUrl = `https://${cleanUrl}/webhook`;
    console.log('Attempting to set webhook URL:', webhookUrl);

    try {
      // First, delete any existing webhook
      await bot.deleteWebHook();
      console.log('Deleted existing webhook');

      // Then set the new webhook
      await bot.setWebHook(webhookUrl);
      console.log('Webhook set successfully:', webhookUrl);
    } catch (error) {
      console.error('Error setting webhook:', error);
      console.log('Falling back to polling...');
      bot.startPolling();
    }
  } else {
    console.log('No RENDER_EXTERNAL_URL available, using polling...');
    bot.startPolling();
  }
}); 