const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

const UPSTREAM_HOST = 'https://generativelanguage.googleapis.com';
const DEFAULT_API_VERSION = 'v1beta';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --------------------------------------------------------------------------
// Web UI HTML (含侧边栏、多会话逻辑)
// --------------------------------------------------------------------------
const WEB_UI_HTML = `
<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Gemini Ultra UI</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css" rel="stylesheet">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .sidebar-transition { transition: transform 0.3s ease-in-out; }
        .chat-container::-webkit-scrollbar { width: 4px; }
        .chat-container::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        pre { background: #1e293b; color: #f8fafc; padding: 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; font-size: 13px; }
        .prose img { max-width: 100%; border-radius: 8px; margin: 8px 0; }
        @media (max-width: 768px) { .mobile-hide { display: none; } }
    </style>
</head>
<body class="h-full bg-white flex overflow-hidden">

    <div id="overlay" onclick="toggleSidebar()" class="fixed inset-0 bg-black/50 z-40 hidden md:hidden"></div>

    <aside id="sidebar" class="fixed md:relative flex flex-col w-72 h-full bg-slate-900 text-slate-300 z-50 sidebar-transition -translate-x-full md:translate-x-0 border-r border-slate-800">
        <div class="p-4 flex flex-col h-full">
            <button onclick="createNewChat()" class="flex items-center gap-2 border border-slate-700 rounded-lg p-3 hover:bg-slate-800 transition-all text-sm mb-4">
                <span>+</span> 新建对话
            </button>
            
            <div id="sessionList" class="flex-grow overflow-y-auto space-y-2 chat-container">
                </div>

            <div class="mt-4 pt-4 border-t border-slate-800 space-y-3">
                <input type="password" id="apiKey" placeholder="API Key" class="w-full bg-slate-800 border-none rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-blue-500">
                <select id="modelSelect" class="w-full bg-slate-800 border-none rounded-lg px-3 py-2 text-xs">
                    <option value="gemini-1.5-flash">加载中...</option>
                </select>
                <button onclick="loadModels()" class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-xs transition-colors">验证并刷新列表</button>
            </div>
        </div>
    </aside>

    <main class="flex-grow flex flex-col h-full relative overflow-hidden bg-slate-50">
        <nav class="h-14 border-b bg-white/80 backdrop-blur flex items-center justify-between px-4 z-30">
            <button onclick="toggleSidebar()" class="md:hidden p-2 hover:bg-slate-100 rounded">
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
            <div id="currentChatTitle" class="text-sm font-medium truncate max-w-[200px]">新对话</div>
            <div class="flex gap-2">
                <button onclick="clearCurrentChat()" class="p-2 text-slate-400 hover:text-red-500 transition-colors">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
            </div>
        </nav>

        <div id="chatBox" class="flex-grow overflow-y-auto p-4 md:p-8 space-y-6 chat-container">
            </div>

        <div class="p-4 md:p-6 max-w-4xl mx-auto w-full">
            <div id="imagePreviewContainer" class="hidden mb-2">
                <div class="relative inline-block group">
                    <img id="imagePreview" class="h-20 w-20 object-cover rounded-lg border-2 border-white shadow-lg">
                    <button onclick="clearImage()" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">×</button>
                </div>
            </div>
            
            <div class="relative flex items-end gap-2 bg-white rounded-2xl border shadow-sm p-2 focus-within:border-blue-400 transition-all">
                <label class="p-2 hover:bg-slate-100 rounded-xl cursor-pointer text-slate-500">
                    <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                    <input type="file" id="fileInput" class="hidden" accept="image/*" onchange="previewImage(this)">
                </label>
                <textarea id="userInput" rows="1" class="flex-grow bg-transparent border-none focus:ring-0 p-2 max-h-48 resize-none text-sm" placeholder="有问题尽管问..."></textarea>
                <button id="sendBtn" onclick="sendMessage()" class="bg-blue-600 text-white p-2.5 rounded-xl hover:bg-blue-700 transition-all disabled:opacity-50">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                </button>
            </div>
            <p class="text-[10px] text-center text-slate-400 mt-2">支持多轮对话上下文与图片解析</p>
        </div>
    </main>

    <script>
        let sessions = JSON.parse(localStorage.getItem('gemini_sessions') || '[]');
        let currentSessionId = localStorage.getItem('current_session_id') || null;
        let currentImageBase64 = null;

        // 初始化
        window.onload = () => {
            document.getElementById('apiKey').value = localStorage.getItem('gemini_key') || '';
            if (sessions.length === 0) createNewChat();
            else switchSession(currentSessionId || sessions[0].id);
            loadModels(true);
            renderSessionList();
        };

        function toggleSidebar() {
            const sb = document.getElementById('sidebar');
            const ov = document.getElementById('overlay');
            sb.classList.toggle('-translate-x-full');
            ov.classList.toggle('hidden');
        }

        // --- 会话管理 ---
        function createNewChat() {
            const newId = Date.now().toString();
            sessions.unshift({ id: newId, title: '新对话', messages: [] });
            saveSessions();
            switchSession(newId);
            renderSessionList();
            if (window.innerWidth < 768) toggleSidebar();
        }

        function switchSession(id) {
            currentSessionId = id;
            localStorage.setItem('current_session_id', id);
            const session = sessions.find(s => s.id === id);
            document.getElementById('currentChatTitle').innerText = session.title;
            document.getElementById('chatBox').innerHTML = '';
            session.messages.forEach(m => appendMessageToUI(m.role, m.content, m.img));
            renderSessionList();
        }

        function deleteSession(id, e) {
            e.stopPropagation();
            sessions = sessions.filter(s => s.id !== id);
            if (sessions.length === 0) createNewChat();
            else if (currentSessionId === id) switchSession(sessions[0].id);
            saveSessions();
            renderSessionList();
        }

        function saveSessions() {
            localStorage.setItem('gemini_sessions', JSON.stringify(sessions));
        }

        function renderSessionList() {
            const list = document.getElementById('sessionList');
            list.innerHTML = sessions.map(s => \`
                <div onclick="switchSession('\${s.id}')" class="group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all \${s.id === currentSessionId ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/50 text-slate-400'}">
                    <div class="flex items-center gap-2 truncate">
                        <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
                        <span class="text-sm truncate w-40">\${s.title}</span>
                    </div>
                    <button onclick="deleteSession('\${s.id}', event)" class="opacity-0 group-hover:opacity-100 hover:text-red-400 p-1">×</button>
                </div>
            \`).join('');
        }

        // --- API & 发送 ---
        async function loadModels(isInit = false) {
            const key = document.getElementById('apiKey').value;
            if (!key) return;
            localStorage.setItem('gemini_key', key);
            try {
                const res = await fetch(\`/v1beta/models?key=\${key}\`);
                const data = await res.json();
                const select = document.getElementById('modelSelect');
                select.innerHTML = data.models.filter(m => m.name.includes('gemini')).map(m => 
                    \`<option value="\${m.name}" \${m.name.includes('1.5-flash') ? 'selected' : ''}>\${m.displayName}</option>\`
                ).join('');
                if(!isInit) alert('模型列表已更新');
            } catch (e) { console.error('Load models failed'); }
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

        async function sendMessage() {
            const input = document.getElementById('userInput');
            const key = document.getElementById('apiKey').value;
            const model = document.getElementById('modelSelect').value;
            const text = input.value.trim();
            const session = sessions.find(s => s.id === currentSessionId);

            if ((!text && !currentImageBase64) || !key) return;

            // 更新标题（仅限第一条消息）
            if (session.messages.length === 0) {
                session.title = text.substring(0, 15) || '图片对话';
                renderSessionList();
                document.getElementById('currentChatTitle').innerText = session.title;
            }

            // 保存并渲染用户消息
            const userMsg = { role: 'user', content: text, img: currentImageBase64 };
            session.messages.push(userMsg);
            appendMessageToUI('user', text, currentImageBase64);
            
            input.value = '';
            input.style.height = 'auto';
            clearImage();

            // 构建上下文请求
            const contents = session.messages.map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: m.img ? [{ text: m.content || "识别内容" }, { inline_data: { mime_type: "image/jpeg", data: m.img } }] : [{ text: m.content }]
            }));

            const aiResWrap = appendMessageToUI('model', '...');
            
            try {
                const response = await fetch(\`\${model}:streamGenerateContent?key=\${key}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents })
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullText = '';
                aiResWrap.innerHTML = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\\n');
                    for (let line of lines) {
                        if (!line.includes('"text":')) continue;
                        const match = line.match(/"text":\\s*"(.*)"/);
                        if (match) {
                            try {
                                let content = JSON.parse(\`{"t":"\${match[1]}"}\`).t;
                                fullText += content;
                                aiResWrap.innerHTML = marked.parse(fullText);
                            } catch(e) {}
                        }
                    }
                    document.getElementById('chatBox').scrollTop = document.getElementById('chatBox').scrollHeight;
                }
                session.messages.push({ role: 'model', content: fullText });
                saveSessions();
            } catch (e) { aiResWrap.innerText = "Error: " + e.message; }
        }

        function appendMessageToUI(role, content, img) {
            const box = document.getElementById('chatBox');
            const div = document.createElement('div');
            div.className = \`flex \${role === 'user' ? 'justify-end' : 'justify-start'} animate__animated animate__fadeInUp animate__faster\`;
            div.innerHTML = \`
                <div class="max-w-[85%] \${role === 'user' ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-white border shadow-sm'} rounded-2xl px-4 py-2.5">
                    \${img ? \`<img src="data:image/jpeg;base64,\${img}" class="mb-2"> \` : ''}
                    <div class="prose prose-sm \${role === 'user' ? 'prose-invert text-white' : 'text-slate-700'}">\${role === 'user' ? content : marked.parse(content)}</div>
                </div>\`;
            box.appendChild(div);
            box.scrollTop = box.scrollHeight;
            return div.querySelector('.prose');
        }

        // 自动伸缩输入框
        document.getElementById('userInput').addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
        });

        // 快捷键
        document.getElementById('userInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 768) {
                e.preventDefault();
                sendMessage();
            }
        });
    </script>
</body>
</html>
`;

// --------------------------------------------------------------------------
// 代理逻辑 (与之前相同)
// --------------------------------------------------------------------------
app.get('/', (req, res) => res.send(WEB_UI_HTML));

app.all(/(.*)/, async (req, res) => {
    if (req.path === '/' || req.path === '/favicon.ico') return;
    
    // 提取 Key
    let apiKey = req.headers['x-goog-api-key'] || req.query.key;
    const auth = req.headers['authorization'];
    if (!apiKey && auth) apiKey = auth.replace('Bearer ', '').trim();

    if (!apiKey) return res.status(401).json({ error: "API Key Required" });

    let targetPath = req.path;
    if (!targetPath.startsWith('/v1')) targetPath = '/' + DEFAULT_API_VERSION + targetPath;

    const queryString = new url.URLSearchParams({ ...req.query, key: apiKey }).toString();

    try {
        const response = await axios({
            method: req.method,
            url: `${UPSTREAM_HOST}${targetPath}?${queryString}`,
            headers: { 'Content-Type': 'application/json' },
            data: req.body,
            validateStatus: () => true,
            responseType: 'stream'
        });
        res.status(response.status);
        response.data.pipe(res);
    } catch (e) { res.status(500).send(e.message); }
});

app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
