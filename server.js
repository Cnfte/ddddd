const express = require('express');
const axios = require('axios');
const url = require('url');
const { finished } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

// 基础中间件配置
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// --------------------------------------------------------------------------
// Web UI (移动端适配 + 增强动画 + 零转义陷阱)
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
    <style>
        :root { --sb-w: 280px; }
        body { font-family: -apple-system, system-ui, sans-serif; -webkit-tap-highlight-color: transparent; }
        .drawer { transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); width: var(--sb-w); z-index: 50; }
        .overlay { opacity: 0; pointer-events: none; transition: opacity 0.3s ease; z-index: 40; }
        body.sb-open .overlay { opacity: 1; pointer-events: auto; }
        .bubble-u { background: #2563eb; color: white; border-radius: 1.1rem 1.1rem 0.2rem 1.1rem; }
        .bubble-a { background: white; color: #1e293b; border-radius: 1.1rem 1.1rem 1.1rem 0.2rem; border: 1px solid #e2e8f0; }
        .no-sb::-webkit-scrollbar { display: none; }
        .prose pre { background: #0f172a !important; color: #f8fafc; padding: 1rem; border-radius: 0.75rem; overflow-x: auto; margin: 0.5rem 0; }
        textarea { field-sizing: content; min-height: 44px; }
    </style>
</head>
<body class="h-full bg-slate-50 flex overflow-hidden">
    <div id="ovl" onclick="toggleSB()" class="overlay fixed inset-0 bg-black/50 md:hidden"></div>
    
    <aside id="sb" class="drawer fixed md:relative h-full bg-[#0d1117] text-slate-300 -translate-x-full md:translate-x-0 flex flex-col shadow-2xl md:shadow-none">
        <div class="p-5 flex flex-col h-full">
            <button onclick="newChat()" class="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl py-3 font-bold active:scale-95 transition-all shadow-lg">+ 新建对话</button>
            <div id="sList" class="flex-grow overflow-y-auto mt-6 space-y-2 no-sb"></div>
            <div class="mt-auto space-y-3 pt-6 border-t border-slate-800">
                <input type="password" id="key" placeholder="API Key" class="w-full bg-slate-800 border-none rounded-lg px-4 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-blue-500">
                <select id="mSel" class="w-full bg-slate-800 border-none rounded-lg px-4 py-2 text-sm text-white outline-none"></select>
                <button onclick="syncM()" class="w-full bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-xs transition-colors font-medium">同步模型列表</button>
            </div>
        </div>
    </aside>

    <main class="flex-grow flex flex-col h-full min-w-0 bg-white relative">
        <nav class="h-14 flex items-center justify-between px-4 border-b bg-white/80 backdrop-blur-md sticky top-0 z-30">
            <div class="flex items-center gap-2 overflow-hidden">
                <button onclick="toggleSB()" class="p-2 hover:bg-slate-100 rounded-lg"><svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" stroke-width="2"/></svg></button>
                <h1 id="cTitle" class="font-bold text-slate-800 truncate text-sm" onclick="rnChat()">Gemini WebUI</h1>
            </div>
        </nav>

        <div id="box" class="flex-grow overflow-y-auto px-4 py-6 md:px-20 lg:px-40 space-y-6 no-sb"></div>

        <div class="p-4 bg-white border-t">
            <div id="fPre" class="max-w-4xl mx-auto flex flex-wrap gap-2 mb-2"></div>
            <div class="max-w-4xl mx-auto flex items-end gap-2 bg-slate-100 rounded-2xl p-1.5 border focus-within:border-blue-400 focus-within:bg-white transition-all">
                <label class="p-2.5 text-slate-500 cursor-pointer hover:bg-slate-200 rounded-xl"><svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" stroke-width="2.5"/></svg><input type="file" id="fInp" class="hidden" multiple onchange="hFiles(this)"></label>
                <textarea id="uInp" rows="1" class="flex-grow bg-transparent border-none focus:ring-0 p-2 text-[15px] max-h-48 resize-none" placeholder="输入消息..."></textarea>
                <button onclick="send()" class="bg-blue-600 text-white p-2.5 rounded-xl hover:bg-blue-700 shadow-md active:scale-90 transition-all"><svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7" stroke-width="2.5"/></svg></button>
            </div>
        </div>
    </main>

    <script>
        let ss = JSON.parse(localStorage.getItem('gemini_v6') || '[]');
        let cur = localStorage.getItem('g_id') || null;
        let pFs = [];

        window.onload = () => {
            document.getElementById('key').value = localStorage.getItem('g_key') || '';
            if(!ss.length) newChat(); else swSession(cur || ss[0].id);
            syncM(true);
        };

        function toggleSB() { document.body.classList.toggle('sb-open'); document.getElementById('sb').classList.toggle('-translate-x-full'); }
        function newChat() { const id = Date.now().toString(); ss.unshift({id, title: '新对话', msgs: []}); sv(id); if(window.innerWidth<768 && document.body.classList.contains('sb-open')) toggleSB(); }
        function swSession(id) { cur = id; localStorage.setItem('g_id', id); const s = ss.find(x => x.id === id); document.getElementById('cTitle').innerText = s.title; rMsgs(); rList(); if(window.innerWidth<768 && document.body.classList.contains('sb-open')) toggleSB(); }
        function sv(id) { localStorage.setItem('gemini_v6', JSON.stringify(ss)); if(id) swSession(id); else rList(); }
        
        function rList() {
            document.getElementById('sList').innerHTML = ss.map(s => \`
                <div onclick="swSession('\${s.id}')" class="group flex items-center justify-between p-3 rounded-xl cursor-pointer \${s.id === cur ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'}">
                    <span class="text-sm truncate font-medium">\${s.title}</span>
                    <button onclick="delChat('\${s.id}', event)" class="opacity-0 group-hover:opacity-100 p-1">×</button>
                </div>\`).join('');
        }

        async function hFiles(inp) {
            for(let f of inp.files) {
                const r = new FileReader();
                r.onload = (e) => { pFs.push({n: f.name, t: f.type, d: e.target.result}); rFPre(); };
                if(f.type.startsWith('image/')) r.readAsDataURL(f); else r.readAsText(f);
            }
        }
        function rFPre() { document.getElementById('fPre').innerHTML = pFs.map((f, i) => \`<div class="bg-blue-50 text-blue-600 border border-blue-100 px-2 py-1 rounded-lg text-xs font-bold">\${f.n} <span class="ml-1 cursor-pointer text-blue-300" onclick="pFs.splice(\${i},1);rFPre()">×</span></div>\`).join(''); }

        async function send() {
            const txt = document.getElementById('uInp').value.trim();
            const k = document.getElementById('key').value;
            if((!txt && !pFs.length) || !k) return;
            const s = ss.find(x => x.id === cur);
            if(!s.msgs.length && txt) s.title = txt.slice(0,15);
            
            let pts = [{text: txt || "请处理文件内容"}];
            let imgs = [];
            pFs.forEach(f => {
                if(f.t.startsWith('image/')) { pts.push({inline_data:{mime_type:f.t, data:f.d.split(',')[1]}}); imgs.push(f.d); }
                else pts[0].text += \`\\n\\n【文件: \${f.n}】\\n\${f.d}\`;
            });

            s.msgs.push({role:'user', parts:pts, imgs});
            pFs = []; rFPre(); document.getElementById('uInp').value = '';
            rMsgs(); await ask(s);
        }

        async function ask(s) {
            const m = document.getElementById('mSel').value;
            const k = document.getElementById('key').value;
            const idx = s.msgs.length;
            s.msgs.push({role:'model', parts:[{text:''}]});
            try {
                const res = await fetch(\`\${m}:streamGenerateContent?key=\${k}\`, {
                    method:'POST', body: JSON.stringify({contents: s.msgs.map(x=>({role:x.role, parts:x.parts}))})
                });
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let full = "";
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    const chunk = decoder.decode(value);
                    const matches = chunk.matchAll(/"text":\\s*"(.*?)"/g);
                    for(const mt of matches) {
                        try { 
                            const decodedTxt = JSON.parse(\`{"t":"\${mt[1]}"}\`).t;
                            full += decodedTxt;
                            s.msgs[idx].parts[0].text = full;
                            rMsgs(true);
                        } catch(e){}
                    }
                }
                sv();
            } catch(e){ alert("请求中断"); }
        }

        function rMsgs(silent=false) {
            const b = document.getElementById('box');
            const s = ss.find(x => x.id === cur);
            b.innerHTML = s.msgs.map((m, i) => \`
                <div class="flex \${m.role==='user'?'justify-end':'justify-start'} animate__animated animate__fadeInUp animate__faster">
                    <div class="max-w-[88%] group">
                        <div class="px-4 py-3 \${m.role==='user'?'bubble-u':'bubble-a'} shadow-sm">
                            \${m.imgs?m.imgs.map(img=>\`<img src="\${img}" class="rounded-lg mb-2 max-h-64">\`).join(''):''}
                            <div class="prose \${m.role==='user'?'prose-invert':''} text-[15px] leading-relaxed">\${marked.parse(m.parts[0].text || '')}</div>
                        </div>
                        <div class="flex gap-4 mt-1 text-[11px] text-slate-400 opacity-60 \${m.role==='user'?'justify-end pr-1':'pl-1'}">
                            <button onclick="eMsg(\${i})" class="hover:text-blue-500">编辑</button>
                            <button onclick="dMsg(\${i})" class="hover:text-red-500">删除</button>
                        </div>
                    </div>
                </div>\`).join('');
            if(!silent) b.scrollTo({top: b.scrollHeight, behavior:'smooth'}); else b.scrollTop = b.scrollHeight;
        }

        function eMsg(i) { 
            const s=ss.find(x=>x.id===cur); 
            const v=prompt("修改对话:", s.msgs[i].parts[0].text); 
            if(v!==null) { 
                s.msgs[i].parts[0].text=v; 
                if(s.msgs[i].role==='user'){ s.msgs=s.msgs.slice(0,i+1); rMsgs(); ask(s); } 
                else { sv(); rMsgs(); } 
            } 
        }
        function dMsg(i) { if(confirm("删除这条消息？")){ ss.find(x=>x.id===cur).msgs.splice(i,1); sv(); rMsgs(); } }
        function delChat(id, e) { e.stopPropagation(); if(confirm("彻底删除对话？")){ ss=ss.filter(x=>x.id!==id); if(!ss.length) newChat(); else if(cur===id) swSession(ss[0].id); sv(); } }
        function rnChat() { const s=ss.find(x=>x.id===cur); const t=prompt("重命名:", s.title); if(t){s.title=t; sv();} }
        
        async function syncM(init=false) {
            const k = document.getElementById('key').value; if(!k) return;
            localStorage.setItem('g_key', k);
            try {
                const r = await fetch(\`/v1beta/models?key=\${k}\`);
                const d = await r.json();
                document.getElementById('mSel').innerHTML = d.models.filter(m=>m.name.includes('gemini')).map(m=>\`<option value="\${m.name}" \${m.name.includes('flash')?'selected':''}>\${m.displayName}</option>\`).join('');
            } catch(e){}
        }
    </script>
</body>
</html>
`;

// --------------------------------------------------------------------------
// 后端代理逻辑 (Node 22 稳定性补丁)
// --------------------------------------------------------------------------
app.get('/', (req, res) => res.send(WEB_UI_HTML));

app.all(/(.*)/, async (req, res) => {
    if (req.path === '/' || req.path === '/favicon.ico') return;

    let apiKey = req.headers['x-goog-api-key'] || req.query.key || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);
    if (!apiKey) return res.status(401).json({ error: "API Key Required" });

    const targetUrl = `https://generativelanguage.googleapis.com${req.path.startsWith('/v1') ? req.path : '/v1beta' + req.path}?${new url.URLSearchParams({...req.query, key: apiKey})}`;

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

        // 核心加固：监听数据流状态，确保 Node 22 进程不因流中断退出
        response.data.on('error', (err) => {
            console.error('Stream Error detected, closing silently...');
            res.end();
        });

        finished(response.data, (err) => {
            if (err) console.error('Stream finished with error:', err.message);
            res.end();
        });

        response.data.pipe(res);

    } catch (e) {
        if (!res.headersSent) {
            res.status(500).json({ error: "Backend Proxy Error: " + e.message });
        }
    }
});

// 最后一层全局防护
process.on('uncaughtException', (err) => console.error('Caught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));

app.listen(PORT, () => console.log(`Gemini WebUI Started: http://localhost:${PORT}`));
