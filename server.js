const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const url = require('url');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置常量
const UPSTREAM_HOST = 'https://generativelanguage.googleapis.com';
const DEFAULT_API_VERSION = 'v1beta';
const DEBUG_MODE = process.env.DEBUG === 'true';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --------------------------------------------------------------------------
// 1. Web UI 静态 HTML 字符串 (直接集成)
// --------------------------------------------------------------------------
const WEB_UI_HTML = `
<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gemini Pro Advanced</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css" rel="stylesheet">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&display=swap');
        body { font-family: 'Inter', sans-serif; }
        .glass { background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.3); }
        .chat-container::-webkit-scrollbar { width: 5px; }
        .chat-container::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .typing-dot { width: 4px; height: 4px; background: #3b82f6; border-radius: 50%; animation: bounce 1.4s infinite ease-in-out; }
        @keyframes bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
        pre { background: #1e293b; color: #f8fafc; padding: 1rem; border-radius: 0.75rem; margin: 0.5rem 0; overflow-x: auto; }
    </style>
</head>
<body class="h-full bg-slate-50 text-slate-900 flex flex-col transition-colors duration-300">

    <nav class="glass sticky top-0 z-50 px-6 py-3 flex items-center justify-between border-b border-slate-200">
        <div class="flex items-center gap-2">
            <div class="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-blue-200">G</div>
            <span class="font-semibold tracking-tight text-slate-700">Gemini Proxy Next</span>
        </div>
        <div class="flex items-center gap-3">
            <input type="password" id="apiKey" placeholder="Gemini API Key" class="text-sm border border-slate-200 rounded-full px-4 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none transition-all w-48 lg:w-64">
            <button onclick="loadModels()" class="bg-slate-900 text-white text-sm px-4 py-1.5 rounded-full hover:bg-slate-800 transition-all active:scale-95">连接</button>
            <select id="modelSelect" class="text-sm border border-slate-200 rounded-full px-3 py-1.5 bg-white outline-none hidden md:block">
                <option value="">选择模型</option>
            </select>
        </div>
    </nav>

    <main class="flex-grow overflow-hidden flex flex-col max-w-5xl mx-auto w-full">
        <div id="chatBox" class="flex-grow overflow-y-auto p-6 space-y-6 chat-container">
            <div class="flex flex-col items-center justify-center h-full text-center space-y-4 animate__animated animate__fadeIn">
                <div class="p-4 bg-white rounded-2xl shadow-sm border border-slate-100">
                    <p class="text-slate-500 text-sm">欢迎体验 Gemini 1.5 极速版</p>
                    <p class="text-xs text-slate-400">支持原生 OCR、长上下文与流式输出</p>
                </div>
            </div>
        </div>

        <div id="imagePreviewContainer" class="hidden px-6 py-2">
            <div class="relative inline-block group">
                <img id="imagePreview" src="" class="h-24 w-24 object-cover rounded-xl shadow-md border-2 border-white">
                <button onclick="clearImage()" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">×</button>
            </div>
        </div>

        <div class="p-6">
            <div class="relative glass rounded-2xl border border-slate-200 shadow-xl focus-within:ring-2 focus-within:ring-blue-400 transition-all">
                <textarea id="userInput" rows="1" class="w-full bg-transparent border-none focus:ring-0 p-4 pr-24 resize-none text-slate-700" placeholder="输入消息..."></textarea>
                <div class="absolute right-2 bottom-2 flex items-center gap-2">
                    <label class="cursor-pointer p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
                        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                        <input type="file" id="fileInput" class="hidden" accept="image/*" onchange="previewImage(this)">
                    </label>
                    <button id="sendBtn" onclick="sendMessage()" class="bg-blue-600 text-white p-2 rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all active:scale-90">
                        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                    </button>
                </div>
            </div>
        </div>
    </main>

    <script>
        let chatHistory = [];
        let currentImageBase64 = null;

        document.getElementById('apiKey').value = localStorage.getItem('gemini_key') || '';

        async function loadModels() {
            const key = document.getElementById('apiKey').value;
            if (!key) return;
            localStorage.setItem('gemini_key', key);
            try {
                const res = await fetch(\`/v1beta/models?key=\${key}\`);
                const data = await res.json();
                const select = document.getElementById('modelSelect');
                select.innerHTML = '';
                data.models.filter(m => m.name.includes('gemini')).forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.name;
                    opt.innerText = m.displayName;
                    if(m.name.includes('1.5-flash')) opt.selected = true;
                    select.appendChild(opt);
                });
            } catch (e) { console.error('Failed to load models'); }
        }

        function previewImage(input) {
            const file = input.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    currentImageBase64 = e.target.result.split(',')[1];
                    document.getElementById('imagePreview').src = e.target.result;
                    document.getElementById('imagePreviewContainer').classList.remove('hidden');
                };
                reader.readAsDataURL(file);
            }
        }

        function clearImage() {
            currentImageBase64 = null;
            document.getElementById('imagePreviewContainer').classList.add('hidden');
        }

        function appendMessage(role, text, imgBase64 = null) {
            const box = document.getElementById('chatBox');
            if(box.firstElementChild && box.firstElementChild.classList.contains('animate__fadeIn')) box.innerHTML = '';
            
            const wrapper = document.createElement('div');
            wrapper.className = \`flex \${role === 'user' ? 'justify-end' : 'justify-start'} animate__animated animate__fadeInUp animate__faster\`;
            
            const content = \`
                <div class="max-w-[85%] \${role === 'user' ? 'bg-blue-600 text-white shadow-blue-100' : 'bg-white border border-slate-100 shadow-sm'} rounded-2xl px-4 py-3 shadow-md">
                    \${imgBase64 ? \`<img src="data:image/jpeg;base64,\${imgBase64}" class="rounded-lg mb-2 max-h-64 shadow-inner">\` : ''}
                    <div class="prose \${role === 'user' ? 'prose-invert' : 'text-slate-700'} text-sm leading-relaxed">\${role === 'user' ? text : marked.parse(text)}</div>
                </div>\`;
            wrapper.innerHTML = content;
            box.appendChild(wrapper);
            box.scrollTop = box.scrollHeight;
            return wrapper.querySelector('.prose');
        }

        async function sendMessage() {
            const input = document.getElementById('userInput');
            const key = document.getElementById('apiKey').value;
            const model = document.getElementById('modelSelect').value;
            const text = input.value.trim();

            if (!text && !currentImageBase64) return;
            if (!key) return alert('请输入 API Key');

            const aiDiv = appendMessage('user', text, currentImageBase64);
            const userParts = [{ text: text || "请分析这张图片" }];
            if (currentImageBase64) userParts.push({ inline_data: { mime_type: "image/jpeg", data: currentImageBase64 } });
            
            chatHistory.push({ role: "user", parts: userParts });
            input.value = '';
            clearImage();

            const aiResponseDiv = appendMessage('model', '<div class="flex gap-1"><div class="typing-dot"></div><div class="typing-dot" style="animation-delay: 0.2s"></div><div class="typing-dot" style="animation-delay: 0.4s"></div></div>');

            try {
                const response = await fetch(\`\${model}:streamGenerateContent?key=\${key}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: chatHistory })
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullText = '';
                aiResponseDiv.innerHTML = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\\n');
                    for (let line of lines) {
                        if (!line || !line.includes('"text":')) continue;
                        try {
                            const match = line.match(/"text":\\s*"(.*)"/);
                            if (match) {
                                let content = JSON.parse(\`{"t":"\${match[1]}"}\`).t;
                                fullText += content;
                                aiResponseDiv.innerHTML = marked.parse(fullText);
                            }
                        } catch (e) {}
                    }
                }
                chatHistory.push({ role: "model", parts: [{ text: fullText }] });
            } catch (e) { aiResponseDiv.innerText = "Error connecting to server."; }
        }

        document.getElementById('userInput').addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });
    </script>
</body>
</html>
`;

