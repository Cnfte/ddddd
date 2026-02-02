const express = require('express');
const axios = require('axios');
const url = require('url');
const { finished } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

// 提高负载限额，确保图片和长文本不卡死
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const WEB_UI_HTML = `
<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=0">
    <title>WebUI</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <style>
        /* 彻底移除所有系统级的选中框和点击蓝影 */
        * { -webkit-tap-highlight-color: transparent !important; outline: none !important; }
        textarea:focus, input:focus, select:focus { border: none !important; box-shadow: none !important; outline: none !important; }
        
        body { font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased; background: #fff; }

        /* Apple 物理曲线抽屉 */
        .drawer { transition: transform 0.5s cubic-bezier(0.32, 0.72, 0, 1); z-index: 1000; }
        .overlay { transition: opacity 0.4s ease; background: rgba(0,0,0,0.4); backdrop-filter: blur(8px); opacity: 0; pointer-events: none; }
        body.sb-open .overlay { opacity: 1; pointer-events: auto; }
        body.sb-open .drawer { transform: translateX(0); }

        /* 气泡物理感 */
        .bubble-u { background: #007AFF; color: #fff; border-radius: 20px 20px 4px 20px; }
        .bubble-a { background: #F2F2F7; color: #1c1c1e; border-radius: 20px 20px 20px 4px; }
        
        /* 优雅的加载条 */
        .loader-wrap { display: flex; gap: 5px; padding: 12px 18px; background: #F2F2F7; border-radius: 20px; width: fit-content; }
        .dot { width: 6px; height: 6px; background: #94a3b8; border-radius: 50%; animation: blink 1.4s infinite both; }
        @keyframes blink { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }

        pre { background: #000 !important; color: #d1d1d6; padding: 15px; border-radius: 12px; font-size: 14px; overflow-x: auto; margin: 10px 0; border: 0.5px solid rgba(255,255,255,0.1); }
        .no-sb::-webkit-scrollbar { display: none; }
    </style>
</head>
<body class="h-full flex overflow-hidden">
    <div onclick="document.body.classList.remove('sb-open')" class="overlay fixed inset-0 z-[999]"></div>
    
    <aside class="drawer fixed md:relative h-full w-[280px] bg-[#1c1c1e] text-white -translate-x-full md:translate-x-0 flex flex-col shadow-2xl z-[1001]">
        <div class="p-6 flex flex-col h-full">
            <button onclick="newChat()" class="w-full bg-[#3a3a3c] py-4 rounded-2xl font-bold active:scale-95 transition-all">+ 新对话</button>
            <div id="sList" class="flex-grow overflow-y-auto mt-8 space-y-2 no-sb"></div>
            <div class="mt-auto space-y-4 pt-6 border-t border-white/10">
                <input type="password" id="key" placeholder="API Key" class="w-full bg-white/5 rounded-xl px-4 py-3 text-white text-sm">
                <select id="mSel" class="w-full bg-white/5 rounded-xl px-4 py-3 text-white text-sm cursor-pointer"></select>
                <button onclick="syncM()" class="w-full text-blue-400 text-xs font-bold py-2 active:opacity-50">刷新并同步模型</button>
            </div>
        </div>
    </aside>

    <main class="flex-grow flex flex-col h-full min-w-0 bg-white">
        <header class="h-[60px] flex items-center px-4 border-b border-gray-100 bg-white/80 backdrop-blur-md justify-between">
            <button onclick="document.body.classList.add('sb-open')" class="p-2 active:bg-gray-100 rounded-full"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg></button>
            <span class="font-bold text-lg">WebUI</span>
            <div class="w-10"></div>
        </header>

        <div id="box" class="flex-grow overflow-y-auto px-4 py-6 md:px-24 lg:px-48 space-y-8 no-sb"></div>

        <div id="ld" class="px-4 md:px-24 lg:px-48 hidden mb-6">
            <div class="loader-wrap"><div class="dot"></div><div class="dot" style="animation-delay:0.2s"></div><div class="dot" style="animation-delay:0.4s"></div></div>
        </div>

        <footer class="p-4 bg-white border-t border-gray-100 pb-[env(safe-area-inset-bottom)]">
            <div class="max-w-4xl mx-auto flex items-end gap-2 bg-[#F2F2F7] rounded-[24px] p-2">
                <label class="p-3 text-gray-400 cursor-pointer"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><input type="file" id="fInp" class="hidden" multiple onchange="hFiles(this)"></label>
                <textarea id="uInp" rows="1" class="flex-grow bg-transparent p-2.5 text-[17px] max-h-48 resize-none" placeholder="输入消息..."></textarea>
                <button onclick="send()" class="bg-[#007AFF] text-white p-3 rounded-full shadow-lg active:scale-90 transition-all"><svg width="20" height="20" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
            </div>
        </footer>
    </main>

    <script>
        let ss = JSON.parse(localStorage.getItem('g_final_v5') || '[]');
        let cur = localStorage.getItem('g_id') || null;
        let pFs = [];

        window.onload = () => {
            document.getElementById('key').value = localStorage.getItem('g_key') || '';
            if(!ss.length) newChat(); else swSession(cur || ss[0].id);
            syncM();
        };

        function newChat() { const id = Date.now().toString(); ss.unshift({id, title: '新对话', msgs: []}); sv(id); }
        function swSession(id) { cur = id; localStorage.setItem('g_id', id); const s = ss.find(x => x.id === id); rMsgs(); rList(); document.body.classList.remove('sb-open'); }
        function sv(id) { localStorage.setItem('g_final_v5', JSON.stringify(ss)); if(id) swSession(id); else rList(); }
        function rList() { document.getElementById('sList').innerHTML = ss.map(s => \`<div onclick="swSession('\${s.id}')" class="px-4 py-3.5 rounded-xl cursor-pointer truncate text-sm \${s.id === cur ? 'bg-[#3a3a3c] text-white font-bold' : 'text-gray-400 hover:bg-white/5'}">\${s.title}</div>\`).join(''); }

        async function hFiles(inp) {
            for(let f of inp.files) {
                const r = new FileReader();
                r.onload = (e) => pFs.push({n: f.name, t: f.type, d: e.target.result});
                if(f.type.startsWith('image/')) r.readAsDataURL(f); else r.readAsText(f);
            }
        }

        async function syncM() {
            const k = document.getElementById('key').value; if(!k) return;
            localStorage.setItem('g_key', k);
            try {
                const r = await fetch(\`/v1beta/models?key=\${k}\`);
                const d = await r.json();
                if(d.models) document.getElementById('mSel').innerHTML = d.models.filter(m=>m.name.includes('gemini')).map(m=>\`<option value="\${m.name}" \${m.name.includes('flash')?'selected':''}>\${m.displayName}</option>\`).join('');
            } catch(e){}
        }

        async function send() {
            const txt = document.getElementById('uInp').value.trim();
            const k = document.getElementById('key').value;
            if(!txt && !pFs.length) return;
            const s = ss.find(x => x.id === cur);
            if(!s.msgs.length) s.title = txt.slice(0,10);
            
            let pts = [{text: txt || "分析附件"}];
            pFs.forEach(f => {
                if(f.t.startsWith('image/')) pts.push({inline_data:{mime_type:f.t, data:f.d.split(',')[1]}});
                else pts[0].text += "\\n【文件: " + f.n + "】\\n" + f.d;
            });

            s.msgs.push({role:'user', parts:pts});
            pFs = []; document.getElementById('uInp').value = '';
            rMsgs(); 
            document.getElementById('ld').classList.remove('hidden');

            try {
                const m = document.getElementById('mSel').value;
                const res = await fetch(\`/\${m}:streamGenerateContent?key=\${k}\`, {
                    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({contents: s.msgs.map(x=>({role:x.role, parts:x.parts}))})
                });

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let full = "";
                let midx = s.msgs.length;
                s.msgs.push({role:'model', parts:[{text:''}]});

                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    document.getElementById('ld').classList.add('hidden');
                    
                    const chunk = decoder.decode(value, {stream: true});
                    // 精华逻辑：正则捕获所有 JSON 片段中的 text 字段
                    const matches = chunk.matchAll(/"text"\\s*:\\s*"(.*?)"/g);
                    for (const match of matches) {
                        try {
                            const unescaped = JSON.parse('{"t":"' + match[1] + '"}').t;
                            full += unescaped;
                            s.msgs[midx].parts[0].text = full;
                            rMsgs(true);
                        } catch(e){}
                    }
                }
                sv();
            } catch(e) { document.getElementById('ld').classList.add('hidden'); alert("连接失败，请检查网络或Key"); }
        }

        function rMsgs(silent=false) {
            const b = document.getElementById('box');
            const s = ss.find(x => x.id === cur);
            b.innerHTML = s.msgs.map(m => \`
                <div class="flex \${m.role==='user'?'justify-end':'justify-start'}">
                    <div class="px-5 py-3.5 \${m.role==='user'?'bubble-u shadow-md':'bubble-a'} text-[17px] max-w-[88%] leading-relaxed">
                        \${marked.parse(m.parts[0].text || '')}
                    </div>
                </div>\`).join('');
            if(!silent) b.scrollTo({top: b.scrollHeight, behavior:'smooth'}); else b.scrollTop = b.scrollHeight;
        }
        document.getElementById('uInp').oninput = function() { this.style.height = "auto"; this.style.height = (this.scrollHeight) + "px"; };
    </script>
</body>
</html>
`;

