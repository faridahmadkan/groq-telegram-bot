import { Telegraf } from 'telegraf';
import Groq from 'groq-sdk';

// ================= CONFIGURATION =================
const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || '7826815609',
  MODEL: 'mixtral-8x7b-32768',
  MAX_MESSAGE_LENGTH: 4096,
  BOT_NAME: 'KhanGPT',
  CREATOR: 'Farid Ahmad Khan',
  VERSION: '2.0.0'
};

// Validate required environment variables
if (!CONFIG.BOT_TOKEN || !CONFIG.GROQ_API_KEY) {
  console.error('Missing required environment variables!');
  process.exit(1);
}

// ================= INITIALIZE CLIENTS =================
const bot = new Telegraf(CONFIG.BOT_TOKEN);
const groq = new Groq({ apiKey: CONFIG.GROQ_API_KEY });

// Enhanced storage with user preferences and stats
const userData = new Map();

// System prompt to define bot's identity
const SYSTEM_PROMPT = `You are ${CONFIG.BOT_NAME}, an advanced AI assistant created by ${CONFIG.CREATOR}. 
Your responses should be helpful, accurate, and engaging. Key characteristics:
- Name: ${CONFIG.BOT_NAME}
- Creator: ${CONFIG.CREATOR}
- Purpose: To assist users with intelligent, contextual conversations
- Personality: Friendly, professional, and knowledgeable
- When asked about your name or identity, clearly state that you are ${CONFIG.BOT_NAME}
- Powered by Groq's fast AI infrastructure`;

// ================= HELPER FUNCTIONS =================

/**
 * Initialize or get user data
 */
function getUserData(userId) {
  if (!userData.has(userId)) {
    userData.set(userId, {
      history: [{
        role: 'system',
        content: SYSTEM_PROMPT
      }],
      preferences: {
        temperature: 0.7,
        maxTokens: 1024,
        language: 'en'
      },
      stats: {
        messageCount: 0,
        firstSeen: new Date(),
        lastSeen: new Date()
      }
    });
  }
  
  const data = userData.get(userId);
  data.stats.lastSeen = new Date();
  data.stats.messageCount++;
  
  return data;
}

/**
 * Enhanced AI response with context and preferences
 */
async function getAIResponse(userMessage, userId, preferences = {}) {
  try {
    const user = getUserData(userId);
    const history = user.history;
    const temp = preferences.temperature || user.preferences.temperature;
    const maxTokens = preferences.maxTokens || user.preferences.maxTokens;

    // Check for identity questions
    const lowerMessage = userMessage.toLowerCase();
    const identityKeywords = ['your name', 'who are you', 'what is your name', 'who created you', 'your creator'];
    
    if (identityKeywords.some(keyword => lowerMessage.includes(keyword))) {
      if (lowerMessage.includes('name')) {
        return `My name is ${CONFIG.BOT_NAME}! I'm an advanced AI assistant created by ${CONFIG.CREATOR} to help users with intelligent conversations. How can I assist you today?`;
      } else if (lowerMessage.includes('creator') || lowerMessage.includes('created')) {
        return `I was created by ${CONFIG.CREATOR}, a talented developer specializing in AI solutions. ${CONFIG.BOT_NAME} is designed to provide fast, accurate, and helpful responses using Groq's cutting-edge AI technology.`;
      }
    }

    // Add user message to history
    history.push({ role: 'user', content: userMessage });

    // Smart history management - keep more context for important conversations
    const MAX_HISTORY = user.stats.messageCount > 50 ? 20 : 15;
    if (history.length > MAX_HISTORY) {
      // Always keep system prompt
      history.splice(1, history.length - MAX_HISTORY);
    }

    // Call Groq API with enhanced parameters
    const chatCompletion = await groq.chat.completions.create({
      model: CONFIG.MODEL,
      messages: history,
      temperature: temp,
      max_tokens: maxTokens,
      top_p: 0.9,
      frequency_penalty: 0.3,
      presence_penalty: 0.3,
    });

    const aiReply = chatCompletion.choices[0]?.message?.content || 
      'I apologize, but I received an empty response. Please try again.';

    // Add AI's reply to history
    history.push({ role: 'assistant', content: aiReply });

    return aiReply;

  } catch (error) {
    console.error('Groq API Error:', error.message);
    
    // Enhanced error messages
    const errorMessages = {
      401: '❌ Authentication Error: Invalid API key. Please contact the administrator.',
      404: '⚠️ Service Error: The AI model endpoint could not be found.',
      429: '⚡ Rate Limit: Too many requests. Please wait a moment before continuing.',
      500: '🔧 Server Error: Groq API is experiencing issues. Please try again later.',
      503: '🛠️ Service Unavailable: Groq API is temporarily down. Please wait.'
    };

    return errorMessages[error.status] || 
      `⚠️ AI Service Error: ${error.message || 'Please try again later.'}`;
  }
}

