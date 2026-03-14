import { Telegraf } from 'telegraf';
import Groq from 'groq-sdk';
import express from 'express';

// ================= CONFIGURATION =================
const CONFIG = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || '7826815609',
  MODEL: process.env.MODEL || 'llama-3.3-70b-versatile',
  MAX_MESSAGE_LENGTH: parseInt(process.env.MAX_MESSAGE_LENGTH) || 4096,
  BOT_NAME: 'KhanGPT',
  CREATOR: 'Farid Ahmad Khan',
  VERSION: '2.1.0',
  PORT: process.env.PORT || 10000
};

// Validate required environment variables
if (!CONFIG.BOT_TOKEN || !CONFIG.GROQ_API_KEY) {
  console.error('❌ Missing required environment variables!');
  console.error('BOT_TOKEN:', CONFIG.BOT_TOKEN ? '✓ Present' : '✗ Missing');
  console.error('GROQ_API_KEY:', CONFIG.GROQ_API_KEY ? '✓ Present' : '✗ Missing');
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
- Powered by Groq's fast AI infrastructure

When providing code:
1. Always use proper markdown code blocks with language specification
2. Format code with proper indentation and syntax highlighting
3. Keep code complete and runnable
4. Add comments to explain important parts
5. Include sample usage if applicable`;

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
        maxTokens: 2048, // Increased for code responses
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
 * Check if message contains code request
 */
function isCodeRequest(message) {
  const codeKeywords = [
    'code', 'program', 'script', 'function', 'class', 'write a', 
    'create a', 'implement', 'python', 'javascript', 'java', 'c++', 
    'html', 'css', 'php', 'ruby', 'swift', 'kotlin', 'rust', 'go',
    'algorithm', 'example', 'snippet'
  ];
  
  const lowerMessage = message.toLowerCase();
  return codeKeywords.some(keyword => lowerMessage.includes(keyword));
}

/**
 * Format code blocks for better display
 */
function formatCodeBlocks(text) {
  // Ensure code blocks have language specification
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  
  return text.replace(codeBlockRegex, (match, lang, code) => {
    // If no language specified, try to detect or default to text
    const language = lang || detectLanguage(code) || 'text';
    return `\`\`\`${language}\n${code.trim()}\n\`\`\``;
  });
}

/**
 * Detect programming language from code
 */
