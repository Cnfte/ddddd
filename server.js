const express = require('express');
const axios = require('axios');
const { finished } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

// 【后端硬核配置：支持超大文件、多图传输、无限长响应】
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

const WEB_UI_HTML = `
<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=0">
    <title>Gemini Pro 完整版</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github-dark.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
    <style>
        /* 【暴力 UI 封印：彻底干掉系统级选中框】 */
        * { 
            -webkit-tap-highlight-color: transparent !important; 
            outline: none !important; 
            box-shadow: none !important;
            scrollbar-width: none;
        }
        *::-webkit-scrollbar { display: none; }
        
        textarea, input, select {
            -webkit-appearance: none;
            outline: none !important;
            border: none !important;
            background: transparent;
        }

        /* 强制覆盖：点击时绝不显示任何系统高亮 */
        textarea:focus, input:focus {
            outline: 0 !important;
            -webkit-tap-highlight-color: rgba(0,0,0,0) !important;
        }

        body { 
            font-family: -apple-system, system-ui, sans-serif; 
            background: #ffffff; 
            color: #1c1c1e;
            display: flex;
            height: 100%;
            overflow: hidden;
        }

        /* Apple 级物理曲线侧边栏 */
        .sidebar {
            width: 280px;
            background: #1c1c1e;
            color: #fff;
            transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            z-index: 1001;
        }
        @media (max-width: 768px) {
            .sidebar { position: fixed; height: 100%; transform: translateX(-100%); }
            body.sb-open .sidebar { transform: translateX(0); }
        }

        .overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.4);
            backdrop-filter: blur(10px);
            z-index: 1000;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s ease;
        }
        body.sb-open .overlay { opacity: 1; pointer-events: auto; }

        /* 消息气泡：极致质感 */
        .bubble-u { 
            background: #007AFF; 
            color: white; 
            border-radius: 20px 20px 4px 20px;
            box-shadow: 0 4px 15px rgba(0,122,255,0.15);
        }
        .bubble-a { 
            background: #F2F2F7; 
            color: #1c1c1e; 
            border-radius: 20px 20px 20px 4px;
            border: 0.5px solid rgba(0,0,0,0.05);
        }

        /* 打字机等待动画 */
        .dot { width: 6px; height: 6px; background: #94a3b8; border-radius: 50%; animation: blink 1.4s infinite both; }
        @keyframes blink { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }

        /* 代码块优化 */
        pre { background: #1c1c1e !important; color: #e5e7eb; padding: 16px; border-radius: 12px; margin: 12px 0; font-size: 14px; overflow-x: auto; }
        code { font-family: "SF Mono", Menlo, monospace; }
        .safe-area-bottom { padding-bottom: env(safe-area-inset-bottom); }
    </style>
</head>
<body class="h-full">
    <div class="overlay" onclick="toggleSB()"></div>
    
    <aside class="sidebar flex flex-col">
        <div class="p-6">
            <button onclick="newChat()" class="w-full bg-white/10 hover:bg-white/20 py-4 rounded-2xl font-bold transition-all active:scale-95 shadow-xl">＋ 新建对话</button>
        </div>
        <div id="sessionList" class="flex-grow overflow-y-auto px-4 space-y-2"></div>
        <div class="p-6 border-t border-white/10 space-y-4">
            <div class="text-[10px] text-gray-500 font-bold tracking-widest uppercase">API 设置</div>
            <input type="password" id="apiKey" placeholder="在此粘贴 API Key" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm">
            <select id="modelSelect" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm"></select>
            <button onclick="fetchModels()" class="w-full text-blue-400 text-xs font-bold py-2">刷新模型列表</button>
        </div>
    </aside>

    <main class="flex-grow flex flex-col min-w-0 bg-white relative">
        <header class="h-16 flex items-center px-4 justify-between border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-50">
            <button onclick="toggleSB()" class="p-2 active:bg-gray-100 rounded-full md:hidden">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
            </button>
            <div id="chatTitle" class="font-bold text-lg truncate mx-4">WebUI Pro</div>
            <button onclick="clearChat()" class="text-blue-600 font-bold text-sm px-2">重置</button>
        </header>

        <div id="chatBox" class="flex-grow overflow-y-auto px-4 py-6 md:px-24 lg:px-48 space-y-8"></div>

        <div id="loading" class="px-4 md:px-24 lg:px-48 hidden mb-6">
            <div class="flex gap-1.5 p-4 bg-gray-100 w-fit rounded-2xl">
                <div class="dot"></div><div class="dot" style="animation-delay:0.2s"></div><div class="dot" style="animation-delay:0.4s"></div>
            </div>
        </div>

        <footer class="p-4 bg-white border-t border-gray-100 safe-area-bottom">
            <div id="previews" class="max-w-4xl mx-auto flex flex-wrap gap-2 mb-2"></div>
            <div class="max-w-4xl mx-auto flex items-end gap-2 bg-[#F2F2F7] rounded-[28px] p-2 focus-within:bg-[#E5E5EA] transition-all">
                <label class="p-3 text-gray-500 hover:text-blue-600 cursor-pointer">
                    <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                    <input type="file" id="fileInp" class="hidden" multiple onchange="handleFiles(this)">
                </label>
                <textarea id="uInput" rows="1" class="flex-grow p-3 text-[17px] max-h-48 resize-none" placeholder="输入消息..." onkeydown="handleEnter(event)"></textarea>
                <button onclick="send()" id="sendBtn" class="bg-[#007AFF] text-white p-3.5 rounded-full shadow-lg active:scale-90 transition-all">
                    <svg width="20" height="20" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
            </div>
        </footer>
    </main>

    <script>
        let db = JSON.parse(localStorage.getItem('GEMINI_PRO_V20') || '[]');
        let curId = localStorage.getItem('GEMINI_CUR_ID') || null;
        let pFiles = [];

        window.onload = () => {
            const k = localStorage.getItem('GEMINI_KEY') || '';
            document.getElementById('apiKey').value = k;
            if(!db.length) newChat(); else switchChat(curId || db[0].id);
            fetchModels();
            marked.setOptions({ highlight: (code) => hljs.highlightAuto(code).value });
        };

        function toggleSB() { document.body.classList.toggle('sb-open'); }
        function newChat() { const id = Date.now().toString(); db.unshift({id, title:'新对话', msgs:[]}); save(id); }
        function switchChat(id) { curId = id; localStorage.setItem('GEMINI_CUR_ID', id); const s = db.find(x=>x.id===id); document.getElementById('chatTitle').innerText = s.title; renderMsgs(); renderList(); document.body.classList.remove('sb-open'); }
        function save(id) { localStorage.setItem('GEMINI_PRO_V20', JSON.stringify(db)); if(id) switchChat(id); else renderList(); }
        function renderList() { document.getElementById('sessionList').innerHTML = db.map(s => \`<div onclick="switchChat('\${s.id}')" class="px-5 py-4 rounded-2xl cursor-pointer truncate text-sm \${s.id === curId ? 'bg-blue-600 text-white font-bold shadow-lg' : 'text-gray-400 hover:bg-white/5'}">\${s.title}</div>\`).join(''); }
        function clearChat() { const s = db.find(x=>x.id===curId); s.msgs = []; save(curId); }

        function handleFiles(inp) {
            for(let f of inp.files) {
                const r = new FileReader();
                r.onload = (e) => {
                    pFiles.push({n: f.name, t: f.type, d: e.target.result});
                    document.getElementById('previews').innerHTML += \`<div class="bg-gray-100 px-3 py-1 rounded-full text-xs font-bold">\${f.name}</div>\`;
                };
                if(f.type.startsWith('image/')) r.readAsDataURL(f); else r.readAsText(f);
            }
        }

        async function fetchModels() {
            const k = document.getElementById('apiKey').value; if(!k) return;
            localStorage.setItem('GEMINI_KEY', k);
            try {
                const r = await fetch('./v1beta/models?key=' + k);
                const d = await r.json();
                if(d.models) document.getElementById('modelSelect').innerHTML = d.models.filter(m=>m.name.includes('gemini')).map(m=>\`<option value="\${m.name}" \${m.name.includes('flash')?'selected':''}>\${m.displayName}</option>\`).join('');
            } catch(e){}
        }

        async function send() {
            const val = document.getElementById('uInput').value.trim();
            const k = document.getElementById('apiKey').value;
            if(!val && !pFiles.length) return;
            const s = db.find(x=>x.id===curId);
            if(!s.msgs.length) s.title = val.slice(0,12) || "附件分析";

            let pts = [{text: val || "分析附件内容"}];
            pFiles.forEach(f => {
                if(f.t.startsWith('image/')) pts.push({inline_data:{mime_type:f.t, data:f.d.split(',')[1]}});
                else pts[0].text += "\\n【文件: " + f.n + "】\\n" + f.d;
            });

            s.msgs.push({role:'user', parts:pts});
            pFiles = []; document.getElementById('uInput').value = ''; document.getElementById('previews').innerHTML = '';
            renderMsgs();
            document.getElementById('loading').classList.remove('hidden');

            try {
                const model = document.getElementById('modelSelect').value;
                const response = await fetch('./' + model + ':streamGenerateContent?key=' + k, {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({ contents: s.msgs.map(m=>({role:m.role, parts:m.parts})) })
                });

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let full = "";
                const aiIdx = s.msgs.length;
                s.msgs.push({role:'model', parts:[{text:''}]});

                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    document.getElementById('loading').classList.add('hidden');
                    const chunk = decoder.decode(value);
                    const matches = chunk.matchAll(/"text"\\s*:\\s*"(.*?)(?<!\\\\)"/g);
                    for (const m of matches) {
                        try {
                            const val = JSON.parse('{"t":"' + m[1] + '"}').t;
                            full += val; s.msgs[aiIdx].parts[0].text = full; renderMsgs(true);
                        } catch(e){}
                    }
                }
                save();
            } catch(e) { 
                document.getElementById('loading').classList.add('hidden');
                alert("API 响应失败，请检查网络或 Key"); 
            }
        }

        function renderMsgs(sil=false) {
            const b = document.getElementById('chatBox');
            const s = db.find(x=>x.id===curId);
            b.innerHTML = s.msgs.map(m => \`
                <div class="flex \${m.role==='user'?'justify-end':'justify-start'}">
                    <div class="max-w-[92%] md:max-w-[85%] px-5 py-3.5 \${m.role==='user'?'bubble-u':'bubble-a'} text-[17px] leading-relaxed">
                        \${marked.parse(m.parts[0].text || '')}
                    </div>
                </div>\`).join('');
            if(!sil) b.scrollTo({top:b.scrollHeight, behavior:'smooth'}); else b.scrollTop = b.scrollHeight;
        }

        function handleEnter(e) { if(e.key === 'Enter' && !e.shiftKey && window.innerWidth > 768) { e.preventDefault(); send(); } }
        document.getElementById('uInput').oninput = function() { this.style.height = "auto"; this.style.height = (this.scrollHeight) + "px"; };
    </script>
</body>
</html>
`;

// --- 【硬核后端转发：解决 SyntaxError 的最终补丁】 ---
app.get('/', (req, res) => res.send(WEB_UI_HTML));

app.all(/(.*)/, async (req, res) => {
    if (req.path === '/' || req.path === '/favicon.ico') return;
    
    const apiKey = req.query.key;
    if (!apiKey) return res.status(401).end();

    let apiPath = req.path;
    // 自动补全 v1beta
    if (!apiPath.includes('v1')) apiPath = '/v1beta' + (apiPath.startsWith('/') ? '' : '/') + apiPath;
    
    // 【关键修复】：放弃不稳定的反引号转义，使用最稳的字符串拼接
    const targetUrl = 'https://generativelanguage.googleapis.com' + apiPath + '?key=' + apiKey;

    try {
        const response = await axios({
            method: req.method,
            url: targetUrl,
            data: req.body,
            responseType: 'stream',
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 60000
        });

        res.status(response.status);
        response.data.pipe(res);
        finished(response.data, () => res.end());
    } catch (e) {
        if (!res.headersSent) res.status(500).send(e.message);
    }
});

app.listen(PORT, () => console.log('🚀 服务已在端口 ' + PORT + ' 满血启动'));