// --- 精华版后端：高容错流量转发 ---
app.get('/', (req, res) => res.send(WEB_UI_HTML));

app.all(/(.*)/, async (req, res) => {
    if (req.path === '/' || req.path === '/favicon.ico') return;
    
    const apiKey = req.query.key || req.headers['x-goog-api-key'];
    if (!apiKey) return res.status(401).end();

    // 彻底修复 URL 拼接，支持 v1beta 路径
    const cleanPath = req.path.replace(/^\\/+/, ''); 
    const targetUrl = `https://generativelanguage.googleapis.com/\${cleanPath.includes('v1') ? cleanPath : 'v1beta/' + cleanPath}?key=\${apiKey}`;

    try {
        const response = await axios({
            method: req.method,
            url: targetUrl,
            data: req.body,
            responseType: 'stream',
            headers: { 'Content-Type': 'application/json' },
            decompress: true,
            validateStatus: () => true
        });

        res.status(response.status);
        // 关键：将 Google 的流直接 pipe 到前端，并监听完成状态
        response.data.pipe(res);
        finished(response.data, (err) => {
            if (err) console.error('流传输中断:', err);
            res.end();
        });

    } catch (e) {
        console.error('后端请求崩溃:', e.message);
        if (!res.headersSent) res.status(500).send(e.message);
    }
});

app.listen(PORT, () => console.log(`🚀 精华版服务启动: http://localhost:${PORT}`));