function detectLanguage(code) {
  const patterns = {
    python: [/def\s+\w+\s*\(/, /import\s+\w+/, /from\s+\w+\s+import/, /print\s*\(/, /if\s+__name__\s*==\s*['"]__main__['"]/],
    javascript: [/function\s+\w+\s*\(/, /const\s+\w+\s*=/, /let\s+\w+\s*=/, /console\.log/, /=>/, /document\./, /window\./],
    java: [/public\s+class/, /private\s+\w+/, /System\.out\.println/, /@Override/, /import\s+java\./],
    html: [/<html>/, /<body>/, /<div>/, /<script>/, /<!DOCTYPE\s+html>/i],
    css: [/^\s*\.\w+\s*\{/, /^\s*#\w+\s*\{/, /^\s*@media/, /color:\s*[^;]+;/, /margin:/],
    cpp: [/include\s*<[^>]+>/, /using namespace std/, /cout\s*<</, /cin\s*>>/, /int main\(\)/],
    sql: [/SELECT.*FROM/i, /INSERT INTO/i, /CREATE TABLE/i, /ALTER TABLE/i]
  };
  
  for (const [lang, patterns_list] of Object.entries(patterns)) {
    if (patterns_list.some(pattern => pattern.test(code))) {
      return lang;
    }
  }
  
  return null;
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

    let aiReply = chatCompletion.choices[0]?.message?.content || 
      'I apologize, but I received an empty response. Please try again.';

    // Format code blocks if this is a code request
    if (isCodeRequest(userMessage)) {
      aiReply = formatCodeBlocks(aiReply);
    }

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
  
  // Try to split by code blocks first to keep them intact
  const codeBlockRegex = /(```[\s\S]*?```)/g;
  const segments = text.split(codeBlockRegex);
  let currentPart = '';

  for (const segment of segments) {
    // If it's a code block, handle specially
    if (segment.startsWith('```') && segment.endsWith('```')) {
      if (currentPart.length + segment.length <= maxLength) {
        currentPart += segment;
      } else {
        if (currentPart) parts.push(currentPart);
        // If code block itself is too long, we have to split it (unfortunate but necessary)
        if (segment.length > maxLength) {
          const codeLines = segment.split('\n');
          let tempCode = '';
          for (const line of codeLines) {
            if (tempCode.length + line.length + 1 <= maxLength - 6) { // Reserve space for ``` markers
              tempCode += line + '\n';
            } else {
              if (tempCode) {
                parts.push('```\n' + tempCode + '```');
              }
              tempCode = line + '\n';
            }
          }
          if (tempCode) {
            parts.push('```\n' + tempCode + '```');
          }
        } else {
          currentPart = segment;
        }
      }
    } else {
      // Regular text - split by sentences
      const sentences = segment.match(/[^.!?]+[.!?]+/g) || [segment];
      for (const sentence of sentences) {
        if (currentPart.length + sentence.length <= maxLength) {
          currentPart += sentence;
        } else {
          if (currentPart) parts.push(currentPart.trim());
          currentPart = sentence;
        }
      }
    }
  }

  if (currentPart) parts.push(currentPart.trim());
  
  // Add continuation indicator
  return parts.map((part, index) => 
    `${part}${index < parts.length - 1 ? '\n\n_[continued...]_' : ''}`
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
• **Code formatting with syntax highlighting** ✨
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

💻 **Code Examples:**
Just ask for code in any language - it will be beautifully formatted!
Example: "Write a Python function to calculate fibonacci"

Send a message to start chatting!`;

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

**Code Features:**
• Ask for code in any language
• Receive formatted code blocks with syntax highlighting
• Code is easily copyable
• Language auto-detection

**Tips:**
• Ask me about my name or creator
• Request code like "Write a Python script for..."
• Code blocks are copyable with one click
• Use /clear to start fresh anytime

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
• **Code formatting with syntax highlighting** ✨
• Multiple language support
• User preference memory
• Smart response formatting
• Real-time typing indicators

**Features:**
• Message history: 15-20 exchanges
• Response length: Up to 2048 tokens
• Code auto-detection and formatting
• Admin notifications active

**Links:**
Creator: @faridahmadkhan
Version: ${CONFIG.VERSION}

Type /help for all commands! 🚀
  `;
  
  ctx.reply(about, { parse_mode: 'Markdown' });
});

// /model command with selection
bot.command('model', (ctx) => {
  const models = [
    { name: 'Llama 3.3 70B (Versatile)', id: 'llama-3.3-70b-versatile', desc: 'Latest, most powerful' },
    { name: 'Llama 3.3 70B (Fast)', id: 'llama-3.3-70b-specdec', desc: 'Fastest inference' },
    { name: 'Llama 3.1 70B', id: 'llama-3.1-70b-versatile', desc: 'Great all-rounder' },
    { name: 'Llama 3.1 8B', id: 'llama-3.1-8b-instant', desc: 'Fast and efficient' }
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
    return ctx.reply('Please specify a model ID. Example: `/setmodel llama-3.3-70b-versatile`', 
      { parse_mode: 'Markdown' });
  }
  
  const validModels = [
    'llama-3.3-70b-versatile',
    'llama-3.3-70b-specdec',
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant'
  ];
  
  if (validModels.includes(args)) {
    CONFIG.MODEL = args;
    ctx.reply(`✅ Model changed to \`${args}\` successfully!\n\nYour code responses will now use this model.`, 
      { parse_mode: 'Markdown' });
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
• **Code Formatting:** ✅ Enabled

**Commands to adjust:**
/settemp <0.1-1.5> - Change creativity
/settokens <100-4096> - Change max tokens
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
  
  if (isNaN(args) || args < 100 || args > 4096) {
    return ctx.reply('❌ Please provide valid token count between 100 and 4096');
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

// /code command - explicit code request handler
bot.command('code', (ctx) => {
  const query = ctx.message.text.replace('/code', '').trim();
  if (!query) {
    return ctx.reply('Please specify what code you want. Example: `/code python fibonacci function`', 
      { parse_mode: 'Markdown' });
  }
  
  // Process as a code request
  ctx.message.text = `Write code: ${query}`;
  // Let the message handler take over
  bot.handleUpdate(ctx.update);
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
    await ctx.reply(messageParts[i], { parse_mode: 'Markdown' });
  }
});

// Handle media with enhanced responses
bot.on(['photo', 'video', 'document', 'voice', 'sticker'], async (ctx) => {
  const mediaType = ctx.updateSubTypes[0];
  const user = getUserData(ctx.from.id);
  
  const responses = {
    photo: "📸 I see you've shared a photo! While I can't view images directly, I can discuss it if you describe it. Need code? Just ask!",
    video: "🎥 Thanks for sharing a video! Tell me what it's about and I'll help. I can also write code for you if needed.",
    document: "📄 Document received. Describe its contents and I'll assist! I'm particularly good at reading and explaining code files.",
    voice: "🎤 I received a voice message. Currently I can only process text, but feel free to type your message! I can help with code.",
    sticker: "😊 Nice sticker! Need help with some code? Just ask!"
  };
  
  await ctx.reply(responses[mediaType] || `📁 I received your ${mediaType}. Please send text messages for AI assistance, especially for code requests.`);

  // Notify admin
  await notifyAdmin(ctx, 'message', { 
    text: `[${mediaType.toUpperCase()}] Shared by user`,
    messageCount: user.stats.messageCount 
  });
});

// Handle commands for bot identity questions
bot.hears(/.*(your name|who are you|what is your name).*/i, (ctx) => {
  ctx.reply(`My name is ${CONFIG.BOT_NAME}! I'm an AI assistant created by ${CONFIG.CREATOR} to help you with intelligent conversations and **code generation**. Need a Python script? Just ask! 🤖`, 
    { parse_mode: 'Markdown' });
});

bot.hears(/.*(who created you|your creator).*/i, (ctx) => {
  ctx.reply(`I was created by ${CONFIG.CREATOR}, a skilled developer specializing in AI solutions. ${CONFIG.BOT_NAME} is designed to provide fast, helpful responses using Groq's cutting-edge AI technology - including **beautifully formatted code**! 🚀`, 
    { parse_mode: 'Markdown' });
});

// Handle explicit code requests
bot.hears(/^(python|javascript|java|cpp|html|css|php|ruby|go|rust|swift|kotlin)\s+code\s+for\s+(.+)/i, async (ctx) => {
  const matches = ctx.message.text.match(/^(\w+)\s+code\s+for\s+(.+)/i);
  if (matches) {
    const language = matches[1];
    const query = matches[2];
    ctx.message.text = `Write a ${language} program for ${query}`;
    // Let the message handler take over
    bot.handleUpdate(ctx.update);
  }
});

// ================= ERROR HANDLING =================

bot.catch(async (err, ctx) => {
  console.error('Bot Error:', err);
  
  await ctx.reply('❌ An internal error occurred. Please try again.').catch(() => {});
  
  // Notify admin of error
  await notifyAdmin(ctx, 'error', { error: err.message }).catch(() => {});
});

// ================= EXPRESS SERVER FOR RENDER =================

const app = express();

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>${CONFIG.BOT_NAME}</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
          .container { max-width: 800px; margin: 0 auto; }
          h1 { font-size: 3em; margin-bottom: 20px; }
          .status { background: rgba(255,255,255,0.2); padding: 20px; border-radius: 10px; margin: 20px 0; }
          .badge { background: #4CAF50; color: white; padding: 5px 15px; border-radius: 20px; display: inline-block; }
          .code-badge { background: #FF6B6B; color: white; padding: 5px 15px; border-radius: 20px; display: inline-block; margin-left: 10px; }
          .footer { margin-top: 50px; font-size: 0.9em; opacity: 0.8; }
          pre { background: #2d2d2d; color: #f8f8f2; padding: 15px; border-radius: 5px; text-align: left; overflow-x: auto; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 ${CONFIG.BOT_NAME}</h1>
          <div>
            <span class="badge">🟢 Online</span>
            <span class="code-badge">✨ Code Formatter</span>
          </div>
          <div class="status">
            <p><strong>Version:</strong> ${CONFIG.VERSION}</p>
            <p><strong>Model:</strong> ${CONFIG.MODEL}</p>
            <p><strong>Creator:</strong> ${CONFIG.CREATOR}</p>
            <p><strong>Users:</strong> ${userData.size}</p>
            <p><strong>Uptime:</strong> ${Math.floor(process.uptime() / 60)} minutes</p>
          </div>
          <p>Bot is running and ready to handle messages with <strong>beautiful code formatting!</strong></p>
          <p>Try asking: <em>"Write a Python function to calculate fibonacci"</em></p>
          <div class="footer">
            <p>Powered by Groq AI | Made with ❤️ by ${CONFIG.CREATOR}</p>
            <p><small>Code blocks are automatically formatted with syntax highlighting</small></p>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: CONFIG.VERSION,
    users: userData.size,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    model: CONFIG.MODEL,
    features: ['code-formatting', 'syntax-highlighting', 'markdown']
  });
});

// ================= START BOT AND SERVER =================

// Start express server
app.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   🚀 ${CONFIG.BOT_NAME} v${CONFIG.VERSION}                    ║
╠══════════════════════════════════════════════╣
║ Web Server: http://localhost:${CONFIG.PORT}           ║
║ Model: ${CONFIG.MODEL}        ║
║ Creator: ${CONFIG.CREATOR}                            ║
║ Status: ✅ Online                                   ║
║ Features: ✨ Code Formatting Enabled                  ║
╚══════════════════════════════════════════════╝
  `);
  
  // Launch the bot
  bot.launch()
    .then(() => {
      console.log(`✅ ${CONFIG.BOT_NAME} is running with code formatting!`);
      
      // Send startup notification
      bot.telegram.sendMessage(
        CONFIG.ADMIN_CHAT_ID,
        `🤖 **${CONFIG.BOT_NAME} v${CONFIG.VERSION}** started successfully at ${new Date().toLocaleString()}\n\n` +
        `📊 **Stats:**\n` +
        `• Model: ${CONFIG.MODEL}\n` +
        `• Port: ${CONFIG.PORT}\n` +
        `• Users: ${userData.size}\n` +
        `• Status: ✅ Online\n` +
        `• Features: ✨ Code Formatting\n\n` +
        `Code responses will now be beautifully formatted with syntax highlighting!`,
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