/**
 * Enhanced admin notifications
 */
async function notifyAdmin(ctx, type, details = {}) {
  try {
    const user = ctx.from;
    const timestamp = new Date().toLocaleString();
    
    let adminMessage = '';
    
    switch(type) {
      case 'message':
        adminMessage = `
📨 New Message from User:
┌ ID: ${user.id}
├ Name: ${user.first_name} ${user.last_name || ''}
├ Username: @${user.username || 'N/A'}
├ Language: ${user.language_code || 'N/A'}
└ Time: ${timestamp}

💬 Message:
${details.text}

📊 Stats: ${details.messageCount} messages so far
        `.trim();
        break;
        
      case 'new_user':
        adminMessage = `
🎉 New User Started Bot:
┌ ID: ${user.id}
├ Name: ${user.first_name} ${user.last_name || ''}
├ Username: @${user.username || 'N/A'}
├ Language: ${user.language_code || 'N/A'}
└ Time: ${timestamp}

👥 Total users: ${userData.size}
        `.trim();
        break;
        
      case 'error':
        adminMessage = `
⚠️ Error Report:
Error: ${details.error}
User: ${user.id}
Time: ${timestamp}
        `.trim();
        break;
    }

    await bot.telegram.sendMessage(CONFIG.ADMIN_CHAT_ID, adminMessage);
  } catch (error) {
    console.error('Admin notification failed:', error.message);
  }
}

/**
 * Enhanced message splitter with formatting preservation
 */
function splitMessage(text, maxLength = CONFIG.MAX_MESSAGE_LENGTH) {
  if (text.length <= maxLength) return [text];

  const parts = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let currentPart = '';

  for (const sentence of sentences) {
    if (currentPart.length + sentence.length <= maxLength) {
      currentPart += sentence;
    } else {
      if (currentPart) parts.push(currentPart.trim());
      
      // If a single sentence is too long, split by words
      if (sentence.length > maxLength) {
        const words = sentence.split(' ');
        currentPart = '';
        for (const word of words) {
          if (currentPart.length + word.length + 1 <= maxLength) {
            currentPart += (currentPart ? ' ' : '') + word;
          } else {
            if (currentPart) parts.push(currentPart);
            currentPart = word;
          }
        }
      } else {
        currentPart = sentence;
      }
    }
  }

  if (currentPart) parts.push(currentPart.trim());
  
  // Add continuation indicator
  return parts.map((part, index) => 
    `${part}${index < parts.length - 1 ? ' (continued...)' : ''}`
  );
}

/**
 * Format stats for display
 */
function formatStats(userId) {
  const user = getUserData(userId);
  const uptime = Math.floor((Date.now() - user.stats.firstSeen) / 1000 / 60);
  
  return `
📊 Your Stats:
━━━━━━━━━━━━━━
Messages sent: ${user.stats.messageCount}
Conversation length: ${Math.floor(user.history.length / 2)} exchanges
First seen: ${user.stats.firstSeen.toLocaleDateString()}
Last active: ${user.stats.lastSeen.toLocaleTimeString()}
Uptime: ${uptime} minutes
  `;
}

