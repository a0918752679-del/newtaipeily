const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://newtaipeinoise.zeabur.app').replace(/\/$/, '');
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://noise115.zeabur.app';
const FIELD_REPORT_URL = process.env.FIELD_REPORT_URL || 'https://out115.zeabur.app';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LINE_SECRET = process.env.LINE_CHANNEL_SECRET || '';

const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const upload = multer({ dest: path.join(__dirname, 'uploads') });
let latestDebug = { lastEvents: [], lastReply: null, lastError: null, startedAt: new Date().toISOString() };

function parseCookies(req){
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0,idx).trim()] = decodeURIComponent(part.slice(idx+1).trim());
  });
  return out;
}
function sign(value){
  const secret = SESSION_SECRET || 'runtime-only-session-secret';
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}
function makeSession(){
  const value = String(Date.now());
  return `${value}.${sign(value)}`;
}
function verifySession(cookieValue){
  if (!cookieValue) return false;
  const [value, sig] = String(cookieValue).split('.');
  if (!value || !sig) return false;
  const expected = sign(value);
  try {
    const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    const ageMs = Date.now() - Number(value);
    return ok && Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 12 * 60 * 60 * 1000;
  } catch { return false; }
}
function isAdmin(req){ return verifySession(parseCookies(req).ntpc_admin); }
function requireAdmin(req,res,next){
  if (!ADMIN_PASSWORD) return res.status(503).json({ok:false, error:'ADMIN_PASSWORD is not configured. Please set it in Zeabur environment variables.'});
  if (!isAdmin(req)) return res.status(401).json({ok:false, error:'Unauthorized'});
  next();
}
function authStatus(req){
  return { authenticated: isAdmin(req), adminConfigured: !!ADMIN_PASSWORD, sessionSecretConfigured: !!SESSION_SECRET };
}


app.use('/assets', express.static(path.join(__dirname, 'public/assets')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

function readStore(){
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch { return { annualGoal: 490, summary: { sessions:0, traffic:0, exceed:0, fines:0, notices:0 }, months:{}, districts:{}, plates:{}, equipment:[] }; }
}
function writeStore(data){ fs.mkdirSync(DATA_DIR, {recursive:true}); fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2)); }
function fmt(n){ return Number(n||0).toLocaleString('zh-TW'); }
function pct(a,b){ return b ? ((a/b)*100).toFixed(1)+'%' : '0.0%'; }
function kpi(obj){ return obj.sessions ? ((obj.fines + obj.notices) / obj.sessions).toFixed(2) : '0.00'; }
function rate(a,b){ return b ? ((a/b)*100).toFixed(1)+'%' : '0.0%'; }
function now(){ return new Date().toISOString(); }
function recordEvent(e){ latestDebug.lastEvents.unshift(e); latestDebug.lastEvents = latestDebug.lastEvents.slice(0,20); }

