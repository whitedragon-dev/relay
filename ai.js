// ============================================
// SINGLE FILE: worker.js
// Complete Cloudflare Worker with Llama 4 AI
// Minimalist white UI + API endpoint
// ============================================

// ===== CONFIGURATION =====
const CONFIG = {
  defaultModel: '@cf/meta/llama-4-scout-17b-16e-instruct',
  defaultTemperature: 0.7,
  defaultMaxTokens: 1000,
  corsHeaders: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
};

// ===== HTML UI (Beautiful Minimalist) =====
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Chat</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #ffffff;
      color: #1a1a1a;
      height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .container {
      max-width: 700px;
      width: 100%;
      height: 90vh;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border-radius: 24px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.05);
      border: 1px solid #f0f0f0;
    }
    .header {
      padding: 24px 32px 16px 32px;
      border-bottom: 1px solid #f0f0f0;
    }
    .header h1 {
      font-size: 18px;
      font-weight: 500;
      letter-spacing: -0.3px;
      color: #1a1a1a;
    }
    .header .sub {
      font-size: 13px;
      color: #999;
      margin-top: 4px;
      font-weight: 400;
    }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 24px 32px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .messages::-webkit-scrollbar {
      width: 4px;
    }
    .messages::-webkit-scrollbar-thumb {
      background: #e0e0e0;
      border-radius: 10px;
    }
    .message {
      padding: 12px 16px;
      border-radius: 12px;
      max-width: 85%;
      line-height: 1.6;
      font-size: 15px;
      animation: fadeIn 0.3s ease;
    }
    .message.user {
      background: #f5f5f5;
      align-self: flex-end;
      color: #1a1a1a;
    }
    .message.ai {
      background: #fafafa;
      align-self: flex-start;
      border: 1px solid #f0f0f0;
      color: #1a1a1a;
    }
    .message .label {
      font-size: 11px;
      font-weight: 500;
      color: #999;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .message .content {
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .typing {
      padding: 12px 16px;
      color: #999;
      font-size: 14px;
      align-self: flex-start;
    }
    .typing::after {
      content: '...';
      animation: dots 1.5s infinite;
    }
    @keyframes dots {
      0%, 20% { content: '.'; }
      40%, 60% { content: '..'; }
      80%, 100% { content: '...'; }
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .input-area {
      padding: 16px 32px 24px 32px;
      border-top: 1px solid #f0f0f0;
      display: flex;
      gap: 12px;
    }
    .input-area input {
      flex: 1;
      padding: 12px 16px;
      border: 1px solid #e8e8e8;
      border-radius: 12px;
      font-size: 15px;
      outline: none;
      transition: border 0.2s;
      background: #fafafa;
      color: #1a1a1a;
    }
    .input-area input:focus {
      border-color: #1a1a1a;
      background: #ffffff;
    }
    .input-area input::placeholder {
      color: #bbb;
    }
    .input-area button {
      padding: 12px 24px;
      background: #1a1a1a;
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .input-area button:hover {
      background: #333;
      transform: scale(1.02);
    }
    .input-area button:active {
      transform: scale(0.98);
    }
    .input-area button:disabled {
      background: #e0e0e0;
      cursor: not-allowed;
      transform: none;
    }
    .footer {
      text-align: center;
      padding: 12px;
      font-size: 11px;
      color: #ddd;
      border-top: 1px solid #f5f5f5;
    }
    .error {
      color: #e74c3c;
      padding: 12px 16px;
      background: #fef2f2;
      border-radius: 12px;
      font-size: 14px;
      align-self: center;
      width: 100%;
      text-align: center;
    }
    .model-badge {
      display: inline-block;
      font-size: 11px;
      color: #999;
      background: #f5f5f5;
      padding: 2px 10px;
      border-radius: 20px;
      margin-left: 8px;
      font-weight: 400;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>
        ✦ AI Chat
        <span class="model-badge">Llama 4</span>
      </h1>
      <div class="sub">Ask anything</div>
    </div>
    
    <div class="messages" id="messages">
      <div class="message ai">
        <div class="label">AI</div>
        <div class="content">Hello! How can I help you today?</div>
      </div>
    </div>
    
    <div class="input-area">
      <input 
        type="text" 
        id="prompt" 
        placeholder="Type your message..." 
        autofocus
      />
      <button id="sendBtn">Send</button>
    </div>
    <div class="footer">Cloudflare Workers AI · Free tier</div>
  </div>

  <script>
    const messagesEl = document.getElementById('messages');
    const promptEl = document.getElementById('prompt');
    const sendBtn = document.getElementById('sendBtn');

    function addMessage(role, content) {
      const div = document.createElement('div');
      div.className = \`message \${role}\`;
      const label = role === 'user' ? 'You' : 'AI';
      div.innerHTML = \`<div class="label">\${label}</div><div class="content">\${content}</div>\`;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addTyping() {
      const div = document.createElement('div');
      div.className = 'typing';
      div.id = 'typing';
      div.textContent = 'AI is thinking';
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeTyping() {
      const typing = document.getElementById('typing');
      if (typing) typing.remove();
    }

    function addError(msg) {
      const div = document.createElement('div');
      div.className = 'error';
      div.textContent = '⚠️ ' + msg;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function sendMessage() {
      const prompt = promptEl.value.trim();
      if (!prompt) return;

      // Disable UI
      sendBtn.disabled = true;
      promptEl.disabled = true;
      
      // Add user message
      addMessage('user', prompt);
      promptEl.value = '';
      
      // Add typing indicator
      addTyping();

      try {
        const response = await fetch('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });

        removeTyping();

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Something went wrong');
        }

        const data = await response.json();
        addMessage('ai', data.response);

      } catch (error) {
        removeTyping();
        addError(error.message || 'Failed to get response');
      } finally {
        // Re-enable UI
        sendBtn.disabled = false;
        promptEl.disabled = false;
        promptEl.focus();
      }
    }

    // Event listeners
    sendBtn.addEventListener('click', sendMessage);
    promptEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  </script>
</body>
</html>`;

// ===== MAIN WORKER =====
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CONFIG.corsHeaders });
    }

    // Serve UI
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(HTML, {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
          ...CONFIG.corsHeaders
        }
      });
    }

    // Health check
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ok', model: CONFIG.defaultModel }, {
        headers: CONFIG.corsHeaders
      });
    }

    // AI Chat endpoint
    if (request.method === 'POST' && url.pathname === '/chat') {
      try {
        // Parse request
        const body = await request.json().catch(() => { throw new Error('Invalid JSON'); });
        const { prompt, temperature = CONFIG.defaultTemperature, max_tokens = CONFIG.defaultMaxTokens } = body;

        if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
          return Response.json(
            { error: 'Prompt is required' },
            { status: 400, headers: CONFIG.corsHeaders }
          );
        }

        // Call AI
        const response = await env.AI.run(CONFIG.defaultModel, {
          messages: [{ role: 'user', content: prompt.trim() }],
          temperature: Math.min(1, Math.max(0, temperature)),
          max_tokens: Math.min(2048, Math.max(1, max_tokens))
        });

        // Extract response text
        const aiResponse = response.response || response.message?.content || JSON.stringify(response);

        return Response.json({
          success: true,
          response: aiResponse,
          model: CONFIG.defaultModel.split('/').pop(),
          usage: response.usage || null
        }, {
          headers: CONFIG.corsHeaders
        });

      } catch (error) {
        console.error('AI Error:', error);
        
        // Handle specific errors
        let status = 500;
        let message = error.message || 'Internal server error';
        
        if (error.message?.includes('403')) {
          status = 403;
          message = 'Please accept the Llama 4 license in the Cloudflare dashboard first.';
        } else if (error.message?.includes('429')) {
          status = 429;
          message = 'Daily neuron limit reached. Please try again tomorrow.';
        }

        return Response.json(
          { error: message },
          { status, headers: CONFIG.corsHeaders }
        );
      }
    }

    // 404
    return new Response('Not found', { 
      status: 404,
      headers: CONFIG.corsHeaders
    });
  }
};