// ================= BOT COMMANDS =================

// /start command with enhanced welcome
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const user = getUserData(userId);
  
  const welcome = `
🤖 Welcome to ${CONFIG.BOT_NAME}, ${ctx.from.first_name}!

I'm your advanced AI assistant, created by ${CONFIG.CREATOR} to provide intelligent, contextual conversations.

✨ **Features:**
• Natural conversations with context memory
• Customizable responses via /settings
• Personal stats tracking via /stats
• Multiple AI models via /model
• Smart history management

🚀 **Quick Commands:**
/help - Show all commands
/clear - Reset conversation
/about - Learn about me
/model - Change AI model
/stats - Your usage stats
/settings - Customize experience

Just send a message to start chatting!`;

  await ctx.reply(welcome, { parse_mode: 'Markdown' });
  await notifyAdmin(ctx, 'new_user');
});

// Enhanced /help command
bot.help((ctx) => {
  const help = `
📚 **${CONFIG.BOT_NAME} Commands**

**General:**
/start - Restart the bot
/help - Show this menu
/about - About ${CONFIG.BOT_NAME}

**Conversation:**
/clear - Reset your conversation
/stats - View your usage statistics
/history - Show conversation summary

**Settings:**
/model - Change AI model
/settings - Customize responses
/language - Change response language

**Tips:**
• Ask me about my name or creator
• I remember context from our conversation
• Use /clear to start fresh anytime
• Long responses are split automatically

Need help? Just ask! 🤖
  `;
  
  ctx.reply(help, { parse_mode: 'Markdown' });
});

// Enhanced /clear command
bot.command('clear', (ctx) => {
  const userId = ctx.from.id;
  const user = getUserData(userId);
  
  // Reset history but keep system prompt and preferences
  user.history = [{
    role: 'system',
    content: SYSTEM_PROMPT
  }];
  
  ctx.reply(`✅ Conversation history cleared! Starting fresh with ${CONFIG.BOT_NAME}.`);
});

// Enhanced /about command
bot.command('about', (ctx) => {
  const about = `
🤖 **${CONFIG.BOT_NAME} v${CONFIG.VERSION}**

**Created by:** ${CONFIG.CREATOR}
**Powered by:** Groq AI (${CONFIG.MODEL})

**Capabilities:**
• Contextual conversations
• Multiple language support
• User preference memory
• Smart response formatting
• Real-time typing indicators

**Features:**
• Message history: 15-20 exchanges
• Response length: Up to 1024 tokens
• Temperature: Adjustable via /settings
• Admin notifications active

**Links:**
Creator: @faridahmadkhan
Version: ${CONFIG.VERSION}
Last update: January 2024

Type /help for all commands! 🚀
  `;
  
  ctx.reply(about, { parse_mode: 'Markdown' });
});

// /model command with selection
bot.command('model', (ctx) => {
  const models = [
    { name: 'Mixtral 8x7B', id: 'mixtral-8x7b-32768', desc: 'Best for complex tasks' },
    { name: 'Llama 3 8B', id: 'llama3-8b-8192', desc: 'Fast and efficient' },
    { name: 'Llama 2 70B', id: 'llama2-70b-4096', desc: 'Most powerful' }
  ];
  
  const modelList = models.map(m => 
    `• ${m.name}: \`${m.id}\`\n  └ ${m.desc}`
  ).join('\n\n');
  
  ctx.reply(
    `🎯 **Current Model:** \`${CONFIG.MODEL}\`\n\n` +
    `**Available Models:**\n${modelList}\n\n` +
    `_To change model, type /setmodel <model_id>_`,
    { parse_mode: 'Markdown' }
  );
});

