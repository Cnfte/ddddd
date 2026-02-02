const express = require('express');
const axios = require('axios');
const { finished } = require('stream');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 【后端硬核配置】
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

const WEB_UI_HTML = `
<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=0">
    <title>WebUI</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github-dark.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
    <style>
        /* 【外部样式优化：彻底消除系统干扰】 */
        * { 
            -webkit-tap-highlight-color: transparent !important; 
            outline: none !important; 
            box-shadow: none !important;
            -webkit-overflow-scrolling: touch;
        }
        
        /* 隐藏所有丑陋滚动条 */
        ::-webkit-scrollbar { display: none; }
        * { scrollbar-width: none; }

        textarea, input, select {
            -webkit-appearance: none;
            outline: none !important;
            border: none !important;
            background: transparent;
        }

        /* 针对 iOS/Android 选中边框的死刑判决 */
        textarea:focus, input:focus {
            outline: 0 !important;
            border: none !important;
        }

        body { 
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
            background-color: #ffffff;
            color: #1c1c1e;
            display: flex;
            height: 100%;
            overflow: hidden;
        }

        /* 侧边栏物理动效 */
        .sidebar {
            width: 280px;
            background: #1c1c1e;
            color: white;
            transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 100;
        }
        @media (max-width: 768px) {
            .sidebar { position: fixed; height: 100%; transform: translateX(-100%); }
            body.sb-open .sidebar { transform: translateX(0); }
        }

        /* 遮罩层 */
        .overlay {
            display: none;
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.4);
            backdrop-filter: blur(8px);
            z-index: 90;
        }
        body.sb-open .overlay { display: block; }

        /* 消息气泡质感 */
        .bubble-user {
            background: #007AFF;
            color: white;
            border-radius: 20px 20px 4px 20px;
            box-shadow: 0 4px 15px rgba(0,122,255,0.15);
        }
        .bubble-bot {
            background: #F2F2F7;
            color: #1c1c1e;
            border-radius: 20px 20px 20px 4px;
        }

        /* 加载动画 */
        .typing-loader {
            display: flex;
            gap: 4px;
            padding: 10px 15px;
            background: #F2F2F7;
            border-radius: 15px;
            width: fit-content;
        }
        .dot {
            width: 6px;
            height: 6px;
            background: #94a3b8;
            border-radius: 50%;
            animation: blink 1.4s infinite both;
        }
        @keyframes blink { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }

        /* 代码块样式增强 */
        pre {
            background: #000 !important;
            padding: 15px;
            border-radius: 12px;
            margin: 10px 0;
            overflow-x: auto;
            position: relative;
        }
        .copy-btn {
            position: absolute;
            right: 8px;
            top: 8px;
            padding: 4px 8px;
            background: rgba(255,255,255,0.1);
            color: #fff;
            border-radius: 6px;
            font-size: 10px;
            cursor: pointer;
        }

        /* 移动端适配 */
        .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom); }
    </style>
</head>
<body class="h-full">
    <div class="overlay" onclick="toggleSidebar()"></div>
    
    <aside class="sidebar flex flex-col">
        <div class="p-6">
            <button onclick="createNewSession()" class="w-full bg-blue-600 hover:bg-blue-500 py-4 rounded-2xl font-bold transition-all active:scale-95 shadow-lg">+ 新对话</button>
        </div>
        <div id="sessionList" class="flex-grow overflow-y-auto px-4 space-y-2"></div>
        <div class="p-6 border-t border-white/10 space-y-4">
            <input type="password" id="apiKey" placeholder="在此输入 API Key" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm">
            <select id="modelSelector" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm appearance-none"></select>
            <button onclick="fetchModels()" id="syncBtn" class="w-full text-blue-400 text-xs font-bold py-2">刷新模型列表</button>
        </div>
    </aside>

    <main class="flex-grow flex flex-col min-w-0 bg-white relative">
        <header class="h-16 flex items-center px-4 justify-between border-b border-gray-100 bg-white/90 backdrop-blur-md sticky top-0 z-50">
            <button onclick="toggleSidebar()" class="p-2 active:bg-gray-100 rounded-full md:hidden">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
            </button>
            <div id="currentTitle" class="font-bold text-lg truncate mx-4">WebUI</div>
            <button onclick="clearCurrentChat()" class="text-red-500 font-bold text-sm px-2">重置</button>
        </header>

        <div id="chatContainer" class="flex-grow overflow-y-auto px-4 py-6 md:px-24 lg:px-48 space-y-8"></div>

        <div id="loader" class="px-4 md:px-24 lg:px-48 hidden mb-6">
            <div class="typing-loader">
                <div class="dot"></div><div class="dot" style="animation-delay:0.2s"></div><div class="dot" style="animation-delay:0.4s"></div>
            </div>
        </div>

        <footer class="p-4 bg-white border-t border-gray-100 safe-area-bottom">
            <div id="fileZone" class="max-w-4xl mx-auto flex flex-wrap gap-2 mb-2"></div>
            <div class="max-w-4xl mx-auto flex items-end gap-2 bg-[#F2F2F7] rounded-[28px] p-2 focus-within:bg-[#E5E5EA] transition-all">
                <label class="p-3 text-gray-500 hover:text-blue-600 cursor-pointer">
                    <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                    <input type="file" id="fileInput" class="hidden" multiple onchange="handleFiles(this)">
                </label>
                <textarea id="userInput" rows="1" class="flex-grow p-3 text-[17px] max-h-48 resize-none" placeholder="输入消息..." onkeydown="onEnter(event)"></textarea>
                <button onclick="doSend()" id="sendBtn" class="bg-[#007AFF] text-white p-3.5 rounded-full shadow-lg active:scale-90 transition-all">
                    <svg width="20" height="20" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
            </div>
        </footer>
    </main>

    <script>
        // 【精华逻辑：对话管理系统】
        let sessions = JSON.parse(localStorage.getItem('WEBUI_V12_DB') || '[]');
        let activeId = localStorage.getItem('WEBUI_ACTIVE_ID') || null;
        let pFiles = [];

        window.onload = () => {
            const k = localStorage.getItem('WEBUI_KEY') || '';
            document.getElementById('apiKey').value = k;
            if(!sessions.length) createNewSession(); else loadSession(activeId || sessions[0].id);
            fetchModels(true);
            marked.setOptions({
                highlight: function(code) { return hljs.highlightAuto(code).value; }
            });
        };

        function toggleSidebar() { document.body.classList.toggle('sb-open'); }

        function createNewSession() {
            const id = Date.now().toString();
            sessions.unshift({ id, title: '新对话', msgs: [] });
            saveAndSwitch(id);
        }

        function loadSession(id) {
            activeId = id;
            localStorage.setItem('WEBUI_ACTIVE_ID', id);
            const s = sessions.find(x => x.id === id);
            document.getElementById('currentTitle').innerText = s.title;
            renderAllMsgs();
            renderSessionList();
            document.body.classList.remove('sb-open');
        }

        function saveAndSwitch(id) {
            localStorage.setItem('WEBUI_V12_DB', JSON.stringify(sessions));
            if(id) loadSession(id); else renderSessionList();
        }

        function renderSessionList() {
            const list = document.getElementById('sessionList');
            list.innerHTML = sessions.map(s => \`
                <div onclick="loadSession('\${s.id}')" class="group relative px-5 py-4 rounded-2xl cursor-pointer transition-all \${s.id === activeId ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:bg-white/5'}">
                    <div class="truncate text-sm pr-6 font-medium">\${s.title}</div>
                    <div onclick="event.stopPropagation(); deleteSession('\${s.id}')" class="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity">✕</div>
                </div>
            \`).join('');
        }

        function deleteSession(id) {
            sessions = sessions.filter(s => s.id !== id);
            if(id === activeId) activeId = sessions.length ? sessions[0].id : null;
            if(!sessions.length) createNewSession(); else saveAndSwitch(activeId);
        }

        function clearCurrentChat() {
            const s = sessions.find(x => x.id === activeId);
            s.msgs = [];
            saveAndSwitch(activeId);
        }

        // 【精华逻辑：多模态处理】
        function handleFiles(inp) {
            for(let f of inp.files) {
                const r = new FileReader();
                r.onload = (e) => {
                    pFiles.push({n: f.name, t: f.type, d: e.target.result});
                    renderFileZone();
                };
                if(f.type.startsWith('image/')) r.readAsDataURL(f); else r.readAsText(f);
            }
        }

        function renderFileZone() {
            const z = document.getElementById('fileZone');
            z.innerHTML = pFiles.map((f, i) => \`
                <div class="bg-gray-100 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 border border-gray-200">
                    <span>\${f.n}</span>
                    <button onclick="pFiles.splice(\${i},1);renderFileZone()" class="text-gray-400 hover:text-red-500">✕</button>
                </div>
            \`).join('');
        }

        async function doSend() {
            const val = document.getElementById('userInput').value.trim();
            const key = document.getElementById('apiKey').value;
            if(!val && !pFiles.length) return;
            if(!key) { alert('请输入 API Key'); return; }

            localStorage.setItem('WEBUI_KEY', key);
            const s = sessions.find(x => x.id === activeId);
            if(!s.msgs.length) s.title = val.slice(0,15) || "图片分析";

            let pts = [{text: val || "分析附件"}];
            pFiles.forEach(f => {
                if(f.t.startsWith('image/')) pts.push({inline_data:{mime_type:f.t, data:f.d.split(',')[1]}});
                else pts[0].text += "\\n\\n【文件: " + f.n + "】\\n" + f.d;
            });

            s.msgs.push({role:'user', parts:pts});
            pFiles = []; document.getElementById('userInput').value = ''; 
            document.getElementById('fileZone').innerHTML = '';
            renderAllMsgs();
            document.getElementById('loader').classList.remove('hidden');

            try {
                const model = document.getElementById('modelSelector').value;
                const res = await fetch('/' + model + ':streamGenerateContent?key=' + key, {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({ contents: s.msgs.map(m=>({role:m.role, parts:m.parts})) })
                });

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let full = "";
                const midx = s.msgs.length;
                s.msgs.push({role:'model', parts:[{text:''}]});

                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    document.getElementById('loader').classList.add('hidden');
                    const chunk = decoder.decode(value);
                    // 【精华逻辑：多重容错正则】
                    const matches = chunk.matchAll(/"text"\\s*:\\s*"(.*?)(?<!\\\\)"/g);
                    for (const m of matches) {
                        try {
                            const unescaped = JSON.parse('{"t":"' + m[1] + '"}').t;
                            full += unescaped;
                            s.msgs[midx].parts[0].text = full;
                            renderAllMsgs(true);
                        } catch(e){}
                    }
                }
                saveAndSwitch();
            } catch(e) { 
                document.getElementById('loader').classList.add('hidden');
                alert("请求失败，检查 API Key 或网络"); 
            }
        }

        function renderAllMsgs(sil=false) {
            const box = document.getElementById('chatContainer');
            const s = sessions.find(x => x.id === activeId);
            box.innerHTML = s.msgs.map(m => \`
                <div class="flex \${m.role==='user'?'justify-end':'justify-start'}">
                    <div class="max-w-[92%] md:max-w-[85%]">
                        <div class="px-5 py-4 \${m.role==='user'?'bubble-user':'bubble-bot'}">
                            <div class="prose \${m.role==='user'?'prose-invert':''} text-[17px] leading-relaxed">
                                \${marked.parse(m.parts[0].text || '')}
                            </div>
                        </div>
                    </div>
                </div>
            \`).join('');
            if(!sil) box.scrollTo({top:box.scrollHeight, behavior:'smooth'}); else box.scrollTop = box.scrollHeight;
            
            // 为所有 pre 添加复制按钮
            document.querySelectorAll('pre').forEach(pre => {
                if(!pre.querySelector('.copy-btn')) {
                    const btn = document.createElement('div');
                    btn.className = 'copy-btn';
                    btn.innerText = '复制';
                    btn.onclick = () => {
                        navigator.clipboard.writeText(pre.innerText.replace('复制', ''));
                        btn.innerText = '已复制';
                        setTimeout(() => btn.innerText = '复制', 2000);
                    };
                    pre.appendChild(btn);
                }
            });
        }

        async function fetchModels(sil=false) {
            const k = document.getElementById('apiKey').value; if(!k) return;
            try {
                const r = await fetch('/v1beta/models?key=' + k);
                const d = await r.json();
                if(d.models) {
                    document.getElementById('modelSelector').innerHTML = d.models.filter(m=>m.name.includes('gemini')).map(m=>\`
                        <option value="\${m.name}" \${m.name.includes('flash')?'selected':''}>\${m.displayName}</option>
                    \`).join('');
                }
            } catch(e){}
        }

        function onEnter(e) { if(e.key === 'Enter' && !e.shiftKey && window.innerWidth > 768) { e.preventDefault(); doSend(); } }
        document.getElementById('userInput').oninput = function() {
            this.style.height = "auto";
            this.style.height = (this.scrollHeight) + "px";
        };
    </script>
</body>
</html>
`;

