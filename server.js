const express = require('express');
const axios = require('axios');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// 增加限制以支持大文件解析
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// --------------------------------------------------------------------------
// Web UI HTML 字符串 (已转义修复，适配 Node 22)
// --------------------------------------------------------------------------
const WEB_UI_HTML = `
<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Gemini Workspace Pro</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css" rel="stylesheet">
    <style>
        .chat-container::-webkit-scrollbar { width: 4px; }
        .chat-container::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
        code { font-family: 'Fira Code', monospace; font-size: 0.9em; }
        .prose { max-width: none; font-size: 14px; line-height: 1.6; }
        .file-tag { background: #f1f5f9; border: 1px solid #e2e8f0; color: #475569; font-size: 11px; padding: 2px 8px; border-radius: 12px; }
    </style>
</head>
<body class="h-full bg-slate-50 flex overflow-hidden">

    <aside id="sidebar" class="fixed md:relative flex flex-col w-72 h-full bg-[#0d1117] text-slate-300 z-50 transition-transform -translate-x-full md:translate-x-0 border-r border-slate-800">
        <div class="p-4 flex flex-col h-full">
            <button onclick="createNewChat()" class="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg p-2.5 transition-all mb-4 text-sm font-medium">
                + 新建对话
            </button>
            <div id="sessionList" class="flex-grow overflow-y-auto space-y-1 chat-container"></div>
            <div class="mt-auto pt-4 border-t border-slate-800 space-y-2">
                <input type="password" id="apiKey" placeholder="Gemini API Key" class="w-full bg-slate-800 border-none rounded-lg px-3 py-2 text-xs text-white">
                <select id="modelSelect" class="w-full bg-slate-800 border-none rounded-lg px-3 py-2 text-xs text-white"></select>
                <button onclick="loadModels()" class="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-xs transition-colors">验证并刷新模型列表</button>
            </div>
        </div>
    </aside>

    <main class="flex-grow flex flex-col h-full overflow-hidden">
        <nav class="h-14 border-b bg-white flex items-center justify-between px-4">
            <button onclick="toggleSidebar()" class="md:hidden p-2"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" stroke-width="2"/></svg></button>
            <div id="currentChatTitle" class="font-semibold text-slate-700 truncate max-w-xs cursor-pointer px-2 py-1 hover:bg-slate-100 rounded" onclick="renameChat()">新对话</div>
            <div class="w-8"></div>
        </nav>

        <div id="chatBox" class="flex-grow overflow-y-auto p-4 md:p-8 space-y-6 chat-container"></div>

        <div class="p-4 bg-white border-t">
            <div id="filePreview" class="max-w-4xl mx-auto flex flex-wrap gap-2 mb-2"></div>
            <div class="max-w-4xl mx-auto relative bg-slate-100 rounded-2xl p-2 flex items-end gap-2 focus-within:ring-2 focus-within:ring-blue-400 transition-all">
                <label class="p-2 text-slate-500 hover:bg-slate-200 rounded-xl cursor-pointer">
                    <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" stroke-width="2"/></svg>
                    <input type="file" id="fileInput" class="hidden" multiple onchange="handleFiles(this)">
                </label>
                <textarea id="userInput" rows="1" class="flex-grow bg-transparent border-none focus:ring-0 p-2 text-sm max-h-60 resize-none" placeholder="输入消息，或拖入文件 (json, py, js, cpp, txt, 图片)..."></textarea>
                <button onclick="sendMessage()" class="bg-blue-600 text-white p-2.5 rounded-xl hover:bg-blue-700 shadow-md">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" stroke-width="2"/></svg>
                </button>
            </div>
        </div>
    </main>

    <script>
        let sessions = JSON.parse(localStorage.getItem('gemini_v3_sessions') || '[]');
        let currentId = localStorage.getItem('current_id') || null;
        let pendingFiles = [];

        window.onload = () => {
            document.getElementById('apiKey').value = localStorage.getItem('gemini_key') || '';
            if(!sessions.length) createNewChat();
            else switchSession(currentId || sessions[0].id);
            loadModels(true);
            renderList();
        };

        function toggleSidebar() { document.getElementById('sidebar').classList.toggle('-translate-x-full'); }

        function createNewChat() {
            const id = Date.now().toString();
            sessions.unshift({ id, title: '新对话', messages: [] });
            save(id);
        }

        function switchSession(id) {
            currentId = id;
            localStorage.setItem('current_id', id);
            const s = sessions.find(x => x.id === id);
            document.getElementById('currentChatTitle').innerText = s.title;
            renderMessages();
            renderList();
        }

        function save(id) {
            localStorage.setItem('gemini_v3_sessions', JSON.stringify(sessions));
            if(id) switchSession(id); else renderList();
        }

        function renderList() {
            const list = document.getElementById('sessionList');
            list.innerHTML = sessions.map(s => \`
                <div onclick="switchSession('\${s.id}')" class="group flex items-center justify-between p-2.5 rounded-lg cursor-pointer \${s.id === currentId ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/50'}">
                    <span class="text-sm truncate w-44">\${s.title}</span>
                    <button onclick="deleteChat('\${s.id}', event)" class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 font-bold">×</button>
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
                <div class="file-tag flex items-center gap-1">
                    \${f.name} <span class="cursor-pointer font-bold" onclick="removeFile(\${i})">×</span>
                </div>
            \`).join('');
        }

        function removeFile(i) { pendingFiles.splice(i, 1); renderFilePreview(); }

        async function sendMessage() {
            const text = document.getElementById('userInput').value.trim();
            if(!text && !pendingFiles.length) return;
            const key = document.getElementById('apiKey').value;
            if(!key) return alert("请先输入 API Key");

            const s = sessions.find(x => x.id === currentId);
            if(s.messages.length === 0 && text) s.title = text.slice(0, 20);

            // 解析多模态/文本文件
            let parts = [{ text: text || "处理上传的文件" }];
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
                            renderMessages();
                        } catch(e){}
                    }
                }
                save();
            } catch(e) { alert("请求失败: " + e.message); }
        }

        function renderMessages() {
            const box = document.getElementById('chatBox');
            const s = sessions.find(x => x.id === currentId);
            box.innerHTML = s.messages.map((m, i) => \`
                <div class="flex \${m.role === 'user' ? 'justify-end' : 'justify-start'} group">
                    <div class="max-w-[90%] md:max-w-[80%]">
                        <div class="px-4 py-3 rounded-2xl shadow-sm \${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border text-slate-800'}">
                            \${m.displayImgs ? m.displayImgs.map(img => \`<img src="\${img}" class="rounded-lg mb-2 max-h-64">\`).join('') : ''}
                            <div class="prose \${m.role === 'user' ? 'prose-invert' : ''}">\${marked.parse(m.parts[0].text || '')}</div>
                        </div>
                        <div class="flex gap-3 mt-1 opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 \${m.role === 'user' ? 'justify-end' : ''}">
                            <button onclick="editMsg(\${i})">编辑</button>
                            <button onclick="deleteMsg(\${i})">删除</button>
                        </div>
                    </div>
                </div>
            \`).join('');
            box.scrollTop = box.scrollHeight;
        }

        function editMsg(i) {
            const s = sessions.find(x => x.id === currentId);
            const val = prompt("修改内容:", s.messages[i].parts[0].text);
            if(val) {
                s.messages[i].parts[0].text = val;
                if(s.messages[i].role === 'user') {
                    s.messages = s.messages.slice(0, i+1);
                    renderMessages();
                    askGemini(s);
                } else save(); renderMessages();
            }
        }

        function deleteMsg(i) {
            const s = sessions.find(x => x.id === currentId);
            s.messages.splice(i, 1);
            save(); renderMessages();
        }

        function deleteChat(id, e) {
            e.stopPropagation();
            sessions = sessions.filter(x => x.id !== id);
            if(!sessions.length) createNewChat();
            else if(currentId === id) switchSession(sessions[0].id);
            save();
        }

        function renameChat() {
            const s = sessions.find(x => x.id === currentId);
            const t = prompt("重命名:", s.title);
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
                if(!init) alert("已更新 " + data.models.length + " 个模型");
            } catch(e){}
        }

        document.getElementById('userInput').oninput = function() {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
        };
    </script>
</body>
</html>
`;

