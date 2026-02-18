import { Telegraf } from 'telegraf';
import Groq from 'groq-sdk';

// ================= CONFIGURATION =================
// These will be set as environment variables on Render
const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || '7826815609',
  MODEL: 'mixtral-8x7b-32768', // You can change this model
  MAX_MESSAGE_LENGTH: 4096,
};

// Validate required environment variables
if (!CONFIG.BOT_TOKEN || !CONFIG.GROQ_API_KEY) {
  console.error('Missing required environment variables!');
  process.exit(1);
}

// ================= INITIALIZE CLIENTS =================
const bot = new Telegraf(CONFIG.BOT_TOKEN);
const groq = new Groq({ apiKey: CONFIG.GROQ_API_KEY });

// Simple in-memory storage for conversation history
const userConversations = new Map();

// ================= HELPER FUNCTIONS =================

/**
 * Gets AI response from Groq API
 */
async function getAIResponse(userMessage, userId) {
  try {
    // Get or create user's conversation history
    if (!userConversations.has(userId)) {
      userConversations.set(userId, []);
    }
    const history = userConversations.get(userId);

    // Add user's new message to history
    history.push({ role: 'user', content: userMessage });

    // Keep history manageable (last 5 exchanges = 10 messages)
    const MAX_HISTORY = 10;
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }

    // Call Groq API
    const chatCompletion = await groq.chat.completions.create({
      model: CONFIG.MODEL,
      messages: history,
      temperature: 0.7,
      max_tokens: 1024,
    });

    const aiReply = chatCompletion.choices[0]?.message?.content || 'I received an empty response.';

    // Add AI's reply to history
    history.push({ role: 'assistant', content: aiReply });

    return aiReply;

  } catch (error) {
    console.error('Groq API Error:', error.message);
    
    // User-friendly error messages
    if (error.status === 401) {
      return '❌ Authentication Error: Invalid API key.';
    } else if (error.status === 404) {
      return '⚠️ Service Error: The AI model endpoint could not be found.';
    } else if (error.status === 429) {
      return '⚡ Rate Limit: Too many requests. Please wait a moment.';
    } else {
      return `⚠️ AI Service Error: Please try again later.`;
    }
  }
}

/**
 * Forwards user messages to the admin
 */
async function forwardToAdmin(ctx, userMessage) {
  try {
    const user = ctx.from;
    const adminMessage = `
👤 Message from user:
ID: ${user.id}
Name: ${user.first_name} ${user.last_name || ''}
Username: @${user.username || 'N/A'}

💬 Text:
${userMessage}

⏰ ${new Date().toLocaleString()}
    `.trim();

    await bot.telegram.sendMessage(CONFIG.ADMIN_CHAT_ID, adminMessage);
  } catch (error) {
    console.error('Failed to forward to admin:', error.message);
  }
}

/**
 * Splits long messages for Telegram
 */
function splitMessage(text, maxLength = CONFIG.MAX_MESSAGE_LENGTH) {
  if (text.length <= maxLength) return [text];

  const parts = [];
  const lines = text.split('\n');
  let currentPart = '';

  for (const line of lines) {
    if (currentPart.length + line.length + 1 <= maxLength) {
      currentPart += (currentPart ? '\n' : '') + line;
    } else {
      if (currentPart) parts.push(currentPart);
      currentPart = line;
    }
  }

  if (currentPart) parts.push(currentPart);
  return parts;
}

// ================= BOT COMMANDS =================

// /start command
bot.start((ctx) => {
  const welcome = `🤖 Welcome ${ctx.from.first_name}!

I'm your AI assistant powered by Groq's fast language models. Created by Farid Ahmad Khan.

Commands:
/help - Show help
/clear - Clear chat history
/about - Bot info
/model - Show current AI model

Just send a message to start chatting!`;

  ctx.reply(welcome);

  // Notify admin
  bot.telegram.sendMessage(
    CONFIG.ADMIN_CHAT_ID,
    `🆕 New user started bot: ${ctx.from.first_name} (ID: ${ctx.from.id})`
  ).catch(console.error);
});

// /help command
bot.help((ctx) => {
  ctx.reply(`Available commands:
/start - Start the bot
/help - Show this menu
/clear - Reset conversation
/about - About this bot
/model - Show current AI model

📨 All user messages are forwarded to the admin.`);
});

// /clear command
bot.command('clear', (ctx) => {
  userConversations.delete(ctx.from.id);
  ctx.reply('✅ Conversation history cleared! Starting fresh.');
});

// /about command
bot.command('about', (ctx) => {
  ctx.reply(`🤖 Telegram AI Bot
Powered by Khan's AI Solutions
Model: ${CONFIG.MODEL}
Admin ID: ${CONFIG.ADMIN_CHAT_ID}

Built for fast, intelligent conversations.`);
});

// /model command
bot.command('model', (ctx) => {
  ctx.reply(`Current AI model: ${CONFIG.MODEL}

Available models: mixtral-8x7b-32768, llama3-8b-8192, llama2-70b-4096`);
});

// ================= MESSAGE HANDLING =================

// Handle text messages
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userMessage = ctx.message.text;

  // Show typing indicator
  await ctx.sendChatAction('typing');

  // Forward to admin (optional - comment out if not needed)
  await forwardToAdmin(ctx, userMessage);

  // Get AI response
  const aiResponse = await getAIResponse(userMessage, userId);

  // Send response (split if too long)
  const messageParts = splitMessage(aiResponse);
  for (const part of messageParts) {
    await ctx.reply(part);
  }
});

// Handle non-text messages
bot.on(['photo', 'video', 'document', 'voice'], async (ctx) => {
  const mediaType = ctx.updateSubTypes[0];
  await ctx.reply(`📁 I received your ${mediaType}. Currently, I can only process text messages.`);

  // Forward media info to admin
  bot.telegram.sendMessage(
    CONFIG.ADMIN_CHAT_ID,
    `📎 User ${ctx.from.id} sent a ${mediaType}`
  ).catch(console.error);
});

// ================= ERROR HANDLING =================

bot.catch((err, ctx) => {
  console.error('Bot Error:', err);
  ctx.reply('❌ An internal error occurred. Please try again.').catch(() => {});
});

// ================= START BOT =================

const PORT = process.env.PORT || 3000;

// Start web server for Render (required for web services)
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('🤖 Telegram Bot is running!');
});

app.listen(PORT, () => {
  console.log(`🚀 Web server running on port ${PORT}`);
  console.log(`🤖 Starting Telegram Bot with Groq...`);
  console.log(`🤖 Model: ${CONFIG.MODEL}`);
  
  // Launch the bot
  bot.launch()
    .then(() => {
      console.log('✅ Bot is running!');
      
      // Send startup notification
      bot.telegram.sendMessage(
        CONFIG.ADMIN_CHAT_ID,
        `🤖 Groq Bot started successfully at ${new Date().toLocaleString()}`
      ).catch(console.error);
    })
    .catch(err => {
      console.error('❌ Failed to start bot:', err);
    });
});

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));