// --- 【精华版后端：Node 22 暴力转发补丁】 ---
app.get('/', (req, res) => res.send(WEB_UI_HTML));

app.all(/(.*)/, async (req, res) => {
    if (req.path === '/' || req.path === '/favicon.ico') return;
    
    const apiKey = req.query.key || req.headers['x-goog-api-key'];
    if (!apiKey) return res.status(401).end();

    let p = req.path;
    if (!p.includes('v1')) {
        p = '/v1beta' + (p.startsWith('/') ? '' : '/') + p;
    }
    
    // 强制使用最稳的加号拼接，防止任何反引号转义导致的 SyntaxError
    const tUrl = 'https://generativelanguage.googleapis.com' + p + '?key=' + apiKey;

    try {
        const response = await axios({
            method: req.method,
            url: tUrl,
            data: req.body,
            responseType: 'stream',
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true, // 转发 400, 404, 500 等所有错误，让前端捕获
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 60000
        });

        res.status(response.status);
        response.data.pipe(res);
        finished(response.data, (err) => {
            if(err) console.error('流传输中断:', err.message);
            res.end();
        });

    } catch (e) {
        console.error('转发层崩溃:', e.message);
        if (!res.headersSent) res.status(500).send(e.message);
    }
});

app.listen(PORT, () => {
    console.log('-------------------------------------------');
    console.log('✅ GEMINI WEBUI 究极完整版已满血启动');
    console.log('🚀 运行地址: http://localhost:' + PORT);
    console.log('-------------------------------------------');
});
