const express = require('express');
const axios = require('axios');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// --------------------------------------------------------------------------
// Web UI (全功能增强版)
// --------------------------------------------------------------------------
const WEB_UI_HTML = `
<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Gemini Pro Workspace</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css" rel="stylesheet">
    <style>
        .chat-container::-webkit-scrollbar { width: 4px; }
        .chat-container::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        pre { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; overflow-x: auto; position: relative; }
        .edit-area { outline: none; border-bottom: 2px solid #3b82f6; }
        .file-tag { background: #eff6ff; border: 1px solid #dbeafe; color: #1e40af; }
    </style>
</head>
<body class="h-full bg-slate-50 flex overflow-hidden text-slate-900">

    <aside id="sidebar" class="fixed md:relative flex flex-col w-72 h-full bg-slate-900 text-slate-300 z-50 transition-transform -translate-x-full md:translate-x-0 border-r border-slate-800">
        <div class="p-4 flex flex-col h-full">
            <button onclick="createNewChat()" class="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg p-2.5 transition-all text-sm font-medium mb-4">
                <span>+</span> 新建对话
            </button>
            
            <div id="sessionList" class="flex-grow overflow-y-auto space-y-1 chat-container"></div>

            <div class="mt-4 pt-4 border-t border-slate-800 space-y-2">
                <input type="password" id="apiKey" placeholder="Gemini API Key" class="w-full bg-slate-800 border-none rounded-lg px-3 py-2 text-xs text-white">
                <select id="modelSelect" class="w-full bg-slate-800 border-none rounded-lg px-3 py-2 text-xs text-white focus:ring-1 focus:ring-blue-500"></select>
                <button onclick="loadModels()" class="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-xs transition-colors">验证 Key 并同步列表</button>
            </div>
        </div>
    </aside>

    <main class="flex-grow flex flex-col h-full overflow-hidden">
        <nav class="h-14 border-b bg-white flex items-center justify-between px-4">
            <button onclick="toggleSidebar()" class="md:hidden p-2 text-slate-500">
                <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" stroke-width="2"/></svg>
            </button>
            <div id="currentChatTitle" class="font-semibold text-slate-700 truncate px-4 cursor-pointer hover:bg-slate-100 rounded" onclick="renameCurrentSession()">新对话</div>
            <div class="flex gap-2">
                <button onclick="exportChat()" class="p-2 text-slate-400 hover:text-blue-500" title="导出对话">
                   <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" stroke-width="2"/></svg>
                </button>
            </div>
        </nav>

        <div id="chatBox" class="flex-grow overflow-y-auto p-4 md:p-8 space-y-6 chat-container bg-slate-50"></div>

        <div class="p-4 bg-white border-t">
            <div id="attachmentArea" class="max-w-4xl mx-auto hidden flex flex-wrap gap-2 mb-2"></div>
            <div class="max-w-4xl mx-auto relative bg-slate-100 rounded-2xl p-2 flex items-end gap-2 shadow-inner focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-400 transition-all">
                <label class="p-2 text-slate-500 hover:bg-slate-200 rounded-xl cursor-pointer">
                    <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" stroke-width="2"/></svg>
                    <input type="file" id="fileInput" class="hidden" multiple onchange="handleFileUpload(this)">
                </label>
                <textarea id="userInput" rows="1" class="flex-grow bg-transparent border-none focus:ring-0 p-2 max-h-64 resize-none text-sm" placeholder="输入消息或上传文件..."></textarea>
                <button id="sendBtn" onclick="sendMessage()" class="bg-blue-600 text-white p-2.5 rounded-xl hover:bg-blue-700 transition-all">
                    <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" stroke-width="2"/></svg>
                </button>
            </div>
        </div>
    </main>

    <script>
        let sessions = JSON.parse(localStorage.getItem('gemini_v2_sessions') || '[]');
        let currentId = localStorage.getItem('current_id') || null;
        let pendingFiles = [];

        window.onload = () => {
            document.getElementById('apiKey').value = localStorage.getItem('gemini_key') || '';
            if (!sessions.length) createNewChat();
            else switchSession(currentId || sessions[0].id);
            loadModels(true);
            renderList();
        };

        function toggleSidebar() { document.getElementById('sidebar').classList.toggle('-translate-x-full'); }

        function createNewChat() {
            const id = Date.now().toString();
            sessions.unshift({ id, title: '新对话', messages: [] });
            saveAndRender(id);
        }

        function switchSession(id) {
            currentId = id;
            localStorage.setItem('current_id', id);
            const s = sessions.find(x => x.id === id);
            document.getElementById('currentChatTitle').innerText = s.title;
            renderMessages();
            renderList();
        }

        function saveAndRender(id) {
            localStorage.setItem('gemini_v2_sessions', JSON.stringify(sessions));
            if (id) switchSession(id);
            else renderList();
        }

        function renderList() {
            const list = document.getElementById('sessionList');
            list.innerHTML = sessions.map(s => \`
                <div onclick="switchSession('\${s.id}')" class="group flex items-center justify-between p-2.5 rounded-lg cursor-pointer \${s.id === currentId ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/50'}">
                    <span class="text-sm truncate w-48">\${s.title}</span>
                    <button onclick="deleteSession('\${s.id}', event)" class="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400">×</button>
                </div>
            \`).join('');
        }

        async function handleFileUpload(input) {
            const files = Array.from(input.files);
            const area = document.getElementById('attachmentArea');
            area.classList.remove('hidden');

            for (let file of files) {
                const isImage = file.type.startsWith('image/');
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target.result;
                    const fileData = { name: file.name, type: file.type, data: content };
                    pendingFiles.push(fileData);
                    
                    const tag = document.createElement('div');
                    tag.className = "file-tag px-3 py-1 rounded-full text-xs flex items-center gap-1 animate__animated animate__fadeIn";
                    tag.innerHTML = \`\${file.name} <span onclick="removeFile('\${file.name}')" class="cursor-pointer font-bold ml-1">×</span>\`;
                    area.appendChild(tag);
                };
                if (isImage) reader.readAsDataURL(file);
                else reader.readAsText(file);
            }
        }

        function removeFile(name) {
            pendingFiles = pendingFiles.filter(f => f.name !== name);
            renderAttachmentArea();
        }

        function renderAttachmentArea() {
            const area = document.getElementById('attachmentArea');
            if (pendingFiles.length === 0) area.classList.add('hidden');
            area.innerHTML = pendingFiles.map(f => \`
                <div class="file-tag px-3 py-1 rounded-full text-xs flex items-center gap-1">\${f.name} <span onclick="removeFile('\${f.name}')" class="cursor-pointer font-bold ml-1">×</span></div>
            \`).join('');
        }

        async function sendMessage() {
            const text = document.getElementById('userInput').value.trim();
            if (!text && !pendingFiles.length) return;
            
            const session = sessions.find(s => s.id === currentId);
            if (session.messages.length === 0 && text) session.title = text.slice(0, 15);

            // 处理附件
            let parts = [{ text: text || "请处理上传的文件" }];
            let displayImgs = [];
            
            pendingFiles.forEach(f => {
                if (f.type.startsWith('image/')) {
                    const b64 = f.data.split(',')[1];
                    parts.push({ inline_data: { mime_type: f.type, data: b64 } });
                    displayImgs.push(f.data);
                } else {
                    parts[0].text += \`\\n\\n【文件: \${f.name}】\\n\${f.data}\`;
                }
            });

            session.messages.push({ role: 'user', parts, displayImgs, text });
            pendingFiles = [];
            renderAttachmentArea();
            document.getElementById('userInput').value = '';
            
            renderMessages();
            await callGemini(session);
        }

        async function callGemini(session) {
            const model = document.getElementById('modelSelect').value;
            const key = document.getElementById('apiKey').value;
            const aiMsgIndex = session.messages.length;
            session.messages.push({ role: 'model', parts: [{ text: '' }] });
            
            try {
                const response = await fetch(\`\${model}:streamGenerateContent?key=\${key}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: session.messages.map(m => ({ role: m.role, parts: m.parts })) })
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullText = '';
                
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
                                fullText += JSON.parse(\`{"t":"\${match[1]}"}\`).t;
                                session.messages[aiMsgIndex].parts[0].text = fullText;
                                renderMessages();
                            } catch(e) {}
                        }
                    }
                }
                saveAndRender();
            } catch (e) { alert(e.message); }
        }

        function renderMessages() {
            const box = document.getElementById('chatBox');
            const session = sessions.find(s => s.id === currentId);
            box.innerHTML = session.messages.map((m, idx) => \`
                <div class="flex \${m.role === 'user' ? 'justify-end' : 'justify-start'} group">
                    <div class="max-w-[90%] md:max-w-[80%] relative">
                        <div class="px-4 py-3 rounded-2xl shadow-sm \${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white border text-slate-800'}">
                            \${m.displayImgs ? m.displayImgs.map(img => \`<img src="\${img}" class="rounded-lg mb-2 max-h-60"> \`).join('') : ''}
                            <div class="prose prose-sm \${m.role === 'user' ? 'prose-invert' : ''}" id="content-\${idx}">\${marked.parse(m.parts[0].text || '')}</div>
                        </div>
                        <div class="flex gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity \${m.role === 'user' ? 'justify-end' : ''}">
                            <button onclick="editMessage(\${idx})" class="text-[10px] text-slate-400 hover:text-blue-500">编辑</button>
                            <button onclick="deleteMessage(\${idx})" class="text-[10px] text-slate-400 hover:text-red-500">删除</button>
                        </div>
                    </div>
                </div>
            \`).join('');
            box.scrollTop = box.scrollHeight;
        }

        function editMessage(idx) {
            const session = sessions.find(s => s.id === currentId);
            const newText = prompt("编辑对话内容:", session.messages[idx].parts[0].text);
            if (newText !== null) {
                session.messages[idx].parts[0].text = newText;
                if (session.messages[idx].role === 'user') {
                    // 如果编辑了用户问题，删除之后的所有 AI 回复并重发
                    session.messages = session.messages.slice(0, idx + 1);
                    renderMessages();
                    callGemini(session);
                } else {
                    saveAndRender();
                    renderMessages();
                }
            }
        }

        function deleteMessage(idx) {
            const session = sessions.find(s => s.id === currentId);
            session.messages.splice(idx, 1);
            saveAndRender();
            renderMessages();
        }

        function deleteSession(id, e) {
            e.stopPropagation();
            sessions = sessions.filter(s => s.id !== id);
            if (!sessions.length) createNewChat();
            else if (currentId === id) switchSession(sessions[0].id);
            saveAndRender();
        }

        function renameCurrentSession() {
            const s = sessions.find(x => x.id === currentId);
            const name = prompt("重命名对话:", s.title);
            if (name) {
                s.title = name;
                saveAndRender();
                document.getElementById('currentChatTitle').innerText = name;
            }
        }

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
                if(!isInit) alert("成功获取 " + data.models.length + " 个模型");
            } catch (e) { console.error(e); }
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
// Proxy Logic (支持跨域、流式转发)
// --------------------------------------------------------------------------
app.get('/', (req, res) => res.send(WEB_UI_HTML));

app.all(/(.*)/, async (req, res) => {
    if (req.path === '/' || req.path === '/favicon.ico') return;
    let apiKey = req.headers['x-goog-api-key'] || req.query.key || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });

    let targetPath = req.path.startsWith('/v1') ? req.path : '/v1beta' + req.path;
    const targetUrl = \`https://generativelanguage.googleapis.com\${targetPath}?\${new url.URLSearchParams({...req.query, key: apiKey})}\`;

    try {
        const response = await axios({
            method: req.method, url: targetUrl, headers: { 'Content-Type': 'application/json' },
            data: req.body, validateStatus: () => true, responseType: 'stream'
        });
        res.status(response.status);
        response.data.pipe(res);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Running: http://localhost:${PORT}`));
