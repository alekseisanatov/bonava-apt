# Telegram Apartment Bot

A Telegram bot that scrapes and displays apartment listings from Bonava.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the root directory with the following content:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
```

3. Start the bot:

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## Features

- Daily automatic scraping of apartments at 1 AM
- Inline buttons to filter apartments by number of rooms (2, 3, or 4)
- Displays apartment details including:
  - Project name
  - Plan
  - Price
  - Number of rooms
  - Area in square meters
  - Floor
  - Image
  - Link to details

## Commands

- `/start` - Shows the main menu with room options

## Database

The bot uses SQLite to store apartment data. The database file (`apartments.db`) will be created automatically in the root directory.