// --------------------------------------------------------------------------
// 2. 辅助逻辑 (API Key, 版本控制等)
// --------------------------------------------------------------------------
function extractApiKey(req) {
    if (req.headers['x-goog-api-key']) return req.headers['x-goog-api-key'];
    const auth = req.headers['authorization'];
    if (auth) {
        const match = auth.match(/^Bearer\s+(.+)$/i);
        return match ? match[1].trim() : auth.trim();
    }
    const queryKeys = ['key', 'api_key', 'apikey'];
    for (const key of queryKeys) if (req.query[key]) return req.query[key];
    return null;
}

// --------------------------------------------------------------------------
// 3. 路由处理
// --------------------------------------------------------------------------

// 首页：渲染 Web UI
app.get('/', (req, res) => {
    res.send(WEB_UI_HTML);
});

// 通用代理逻辑
app.all(/(.*)/, async (req, res) => {
    if (req.path === '/favicon.ico' || req.path === '/') return;

    const apiKey = extractApiKey(req);
    const method = req.method;
    const path = req.path;

    if (!apiKey) return res.status(401).json({ error: "API key missing" });

    // 自动补全版本号（如果外部工具没带版本号）
    let targetPath = path;
    if (!path.startsWith('/v1/') && !path.startsWith('/v1beta/')) {
        targetPath = `/${DEFAULT_API_VERSION}${path.startsWith('/') ? '' : '/'}${path}`;
    }

    const queryParams = { ...req.query };
    delete queryParams.key; 
    const queryString = new url.URLSearchParams({ ...queryParams, key: apiKey }).toString();
    const targetUrl = `${UPSTREAM_HOST}${targetPath}?${queryString}`;

    try {
        const response = await axios({
            method: method,
            url: targetUrl,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Gemini-Proxy-WebUI'
            },
            data: req.body,
            validateStatus: () => true,
            responseType: 'stream'
        });

        res.status(response.status);
        response.data.pipe(res);
    } catch (error) {
        res.status(502).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Gemini All-in-One 运行成功!`);
    console.log(`🔗 浏览器访问: http://localhost:${PORT}`);
    console.log(`🛠️ 外部工具地址: http://localhost:${PORT}/v1beta\n`);
});
