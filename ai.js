// ============================================
// SINGLE FILE: Cloudflare Worker with Llama 4 AI
// ============================================

// ===== CONFIGURATION =====
var CONFIG = {
  MODEL: '@cf/meta/llama-4-scout-17b-16e-instruct',
  TEMPERATURE: 0.7,
  MAX_TOKENS: 1000,
  CORS_ORIGIN: '*'
};

// ===== HTML UI =====
var UI_HTML = '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'  <meta charset="UTF-8" />' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
'  <title>Llama 4 AI Chat</title>' +
'  <style>' +
'    * { margin: 0; padding: 0; box-sizing: border-box; }' +
'    body {' +
'      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif;' +
'      background: #ffffff;' +
'      color: #1a1a1a;' +
'      height: 100vh;' +
'      display: flex;' +
'      flex-direction: column;' +
'    }' +
'    .header {' +
'      padding: 24px 32px 12px 32px;' +
'      border-bottom: 1px solid #f0f0f0;' +
'      flex-shrink: 0;' +
'    }' +
'    .header h1 { font-size: 20px; font-weight: 500; letter-spacing: -0.3px; color: #1a1a1a; }' +
'    .header .subtitle { font-size: 13px; color: #888; margin-top: 4px; font-weight: 400; }' +
'    .model-bar {' +
'      padding: 12px 32px;' +
'      border-bottom: 1px solid #f0f0f0;' +
'      display: flex;' +
'      align-items: center;' +
'      gap: 12px;' +
'      flex-shrink: 0;' +
'      flex-wrap: wrap;' +
'    }' +
'    .model-bar label { font-size: 13px; color: #555; font-weight: 450; }' +
'    .model-bar select {' +
'      padding: 6px 12px;' +
'      border: 1px solid #e0e0e0;' +
'      border-radius: 6px;' +
'      font-size: 13px;' +
'      background: #fafafa;' +
'      color: #1a1a1a;' +
'      cursor: pointer;' +
'      outline: none;' +
'      transition: border 0.2s;' +
'    }' +
'    .model-bar select:hover { border-color: #bbb; }' +
'    .model-bar select:focus { border-color: #666; }' +
'    .model-bar .badge {' +
'      font-size: 11px;' +
'      color: #999;' +
'      background: #f5f5f5;' +
'      padding: 2px 10px;' +
'      border-radius: 12px;' +
'      margin-left: 4px;' +
'    }' +
'    .controls {' +
'      padding: 8px 32px;' +
'      border-bottom: 1px solid #f0f0f0;' +
'      display: flex;' +
'      gap: 16px;' +
'      flex-shrink: 0;' +
'    }' +
'    .controls button {' +
'      padding: 4px 16px;' +
'      background: none;' +
'      border: 1px solid #e0e0e0;' +
'      border-radius: 4px;' +
'      font-size: 12px;' +
'      color: #666;' +
'      cursor: pointer;' +
'      transition: all 0.2s;' +
'    }' +
'    .controls button:hover { background: #f5f5f5; border-color: #bbb; }' +
'    .controls .memory-indicator {' +
'      font-size: 12px;' +
'      color: #999;' +
'      margin-left: auto;' +
'    }' +
'    .chat-container {' +
'      flex: 1;' +
'      overflow-y: auto;' +
'      padding: 24px 32px;' +
'      display: flex;' +
'      flex-direction: column;' +
'      gap: 16px;' +
'    }' +
'    .message {' +
'      max-width: 80%;' +
'      padding: 12px 18px;' +
'      border-radius: 12px;' +
'      line-height: 1.6;' +
'      font-size: 15px;' +
'      word-wrap: break-word;' +
'      animation: fadeIn 0.3s ease;' +
'    }' +
'    .message.user {' +
'      align-self: flex-end;' +
'      background: #1a1a1a;' +
'      color: #ffffff;' +
'      border-bottom-right-radius: 4px;' +
'    }' +
'    .message.assistant {' +
'      align-self: flex-start;' +
'      background: #f5f5f5;' +
'      color: #1a1a1a;' +
'      border-bottom-left-radius: 4px;' +
'    }' +
'    .message .label {' +
'      font-size: 11px;' +
'      font-weight: 500;' +
'      text-transform: uppercase;' +
'      letter-spacing: 0.5px;' +
'      opacity: 0.6;' +
'      margin-bottom: 4px;' +
'    }' +
'    .message.user .label { color: #aaa; }' +
'    .message.assistant .label { color: #888; }' +
'    .message pre {' +
'      background: rgba(0,0,0,0.05);' +
'      padding: 10px 14px;' +
'      border-radius: 6px;' +
'      overflow-x: auto;' +
'      margin: 8px 0;' +
'      font-size: 13px;' +
'      font-family: "SF Mono", "Menlo", "Monaco", "Courier New", monospace;' +
'    }' +
'    .message.assistant pre { background: rgba(0,0,0,0.06); }' +
'    .message.user pre { background: rgba(255,255,255,0.1); }' +
'    .message code {' +
'      font-family: "SF Mono", "Menlo", "Monaco", "Courier New", monospace;' +
'      font-size: 13px;' +
'      background: rgba(0,0,0,0.05);' +
'      padding: 2px 6px;' +
'      border-radius: 4px;' +
'    }' +
'    .message.assistant code { background: rgba(0,0,0,0.06); }' +
'    .message.user code { background: rgba(255,255,255,0.1); }' +
'    .message p { margin: 6px 0; }' +
'    .message ul, .message ol { padding-left: 24px; margin: 6px 0; }' +
'    .message li { margin: 2px 0; list-style-position: inside; }' +
'    .message ul li { list-style-type: disc; }' +
'    .message ol li { list-style-type: decimal; }' +
'    .message blockquote {' +
'      border-left: 3px solid #ccc;' +
'      padding-left: 14px;' +
'      margin: 8px 0;' +
'      opacity: 0.8;' +
'    }' +
'    .message h1, .message h2, .message h3, .message h4 {' +
'      margin: 12px 0 6px 0;' +
'      font-weight: 600;' +
'    }' +
'    .message h1 { font-size: 22px; }' +
'    .message h2 { font-size: 19px; }' +
'    .message h3 { font-size: 17px; }' +
'    .typing-indicator {' +
'      align-self: flex-start;' +
'      background: #f5f5f5;' +
'      padding: 12px 20px;' +
'      border-radius: 12px;' +
'      border-bottom-left-radius: 4px;' +
'      display: none;' +
'      gap: 4px;' +
'    }' +
'    .typing-indicator span {' +
'      width: 8px;' +
'      height: 8px;' +
'      background: #999;' +
'      border-radius: 50%;' +
'      display: inline-block;' +
'      animation: bounce 1.4s infinite ease-in-out both;' +
'    }' +
'    .typing-indicator span:nth-child(1) { animation-delay: -0.32s; }' +
'    .typing-indicator span:nth-child(2) { animation-delay: -0.16s; }' +
'    .typing-indicator span:nth-child(3) { animation-delay: 0s; }' +
'    @keyframes bounce {' +
'      0%, 80%, 100% { transform: scale(0); }' +
'      40% { transform: scale(1); }' +
'    }' +
'    @keyframes fadeIn {' +
'      from { opacity: 0; transform: translateY(8px); }' +
'      to { opacity: 1; transform: translateY(0); }' +
'    }' +
'    .input-area {' +
'      padding: 16px 32px 24px 32px;' +
'      border-top: 1px solid #f0f0f0;' +
'      flex-shrink: 0;' +
'      display: flex;' +
'      gap: 12px;' +
'      align-items: flex-end;' +
'    }' +
'    .input-area textarea {' +
'      flex: 1;' +
'      padding: 12px 16px;' +
'      border: 1px solid #e0e0e0;' +
'      border-radius: 8px;' +
'      font-size: 14px;' +
'      font-family: inherit;' +
'      resize: none;' +
'      min-height: 48px;' +
'      max-height: 150px;' +
'      outline: none;' +
'      transition: border 0.2s;' +
'      line-height: 1.5;' +
'      background: #fafafa;' +
'    }' +
'    .input-area textarea:focus {' +
'      border-color: #1a1a1a;' +
'      background: #ffffff;' +
'    }' +
'    .input-area textarea::placeholder { color: #bbb; }' +
'    .input-area button {' +
'      padding: 12px 28px;' +
'      background: #1a1a1a;' +
'      color: #ffffff;' +
'      border: none;' +
'      border-radius: 8px;' +
'      font-size: 14px;' +
'      font-weight: 500;' +
'      cursor: pointer;' +
'      transition: all 0.2s;' +
'      white-space: nowrap;' +
'      height: 48px;' +
'    }' +
'    .input-area button:hover:not(:disabled) { background: #333; transform: scale(0.98); }' +
'    .input-area button:disabled { opacity: 0.4; cursor: not-allowed; }' +
'    .error-toast {' +
'      position: fixed;' +
'      bottom: 100px;' +
'      left: 50%;' +
'      transform: translateX(-50%);' +
'      background: #fee;' +
'      color: #c00;' +
'      padding: 12px 24px;' +
'      border-radius: 8px;' +
'      font-size: 14px;' +
'      border: 1px solid #fcc;' +
'      display: none;' +
'      box-shadow: 0 4px 12px rgba(0,0,0,0.06);' +
'      max-width: 90%;' +
'    }' +
'    .error-toast.show { display: block; animation: fadeIn 0.3s ease; }' +
'    .chat-container::-webkit-scrollbar { width: 5px; }' +
'    .chat-container::-webkit-scrollbar-track { background: #f5f5f5; }' +
'    .chat-container::-webkit-scrollbar-thumb { background: #ddd; border-radius: 10px; }' +
'    .chat-container::-webkit-scrollbar-thumb:hover { background: #bbb; }' +
'    @media (max-width: 640px) {' +
'      .header { padding: 16px 20px 8px 20px; }' +
'      .model-bar { padding: 10px 20px; }' +
'      .controls { padding: 6px 20px; flex-wrap: wrap; }' +
'      .chat-container { padding: 16px 20px; }' +
'      .input-area { padding: 12px 20px 16px 20px; flex-wrap: wrap; }' +
'      .message { max-width: 92%; font-size: 14px; }' +
'      .input-area textarea { min-height: 40px; }' +
'      .input-area button { width: 100%; height: 44px; }' +
'    }' +
'  </style>' +
'</head>' +
'<body>' +
'  <div class="header">' +
'    <h1>Llama 4</h1>' +
'    <div class="subtitle">Ask anything &#183; 17B parameter model</div>' +
'  </div>' +
'  <div class="model-bar">' +
'    <label for="modelSelect">Model</label>' +
'    <select id="modelSelect">' +
'      <option value="@cf/meta/llama-4-scout-17b-16e-instruct">Llama 4 Scout 17B</option>' +
'      <option value="@cf/meta/llama-3.1-8b-instruct">Llama 3.1 8B</option>' +
'      <option value="@cf/mistral/mistral-7b-instruct">Mistral 7B</option>' +
'      <option value="@cf/google/gemma-2-2b-it">Gemma 2B</option>' +
'    </select>' +
'    <span class="badge">Free Tier</span>' +
'  </div>' +
'  <div class="controls">' +
'    <button id="clearMemoryBtn">Clear Memory</button>' +
'    <span class="memory-indicator" id="memoryIndicator">0 messages in context</span>' +
'  </div>' +
'  <div class="chat-container" id="chatContainer">' +
'    <div class="message assistant">' +
'      <div class="label">Assistant</div>' +
'      <p>Hello! I\'m Llama 4. Ask me anything. I remember our conversation!</p>' +
'    </div>' +
'  </div>' +
'  <div class="typing-indicator" id="typingIndicator">' +
'    <span></span><span></span><span></span>' +
'  </div>' +
'  <div class="error-toast" id="errorToast"></div>' +
'  <div class="input-area">' +
'    <textarea id="userInput" rows="1" placeholder="Type your message..." maxlength="2000"></textarea>' +
'    <button id="sendBtn">Send</button>' +
'  </div>' +
'  <script>' +
'    var chatContainer = document.getElementById("chatContainer");' +
'    var userInput = document.getElementById("userInput");' +
'    var sendBtn = document.getElementById("sendBtn");' +
'    var modelSelect = document.getElementById("modelSelect");' +
'    var typingIndicator = document.getElementById("typingIndicator");' +
'    var errorToast = document.getElementById("errorToast");' +
'    var clearMemoryBtn = document.getElementById("clearMemoryBtn");' +
'    var memoryIndicator = document.getElementById("memoryIndicator");' +
'    var isProcessing = false;' +
'    var conversationHistory = [];' +
'' +
'    function renderMarkdown(text) {' +
'      if (!text) return "";' +
'      var html = text;' +
'      html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");' +
'      var lines = html.split("\\n");' +
'      var result = [];' +
'      var inList = false;' +
'      var listType = "";' +
'      var inCodeBlock = false;' +
'      var codeBlock = [];' +
'      for (var i = 0; i < lines.length; i++) {' +
'        var line = lines[i];' +
'        if (line.trim() === "") {' +
'          if (inList) {' +
'            if (listType === "ul") result.push("</ul>");' +
'            else if (listType === "ol") result.push("</ol>");' +
'            inList = false;' +
'            listType = "";' +
'          }' +
'          continue;' +
'        }' +
'        if (line.match(/^```/)) {' +
'          if (!inCodeBlock) {' +
'            inCodeBlock = true;' +
'            codeBlock = [];' +
'          } else {' +
'            inCodeBlock = false;' +
'            result.push("<pre><code>" + codeBlock.join("\\n").trim() + "</code></pre>");' +
'          }' +
'          continue;' +
'        }' +
'        if (inCodeBlock) {' +
'          codeBlock.push(line);' +
'          continue;' +
'        }' +
'        if (line.match(/^### /)) {' +
'          result.push("<h3>" + line.replace(/^### /, "") + "</h3>");' +
'        } else if (line.match(/^## /)) {' +
'          result.push("<h2>" + line.replace(/^## /, "") + "</h2>");' +
'        } else if (line.match(/^# /)) {' +
'          result.push("<h1>" + line.replace(/^# /, "") + "</h1>");' +
'        } else if (line.match(/^> /)) {' +
'          result.push("<blockquote>" + line.replace(/^> /, "") + "</blockquote>");' +
'        } else if (line.match(/^\\s*[-*+]\\s/)) {' +
'          if (!inList || listType !== "ul") {' +
'            if (inList) result.push("</ul>");' +
'            result.push("<ul>");' +
'            inList = true;' +
'            listType = "ul";' +
'          }' +
'          result.push("<li>" + line.replace(/^\\s*[-*+]\\s/, "") + "</li>");' +
'        } else if (line.match(/^\\s*\\d+\\.\\s/)) {' +
'          if (!inList || listType !== "ol") {' +
'            if (inList) result.push("</ol>");' +
'            result.push("<ol>");' +
'            inList = true;' +
'            listType = "ol";' +
'          }' +
'          result.push("<li>" + line.replace(/^\\s*\\d+\\.\\s/, "") + "</li>");' +
'        } else {' +
'          if (inList) {' +
'            if (listType === "ul") result.push("</ul>");' +
'            else if (listType === "ol") result.push("</ol>");' +
'            inList = false;' +
'            listType = "";' +
'          }' +
'          result.push("<p>" + line + "</p>");' +
'        }' +
'      }' +
'      if (inList) {' +
'        if (listType === "ul") result.push("</ul>");' +
'        else if (listType === "ol") result.push("</ol>");' +
'      }' +
'      html = result.join("");' +
'      html = html.replace(/`([^`]+)`/g, "<code>$1</code>");' +
'      html = html.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");' +
'      html = html.replace(/\\*([^*]+)\\*/g, "<em>$1</em>");' +
'      html = html.replace(/\\n/g, "<br>");' +
'      return html;' +
'    }' +
'' +
'    function updateMemoryIndicator() {' +
'      var count = conversationHistory.length;' +
'      memoryIndicator.textContent = count + " messages in context";' +
'    }' +
'' +
'    userInput.addEventListener("input", function() {' +
'      userInput.style.height = "auto";' +
'      userInput.style.height = Math.min(userInput.scrollHeight, 150) + "px";' +
'    });' +
'' +
'    userInput.addEventListener("keydown", function(e) {' +
'      if (e.key === "Enter" && !e.shiftKey) {' +
'        e.preventDefault();' +
'        sendMessage();' +
'      }' +
'    });' +
'' +
'    function sendMessage() {' +
'      var prompt = userInput.value.trim();' +
'      if (!prompt || isProcessing) return;' +
'      addMessage("user", prompt);' +
'      conversationHistory.push({ role: "user", content: prompt });' +
'      updateMemoryIndicator();' +
'      userInput.value = "";' +
'      userInput.style.height = "auto";' +
'      isProcessing = true;' +
'      sendBtn.disabled = true;' +
'      showTyping(true);' +
'      var model = modelSelect.value;' +
'      fetch("/chat", {' +
'        method: "POST",' +
'        headers: { "Content-Type": "application/json" },' +
'        body: JSON.stringify({' +
'          prompt: prompt,' +
'          model: model,' +
'          temperature: 0.7,' +
'          max_tokens: 1000,' +
'          history: conversationHistory.slice(0, -1)' +
'        })' +
'      })' +
'      .then(function(response) {' +
'        return response.json().then(function(data) {' +
'          if (!response.ok) {' +
'            throw new Error(data.error || "Request failed");' +
'          }' +
'          return data;' +
'        });' +
'      })' +
'      .then(function(data) {' +
'        addMessage("assistant", data.response);' +
'        conversationHistory.push({ role: "assistant", content: data.response });' +
'        updateMemoryIndicator();' +
'        showError(null);' +
'      })' +
'      .catch(function(err) {' +
'        showError(err.message);' +
'        console.error("Error:", err);' +
'      })' +
'      .finally(function() {' +
'        isProcessing = false;' +
'        sendBtn.disabled = false;' +
'        showTyping(false);' +
'        userInput.focus();' +
'      });' +
'    }' +
'' +
'    function addMessage(role, content) {' +
'      var div = document.createElement("div");' +
'      div.className = "message " + role;' +
'      var label = document.createElement("div");' +
'      label.className = "label";' +
'      label.textContent = role === "user" ? "You" : "Assistant";' +
'      var contentDiv = document.createElement("div");' +
'      if (role === "assistant") {' +
'        contentDiv.innerHTML = renderMarkdown(content);' +
'      } else {' +
'        contentDiv.textContent = content;' +
'      }' +
'      div.appendChild(label);' +
'      div.appendChild(contentDiv);' +
'      chatContainer.appendChild(div);' +
'      chatContainer.scrollTop = chatContainer.scrollHeight;' +
'    }' +
'' +
'    function showTyping(visible) {' +
'      typingIndicator.style.display = visible ? "flex" : "none";' +
'      if (visible) {' +
'        chatContainer.scrollTop = chatContainer.scrollHeight;' +
'      }' +
'    }' +
'' +
'    function showError(message) {' +
'      if (message) {' +
'        errorToast.textContent = "\u26a0\ufe0f " + message;' +
'        errorToast.classList.add("show");' +
'        setTimeout(function() {' +
'          errorToast.classList.remove("show");' +
'        }, 5000);' +
'      } else {' +
'        errorToast.classList.remove("show");' +
'      }' +
'    }' +
'' +
'    function clearMemory() {' +
'      conversationHistory = [];' +
'      updateMemoryIndicator();' +
'      chatContainer.innerHTML = "";' +
'      var div = document.createElement("div");' +
'      div.className = "message assistant";' +
'      var label = document.createElement("div");' +
'      label.className = "label";' +
'      label.textContent = "Assistant";' +
'      var contentDiv = document.createElement("div");' +
'      contentDiv.innerHTML = "<p>Memory cleared! Starting fresh. Ask me anything.</p>";' +
'      div.appendChild(label);' +
'      div.appendChild(contentDiv);' +
'      chatContainer.appendChild(div);' +
'      showError(null);' +
'    }' +
'' +
'    clearMemoryBtn.addEventListener("click", clearMemory);' +
'    sendBtn.addEventListener("click", sendMessage);' +
'    updateMemoryIndicator();' +
'    userInput.focus();' +
'  <\/script>' +
'</body>' +
'</html>';

