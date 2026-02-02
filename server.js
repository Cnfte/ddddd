const express = require('express');
const axios = require('axios');
const { finished } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

// 彻底放开负载限制，支持超长文本和多图
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

const WEB_UI_HTML = `
<!DOCTYPE html>
<html lang="zh-CN" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=0">
    <title>Gemini WebUI Pro</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <style>
        /* 【暴力外部优化：干掉所有系统边框】 */
        * { 
            -webkit-tap-highlight-color: transparent !important; 
            outline: none !important; 
            box-shadow: none !important;
        }
        
        /* 针对输入框的深度清洗 */
        textarea, input, select, button {
            -webkit-appearance: none;
            outline: none !important;
            border: none !important;
        }
        
        /* 移动端选中时的蓝色/黄色框彻底消失 */
        textarea:focus, input:focus {
            outline: 0 !important;
            -webkit-tap-highlight-color: rgba(0,0,0,0) !important;
        }

        body { 
            font-family: -apple-system, system-ui, sans-serif; 
            background: #fff; 
            -webkit-font-smoothing: antialiased;
        }

        /* Apple 物理抽屉 */
        .drawer { 
            transition: transform 0.6s cubic-bezier(0.23, 1, 0.32, 1); 
            z-index: 1001;
            background: #1c1c1e;
        }
        .overlay { 
            transition: opacity 0.5s ease; 
            background: rgba(0,0,0,0.3); 
            backdrop-filter: blur(10px); 
            opacity: 0; 
            pointer-events: none; 
            z-index: 1000;
        }
        body.sb-open .overlay { opacity: 1; pointer-events: auto; }
        body.sb-open .drawer { transform: translateX(0); }

        /* 聊天气泡：极致 Apple 质感 */
        .bubble-u { 
            background: #007AFF; 
            color: #fff; 
            border-radius: 20px 20px 4px 20px; 
            box-shadow: 0 4px 12px rgba(0,122,255,0.2);
        }
        .bubble-a { 
            background: rgba(242, 242, 247, 0.8); 
            backdrop-filter: blur(5px);
            color: #1c1c1e; 
            border-radius: 20px 20px 20px 4px; 
            border: 0.5px solid rgba(0,0,0,0.05);
        }

        /* 修复后的打字机动画 */
        .dot { width: 6px; height: 6px; background: #94a3b8; border-radius: 50%; animation: blink 1.4s infinite both; }
        @keyframes blink { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }
        
        pre { background: #000 !important; color: #d1d1d6; padding: 16px; border-radius: 12px; font-size: 14px; overflow-x: auto; margin: 12px 0; }
        .no-sb::-webkit-scrollbar { display: none; }
    </style>
</head>
<body class="h-full flex overflow-hidden">
    <div onclick="document.body.classList.remove('sb-open')" class="overlay fixed inset-0"></div>
    
    <aside class="drawer fixed md:relative h-full w-[300px] -translate-x-full md:translate-x-0 flex flex-col shadow-2xl">
        <div class="p-6 flex flex-col h-full text-white">
            <button onclick="newChat()" class="w-full bg-white/10 hover:bg-white/20 py-4 rounded-2xl font-bold transition-all active:scale-95 text-center">+ 新建对话</button>
            <div id="sList" class="flex-grow overflow-y-auto mt-8 space-y-2 no-sb"></div>
            <div class="mt-auto space-y-4 pt-6 border-t border-white/10">
                <input type="password" id="key" placeholder="API Key" class="w-full bg-white/5 rounded-xl px-4 py-3 text-white text-sm border border-white/10">
                <select id="mSel" class="w-full bg-white/5 rounded-xl px-4 py-3 text-white text-sm cursor-pointer border border-white/10 appearance-none"></select>
                <button onclick="syncM()" class="w-full py-3 bg-blue-600 rounded-xl text-white text-sm font-bold active:scale-95">验证并刷新模型列表</button>
            </div>
        </div>
    </aside>

    <main class="flex-grow flex flex-col h-full min-w-0 bg-white">
        <header class="h-[60px] flex items-center px-4 border-b border-gray-100 bg-white/80 backdrop-blur-md justify-between sticky top-0 z-50">
            <button onclick="document.body.classList.add('sb-open')" class="p-2 active:bg-gray-100 rounded-full">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
            </button>
            <span id="curTitle" class="font-bold text-lg truncate max-w-[200px]">新对话</span>
            <div class="w-10"></div>
        </header>

        <div id="box" class="flex-grow overflow-y-auto px-4 py-6 md:px-24 lg:px-48 space-y-8 no-sb"></div>

        <div id="ld" class="px-4 md:px-24 lg:px-48 hidden mb-6">
            <div class="flex gap-1.5 p-4 bg-gray-100 w-fit rounded-2xl"><div class="dot"></div><div class="dot" style="animation-delay:0.2s"></div><div class="dot" style="animation-delay:0.4s"></div></div>
        </div>

        <footer class="p-4 bg-white border-t border-gray-50 pb-[env(safe-area-inset-bottom)]">
            <div id="fPre" class="flex gap-2 mb-2 overflow-x-auto no-sb"></div>
            <div class="max-w-4xl mx-auto flex items-end gap-2 bg-[#F2F2F7] rounded-[26px] p-2 transition-all focus-within:bg-[#E5E5EA]">
                <label class="p-3 text-gray-500 cursor-pointer hover:text-blue-600"><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><input type="file" id="fInp" class="hidden" multiple onchange="hFiles(this)"></label>
                <textarea id="uInp" rows="1" class="flex-grow bg-transparent p-3 text-[17px] max-h-48 resize-none border-none focus:ring-0" placeholder="输入消息..."></textarea>
                <button onclick="send()" class="bg-[#007AFF] text-white p-3.5 rounded-full shadow-lg active:scale-90 transition-all"><svg width="20" height="20" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
            </div>
        </footer>
    </main>

    <script>
        let ss = JSON.parse(localStorage.getItem('g_v10_final') || '[]');
        let cur = localStorage.getItem('g_cur_id') || null;
        let pFs = [];

        window.onload = () => {
            document.getElementById('key').value = localStorage.getItem('g_key') || '';
            if(!ss.length) newChat(); else sw(cur || ss[0].id);
            syncM();
        };

        function newChat() { const id = Date.now().toString(); ss.unshift({id, title:'新对话', msgs:[]}); sv(id); }
        function sw(id) { cur = id; localStorage.setItem('g_cur_id', id); const s = ss.find(x=>x.id===id); document.getElementById('curTitle').innerText = s.title; rMsgs(); rList(); document.body.classList.remove('sb-open'); }
        function sv(id) { localStorage.setItem('g_v10_final', JSON.stringify(ss)); if(id) sw(id); else rList(); }
        function rList() { document.getElementById('sList').innerHTML = ss.map(s => \`<div onclick="sw('\${s.id}')" class="px-5 py-4 rounded-2xl cursor-pointer truncate text-sm \${s.id === cur ? 'bg-blue-600 text-white font-bold shadow-lg' : 'text-gray-400 hover:bg-white/5'}">\${s.title}</div>\`).join(''); }

        async function hFiles(inp) {
            for(let f of inp.files) {
                const r = new FileReader();
                r.onload = (e) => {
                    pFs.push({n:f.name, t:f.type, d:e.target.result});
                    document.getElementById('fPre').innerHTML += \`<div class="bg-gray-200 px-3 py-1 rounded-full text-xs font-bold">\${f.name}</div>\`;
                };
                if(f.type.startsWith('image/')) r.readAsDataURL(f); else r.readAsText(f);
            }
        }

        async function syncM() {
            const k = document.getElementById('key').value; if(!k) return;
            localStorage.setItem('g_key', k);
            try {
                const r = await fetch('/v1beta/models?key=' + k);
                const d = await r.json();
                if(d.models) document.getElementById('mSel').innerHTML = d.models.filter(m=>m.name.includes('gemini')).map(m=>\`<option value="\${m.name}" \${m.name.includes('1.5-flash')?'selected':''}>\${m.displayName}</option>\`).join('');
            } catch(e){}
        }

        async function send() {
            const txt = document.getElementById('uInp').value.trim();
            const k = document.getElementById('key').value;
            if(!txt && !pFs.length) return;
            const s = ss.find(x=>x.id===cur);
            if(!s.msgs.length) s.title = txt.slice(0,12) || "附件分析";
            
            let pts = [{text: txt || "分析此内容"}];
            pFs.forEach(f => {
                if(f.t.startsWith('image/')) pts.push({inline_data:{mime_type:f.t, data:f.d.split(',')[1]}});
                else pts[0].text += "\\n【文件: " + f.n + "】\\n" + f.d;
            });

            s.msgs.push({role:'user', parts:pts});
            pFs = []; document.getElementById('uInp').value = ''; document.getElementById('fPre').innerHTML = '';
            rMsgs(); document.getElementById('ld').classList.remove('hidden');

            try {
                const m = document.getElementById('mSel').value;
                const res = await fetch(\`/\${m}:streamGenerateContent?key=\${k}\`, {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({contents: s.msgs.map(x=>({role:x.role, parts:x.parts}))})
                });

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let full = "";
                const midx = s.msgs.length;
                s.msgs.push({role:'model', parts:[{text:''}]});

                while(true) {
                    const {done, value} = await reader.read();
                    if(done) break;
                    document.getElementById('ld').classList.add('hidden');
                    const chunk = decoder.decode(value);
                    const matches = chunk.matchAll(/"text"\\s*:\\s*"(.*?)(?<!\\\\)"/g);
                    for (const match of matches) {
                        try {
                            const val = JSON.parse('{"t":"' + match[1] + '"}').t;
                            full += val;
                            s.msgs[midx].parts[0].text = full;
                            rMsgs(true);
                        } catch(e){}
                    }
                }
                sv();
            } catch(e) { document.getElementById('ld').classList.add('hidden'); alert("API连接失败"); }
        }

        function rMsgs(sil=false) {
            const b = document.getElementById('box');
            const s = ss.find(x=>x.id===cur);
            b.innerHTML = s.msgs.map(m => \`
                <div class="flex \${m.role==='user'?'justify-end':'justify-start'}">
                    <div class="px-5 py-3.5 \${m.role==='user'?'bubble-u':'bubble-a'} text-[17px] max-w-[90%] leading-relaxed">
                        \${marked.parse(m.parts[0].text || '')}
                    </div>
                </div>\`).join('');
            if(!sil) b.scrollTo({top:b.scrollHeight, behavior:'smooth'}); else b.scrollTop = b.scrollHeight;
        }
        document.getElementById('uInp').oninput = function() { this.style.height = "auto"; this.style.height = (this.scrollHeight) + "px"; };
    </script>
</body>
</html>
`;

// --- 【真·后端转发：解决 SyntaxError 的最终补丁】 ---
app.get('/', (req, res) => res.send(WEB_UI_HTML));

app.all(/(.*)/, async (req, res) => {
    if (req.path === '/' || req.path === '/favicon.ico') return;
    
    const apiKey = req.query.key || req.headers['x-goog-api-key'];
    if (!apiKey) return res.status(401).end();

    // 修复逻辑：自动判断并补全 v1beta，支持所有 Gemini 接口
    let targetPath = req.path;
    if (!targetPath.includes('v1')) {
        targetPath = '/v1beta' + (targetPath.startsWith('/') ? '' : '/') + targetPath;
    }
    
    const targetUrl = 'https://generativelanguage.googleapis.com' + targetPath + '?key=' + apiKey;

    try {
        const response = await axios({
            method: req.method,
            url: targetUrl,
            data: req.body,
            responseType: 'stream',
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true, // 关键：转发所有错误码，不抛出异常
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });

        res.status(response.status);
        response.data.pipe(res);
        finished(response.data, () => res.end());

    } catch (e) {
        if (!res.headersSent) res.status(500).send(e.message);
    }
});

app.listen(PORT, () => console.log(`🚀 服务已在端口 ${PORT} 满血启动`));