// --------------------------------------------------------------------------
// 代理逻辑 (修正了 Node 22 下的 axios 异常捕获)
// --------------------------------------------------------------------------
app.get('/', (req, res) => res.send(WEB_UI_HTML));

app.all(/(.*)/, async (req, res) => {
    if (req.path === '/' || req.path === '/favicon.ico') return;

    let apiKey = req.headers['x-goog-api-key'] || req.query.key;
    const auth = req.headers['authorization'];
    if (!apiKey && auth) apiKey = auth.replace('Bearer ', '').trim();
    if (!apiKey) return res.status(401).json({ error: "API Key Required" });

    let targetPath = req.path.startsWith('/v1') ? req.path : '/v1beta' + req.path;
    const queryString = new url.URLSearchParams({ ...req.query, key: apiKey }).toString();

    try {
        const response = await axios({
            method: req.method,
            url: `https://generativelanguage.googleapis.com${targetPath}?${queryString}`,
            headers: { 'Content-Type': 'application/json' },
            data: req.body,
            validateStatus: () => true,
            responseType: 'stream'
        });

        res.status(response.status);
        response.data.on('error', (err) => {
            console.error('Stream Error:', err);
            res.end();
        });
        response.data.pipe(res);

    } catch (e) {
        console.error('Proxy Error:', e.message);
        if (!res.headersSent) res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Gemini Node 22 兼容版启动成功!`);
    console.log(`🔗 访问地址: http://localhost:${PORT}\n`);
});
