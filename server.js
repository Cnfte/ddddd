const express = require('express');
const axios = require('axios');
const { finished } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '100mb' }));

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
        /* 彻底消除所有点击高亮和选中边框 */
        * { -webkit-tap-highlight-color: transparent !important; outline: none !important; }
        textarea:focus, input:focus { border: none !important; box-shadow: none !important; }
        
        body { font-family: -apple-system, sans-serif; background: #fff; }

        /* 极简抽屉 */
        .drawer { transition: transform 0.4s cubic-bezier(0.32, 0.72, 0, 1); }
        .overlay { transition: opacity 0.3s; background: rgba(0,0,0,0.4); opacity: 0; pointer-events: none; }
        body.sb-open .overlay { opacity: 1; pointer-events: auto; }
        body.sb-open .drawer { transform: translateX(0); }

        /* 气泡 */
        .bubble-u { background: #007AFF; color: #fff; border-radius: 18px 18px 2px 18px; }
        .bubble-a { background: #F2F2F7; color: #1c1c1e; border-radius: 18px 18px 18px 2px; }
        
        /* 修复后的跳动动画 */
        .dot { width: 6px; height: 6px; background: #999; border-radius: 50%; animation: blink 1.4s infinite ease-in-out; }
        @keyframes blink { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }
        
        pre { background: #111 !important; color: #eee; padding: 12px; border-radius: 10px; overflow-x: auto; margin: 10px 0; font-size: 13px; }
    </style>
</head>
<body class="h-full flex overflow-hidden">
    <div onclick="document.body.classList.remove('sb-open')" class="overlay fixed inset-0 z-[100]"></div>
    
    <aside class="drawer fixed md:relative h-full w-[260px] bg-[#1a1a1c] text-white -translate-x-full md:translate-x-0 flex flex-col z-[110]">
        <div class="p-5 flex flex-col h-full">
            <button onclick="newChat()" class="w-full bg-blue-600 py-3.5 rounded-xl font-bold active:scale-95 transition-all shadow-lg">＋ 新对话</button>
            <div id="sList" class="flex-grow overflow-y-auto mt-6 space-y-2"></div>
            <div class="mt-auto space-y-3 pt-4 border-t border-white/10">
                <input type="password" id="key" placeholder="API Key" class="w-full bg-white/10 rounded-xl px-4 py-3 text-sm">
                <select id="mSel" class="w-full bg-white/10 rounded-xl px-4 py-3 text-sm"></select>
                <button onclick="syncM()" id="syncBtn" class="w-full text-blue-400 text-xs font-bold py-2 active:opacity-50">刷新模型列表</button>
            </div>
        </div>
    </aside>

    <main class="flex-grow flex flex-col h-full min-w-0">
        <header class="h-14 flex items-center px-4 border-b border-gray-100 bg-white/80 backdrop-blur-md justify-between">
            <button onclick="document.body.classList.add('sb-open')" class="p-2"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5"><path d="M3 12h18M3 6h18M3 18h18"/></svg></button>
            <span class="font-bold text-gray-800">WebUI</span>
            <div class="w-10"></div>
        </header>

        <div id="box" class="flex-grow overflow-y-auto px-4 py-6 md:px-20 lg:px-40 space-y-6"></div>

        <div id="ld" class="px-4 md:px-20 lg:px-40 hidden mb-4">
            <div class="bg-[#F2F2F7] w-14 py-3 rounded-2xl flex justify-center gap-1">
                <div class="dot"></div><div class="dot" style="animation-delay:0.2s"></div><div class="dot" style="animation-delay:0.4s"></div>
            </div>
        </div>

        <footer class="p-4 bg-white border-t border-gray-50 pb-[env(safe-area-inset-bottom)]">
            <div class="max-w-4xl mx-auto flex items-end gap-2 bg-[#F2F2F7] rounded-[24px] p-2">
                <label class="p-3 text-gray-400"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><input type="file" id="fInp" class="hidden" multiple onchange="hFiles(this)"></label>
                <textarea id="uInp" rows="1" class="flex-grow bg-transparent p-2 text-[17px] resize-none" placeholder="输入..."></textarea>
                <button onclick="send()" class="bg-blue-600 text-white p-3 rounded-full active:scale-90 shadow-md"><svg width="20" height="20" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
            </div>
        </footer>
    </main>

    <script>
        let ss = JSON.parse(localStorage.getItem('g_v4') || '[]');
        let cur = localStorage.getItem('g_id') || null;
        let pFs = [];

        window.onload = () => {
            document.getElementById('key').value = localStorage.getItem('g_key') || '';
            if(!ss.length) newChat(); else swSession(cur || ss[0].id);
            syncM();
        };

        function newChat() { const id = Date.now().toString(); ss.unshift({id, title: '新对话', msgs: []}); sv(id); }
        function swSession(id) { cur = id; localStorage.setItem('g_id', id); const s = ss.find(x => x.id === id); rMsgs(); rList(); document.body.classList.remove('sb-open'); }
        function sv(id) { localStorage.setItem('g_v4', JSON.stringify(ss)); if(id) swSession(id); else rList(); }
        function rList() { document.getElementById('sList').innerHTML = ss.map(s => \`<div onclick="swSession('\${s.id}')" class="px-4 py-3 rounded-xl cursor-pointer truncate text-sm \${s.id === cur ? 'bg-blue-600' : 'text-gray-400'}">\${s.title}</div>\`).join(''); }

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
                if(d.models) document.getElementById('mSel').innerHTML = d.models.filter(m=>m.name.includes('gemini')).map(m=>\`<option value="\${m.name}">\${m.displayName}</option>\`).join('');
            } catch(e) { console.error(e); }
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
            document.getElementById('uInp').style.height = 'auto';
            rMsgs(); 
            document.getElementById('ld').classList.remove('hidden');

            try {
                const m = document.getElementById('mSel').value;
                const res = await fetch(\`/\${m}:streamGenerateContent?key=\${k}\`, {
                    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({contents: s.msgs.map(x=>({role:x.role, parts:x.parts}))})
                });

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let fullTxt = "";
                let midx = s.msgs.length;
                s.msgs.push({role:'model', parts:[{text:''}]});

                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    document.getElementById('ld').classList.add('hidden');
                    const raw = decoder.decode(value);
                    const matches = raw.matchAll(/"text"\\s*:\\s*"(.*?)"/g);
                    for (const m of matches) {
                        try {
                            const t = JSON.parse('{"t":"' + m[1] + '"}').t;
                            fullTxt += t;
                            s.msgs[midx].parts[0].text = fullTxt;
                            rMsgs(true);
                        } catch(e){}
                    }
                }
                sv();
            } catch(e) { document.getElementById('ld').classList.add('hidden'); alert("请求失败"); }
        }

        function rMsgs(silent=false) {
            const b = document.getElementById('box');
            const s = ss.find(x => x.id === cur);
            b.innerHTML = s.msgs.map(m => \`
                <div class="flex \${m.role==='user'?'justify-end':'justify-start'}">
                    <div class="px-4 py-3 \${m.role==='user'?'bubble-u':'bubble-a'} text-[17px] max-w-[85%] shadow-sm">
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

// --- 后端极简转发 ---
app.get('/', (req, res) => res.send(WEB_UI_HTML));

app.all(/(.*)/, async (req, res) => {
    if (req.path === '/') return;
    const apiKey = req.query.key;
    // 修复 URL 拼接逻辑，确保 path 不会多斜杠
    const path = req.path.startsWith('/') ? req.path.substring(1) : req.path;
    const targetUrl = `https://generativelanguage.googleapis.com/${path}?key=${apiKey}`;

    try {
        const response = await axios({
            method: req.method, url: targetUrl, data: req.body, responseType: 'stream'
        });
        res.status(response.status);
        response.data.pipe(res);
        finished(response.data, () => res.end());
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
