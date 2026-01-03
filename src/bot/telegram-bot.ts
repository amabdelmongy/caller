import 'dotenv/config';
import type TelegramBotType from 'node-telegram-bot-api';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const TelegramBot = require('node-telegram-bot-api') as typeof TelegramBotType;

import type { INestApplicationContext } from '@nestjs/common';
import { createCallerClient } from './caller-client';

function log(message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  if (meta) console.log(`[${ts}] ${message}`, meta);
  else console.log(`[${ts}] ${message}`);
}

function telegramUsername(msg: TelegramBotType.Message): string {
  // Stable per chat; avoids relying on @handle existing
  const chatId = msg.chat?.id ?? 'unknown';
  const userId = msg.from?.id ?? 'unknown';
  return `tg:${chatId}:${userId}`;
}

function chatMeta(msg: TelegramBotType.Message) {
  return {
    chatId: msg.chat?.id,
    userId: msg.from?.id,
    username: msg.from?.username,
    firstName: msg.from?.first_name,
    text: msg.text
  };
}

export async function startTelegramBot(appCtx?: INestApplicationContext) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const TELEGRAM_STATUS_CHAT_ID = process.env.TELEGRAM_STATUS_CHAT_ID ?? TELEGRAM_ADMIN_CHAT_ID;

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable not set');
  }

  log('Booting Telegram bot...');
  const caller = await createCallerClient(appCtx);
  log('Caller client ready (direct NestJS).');

  const bot = new TelegramBot(token, { polling: true });
  log('Telegram polling started.');

  if (TELEGRAM_STATUS_CHAT_ID) {
    try {
      await bot.sendMessage(
        TELEGRAM_STATUS_CHAT_ID,
        `Caller app is up.\nStarted at: ${new Date().toISOString()}`
      );
      log('Startup notification sent', { TELEGRAM_STATUS_CHAT_ID });
    } catch (err: any) {
      log('Failed to send startup notification', {
        TELEGRAM_STATUS_CHAT_ID,
        error: err?.message ?? String(err)
      });
    }
  } else {
    log('Startup notification skipped (TELEGRAM_STATUS_CHAT_ID not set)');
  }

  bot.on('polling_error', (err: any) => {
    log('polling_error', { message: err?.message ?? String(err) });
  });

  bot.onText(/^\/start$/, async (msg: TelegramBotType.Message) => {
    const u = telegramUsername(msg);
    const chatId = msg.chat.id;

    log('Command: /start', { ...chatMeta(msg), mappedUser: u });

    try {
      log('Resetting conversation...', { mappedUser: u });
      await caller.reset(u);

      log('Sending initial "start" message to CallerService...', { mappedUser: u });
      const text = await caller.chat(u, 'start');

      log('Replying to Telegram /start', { chatId, replyPreview: text?.slice?.(0, 200) });
      await bot.sendMessage(chatId, text);
    } catch (err: any) {
      log('Error handling /start', { ...chatMeta(msg), error: err?.message ?? String(err) });
      await bot.sendMessage(chatId, `Error: ${err?.message ?? String(err)}`);
    }
  });

  bot.onText(/^\/reset$/, async (msg: TelegramBotType.Message) => {
    const u = telegramUsername(msg);
    const chatId = msg.chat.id;

    log('Command: /reset', { ...chatMeta(msg), mappedUser: u });

    try {
      await caller.reset(u);
      log('Conversation reset OK', { mappedUser: u });
      await bot.sendMessage(chatId, 'Conversation reset. Send any message to start again.');
    } catch (err: any) {
      log('Error handling /reset', { ...chatMeta(msg), error: err?.message ?? String(err) });
      await bot.sendMessage(chatId, `Error: ${err?.message ?? String(err)}`);
    }
  });

  bot.on('message', async (msg: TelegramBotType.Message) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Ignore commands (handled above) and non-text messages
    if (!text || text.startsWith('/')) return;

    const u = telegramUsername(msg);

    log('Incoming message', { ...chatMeta(msg), mappedUser: u });

    try {
      const reply = await caller.chat(u, text);
      log('CallerService reply', { mappedUser: u, replyPreview: reply?.slice?.(0, 200) });
      await bot.sendMessage(chatId, reply);
    } catch (err: any) {
      log('Error handling message', { ...chatMeta(msg), mappedUser: u, error: err?.message ?? String(err) });
      await bot.sendMessage(chatId, `Error: ${err?.message ?? String(err)}`);
    }
  });

  process.on('SIGINT', async () => {
    log('SIGINT received. Shutting down...');
    try {
      await caller.close();
      log('Shutdown complete.');
    } finally {
      process.exit(0);
    }
  });

  process.on('SIGTERM', async () => {
    log('SIGTERM received. Shutting down...');
    try {
      await caller.close();
      log('Shutdown complete.');
    } finally {
      process.exit(0);
    }
  });

  log('Telegram bot running.');
}

// If executed directly (npm run start:bot), start standalone:
if (require.main === module) {
  startTelegramBot().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