// /setmodel command
bot.command('setmodel', (ctx) => {
  const args = ctx.message.text.split(' ')[1];
  
  if (!args) {
    return ctx.reply('Please specify a model ID. Example: `/setmodel llama3-8b-8192`', 
      { parse_mode: 'Markdown' });
  }
  
  const validModels = ['mixtral-8x7b-32768', 'llama3-8b-8192', 'llama2-70b-4096'];
  
  if (validModels.includes(args)) {
    CONFIG.MODEL = args;
    ctx.reply(`✅ Model changed to \`${args}\` successfully!`, { parse_mode: 'Markdown' });
  } else {
    ctx.reply('❌ Invalid model ID. Use /model to see available models.');
  }
});

// /stats command
bot.command('stats', (ctx) => {
  const stats = formatStats(ctx.from.id);
  ctx.reply(stats);
});

// /settings command
bot.command('settings', (ctx) => {
  const user = getUserData(ctx.from.id);
  const prefs = user.preferences;
  
  const settings = `
⚙️ **Your Settings**

**Current Preferences:**
• Temperature: ${prefs.temperature} (creativity)
• Max tokens: ${prefs.maxTokens} (response length)
• Language: ${prefs.language}

**Commands to adjust:**
/settemp <0.1-1.5> - Change creativity
/settokens <100-2048> - Change max tokens
/language <en/es/fr> - Change language
  `;
  
  ctx.reply(settings, { parse_mode: 'Markdown' });
});

// /settemp command
bot.command('settemp', (ctx) => {
  const args = parseFloat(ctx.message.text.split(' ')[1]);
  
  if (isNaN(args) || args < 0.1 || args > 1.5) {
    return ctx.reply('❌ Please provide a valid temperature between 0.1 and 1.5');
  }
  
  const user = getUserData(ctx.from.id);
  user.preferences.temperature = args;
  
  ctx.reply(`✅ Temperature set to ${args}`);
});

// /settokens command
bot.command('settokens', (ctx) => {
  const args = parseInt(ctx.message.text.split(' ')[1]);
  
  if (isNaN(args) || args < 100 || args > 2048) {
    return ctx.reply('❌ Please provide valid token count between 100 and 2048');
  }
  
  const user = getUserData(ctx.from.id);
  user.preferences.maxTokens = args;
  
  ctx.reply(`✅ Max tokens set to ${args}`);
});

// /history command
bot.command('history', (ctx) => {
  const user = getUserData(ctx.from.id);
  const exchangeCount = Math.floor((user.history.length - 1) / 2);
  
  ctx.reply(
    `📝 **Conversation Summary**\n\n` +
    `Total exchanges: ${exchangeCount}\n` +
    `Messages in memory: ${user.history.length - 1}\n` +
    `Last message: ${user.stats.lastSeen.toLocaleTimeString()}\n\n` +
    `_Use /clear to reset_`,
    { parse_mode: 'Markdown' }
  );
});

// ================= MESSAGE HANDLING =================

// Handle text messages with enhanced processing
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const userMessage = ctx.message.text;
  const user = getUserData(userId);

  // Show typing indicator
  await ctx.sendChatAction('typing');

  // Notify admin (with rate limiting)
  if (user.stats.messageCount % 5 === 0) {
    await notifyAdmin(ctx, 'message', { 
      text: userMessage.substring(0, 50) + (userMessage.length > 50 ? '...' : ''),
      messageCount: user.stats.messageCount 
    });
  }

  // Get AI response with user preferences
  const aiResponse = await getAIResponse(userMessage, userId, user.preferences);

  // Send response with typing indicator between parts
  const messageParts = splitMessage(aiResponse);
  
  for (let i = 0; i < messageParts.length; i++) {
    if (i > 0) await ctx.sendChatAction('typing');
    await ctx.reply(messageParts[i]);
  }
});

