const express = require('express');
const axios = require('axios');
const url = require('url');
const { finished } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const WEB_UI_HTML = `
<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=0">
    <title>Gemini Workspace Pro</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <style>
        /* 彻底干掉所有系统自带的丑陋高亮和边框 */
        * { -webkit-tap-highlight-color: transparent; outline: none !important; }
        textarea, input, select { border: none !important; box-shadow: none !important; appearance: none; -webkit-appearance: none; }
        
        body { font-family: -apple-system, system-ui, sans-serif; background: #fff; color: #1c1c1e; }

        /* 抽屉物理曲线 */
        .drawer { transition: transform 0.5s cubic-bezier(0.32, 0.72, 0, 1); z-index: 1000; }
        .overlay { transition: all 0.4s ease; background: rgba(0,0,0,0.4); backdrop-filter: blur(4px); pointer-events: none; opacity: 0; }
        body.sb-open .overlay { opacity: 1; pointer-events: auto; }
        body.sb-open .drawer { transform: translateX(0); }

        /* 气泡设计 */
        .bubble-u { background: #007AFF; color: #fff; border-radius: 20px 20px 4px 20px; margin-left: 20%; }
        .bubble-a { background: #F2F2F7; color: #1c1c1e; border-radius: 20px 20px 20px 4px; margin-right: 20%; }
        
        /* 三点加载动画 */
        .loader { display: flex; gap: 4px; padding: 12px 16px; background: #F2F2F7; border-radius: 18px; width: fit-content; margin-bottom: 20px; }
        .dot { width: 7px; height: 7px; background: #98989d; border-radius: 50%; animation: jump 1.4s infinite ease-in-out; }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes jump { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; } 40% { transform: scale(1.1); opacity: 1; } }

        .no-sb::-webkit-scrollbar { display: none; }
        pre { background: #000 !important; color: #fff; padding: 14px; border-radius: 12px; font-size: 13px; overflow-x: auto; margin: 8px 0; }
    </style>
</head>
<body class="h-full flex overflow-hidden">
    <div id="ovl" onclick="toggleSB()" class="overlay fixed inset-0 z-[999]"></div>
    
    <aside id="sb" class="drawer fixed md:relative h-full w-[280px] bg-[#1c1c1e] text-white -translate-x-full md:translate-x-0 flex flex-col shadow-2xl">
        <div class="p-6 flex flex-col h-full">
            <button onclick="newChat()" class="w-full bg-blue-600 hover:bg-blue-500 rounded-xl py-4 font-bold active:scale-95 transition-all shadow-lg">＋ 新建对话</button>
            <div id="sList" class="flex-grow overflow-y-auto mt-6 space-y-2 no-sb"></div>
            <div class="mt-auto space-y-4 pt-4 border-t border-white/10">
                <input type="password" id="key" placeholder="API Key" class="w-full bg-white/10 rounded-xl px-4 py-3 text-white text-sm">
                <select id="mSel" class="w-full bg-white/10 rounded-xl px-4 py-3 text-white text-sm"></select>
                <button onclick="syncM()" class="w-full text-blue-400 text-xs font-bold">刷新模型列表</button>
            </div>
        </div>
    </aside>

    <main class="flex-grow flex flex-col h-full min-w-0">
        <header class="h-14 flex items-center px-4 border-b border-gray-100 bg-white/90 backdrop-blur-md z-10 justify-between">
            <button onclick="toggleSB()" class="p-2 active:bg-gray-100 rounded-full"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg></button>
            <span id="cTitle" class="font-bold truncate max-w-[200px]">Gemini WebUI</span>
            <div class="w-10"></div>
        </header>

        <div id="box" class="flex-grow overflow-y-auto px-4 py-6 md:px-20 lg:px-40 space-y-6 no-sb"></div>

        <div id="loader-container" class="px-4 md:px-20 lg:px-40 hidden">
            <div class="loader"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
        </div>

        <footer class="p-4 bg-white border-t border-gray-100 pb-[env(safe-area-inset-bottom)]">
            <div class="max-w-4xl mx-auto flex items-end gap-2 bg-[#F2F2F7] rounded-[26px] p-2 transition-all">
                <label class="p-3 text-gray-400 cursor-pointer"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg><input type="file" id="fInp" class="hidden" multiple onchange="hFiles(this)"></label>
                <textarea id="uInp" rows="1" class="flex-grow bg-transparent p-2.5 text-[17px] max-h-40 resize-none" placeholder="输入消息..."></textarea>
                <button onclick="send()" id="sendBtn" class="bg-blue-600 text-white p-3 rounded-full active:scale-90 transition-all shadow-md"><svg width="20" height="20" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
            </div>
        </footer>
    </main>

    <script>
        let ss = JSON.parse(localStorage.getItem('g_final_v3') || '[]');
        let cur = localStorage.getItem('g_id') || null;
        let pFs = [];

        window.onload = () => {
            document.getElementById('key').value = localStorage.getItem('g_key') || '';
            if(!ss.length) newChat(); else swSession(cur || ss[0].id);
            syncM(true);
        };

        function toggleSB() { document.body.classList.toggle('sb-open'); }
        function newChat() { const id = Date.now().toString(); ss.unshift({id, title: '新对话', msgs: []}); sv(id); }
        function swSession(id) { cur = id; localStorage.setItem('g_id', id); const s = ss.find(x => x.id === id); document.getElementById('cTitle').innerText = s.title; rMsgs(); rList(); if(window.innerWidth < 768) document.body.classList.remove('sb-open'); }
        function sv(id) { localStorage.setItem('g_final_v3', JSON.stringify(ss)); if(id) swSession(id); else rList(); }
        function rList() { document.getElementById('sList').innerHTML = ss.map(s => \`<div onclick="swSession('\${s.id}')" class="px-4 py-3.5 rounded-xl cursor-pointer truncate text-sm \${s.id === cur ? 'bg-white/10 text-white font-bold' : 'text-gray-400 hover:bg-white/5'}">\${s.title}</div>\`).join(''); }

        async function hFiles(inp) {
            for(let f of inp.files) {
                const r = new FileReader();
                r.onload = (e) => { pFs.push({n: f.name, t: f.type, d: e.target.result}); };
                if(f.type.startsWith('image/')) r.readAsDataURL(f); else r.readAsText(f);
            }
        }

        async function send() {
            const txt = document.getElementById('uInp').value.trim();
            const k = document.getElementById('key').value;
            if(!txt && !pFs.length) return;
            const s = ss.find(x => x.id === cur);
            if(!s.msgs.length) s.title = txt.slice(0,10) || "新对话";
            
            let pts = [{text: txt || "分析附件"}];
            pFs.forEach(f => {
                if(f.t.startsWith('image/')) pts.push({inline_data:{mime_type:f.t, data:f.d.split(',')[1]}});
                else pts[0].text += "\\n【文件: " + f.n + "】\\n" + f.d;
            });

            s.msgs.push({role:'user', parts:pts});
            pFs = []; document.getElementById('uInp').value = '';
            document.getElementById('uInp').style.height = 'auto';
            rMsgs(); 
            
            // 显示浮动加载条
            document.getElementById('loader-container').classList.remove('hidden');
            await ask(s);
        }

        async function ask(s) {
            const m = document.getElementById('mSel').value;
            const k = document.getElementById('key').value;
            const box = document.getElementById('box');
            
            const idx = s.msgs.length;
            s.msgs.push({role:'model', parts:[{text:''}]});
            
            try {
                const res = await fetch(\`\${m}:streamGenerateContent?key=\${k}\`, {
                    method:'POST', body: JSON.stringify({contents: s.msgs.slice(0,-1).map(x=>({role:x.role, parts:x.parts}))})
                });

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let full = "";

                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    
                    // 只要流数据一开始进来，立即隐藏加载条
                    document.getElementById('loader-container').classList.add('hidden');

                    const raw = decoder.decode(value, {stream: true});
                    // 极致硬核解析：提取所有引号内的内容
                    const matches = raw.matchAll(/"text"\\s*:\\s*"(.*?)"/g);
                    for (const match of matches) {
                        try {
                            const part = JSON.parse('{"t":"' + match[1] + '"}').t;
                            full += part;
                            s.msgs[idx].parts[0].text = full;
                            rMsgs(true);
                        } catch(e) {}
                    }
                }
                sv();
            } catch(e) {
                document.getElementById('loader-container').classList.add('hidden');
            }
        }

        function rMsgs(silent=false) {
            const b = document.getElementById('box');
            const s = ss.find(x => x.id === cur);
            b.innerHTML = s.msgs.map(m => \`
                <div class="flex \${m.role==='user'?'justify-end':'justify-start'} animate__animated animate__fadeIn">
                    <div class="px-5 py-3.5 \${m.role==='user'?'bubble-u shadow-md':'bubble-a'} text-[17px] leading-relaxed shadow-sm">
                        \${marked.parse(m.parts[0].text || '')}
                    </div>
                </div>\`).join('');
            if(!silent) b.scrollTo({top: b.scrollHeight, behavior:'smooth'}); else b.scrollTop = b.scrollHeight;
        }

        async function syncM() {
            const k = document.getElementById('key').value; if(!k) return;
            localStorage.setItem('g_key', k);
            try {
                const r = await fetch(\`/v1beta/models?key=\${k}\`);
                const d = await r.json();
                document.getElementById('mSel').innerHTML = d.models.filter(m=>m.name.includes('gemini')).map(m=>\`<option value="\${m.name}" \${m.name.includes('flash')?'selected':''}>\${m.displayName}</option>\`).join('');
            } catch(e){}
        }

        document.getElementById('uInp').oninput = function() { this.style.height = "auto"; this.style.height = (this.scrollHeight) + "px"; };
    </script>
</body>
</html>
`;

// --- 后端代码 ---
app.get('/', (req, res) => res.send(WEB_UI_HTML));

app.all(/(.*)/, async (req, res) => {
    if (req.path === '/' || req.path === '/favicon.ico') return;
    let apiKey = req.headers['x-goog-api-key'] || req.query.key || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
    if (!apiKey) return res.status(401).json({ error: "Key Required" });

    const targetUrl = `https://generativelanguage.googleapis.com\${req.path.startsWith('/v1') ? req.path : '/v1beta' + req.path}?key=\${apiKey}`;

    try {
        const response = await axios({
            method: req.method, url: targetUrl, headers: { 'Content-Type': 'application/json' },
            data: req.body, responseType: 'stream', decompress: true 
        });
        res.status(response.status);
        finished(response.data, () => res.end());
        response.data.pipe(res);
    } catch (e) {
        if (!res.headersSent) res.status(500).end();
    }
});

app.listen(PORT, () => console.log(`🚀 运行在 http://localhost:${PORT}`));
