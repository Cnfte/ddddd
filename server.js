const express = require('express');
const axios = require('axios');
const url = require('url');
const { finished } = require('stream');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 【精华逻辑：超大负载容错】
app.use(express.json({ limit: '150mb' }));
app.use(express.urlencoded({ extended: true, limit: '150mb' }));

const WEB_UI_HTML = `
<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=0">
    <title>WebUI</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css"/>
    <style>
        /* 【UI精华：彻底移除所有系统级干扰】 */
        * { 
            -webkit-tap-highlight-color: transparent !important; 
            outline: none !important; 
            -webkit-appearance: none;
            scrollbar-width: none;
        }
        *::-webkit-scrollbar { display: none; }
        
        textarea:focus, input:focus, select:focus, button:focus {
            border: none !important;
            box-shadow: none !important;
            outline: none !important;
        }

        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #ffffff;
            color: #1c1c1e;
            overscroll-behavior-y: contain;
        }

        /* Apple 级物理曲线侧边栏 */
        .drawer-mask {
            transition: all 0.5s cubic-bezier(0.32, 0.72, 0, 1);
            background: rgba(0,0,0,0);
            pointer-events: none;
            backdrop-filter: blur(0px);
        }
        body.sb-open .drawer-mask {
            background: rgba(0,0,0,0.4);
            pointer-events: auto;
            backdrop-filter: blur(10px);
        }
        .drawer {
            transform: translateX(-100%);
            transition: transform 0.5s cubic-bezier(0.32, 0.72, 0, 1);
            box-shadow: 20px 0 50px rgba(0,0,0,0.1);
        }
        body.sb-open .drawer { transform: translateX(0); }

        /* 气泡设计：极致质感 */
        .msg-u { 
            background: #007AFF; 
            color: white; 
            border-radius: 22px 22px 4px 22px;
            box-shadow: 0 4px 15px rgba(0,122,255,0.15);
        }
        .msg-a { 
            background: #F2F2F7; 
            color: #1c1c1e; 
            border-radius: 22px 22px 22px 4px;
            border: 0.5px solid rgba(0,0,0,0.05);
        }

        /* 修复版 Apple 等待动画 */
        .typing-bubble {
            display: inline-flex;
            gap: 5px;
            padding: 14px 20px;
            background: #F2F2F7;
            border-radius: 20px;
            align-items: center;
        }
        .dot {
            width: 7px;
            height: 7px;
            background: #94a3b8;
            border-radius: 50%;
            animation: apple-blink 1.4s infinite ease-in-out both;
        }
        @keyframes apple-blink {
            0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
            40% { transform: scale(1.1); opacity: 1; }
        }

        /* 代码块优化 */
        pre {
            background: #1c1c1e !important;
            color: #e5e7eb;
            padding: 16px;
            border-radius: 14px;
            margin: 12px 0;
            font-size: 14px;
            line-height: 1.5;
            overflow-x: auto;
        }
        code { font-family: "SF Mono", Menlo, monospace; }

        /* 输入区域弹性设计 */
        .input-area {
            background: rgba(242, 242, 247, 0.8);
            backdrop-filter: blur(20px);
            border: 0.5px solid rgba(0,0,0,0.05);
        }
    </style>
</head>
<body class="h-full flex flex-col overflow-hidden">
    <div onclick="toggleSB()" class="drawer-mask fixed inset-0 z-[999]"></div>
    
    <aside class="drawer fixed inset-y-0 left-0 w-[300px] bg-[#1c1c1e] z-[1000] flex flex-col">
        <div class="p-6 flex flex-col h-full">
            <div class="flex items-center justify-between mb-8">
                <span class="text-white font-bold text-xl tracking-tight">历史记录</span>
                <button onclick="newChat()" class="p-2 bg-white/10 rounded-full text-white active:scale-90 transition-all">
                    <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                </button>
            </div>
            <div id="sessionList" class="flex-grow overflow-y-auto space-y-2 pr-2"></div>
            <div class="mt-auto space-y-4 pt-6 border-t border-white/10">
                <div class="space-y-1">
                    <label class="text-[10px] text-gray-500 font-bold uppercase ml-1">Google API Key</label>
                    <input type="password" id="apiKey" placeholder="在此粘贴 Key" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:bg-white/10 transition-all">
                </div>
                <div class="space-y-1">
                    <label class="text-[10px] text-gray-500 font-bold uppercase ml-1">选择模型</label>
                    <select id="modelSelect" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm appearance-none cursor-pointer"></select>
                </div>
                <button onclick="refreshModels()" id="syncBtn" class="w-full py-3 bg-blue-600 rounded-xl text-white text-sm font-bold active:scale-95 transition-all shadow-lg shadow-blue-900/20">同步模型列表</button>
            </div>
        </div>
    </aside>

    <main class="flex-grow flex flex-col h-full relative bg-white">
        <header class="h-[64px] flex items-center px-4 justify-between border-b border-gray-100 sticky top-0 bg-white/80 backdrop-blur-lg z-50">
            <button onclick="toggleSB()" class="p-2 hover:bg-gray-100 rounded-full transition-colors active:scale-90">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1c1c1e" stroke-width="2.2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
            </button>
            <h1 id="chatTitle" class="font-bold text-[17px] tracking-tight truncate max-w-[180px]">WebUI</h1>
            <button onclick="newChat()" class="p-2 text-blue-600 font-bold text-sm">重置</button>
        </header>

        <div id="chatBox" class="flex-grow overflow-y-auto px-4 py-6 md:px-32 lg:px-64 space-y-8"></div>

        <div id="loadingStatus" class="px-4 md:px-32 lg:px-64 hidden mb-6 animate__animated animate__fadeIn">
            <div class="typing-bubble">
                <div class="dot"></div>
                <div class="dot" style="animation-delay: 0.2s"></div>
                <div class="dot" style="animation-delay: 0.4s"></div>
            </div>
        </div>

        <footer class="p-4 bg-white/90 backdrop-blur-xl border-t border-gray-50 pb-[env(safe-area-inset-bottom)]">
            <div id="filePreview" class="max-w-4xl mx-auto flex flex-wrap gap-2 mb-3"></div>
            <div class="max-w-4xl mx-auto flex items-end gap-2 input-area rounded-[28px] p-2 transition-all focus-within:bg-[#e5e5ea]">
                <label class="p-3 text-gray-500 hover:text-blue-600 cursor-pointer transition-colors">
                    <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                    <input type="file" id="fileInput" class="hidden" multiple onchange="handleFileSelect(this)">
                </label>
                <textarea id="userInput" rows="1" class="flex-grow bg-transparent border-none p-2.5 text-[17px] leading-snug max-h-[200px] resize-none overflow-y-auto" placeholder="说点什么..." onkeydown="checkSubmit(event)"></textarea>
                <button onclick="sendMessage()" id="sendButton" class="bg-blue-600 text-white p-3.5 rounded-full active:scale-90 transition-all shadow-md">
                    <svg width="20" height="20" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
            </div>
        </footer>
    </main>

    <script>
        let sessions = JSON.parse(localStorage.getItem('gemini_sessions_v9') || '[]');
        let currentSessionId = localStorage.getItem('gemini_current_id') || null;
        let pendingFiles = [];

        // 初始化
        window.onload = () => {
            const savedKey = localStorage.getItem('gemini_api_key') || '';
            document.getElementById('apiKey').value = savedKey;
            
            if (sessions.length === 0) {
                newChat();
            } else {
                switchSession(currentSessionId || sessions[0].id);
            }
            refreshModels(true);
        };

        function toggleSB() { document.body.classList.toggle('sb-open'); }

        function newChat() {
            const id = Date.now().toString();
            sessions.unshift({ id, title: '新对话', messages: [] });
            saveSessions(id);
            if (window.innerWidth < 768) document.body.classList.remove('sb-open');
        }

        function switchSession(id) {
            currentSessionId = id;
            localStorage.setItem('gemini_current_id', id);
            const s = sessions.find(x => x.id === id);
            document.getElementById('chatTitle').innerText = s.title;
            renderMessages();
            renderSessionList();
            document.body.classList.remove('sb-open');
        }

        function saveSessions(newId = null) {
            localStorage.setItem('gemini_sessions_v9', JSON.stringify(sessions));
            if (newId) switchSession(newId); else renderSessionList();
        }

        function renderSessionList() {
            const list = document.getElementById('sessionList');
            list.innerHTML = sessions.map(s => \`
                <div onclick="switchSession('\${s.id}')" class="group relative px-4 py-4 rounded-2xl cursor-pointer transition-all \${s.id === currentSessionId ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:bg-white/5'}">
                    <div class="truncate text-sm font-medium pr-6">\${s.title}</div>
                    <div onclick="event.stopPropagation(); deleteSession('\${s.id}')" class="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 hover:text-red-400">✕</div>
                </div>
            \`).join('');
        }

        function deleteSession(id) {
            sessions = sessions.filter(s => s.id !== id);
            if (id === currentSessionId) currentSessionId = sessions.length ? sessions[0].id : null;
            if (!sessions.length) newChat(); else saveSessions(currentSessionId);
        }

        // 文件处理
        async function handleFileSelect(input) {
            for (let file of input.files) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    pendingFiles.push({ name: file.name, type: file.type, data: e.target.result });
                    renderFilePreview();
                };
                if (file.type.startsWith('image/')) reader.readAsDataURL(file);
                else reader.readAsText(file);
            }
            input.value = '';
        }

        function renderFilePreview() {
            const pre = document.getElementById('filePreview');
            pre.innerHTML = pendingFiles.map((f, i) => \`
                <div class="flex items-center gap-2 bg-gray-100 px-3 py-1.5 rounded-full animate__animated animate__bounceIn">
                    <span class="text-xs font-bold text-gray-600 truncate max-w-[100px]">\${f.name}</span>
                    <button onclick="pendingFiles.splice(\${i},1);renderFilePreview()" class="text-gray-400 hover:text-red-500 font-bold">✕</button>
                </div>
            \`).join('');
        }

        // 核心发送逻辑
        async function sendMessage() {
            const text = document.getElementById('userInput').value.trim();
            const key = document.getElementById('apiKey').value.trim();
            if (!text && !pendingFiles.length) return;
            if (!key) { alert('请输入 API Key'); return; }
            
            localStorage.setItem('gemini_api_key', key);
            const session = sessions.find(s => s.id === currentSessionId);
            
            // 自动改标题
            if (session.messages.length === 0) {
                session.title = text.slice(0, 15) || "图片分析";
            }

            let parts = [{ text: text || "请分析此附件" }];
            let images = [];
            
            pendingFiles.forEach(f => {
                if (f.type.startsWith('image/')) {
                    parts.push({ inline_data: { mime_type: f.type, data: f.data.split(',')[1] } });
                    images.push(f.data);
                } else {
                    parts[0].text += \`\\n\\n【文件内容: \${f.name}】\\n\${f.data}\`;
                }
            });

            session.messages.push({ role: 'user', parts, images });
            pendingFiles = [];
            renderFilePreview();
            document.getElementById('userInput').value = '';
            document.getElementById('userInput').style.height = 'auto';
            renderMessages();

            // 显示加载
            document.getElementById('loadingStatus').classList.remove('hidden');
            
            try {
                const model = document.getElementById('modelSelect').value;
                const response = await fetch(\`/\${model}:streamGenerateContent?key=\${key}\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: session.messages.map(m => ({ role: m.role, parts: m.parts }))
                    })
                });

                if (!response.ok) throw new Error('API 请求失败');

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let fullText = "";
                
                // 占位
                const aiMsgIdx = session.messages.length;
                session.messages.push({ role: 'model', parts: [{ text: "" }] });

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    document.getElementById('loadingStatus').classList.add('hidden');
                    const chunk = decoder.decode(value, { stream: true });
                    
                    // 【精华：多重容错正则解析】
                    const textMatches = chunk.matchAll(/"text"\\s*:\\s*"(.*?)(?<!\\\\)"/g);
                    for (const match of textMatches) {
                        try {
                            const rawStr = match[1];
                            // 暴力解码 Unicode 和转义
                            const unescaped = JSON.parse(\`{"t":"\${rawStr}"}\`).t;
                            fullText += unescaped;
                            session.messages[aiMsgIdx].parts[0].text = fullText;
                            renderMessages(true); // 静默渲染
                        } catch (e) {
                            // 如果 JSON 失败，尝试暴力清洗
                            const cleaned = rawStr.replace(/\\\\n/g, '\\n').replace(/\\\\"/g, '"');
                            fullText += cleaned;
                            session.messages[aiMsgIdx].parts[0].text = fullText;
                            renderMessages(true);
                        }
                    }
                }
                saveSessions();
            } catch (err) {
                document.getElementById('loadingStatus').classList.add('hidden');
                alert('连接中断: ' + err.message);
            }
        }

        function renderMessages(silent = false) {
            const box = document.getElementById('chatBox');
            const session = sessions.find(s => s.id === currentSessionId);
            
            box.innerHTML = session.messages.map(m => \`
                <div class="flex \${m.role === 'user' ? 'justify-end' : 'justify-start'} animate__animated animate__fadeInUp animate__faster">
                    <div class="max-w-[90%] md:max-w-[85%]">
                        <div class="px-5 py-4 \${m.role === 'user' ? 'msg-u' : 'msg-a'}">
                            \${m.images ? m.images.map(img => \`<img src="\${img}" class="rounded-xl mb-3 max-h-64 shadow-sm">\`).join('') : ''}
                            <div class="markdown-body prose \${m.role === 'user' ? 'prose-invert' : ''} text-[17px] leading-relaxed">
                                \${marked.parse(m.parts[0].text || (m.role==='model'?'...':''))}
                            </div>
                        </div>
                    </div>
                </div>
            \`).join('');
            
            if (!silent) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
            else box.scrollTop = box.scrollHeight;
        }

        async function refreshModels(silent = false) {
            const key = document.getElementById('apiKey').value;
            if (!key) return;
            const btn = document.getElementById('syncBtn');
            btn.innerText = "同步中...";
            try {
                const res = await fetch(\`/v1beta/models?key=\${key}\`);
                const data = await res.json();
                if (data.models) {
                    const filtered = data.models.filter(m => m.name.includes('gemini'));
                    document.getElementById('modelSelect').innerHTML = filtered.map(m => \`
                        <option value="\${m.name}" \${m.name.includes('1.5-flash') ? 'selected' : ''}>\${m.displayName}</option>
                    \`).join('');
                    if(!silent) alert('成功同步 ' + filtered.length + ' 个模型');
                }
            } catch (e) {
                if(!silent) alert('同步失败');
            }
            btn.innerText = "同步模型列表";
        }

        function checkSubmit(e) {
            if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 768) {
                e.preventDefault();
                sendMessage();
            }
        }

        document.getElementById('userInput').oninput = function() {
            this.style.height = "auto";
            this.style.height = (this.scrollHeight) + "px";
        };
    </script>
</body>
</html>
`;