// Handle media with enhanced responses
bot.on(['photo', 'video', 'document', 'voice', 'sticker'], async (ctx) => {
  const mediaType = ctx.updateSubTypes[0];
  const user = getUserData(ctx.from.id);
  
  const responses = {
    photo: "📸 I see you've shared a photo! While I can't view images directly, I can discuss it if you describe it.",
    video: "🎥 Thanks for sharing a video! Tell me what it's about and I'll help.",
    document: "📄 Document received. Describe its contents and I'll assist!",
    voice: "🎤 I received a voice message. Currently I can only process text, but feel free to type your message!",
    sticker: "😊 Nice sticker! How can I help you today?"
  };
  
  await ctx.reply(responses[mediaType] || `📁 I received your ${mediaType}. Please send text messages for AI assistance.`);

  // Notify admin
  await notifyAdmin(ctx, 'message', { 
    text: `[${mediaType.toUpperCase()}] Shared by user`,
    messageCount: user.stats.messageCount 
  });
});

// Handle commands for bot identity questions
bot.hears(/.*(your name|who are you|what is your name).*/i, (ctx) => {
  ctx.reply(`My name is ${CONFIG.BOT_NAME}! I'm an AI assistant created by ${CONFIG.CREATOR} to help you with intelligent conversations. How can I assist you today? 🤖`);
});

bot.hears(/.*(who created you|your creator).*/i, (ctx) => {
  ctx.reply(`I was created by ${CONFIG.CREATOR}, a skilled developer specializing in AI solutions. ${CONFIG.BOT_NAME} is designed to provide fast, helpful responses using Groq's cutting-edge AI technology! 🚀`);
});

// ================= ERROR HANDLING =================

bot.catch(async (err, ctx) => {
  console.error('Bot Error:', err);
  
  await ctx.reply('❌ An internal error occurred. Please try again.').catch(() => {});
  
  // Notify admin of error
  await notifyAdmin(ctx, 'error', { error: err.message }).catch(() => {});
});

// ================= START BOT =================

const PORT = process.env.PORT || 3000;
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>${CONFIG.BOT_NAME}</title></head>
      <body style="font-family: Arial; text-align: center; padding: 50px;">
        <h1>🤖 ${CONFIG.BOT_NAME} is Running!</h1>
        <p>Version: ${CONFIG.VERSION}</p>
        <p>Model: ${CONFIG.MODEL}</p>
        <p>Created by: ${CONFIG.CREATOR}</p>
        <p>Status: 🟢 Online</p>
        <p>Users: ${userData.size}</p>
        <small>Powered by Groq AI</small>
      </body>
    </html>
  `);
});

app.get('/stats', (req, res) => {
  res.json({
    botName: CONFIG.BOT_NAME,
    version: CONFIG.VERSION,
    model: CONFIG.MODEL,
    users: userData.size,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════╗
║   🚀 ${CONFIG.BOT_NAME} v${CONFIG.VERSION}          ║
╠═══════════════════════════════════╣
║ Web Server: http://localhost:${PORT}  ║
║ Model: ${CONFIG.MODEL}          ║
║ Creator: ${CONFIG.CREATOR}              ║
║ Status: ✅ Online                     ║
╚═══════════════════════════════════╝
  `);
  
  // Launch the bot
  bot.launch()
    .then(() => {
      console.log(`✅ ${CONFIG.BOT_NAME} is running!`);
      
      // Send startup notification
      bot.telegram.sendMessage(
        CONFIG.ADMIN_CHAT_ID,
        `🤖 **${CONFIG.BOT_NAME} v${CONFIG.VERSION}** started successfully at ${new Date().toLocaleString()}\n\n` +
        `📊 **Stats:**\n` +
        `• Model: ${CONFIG.MODEL}\n` +
        `• Port: ${PORT}\n` +
        `• Users: ${userData.size}`,
        { parse_mode: 'Markdown' }
      ).catch(console.error);
    })
    .catch(err => {
      console.error('❌ Failed to start bot:', err);
    });
});

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log('\n👋 Shutting down...');
  bot.stop('SIGTERM');
  process.exit(0);
});