const express = require('express');
const axios = require('axios');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置解析限制
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// --------------------------------------------------------------------------
// Web UI (移动端深度优化版)
// --------------------------------------------------------------------------
const WEB_UI_HTML = `
<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=0">
    <title>Gemini WebUI</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css" rel="stylesheet">
    <style>
        :root { --sb-width: 280px; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        
        /* 侧边栏抽屉动画 */
        .sidebar-drawer { transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); width: var(--sb-width); }
        .overlay { opacity: 0; pointer-events: none; transition: opacity 0.3s ease; }
        body.sidebar-open .overlay { opacity: 1; pointer-events: auto; }
        
        /* 聊天气泡样式 */
        .msg-user { background: #2563eb; color: white; border-radius: 1.25rem 1.25rem 0.2rem 1.25rem; }
        .msg-ai { background: white; color: #1e293b; border-radius: 1.25rem 1.25rem 1.25rem 0.2rem; border: 1px solid #e2e8f0; }
        
        /* 滚动条隐藏 */
        .no-scrollbar::-webkit-scrollbar { display: none; }
        
        /* 代码块样式 */
        .prose pre { background: #0f172a !important; color: #f8fafc; padding: 1rem; border-radius: 0.75rem; margin: 0.75rem 0; overflow-x: auto; }
        .prose code { font-family: 'Fira Code', monospace; font-size: 0.85em; }
        
        /* 移动端底部适配 */
        .input-container { padding-bottom: calc(env(safe-area-inset-bottom) + 1rem); }
    </style>
</head>
<body class="h-full bg-slate-50 flex overflow-hidden">

    <div id="overlay" onclick="toggleSidebar()" class="overlay fixed inset-0 bg-black/50 z-40 md:hidden"></div>

    <aside id="sidebar" class="sidebar-drawer fixed md:relative h-full bg-[#0f172a] text-slate-300 z-50 -translate-x-full md:translate-x-0 flex flex-col">
        <div class="p-5 flex flex-col h-full">
            <button onclick="createNewChat()" class="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 transition-all font-semibold shadow-lg shadow-blue-900/20 active:scale-95">
                <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" stroke-width="2.5"/></svg>
                新建对话
            </button>
            
            <div id="sessionList" class="flex-grow overflow-y-auto mt-6 space-y-2 no-scrollbar"></div>

            <div class="mt-auto space-y-3 pt-6 border-t border-slate-800">
                <div class="px-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold">设置</div>
                <input type="password" id="apiKey" placeholder="输入 Gemini API Key" class="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 transition-all outline-none">
                <select id="modelSelect" class="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2 text-sm text-white outline-none appearance-none cursor-pointer hover:bg-slate-800"></select>
                <button onclick="loadModels()" class="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-xs font-medium transition-all">同步模型列表</button>
            </div>
        </div>
    </aside>

    <main class="flex-grow flex flex-col h-full min-w-0 bg-white relative">
        <nav class="h-16 flex items-center justify-between px-4 border-b bg-white/80 backdrop-blur-md sticky top-0 z-30">
            <div class="flex items-center gap-3 overflow-hidden">
                <button onclick="toggleSidebar()" class="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                    <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" stroke-width="2.5"/></svg>
                </button>
                <h1 id="currentChatTitle" class="font-bold text-slate-800 truncate text-base cursor-pointer hover:text-blue-600" onclick="renameChat()">Gemini WebUI</h1>
            </div>
            <div class="flex items-center gap-1">
                <button onclick="createNewChat()" class="md:hidden p-2 text-blue-600">
                    <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" stroke-width="2.5"/></svg>
                </button>
            </div>
        </nav>

        <div id="chatBox" class="flex-grow overflow-y-auto px-4 py-6 md:px-16 lg:px-32 space-y-6 no-scrollbar"></div>

        <div class="input-container p-4 bg-white">
            <div id="filePreview" class="max-w-4xl mx-auto flex flex-wrap gap-2 mb-3"></div>
            <div class="max-w-4xl mx-auto flex items-end gap-2 bg-slate-100 rounded-2xl p-2 border border-transparent focus-within:border-blue-400 focus-within:bg-white focus-within:shadow-xl transition-all">
                <label class="p-3 text-slate-500 hover:bg-slate-200 md:hover:bg-slate-100 rounded-xl cursor-pointer transition-colors">
                    <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.414a4 4 0 00-5.656-5.656l-6.415 6.414a6 6 0 108.486 8.486L20.5 13" stroke-width="2"/></svg>
                    <input type="file" id="fileInput" class="hidden" multiple onchange="handleFiles(this)">
                </label>
                <textarea id="userInput" rows="1" class="flex-grow bg-transparent border-none focus:ring-0 p-3 text-base md:text-sm max-h-48 resize-none text-slate-700" placeholder="问点什么，或上传代码/图片..."></textarea>
                <button onclick="sendMessage()" class="bg-blue-600 text-white p-3 rounded-xl hover:bg-blue-700 transition-all active:scale-90 shadow-md">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" stroke-width="2.5"/></svg>
                </button>
            </div>
        </div>
    </main>

    <script>
        let sessions = JSON.parse(localStorage.getItem('gemini_final_sessions') || '[]');
        let currentId = localStorage.getItem('current_id') || null;
        let pendingFiles = [];

        window.onload = () => {
            document.getElementById('apiKey').value = localStorage.getItem('gemini_key') || '';
            if(!sessions.length) createNewChat();
            else switchSession(currentId || sessions[0].id);
            loadModels(true);
        };

        function toggleSidebar() {
            const isOpen = document.body.classList.toggle('sidebar-open');
            document.getElementById('sidebar').style.transform = isOpen ? 'translateX(0)' : 'translateX(-100%)';
        }

        function createNewChat() {
            const id = Date.now().toString();
            sessions.unshift({ id, title: '新对话', messages: [] });
            save(id);
            if(window.innerWidth < 768) toggleSidebar();
        }

        function switchSession(id) {
            currentId = id;
            localStorage.setItem('current_id', id);
            const s = sessions.find(x => x.id === id);
            document.getElementById('currentChatTitle').innerText = s.title;
            renderMessages();
            renderList();
            if(window.innerWidth < 768 && document.body.classList.contains('sidebar-open')) toggleSidebar();
        }

        function save(id) {
            localStorage.setItem('gemini_final_sessions', JSON.stringify(sessions));
            if(id) switchSession(id); else renderList();
        }

        function renderList() {
            const list = document.getElementById('sessionList');
            list.innerHTML = sessions.map(s => \`
                <div onclick="switchSession('\${s.id}')" class="group flex items-center justify-between p-3.5 rounded-xl cursor-pointer transition-all \${s.id === currentId ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'hover:bg-slate-800 text-slate-400'}">
                    <span class="text-sm truncate font-medium flex-grow">\${s.title}</span>
                    <button onclick="deleteChat('\${s.id}', event)" class="opacity-0 group-hover:opacity-100 hover:text-red-400 p-1 font-bold text-lg">×</button>
                </div>
            \`).join('');
        }

        async function handleFiles(input) {
            const files = Array.from(input.files);
            for (let f of files) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    pendingFiles.push({ name: f.name, type: f.type, data: e.target.result });
                    renderFilePreview();
                };
                if(f.type.startsWith('image/')) reader.readAsDataURL(f);
                else reader.readAsText(f);
            }
        }

        function renderFilePreview() {
            const div = document.getElementById('filePreview');
            div.innerHTML = pendingFiles.map((f, i) => \`
                <div class="bg-blue-50 text-blue-600 border border-blue-100 px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-2 animate__animated animate__fadeIn">
                    \${f.name} <span class="cursor-pointer text-blue-300 hover:text-red-500" onclick="removeFile(\${i})">×</span>
                </div>
            \`).join('');
        }

        function removeFile(i) { pendingFiles.splice(i, 1); renderFilePreview(); }

        async function sendMessage() {
            const text = document.getElementById('userInput').value.trim();
            const key = document.getElementById('apiKey').value;
            if((!text && !pendingFiles.length) || !key) return;

            const s = sessions.find(x => x.id === currentId);
            if(s.messages.length === 0 && text) { s.title = text.slice(0, 15); renderList(); }

            let parts = [{ text: text || "请处理上传的文件" }];
            let displayImgs = [];
            
            pendingFiles.forEach(f => {
                if(f.type.startsWith('image/')) {
                    parts.push({ inline_data: { mime_type: f.type, data: f.data.split(',')[1] } });
                    displayImgs.push(f.data);
                } else {
                    parts[0].text += \`\\n\\n【文件: \${f.name}】\\n\${f.data}\`;
                }
            });

            s.messages.push({ role: 'user', parts, displayImgs });
            pendingFiles = []; renderFilePreview();
            document.getElementById('userInput').value = '';
            document.getElementById('userInput').style.height = 'auto';
            renderMessages();
            await askGemini(s);
        }

        async function askGemini(session) {
            const model = document.getElementById('modelSelect').value;
            const key = document.getElementById('apiKey').value;
            const aiIdx = session.messages.length;
            session.messages.push({ role: 'model', parts: [{ text: '' }] });

            try {
                const res = await fetch(\`\${model}:streamGenerateContent?key=\${key}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: session.messages.map(m => ({ role: m.role, parts: m.parts })) })
                });

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let full = "";
                while(true) {
                    const { done, value } = await reader.read();
                    if(done) break;
                    const chunk = decoder.decode(value);
                    const matches = chunk.matchAll(/"text":\\s*"(.*?)"/g);
                    for(const m of matches) {
                        try {
                            full += JSON.parse(\`{"t":"\${m[1]}"}\`).t;
                            session.messages[aiIdx].parts[0].text = full;
                            renderMessages(true); // 使用静默渲染避免移动端抖动
                        } catch(e){}
                    }
                }
                save();
            } catch(e) { alert("API请求失败"); }
        }

        function renderMessages(silent = false) {
            const box = document.getElementById('chatBox');
            const s = sessions.find(x => x.id === currentId);
            box.innerHTML = s.messages.map((m, i) => \`
                <div class="flex \${m.role === 'user' ? 'justify-end' : 'justify-start'}">
                    <div class="max-w-[90%] md:max-w-[80%] group">
                        <div class="px-5 py-3 shadow-sm \${m.role === 'user' ? 'msg-user' : 'msg-ai'}">
                            \${m.displayImgs ? m.displayImgs.map(img => \`<img src="\${img}" class="rounded-lg mb-2 max-h-72">\`).join('') : ''}
                            <div class="prose \${m.role === 'user' ? 'prose-invert' : 'text-slate-800'} text-[15px] leading-relaxed">\${marked.parse(m.parts[0].text || '')}</div>
                        </div>
                        <div class="flex gap-4 mt-1.5 opacity-0 group-hover:opacity-100 text-[11px] text-slate-400 \${m.role === 'user' ? 'justify-end pr-2' : 'pl-2'} transition-opacity">
                            <button onclick="editMsg(\${i})" class="hover:text-blue-500">编辑</button>
                            <button onclick="deleteMsg(\${i})" class="hover:text-red-500">删除</button>
                        </div>
                    </div>
                </div>
            \`).join('');
            if(!silent) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
            else box.scrollTop = box.scrollHeight;
        }

        function editMsg(i) {
            const s = sessions.find(x => x.id === currentId);
            const val = prompt("编辑内容:", s.messages[i].parts[0].text);
            if(val !== null) {
                s.messages[i].parts[0].text = val;
                if(s.messages[i].role === 'user') {
                    s.messages = s.messages.slice(0, i+1);
                    renderMessages();
                    askGemini(s);
                } else { save(); renderMessages(); }
            }
        }

        function deleteMsg(i) {
            const s = sessions.find(x => x.id === currentId);
            s.messages.splice(i, 1);
            save(); renderMessages();
        }

        function deleteChat(id, e) {
            e.stopPropagation();
            if(!confirm("删除该对话？")) return;
            sessions = sessions.filter(x => x.id !== id);
            if(!sessions.length) createNewChat();
            else if(currentId === id) switchSession(sessions[0].id);
            save();
        }

        function renameChat() {
            const s = sessions.find(x => x.id === currentId);
            const t = prompt("重命名对话:", s.title);
            if(t) { s.title = t; save(); }
        }

        async function loadModels(init = false) {
            const key = document.getElementById('apiKey').value;
            if(!key) return;
            localStorage.setItem('gemini_key', key);
            try {
                const res = await fetch(\`/v1beta/models?key=\${key}\`);
                const data = await res.json();
                const sel = document.getElementById('modelSelect');
                sel.innerHTML = data.models.filter(m => m.name.includes('gemini')).map(m => 
                    \`<option value="\${m.name}" \${m.name.includes('1.5-flash') ? 'selected' : ''}>\${m.displayName}</option>\`
                ).join('');
                if(!init) alert("模型同步成功");
            } catch(e){}
        }

        const input = document.getElementById('userInput');
        input.oninput = function() {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
        };
        input.addEventListener('keydown', (e) => {
            if(e.key === 'Enter' && !e.shiftKey && window.innerWidth > 768) {
                e.preventDefault();
                sendMessage();
            }
        });
    </script>
</body>
</html>
`;

// --------------------------------------------------------------------------
// Proxy API (Node 22 兼容版)
// --------------------------------------------------------------------------
app.get('/', (req, res) => res.send(WEB_UI_HTML));

app.all(/(.*)/, async (req, res) => {
    if (req.path === '/' || req.path === '/favicon.ico') return;

    let apiKey = req.headers['x-goog-api-key'] || req.query.key || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });

    let targetPath = req.path.startsWith('/v1') ? req.path : '/v1beta' + req.path;
    const targetUrl = `https://generativelanguage.googleapis.com${targetPath}?${new url.URLSearchParams({...req.query, key: apiKey})}`;

    try {
        const response = await axios({
            method: req.method,
            url: targetUrl,
            headers: { 'Content-Type': 'application/json' },
            data: req.body,
            validateStatus: () => true,
            responseType: 'stream'
        });

        res.status(response.status);
        response.data.on('error', () => res.end());
        response.data.pipe(res);
    } catch (e) {
        if (!res.headersSent) res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n✅ Gemini WebUI 已在端口 ${PORT} 启动`);
});