// ============================================
// WORKER HANDLER
// ============================================

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    var method = request.method;

    // CORS
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': CONFIG.CORS_ORIGIN,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // Serve UI
    if (method === 'GET' && url.pathname === '/') {
      return new Response(UI_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': CONFIG.CORS_ORIGIN
        }
      });
    }

    // Health check
    if (method === 'GET' && url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        model: CONFIG.MODEL,
        timestamp: new Date().toISOString()
      }, {
        headers: { 'Access-Control-Allow-Origin': CONFIG.CORS_ORIGIN }
      });
    }

    // AI Chat endpoint
    if (method === 'POST' && url.pathname === '/chat') {
      try {
        var body = await request.json();
        var prompt = body.prompt ? body.prompt.trim() : '';
        
        if (!prompt) {
          return Response.json(
            { error: 'Prompt is required' },
            { status: 400, headers: { 'Access-Control-Allow-Origin': CONFIG.CORS_ORIGIN } }
          );
        }

        var model = body.model || CONFIG.MODEL;
        var temperature = body.temperature !== undefined ? body.temperature : CONFIG.TEMPERATURE;
        var max_tokens = body.max_tokens || CONFIG.MAX_TOKENS;

        // Build messages with conversation history
        var messages = [];
        
        // Add system prompt if provided
        if (body.system) {
          messages.push({ role: 'system', content: body.system });
        }
        
        // Add conversation history
        if (body.history && body.history.length > 0) {
          for (var i = 0; i < body.history.length; i++) {
            messages.push(body.history[i]);
          }
        }
        
        // Add current prompt
        messages.push({ role: 'user', content: prompt });

        var response = await env.AI.run(model, {
          messages: messages,
          temperature: temperature,
          max_tokens: max_tokens
        });

        var resultText = response.response || response.result || JSON.stringify(response);

        return Response.json({
          success: true,
          response: resultText,
          model: model,
          usage: response.usage || null
        }, {
          headers: { 'Access-Control-Allow-Origin': CONFIG.CORS_ORIGIN }
        });

      } catch (err) {
        var isLicenseError = err.message && (err.message.includes('403') || err.message.includes('license'));
        var status = isLicenseError ? 403 : 500;
        var message = isLicenseError
          ? 'Llama 4 license not accepted. Visit Cloudflare dashboard > AI > Models and agree to terms.'
          : err.message || 'AI service error';

        return Response.json(
          { error: message },
          { status: status, headers: { 'Access-Control-Allow-Origin': CONFIG.CORS_ORIGIN } }
        );
      }
    }

    // 404
    return new Response('Not Found', {
      status: 404,
      headers: { 'Access-Control-Allow-Origin': CONFIG.CORS_ORIGIN }
    });
  }
};