// --- 【精华版后端：Node 22 暴力流量转发】 ---
app.get('/', (req, res) => res.send(WEB_UI_HTML));

app.all(/(.*)/, async (req, res) => {
    if (req.path === '/' || req.path === '/favicon.ico') return;
    
    const apiKey = req.query.key || req.headers['x-goog-api-key'];
    if (!apiKey) return res.status(401).send("Missing API Key");

    // 彻底修复路径：自动补全 v1beta
    let targetPath = req.path;
    if (!targetPath.includes('v1')) {
        targetPath = '/v1beta' + (targetPath.startsWith('/') ? '' : '/') + targetPath;
    }
    
    const targetUrl = \`https://generativelanguage.googleapis.com\${targetPath}?key=\${apiKey}\`;

    try {
        const response = await axios({
            method: req.method,
            url: targetUrl,
            data: req.body,
            responseType: 'stream',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            timeout: 60000,
            validateStatus: () => true, // 转发所有状态码，不让后端抛异常
            decompress: true
        });

        res.status(response.status);
        
        // 关键流式传输：Node 22 必须用 pipe 且手动清理
        response.data.pipe(res);

        finished(response.data, (err) => {
            if (err) console.error('Stream Error:', err.message);
            res.end();
        });

    } catch (e) {
        console.error('Proxy Error:', e.message);
        if (!res.headersSent) {
            res.status(500).send("Backend Proxy Error: " + e.message);
        }
    }
});

// 核心稳定补丁：捕捉未捕获异常，防止 Node 挂掉
process.on('uncaughtException', (err) => console.log('RUNTIME ERROR:', err.message));

app.listen(PORT, () => {
    console.log(\`
    -------------------------------------------
    ✅ GEMINI WEBUI 完整版启动成功
    🚀 访问地址: http://localhost:\${PORT}
    🛡️ 环境适配: Node 22+ / Mobile Safari / Chrome
    -------------------------------------------
    \`);
});