function verifySignature(req){
  if (!LINE_SECRET) return true;
  const signature = req.get('x-line-signature') || '';
  const hmac = crypto.createHmac('sha256', LINE_SECRET).update(req.rawBody || Buffer.from('')).digest('base64');
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hmac)); } catch { return false; }
}
async function lineReply(replyToken, messages){
  if (!LINE_TOKEN || !replyToken) return { skipped:true };
  const payload = { replyToken, messages: Array.isArray(messages) ? messages : [messages] };
  const r = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_TOKEN}` },
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  latestDebug.lastReply = { at: now(), status: r.status, body: text, sentMessages: payload.messages };
  if (!r.ok) throw new Error(`LINE Reply API ${r.status}: ${text}`);
  return { ok:true };
}
function textMessage(text, quickItems=[]){
  const m = { type:'text', text };
  if (quickItems.length) {
    m.quickReply = { items: quickItems.map(i => ({ type:'action', action: i.uri ? { type:'uri', label:i.label, uri:i.uri } : { type:'message', label:i.label, text:i.text || i.label } })) };
  }
  return m;
}
function menuQuick(){ return [
  {label:'成果查詢', uri:DASHBOARD_URL}, {label:'外勤回報', uri:FIELD_REPORT_URL}, {label:'月份統計', text:'月份選單'},
  {label:'行政區統計', text:'行政區選單'}, {label:'KPI報表', text:'KPI報表'}, {label:'法規中心', text:'法規中心'}, {label:'設備管理', text:'設備管理'}
];}
function mainMenu(){
  return textMessage('新北市打擊噪音車管理系統\n\n請選擇要使用的功能。', menuQuick());
}
function progressMsg(){
  const s=readStore(); const a=s.summary||{}; const goal=s.annualGoal||490;
  return textMessage(`【全計畫執行成效】\n年度目標：${fmt(goal)}場\n已完成：${fmt(a.sessions)}場（${pct(a.sessions, goal)}）\n待執行：${fmt(Math.max(goal-a.sessions,0))}場\n\n車流辨識：${fmt(a.traffic)}件\n超標件數：${fmt(a.exceed)}件\n告發件數：${fmt(a.fines)}件\n通知到檢：${fmt(a.notices)}件\n告發率：${rate(a.fines,a.exceed)}\n通檢率：${rate(a.notices,a.exceed)}\nKPI成效：${kpi(a)}`, menuQuick());
}
function kpiMsg(){
  const s=readStore(); const a=s.summary||{};
  return textMessage(`【KPI報表】\n告發率：${rate(a.fines,a.exceed)}\n通檢率：${rate(a.notices,a.exceed)}\n達成率：${pct(a.sessions, s.annualGoal||490)}\nKPI成效：${kpi(a)}\n\n說明：KPI =（告發件數 + 通知到檢）/ 執行場次。`, [{label:'月份選單',text:'月份選單'}, {label:'行政區選單',text:'行政區選單'}, {label:'成果平台',uri:DASHBOARD_URL}]);
}
function monthMenu(){ return textMessage('請選擇月份查詢：', ['2','3','4','5','6'].map(m=>({label:`${m}月`, text:`${m}月份執行成效`}))); }
function districtMenu(){ return textMessage('請選擇行政區查詢：', ['土城區','淡水區','板橋區','新莊區','三重區','中和區'].map(d=>({label:d, text:`${d}執行成效`}))); }
function statMenu(){ return textMessage('統計查詢可選月份或行政區。', [{label:'月份查詢',text:'月份選單'}, {label:'行政區查詢',text:'行政區選單'}, {label:'成果平台', uri:DASHBOARD_URL}]); }
function monthStats(m){
  const s=readStore(); const d=s.months?.[m];
  if(!d) return textMessage(`目前沒有 ${m} 月資料。`, [{label:'月份選單',text:'月份選單'}]);
  return textMessage(`【${m}月份執行成效】\n執行場次：${fmt(d.sessions)}場\n車流辨識：${fmt(d.traffic)}件\n超標件數：${fmt(d.exceed)}件\n告發件數：${fmt(d.fines)}件\n通知到檢：${fmt(d.notices)}件\n告發率：${rate(d.fines,d.exceed)}\n通檢率：${rate(d.notices,d.exceed)}\nKPI成效：${kpi(d)}`, [{label:'月份選單',text:'月份選單'}, {label:'成果平台', uri:DASHBOARD_URL}]);
}
function districtStats(name){
  const s=readStore(); const d=s.districts?.[name];
  if(!d) return textMessage(`目前沒有「${name}」資料。`, [{label:'行政區選單',text:'行政區選單'}]);
  return textMessage(`【${name}執行成效】\n執行場次：${fmt(d.sessions)}場\n車流辨識：${fmt(d.traffic)}件\n超標件數：${fmt(d.exceed)}件\n告發件數：${fmt(d.fines)}件\n通知到檢：${fmt(d.notices)}件\n告發率：${rate(d.fines,d.exceed)}\n通檢率：${rate(d.notices,d.exceed)}\nKPI成效：${kpi(d)}`, [{label:'行政區選單',text:'行政區選單'}, {label:'成果平台', uri:DASHBOARD_URL}]);
}
function lawCenter(){
  return textMessage('【法規中心】\n提供噪音管制法、修法重點與噪音車新聞摘要。\n\n常用指令：\n法條11、法條13、法條26、法條28、修法、新聞', [
    {label:'最新修法',text:'修法'}, {label:'法條26',text:'法條26'}, {label:'噪音車新聞',text:'新聞'}, {label:'環境部專區',uri:'https://noisecar.moenv.gov.tw/'}
  ]);
}
function lawDetail(text){
  if(text.includes('11')) return textMessage('【噪音管制法 第11條】\n重點：車輛、機動車輛等噪音源應符合主管機關公告之噪音管制標準。\n\n實務：聲音照相執法會依車種、速限及噪音標準進行判定。');
  if(text.includes('13')) return textMessage('【噪音管制法 第13條】\n重點：主管機關得通知噪音源所有人或使用人到場檢驗、改善或提出說明。\n\n實務：對疑似噪音車可辦理通知到檢。');
  if(text.includes('26')) return textMessage('【噪音管制法 第26條】\n重點：違反噪音管制規定者，得依規定裁罰。\n\n噪音車修法重點：最高罰鍰提高至3萬6,000元；情節重大或一年內再犯，可吊扣牌照。');
  if(text.includes('28')) return textMessage('【噪音管制法 第28條】\n重點：未依通知檢驗、改善或提出資料者，可依規定處分。');
  return lawCenter();
}
function lawUpdate(){ return textMessage('【最新修法重點】\n1. 噪音車違規最高罰鍰提高至3萬6,000元。\n2. 情節重大者可吊扣牌照。\n3. 一年內再犯可加重處分。\n4. 後續執法需同步注意中央公告與地方裁罰基準。', [{label:'法條26',text:'法條26'}, {label:'噪音車新聞',text:'新聞'}]); }
function newsMsg(){ return textMessage('【噪音車新聞摘要】\n目前建議追蹤：\n1. 環境部噪音車管制政策。\n2. 國環院聲音照相設備與檢測規範。\n3. 各縣市噪音車科技執法案例。\n\n正式上線後可接 n8n 每日更新新聞摘要。', [{label:'環境部噪音車專區',uri:'https://noisecar.moenv.gov.tw/'}, {label:'法規中心',text:'法規中心'}]); }
function equipmentMsg(){
  const s=readStore(); const list=s.equipment||[]; const today=new Date();
  const rows = list.map(e=>{
    const dm = daysLeft(e.soundMeterDate, 365); const dw=daysLeft(e.windMeterDate,365); const db=daysLeft(e.bitestDate,730); const min=Math.min(dm,dw,db);
    const light = min < 0 ? '紅燈 已逾期' : min <= 30 ? '黃燈 30天內到期' : '綠燈 正常';
    return `${e.id}｜${light}\n比測剩餘：${db}天｜噪音計：${dm}天｜風速計：${dw}天`;
  }).join('\n\n');
  return textMessage(`【設備管理】\n比測週期：2年\n噪音計檢定：1年\n風速計檢定：1年\n\n${rows || '尚未匯入設備資料'}`, [{label:'匯入設備表',uri:`${BASE_URL}/admin.html`}, {label:'設備',text:'設備'}]);
}
function daysLeft(dateStr, cycleDays){
  const d = new Date(String(dateStr).replace(/\//g,'-')); if(isNaN(d)) return 9999;
  const due = new Date(d.getTime() + cycleDays*86400000);
  return Math.ceil((due - new Date())/86400000);
}
function platePrompt(){ return textMessage('請輸入車牌，例如：車牌 ABC-1234。', [{label:'範例 ABC-1234',text:'車牌 ABC-1234'}]); }
function plateQuery(text){
  const key = text.replace(/車牌|查詢|\s/g,'').toUpperCase(); const s=readStore(); const p=s.plates?.[key] || s.plates?.[key.replace('-','')];
  if(!p) return textMessage(`目前查無車牌 ${key} 的案件資料。`, [{label:'車號追蹤',text:'車號追蹤'}]);
  return textMessage(`【車號追蹤】\n車牌：${key}\n累犯次數：${p.repeat}次\n最高超標：${p.maxDb} dB\n最近日期：${p.lastDate}\n行政區：${p.district}\n告發件數：${p.fines}\n通知到檢：${p.notices}`, [{label:'成果平台',uri:DASHBOARD_URL}]);
}
function adminMsg(){ return textMessage(`【管理中心】\n後台網址：${BASE_URL}/admin.html\n\n後台密碼由 Zeabur 環境變數 ADMIN_PASSWORD 管理，不會在 LINE、GitHub 或前端頁面顯示。\n可操作：資料匯入、Rich Menu 更新、成果檢查、設備管理。`, [{label:'開啟後台',uri:`${BASE_URL}/admin.html`}]); }
function routeText(text){
  const t=String(text||'').trim();
  if(!t || t==='選單' || t==='menu') return mainMenu();
  if(t==='成果查詢') return textMessage('請開啟成果查詢平台，或使用月份／行政區快速查詢。', [{label:'成果平台',uri:DASHBOARD_URL}, {label:'月份選單',text:'月份選單'}, {label:'行政區選單',text:'行政區選單'}]);
  if(t==='外勤回報') return textMessage('請開啟外勤回報平台填寫場次、照片與座標。', [{label:'外勤回報',uri:FIELD_REPORT_URL}]);
  if(['進度','KPI報表','KPI','kpi'].includes(t)) return t==='進度'?progressMsg():kpiMsg();
  if(t==='統計選單' || t==='統計查詢') return statMenu();
  if(t==='月份選單' || t==='月份') return monthMenu();
  if(t==='行政區選單' || t==='行政區') return districtMenu();
  if(t==='車號追蹤' || t==='車牌查詢') return platePrompt();
  if(/^\d+月份執行成效$/.test(t)) return monthStats(t.match(/^(\d+)/)[1]);
  if(/^\d+月$/.test(t)) return monthStats(t.match(/^(\d+)/)[1]);
  if(t.endsWith('區執行成效')) return districtStats(t.replace('執行成效',''));
  if(t.endsWith('區')) return districtStats(t);
  if(t==='法規中心') return lawCenter();
  if(t.startsWith('法條')) return lawDetail(t);
  if(t.includes('修法')) return lawUpdate();
  if(t.includes('新聞')) return newsMsg();
  if(t==='設備管理' || t==='設備') return equipmentMsg();
  if(t==='管理功能' || t==='管理中心') return adminMsg();
  if(/車牌|[A-Z]{2,4}-?\d{3,4}/i.test(t)) return plateQuery(t);
  return textMessage('感謝您的回覆🙂', menuQuick());
}

app.get('/healthz', (req,res)=>res.json({ok:true, service:'newtaipei-noise-control-system-v19-ntpc-tech', hasAdminPassword:!!ADMIN_PASSWORD, hasSessionSecret:!!SESSION_SECRET}));
app.get('/api/line/test', (req,res)=>res.json({ok:true, service:'v19-ntpc-tech', hasToken:!!LINE_TOKEN, hasSecret:!!LINE_SECRET, hasAdminPassword:!!ADMIN_PASSWORD, hasSessionSecret:!!SESSION_SECRET}));
app.get('/api/line/debug/latest', (req,res)=>res.json({ok:true, debug:latestDebug}));
app.get('/api/line/rich-menu-spec', (req,res)=>res.json({ok:true, image:`${BASE_URL}/assets/line-rich-menu.jpg`, spec: richMenuSpec()}));
app.get('/api/data/summary', (req,res)=>res.json({ok:true, data:readStore()}));
app.get('/api/admin/status', (req,res)=>res.json({ok:true, ...authStatus(req)}));
app.post('/api/admin/login', express.urlencoded({ extended:true }), (req,res)=>{
  if(!ADMIN_PASSWORD) return res.status(503).json({ok:false, error:'後台密碼尚未在 Zeabur 環境變數 ADMIN_PASSWORD 設定'});
  const pwd = String(req.body?.password || '');
  const ok = pwd.length === ADMIN_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(pwd), Buffer.from(ADMIN_PASSWORD));
  if(!ok) return res.status(401).json({ok:false, error:'密碼錯誤'});
  const secure = (BASE_URL.startsWith('https://')) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `ntpc_admin=${encodeURIComponent(makeSession())}; HttpOnly; Path=/; Max-Age=43200; SameSite=Lax${secure}`);
  res.json({ok:true});
});
app.post('/api/admin/logout', (req,res)=>{ res.setHeader('Set-Cookie','ntpc_admin=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax'); res.json({ok:true}); });
app.post('/api/line/webhook', async (req,res)=>{
  res.status(200).send('OK');
  const valid = verifySignature(req);
  latestDebug.lastSignature = { at:now(), valid, hasSignature:!!req.get('x-line-signature') };
  if(!valid) return;
  const events = req.body?.events || [];
  for (const ev of events){
    if(ev.type !== 'message' || ev.message?.type !== 'text') continue;
    const text = ev.message.text;
    recordEvent({ at:now(), type:'message', userId:ev.source?.userId, text });
    try { await lineReply(ev.replyToken, routeText(text)); }
    catch(err){ latestDebug.lastError = { at:now(), message:String(err.message||err), stack:String(err.stack||'') }; }
  }
});
function richMenuSpec(){
  return { size:{width:2500,height:1686}, selected:true, name:'新北噪音車V19科技版圖文選單', chatBarText:'管理選單', areas:[
    {bounds:{x:0,y:320,width:625,height:683}, action:{type:'uri', uri:DASHBOARD_URL}},
    {bounds:{x:625,y:320,width:625,height:683}, action:{type:'uri', uri:FIELD_REPORT_URL}},
    {bounds:{x:1250,y:320,width:625,height:683}, action:{type:'message', text:'車號追蹤'}},
    {bounds:{x:1875,y:320,width:625,height:683}, action:{type:'message', text:'KPI報表'}},
    {bounds:{x:0,y:1003,width:625,height:683}, action:{type:'message', text:'統計選單'}},
    {bounds:{x:625,y:1003,width:625,height:683}, action:{type:'message', text:'法規中心'}},
    {bounds:{x:1250,y:1003,width:625,height:683}, action:{type:'message', text:'設備管理'}},
    {bounds:{x:1875,y:1003,width:625,height:683}, action:{type:'message', text:'管理功能'}}
  ]};
}
async function lineApi(pathname, options={}){
  const r = await fetch(`https://api.line.me/v2/bot${pathname}`, { ...options, headers:{ ...(options.headers||{}), Authorization:`Bearer ${LINE_TOKEN}` } });
  const text = await r.text();
  if(!r.ok) throw new Error(`${pathname} ${r.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}
app.post('/api/admin/rich-menu/setup', requireAdmin, async (req,res)=>{
  try{
    if(!LINE_TOKEN) throw new Error('LINE_CHANNEL_ACCESS_TOKEN 未設定');
    const list = await lineApi('/richmenu/list');
    for (const rm of (list.richmenus||[])) { if(String(rm.name||'').includes('新北噪音車')) await lineApi(`/richmenu/${rm.richMenuId}`, {method:'DELETE'}); }
    const created = await lineApi('/richmenu', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(richMenuSpec()) });
    const img = fs.readFileSync(path.join(__dirname,'public/assets/line-rich-menu.jpg'));
    const up = await fetch(`https://api-data.line.me/v2/bot/richmenu/${created.richMenuId}/content`, { method:'POST', headers:{ Authorization:`Bearer ${LINE_TOKEN}`, 'Content-Type':'image/jpeg'}, body:img });
    const upText = await up.text(); if(!up.ok) throw new Error(`upload ${up.status}: ${upText}`);
    await lineApi(`/user/all/richmenu/${created.richMenuId}`, { method:'POST' });
    res.json({ok:true, richMenuId:created.richMenuId});
  }catch(e){ res.status(500).json({ok:false, error:String(e.message||e)}); }
});
app.post('/api/admin/upload-excel', requireAdmin, upload.single('file'), (req,res)=>{
  try{
    if(!req.file) throw new Error('未收到檔案');
    const wb = XLSX.readFile(req.file.path); const store=readStore();
    let rows=0; for(const n of wb.SheetNames){ rows += XLSX.utils.sheet_to_json(wb.Sheets[n],{defval:''}).length; }
    store.lastExcelUpload = { at:now(), filename:req.file.originalname, sheets:wb.SheetNames, rows };
    writeStore(store); res.json({ok:true, rows, sheets:wb.SheetNames});
  }catch(e){ res.status(500).json({ok:false, error:String(e.message||e)}); }
});
app.get('/', (req,res)=>res.redirect('/admin.html'));
app.get('/admin.html', (req,res)=>res.send(isAdmin(req) ? adminHtml() : loginHtml(req)));
app.get('/line-bot.html', (req,res)=>res.send(lineBotHtml()));
function htmlLayout(title, body){return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
body{margin:0;font-family:Arial,'Noto Sans TC','Microsoft JhengHei',sans-serif;background:radial-gradient(circle at 20% 0%,#dff3ff 0,#eef6ff 34%,#f8fbff 100%);color:#06295c}.hero{background:linear-gradient(120deg,#00265f,#005bc4 48%,#00a7ff);color:white;padding:34px 40px;border-radius:0 0 32px 32px;box-shadow:0 18px 42px #a9cde8;position:relative;overflow:hidden}.hero:after{content:'';position:absolute;right:-80px;bottom:-90px;width:420px;height:260px;background:radial-gradient(circle,#7ee8ff55,transparent 70%)}.wrap{max-width:1180px;margin:30px auto;padding:0 22px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}.card{background:linear-gradient(180deg,#ffffff,#f5fbff);border:1px solid #b8d9f5;border-radius:22px;padding:24px;box-shadow:0 14px 28px #bdd8ee}.btn{display:inline-block;border:0;border-radius:13px;background:linear-gradient(135deg,#005bd6,#00a7ff);color:white;padding:13px 18px;font-weight:800;cursor:pointer;text-decoration:none;box-shadow:0 8px 16px #b7d2ec}.btn2{background:linear-gradient(135deg,#009a77,#00d6b0)}.btn3{background:linear-gradient(135deg,#35475d,#718199)}.muted{color:#62748a}.code{background:#e9f2fb;border-radius:12px;padding:14px;overflow:auto}input[type=file]{padding:10px;background:#f6fbff;border:1px solid #bfd7ed;border-radius:10px}</style></head><body>${body}</body></html>`}
function loginHtml(req){ return htmlLayout('後台登入',`<div class="hero"><h1>新北市打擊噪音車管理系統</h1><p>後台登入｜密碼由 Zeabur 環境變數管理</p></div><div class="wrap"><div class="card"><h2>管理者登入</h2><p class="muted">系統不會在程式、GitHub、README 或前端頁面顯示管理密碼。</p><form id="login"><input type="password" name="password" placeholder="請輸入後台管理密碼" style="width:100%;box-sizing:border-box;padding:14px;border:1px solid #bfd7ed;border-radius:12px;font-size:16px"><br><br><button class="btn">登入</button></form><pre id="msg" class="code"></pre></div></div><script>document.getElementById('login').onsubmit=async e=>{e.preventDefault();const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(e.target))});const j=await r.json();if(j.ok) location.href='/admin.html'; else document.getElementById('msg').textContent=j.error||'登入失敗';}</script>`)}
function adminHtml(){const s=readStore();return htmlLayout('後台管理',`<div class="hero"><h1>新北市打擊噪音車管理系統 V19</h1><p>後台管理｜LINE 圖文選單｜資料匯入｜系統檢查</p></div><div class="wrap"><div class="grid"><div class="card"><h2>系統狀態</h2><p>版本：V19 NTPC Tech</p><p>Webhook：${BASE_URL}/api/line/webhook</p><p class="muted">管理密碼由 Zeabur ADMIN_PASSWORD 管理，頁面不顯示實際密碼。</p><button class="btn btn3" onclick="logout()">登出</button><a class="btn" href="/healthz" target="_blank">Health Check</a> <a class="btn btn3" href="/api/line/debug/latest" target="_blank">Debug</a></div><div class="card"><h2>Rich Menu</h2><p class="muted">重新產生科技風圖文選單並設為預設。</p><button class="btn" onclick="setupRichMenu()">一鍵建立／更新 LINE 圖文選單</button><pre id="rich" class="code"></pre></div><div class="card"><h2>成果摘要</h2><p>場次：${fmt(s.summary.sessions)} / ${fmt(s.annualGoal)}</p><p>車流：${fmt(s.summary.traffic)}</p><p>超標：${fmt(s.summary.exceed)}</p><p>告發：${fmt(s.summary.fines)}｜通檢：${fmt(s.summary.notices)}</p><p>KPI：${kpi(s.summary)}</p></div><div class="card"><h2>資料匯入</h2><p class="muted">可先匯入 Excel 留存，後續再擴充欄位映射。</p><form id="upload"><input type="file" name="file" accept=".xlsx,.xls"><button class="btn btn2">上傳Excel</button></form><pre id="up" class="code"></pre></div></div><div class="card" style="margin-top:18px"><h2>平台連結</h2><a class="btn" href="${DASHBOARD_URL}" target="_blank">成果查詢系統</a> <a class="btn btn2" href="${FIELD_REPORT_URL}" target="_blank">外勤回報平台</a> <a class="btn btn3" href="/line-bot.html">LINE設定頁</a></div></div><script>
async function setupRichMenu(){ const r=await fetch('/api/admin/rich-menu/setup',{method:'POST'}); document.getElementById('rich').textContent=JSON.stringify(await r.json(),null,2); }
document.getElementById('upload').onsubmit=async e=>{e.preventDefault(); const fd=new FormData(e.target); const r=await fetch('/api/admin/upload-excel',{method:'POST',body:fd}); document.getElementById('up').textContent=JSON.stringify(await r.json(),null,2)};
async function logout(){ await fetch('/api/admin/logout',{method:'POST'}); location.href='/admin.html';}
</script>`)}
function lineBotHtml(){return htmlLayout('LINE BOT設定',`<div class="hero"><h1>LINE BOT 操作與設定</h1><p>Webhook、Rich Menu、常用指令</p></div><div class="wrap"><div class="grid"><div class="card"><h2>Webhook URL</h2><div class="code">${BASE_URL}/api/line/webhook</div><p>LINE Developers Verify 成功後，請確認 Use webhook 開啟。</p></div><div class="card"><h2>常用指令</h2><p>進度、KPI報表、統計選單、月份選單、行政區選單、法規中心、設備管理、車牌 ABC-1234。</p></div><div class="card"><h2>圖文選單預覽</h2><img src="/assets/line-rich-menu.jpg" style="width:100%;border-radius:14px;border:1px solid #c9dff3"></div></div></div>`)}
app.listen(PORT, ()=> console.log(`New Taipei V19 NTPC Tech running on :${PORT}`));
