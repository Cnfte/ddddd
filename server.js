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
    <title>Gemini WebUI</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <style>
        :root { --ios-curve: cubic-bezier(0.32, 0.72, 0, 1); }
        body { font-family: -apple-system, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }

        /* Apple 物理反馈抽屉 */
        .drawer { transition: transform 0.6s var(--ios-curve); will-change: transform; z-index: 100; }
        .overlay { transition: opacity 0.5s var(--ios-curve), backdrop-filter 0.5s var(--ios-curve); pointer-events: none; opacity: 0; }
        body.sb-open .overlay { opacity: 1; backdrop-filter: blur(12px); pointer-events: auto; background: rgba(0,0,0,0.25); }
        body.sb-open .drawer { transform: translateX(0); }

        /* 气泡物理感 */
        .bubble { transition: transform 0.2s var(--ios-curve); transform-origin: center bottom; }
        .bubble-u { background: #007AFF; color: white; border-radius: 20px 20px 4px 20px; }
        .bubble-a { background: #F2F2F7; color: #1C1C1E; border-radius: 20px 20px 20px 4px; border: 0.5px solid rgba(0,0,0,0.05); }

        /* Apple 三点浮动加载条 */
        .loader-bubble { display: inline-flex; align-items: center; gap: 4px; padding: 12px 18px; background: #F2F2F7; border-radius: 20px; }
        .dot { width: 6px; height: 6px; background: #94a3b8; border-radius: 50%; animation: apple-blink 1.4s infinite both; }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes apple-blink { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }

        .no-sb::-webkit-scrollbar { display: none; }
        pre { background: #1c1c1e !important; color: #e5e7eb; padding: 1rem; border-radius: 14px; margin: 0.5rem 0; overflow-x: auto; font-size: 13px; }
        textarea { field-sizing: content; min-height: 44px; }
    </style>
</head>
<body class="h-full bg-white flex overflow-hidden">
    <div id="ovl" onclick="toggleSB()" class="overlay fixed inset-0 z-40 md:hidden"></div>
    
    <aside id="sb" class="drawer fixed md:relative h-full w-[280px] bg-[#1c1c1e] text-white -translate-x-full md:translate-x-0 flex flex-col z-50">
        <div class="p-6 flex flex-col h-full">
            <button onclick="newChat()" class="w-full bg-[#3a3a3c] hover:bg-[#48484a] text-white rounded-2xl py-4 font-bold active:scale-95 transition-all shadow-lg">+ 新建对话</button>
            <div id="sList" class="flex-grow overflow-y-auto mt-8 space-y-1 no-sb"></div>
            <div class="mt-auto space-y-4 pt-6 border-t border-white/10">
                <input type="password" id="key" placeholder="Gemini API Key" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all">
                <select id="mSel" class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none cursor-pointer"></select>
                <button onclick="syncM()" class="w-full text-blue-400 text-xs font-semibold py-2">验证并刷新模型</button>
            </div>
        </div>
    </aside>

    <main class="flex-grow flex flex-col h-full bg-white relative">
        <nav class="h-[60px] flex items-center justify-between px-4 border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-30">
            <div class="flex items-center gap-2">
                <button onclick="toggleSB()" class="p-2 active:bg-gray-100 rounded-full transition-colors"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg></button>
                <h1 id="cTitle" class="font-bold text-lg tracking-tight truncate" onclick="rnChat()">Gemini WebUI</h1>
            </div>
        </nav>

        <div id="box" class="flex-grow overflow-y-auto px-4 py-8 md:px-24 lg:px-48 space-y-8 no-sb"></div>

        <div class="p-4 bg-white/90 backdrop-blur-xl border-t border-gray-100 pb-[env(safe-area-inset-bottom)]">
            <div id="fPre" class="max-w-4xl mx-auto flex flex-wrap gap-2 mb-3"></div>
            <div class="max-w-4xl mx-auto flex items-end gap-2 bg-[#F2F2F7] rounded-[24px] p-1.5 transition-all focus-within:bg-[#E5E5EA]">
                <label class="p-3 text-gray-400 hover:text-gray-600 cursor-pointer"><svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><input type="file" id="fInp" class="hidden" multiple onchange="hFiles(this)"></label>
                <textarea id="uInp" rows="1" class="flex-grow bg-transparent border-none focus:ring-0 p-2.5 text-[17px] max-h-48 resize-none" placeholder="输入消息..."></textarea>
                <button onclick="send()" class="bg-[#007AFF] text-white p-3 rounded-full shadow-lg active:scale-90 transition-all"><svg width="20" height="20" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
            </div>
        </div>
    </main>

    <script>
        let ss = JSON.parse(localStorage.getItem('g_apple_v1') || '[]');
        let cur = localStorage.getItem('g_id') || null;
        let pFs = [];

        window.onload = () => {
            document.getElementById('key').value = localStorage.getItem('g_key') || '';
            if(!ss.length) newChat(); else swSession(cur || ss[0].id);
            syncM(true);
        };

        function toggleSB() { document.body.classList.toggle('sb-open'); }
        function newChat() { const id = Date.now().toString(); ss.unshift({id, title: '新对话', msgs: []}); sv(id); if(window.innerWidth < 768 && document.body.classList.contains('sb-open')) toggleSB(); }
        function swSession(id) { cur = id; localStorage.setItem('g_id', id); const s = ss.find(x => x.id === id); document.getElementById('cTitle').innerText = s.title; rMsgs(); rList(); if(window.innerWidth < 768) document.body.classList.remove('sb-open'); }
        function sv(id) { localStorage.setItem('g_apple_v1', JSON.stringify(ss)); if(id) swSession(id); else rList(); }
        
        function rList() { document.getElementById('sList').innerHTML = ss.map(s => \`<div onclick="swSession('\${s.id}')" class="px-4 py-3.5 rounded-xl cursor-pointer transition-all \${s.id === cur ? 'bg-[#3a3a3c] text-white shadow-md' : 'text-gray-400 hover:bg-white/5'}"><div class="truncate text-sm font-medium">\${s.title}</div></div>\`).join(''); }

        async function hFiles(inp) {
            for(let f of inp.files) {
                const r = new FileReader();
                r.onload = (e) => { pFs.push({n: f.name, t: f.type, d: e.target.result}); rFPre(); };
                if(f.type.startsWith('image/')) r.readAsDataURL(f); else r.readAsText(f);
            }
        }
        function rFPre() { document.getElementById('fPre').innerHTML = pFs.map((f, i) => \`<div class="bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2">\${f.n} <span class="cursor-pointer opacity-40" onclick="pFs.splice(\${i},1);rFPre()">✕</span></div>\`).join(''); }

        async function send() {
            const txt = document.getElementById('uInp').value.trim();
            const k = document.getElementById('key').value;
            if(!txt && !pFs.length) return;
            const s = ss.find(x => x.id === cur);
            if(!s.msgs.length && txt) s.title = txt.slice(0,12);
            
            let pts = [{text: txt || "分析附件"}];
            let imgs = [];
            pFs.forEach(f => {
                if(f.t.startsWith('image/')) { pts.push({inline_data:{mime_type:f.t, data:f.d.split(',')[1]}}); imgs.push(f.d); }
                else pts[0].text += "\\n【文件: " + f.n + "】\\n" + f.d;
            });

            s.msgs.push({role:'user', parts:pts, imgs});
            pFs = []; rFPre(); document.getElementById('uInp').value = '';
            rMsgs(); await ask(s);
        }

        async function ask(s) {
            const m = document.getElementById('mSel').value;
            const k = document.getElementById('key').value;
            
            const box = document.getElementById('box');
            const loader = document.createElement('div');
            loader.id = "apple-loader";
            loader.className = "flex justify-start animate__animated animate__fadeInUp";
            loader.innerHTML = \`<div class="loader-bubble"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>\`;
            box.appendChild(loader);
            box.scrollTop = box.scrollHeight;

            const idx = s.msgs.length;
            s.msgs.push({role:'model', parts:[{text:''}]});
            
            try {
                const res = await fetch(\`\${m}:streamGenerateContent?key=\${k}\`, {
                    method:'POST', body: JSON.stringify({contents: s.msgs.slice(0,-1).map(x=>({role:x.role, parts:x.parts}))})
                });

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = ""; 
                
                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    
                    if(document.getElementById("apple-loader")) document.getElementById("apple-loader").remove();

                    buffer += decoder.decode(value, {stream: true});
                    
                    // 状态机解析：接住所有碎掉的文本
                    let startIdx = buffer.indexOf('{"text":');
                    while (startIdx !== -1) {
                        let endIdx = buffer.indexOf('"}', startIdx);
                        if (endIdx !== -1) {
                            let part = buffer.substring(startIdx, endIdx + 2);
                            try {
                                const val = JSON.parse(part).text;
                                s.msgs[idx].parts[0].text += val;
                                rMsgs(true);
                            } catch(e){}
                            buffer = buffer.substring(endIdx + 2);
                            startIdx = buffer.indexOf('{"text":');
                        } else {
                            break; 
                        }
                    }
                }
                sv();
            } catch(e){ 
                if(document.getElementById("apple-loader")) document.getElementById("apple-loader").remove();
                alert("连接中断"); 
            }
        }

        function rMsgs(silent=false) {
            const b = document.getElementById('box');
            const s = ss.find(x => x.id === cur);
            b.innerHTML = s.msgs.map((m, i) => \`
                <div class="flex \${m.role==='user'?'justify-end':'justify-start'} animate__animated animate__fadeIn">
                    <div class="max-w-[92%] md:max-w-[80%] bubble">
                        <div class="px-5 py-3.5 \${m.role==='user'?'bubble-u shadow-blue-500/10':'bubble-a'} shadow-sm">
                            \${m.imgs?m.imgs.map(img=>\`<img src="\${img}" class="rounded-xl mb-3 max-h-80 shadow-sm">\`).join(''):''}
                            <div class="text-[17px] leading-relaxed prose \${m.role==='user'?'prose-invert':''}">\${marked.parse(m.parts[0].text || '...')}</div>
                        </div>
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
            responseType: 'stream',
            decompress: true // 适配 Node 22 对压缩流的解析
        });

        res.status(response.status);
        
        // 稳定性补丁：监听流状态
        response.data.on('error', (e) => {
            console.error('Stream Error:', e.message);
            res.end();
        });

        finished(response.data, () => res.end());
        
        response.data.pipe(res);

    } catch (e) {
        if (!res.headersSent) res.status(500).json({ error: e.message });
    }
});

// 全局异常捕捉，防止进程退出
process.on('uncaughtException', (err) => console.log('Runtime Safety:', err.message));

app.listen(PORT, () => console.log(`✅ Apple Smooth Edition Started: http://localhost:${PORT}`));
