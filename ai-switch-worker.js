// ai-switch: 三个 Kaggle 服务的统一外部控制台（Qwen聊天 / H3生图 / H3视频）
// 页面和接口同源。状态存 KV 的 status 键；用户请求存 req 键（数组）；
// 用户口令只存哈希（首次请求时设定）；agent 钥匙首次调用时设定（TOFU）。
const JSON_H = { "content-type": "application/json; charset=utf-8" };
const SERVICES = ["qwen", "h3-image", "h3-video"];
const ACTIONS = ["START", "STOP", "KEEP", "PING"];

function defStatus() {
  const s = {};
  for (const k of SERVICES) s[k] = { state: "off", url: null, note: "", updatedAt: null, keepAliveAt: null };
  return s;
}
async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function json(obj, code = 200) { return new Response(JSON.stringify(obj), { status: code, headers: JSON_H }); }

function pageHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI 算力控制台</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:18px 14px 44px;color:#1a1a1a;background:#fafafa}
h1{font-size:21px;margin:6px 0 2px}.sub{color:#666;font-size:13px;margin-bottom:14px}
.card{background:#fff;border:1px solid #e3e3e3;border-radius:14px;padding:16px;margin-bottom:14px}
.name{font-size:18px;font-weight:700}
.model{color:#666;font-size:13px;margin:2px 0 8px}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:7px}
.off{background:#bdbdbd}.starting{background:#fb8c00}.running{background:#43a047}.stopping{background:#fb8c00}.error{background:#e53935}
.state{font-weight:600}.note{color:#555;font-size:14px;margin-top:6px;line-height:1.55}
.upd{color:#999;font-size:12px;margin-top:6px}
.btns{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
button{flex:1;min-width:84px;padding:12px 4px;border-radius:11px;font-size:15px;font-weight:600;border:1px solid #ddd;background:#fff;color:#1a1a1a}
button.primary{background:#1a73e8;color:#fff;border-color:#1a73e8}
button:active{opacity:.7}
a.open{display:block;text-align:center;background:#43a047;color:#fff;text-decoration:none;padding:13px;border-radius:11px;font-weight:600;margin-top:12px}
textarea{width:100%;box-sizing:border-box;border:1px solid #ddd;border-radius:10px;padding:10px;font-size:15px;min-height:60px;margin-top:12px}
.reply{white-space:pre-wrap;background:#f4f6f8;border-radius:10px;padding:12px;margin-top:10px;font-size:15px;line-height:1.6;display:none}
.passrow{display:flex;gap:8px}.passrow input{flex:1;padding:11px;border:1px solid #ddd;border-radius:10px;font-size:15px}
.tip{color:#777;font-size:13px;line-height:1.7}
</style></head><body>
<h1>AI 算力控制台</h1>
<div class="sub">Qwen 聊天 · H3 生图 · H3 视频，都在这一个页面开、关、用</div>
<div class="card" id="passCard">
  <div style="font-weight:600;margin-bottom:8px">开关口令（第一次打开先设一个，自己记好）</div>
  <div class="passrow"><input id="pass" type="password" placeholder="输入口令"><button id="savePass" style="flex:0 0 84px">保存</button></div>
  <div class="tip" id="passTip">口令只用来防别人乱按，保存在这台手机的浏览器里。</div>
</div>
<div id="cards"></div>
<p class="tip">开启后没人用、又忘了关，我会自动帮你关掉省额度；想多用一会儿点「续时」。这个页面别转发给别人。</p>
<script>
var NAMES = {qwen:'Qwen 聊天', 'h3-image':'H3 生图', 'h3-video':'H3 视频'};
var MODELS = {qwen:'Qwen3.8-27B 越狱版 · 约 2-3 分钟开好', 'h3-image':'MiniMax H3-Image · 约 5-10 分钟开好', 'h3-video':'MiniMax H3 视频 · 网页版开启较慢，约 1 小时，提前开'};
var ST = {off:'未开启', starting:'正在开启…', running:'已开启', stopping:'正在关闭…', error:'出错了'};
var status = null;
var histories = {qwen: []};
function passHashSaved(){ return localStorage.getItem('ai_switch_passhash') || ''; }
async function sha(t){ var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(function(x){return x.toString(16).padStart(2,'0')}).join(''); }
document.getElementById('savePass').onclick = async function(){
  var v = document.getElementById('pass').value.trim();
  if (v.length < 4){ document.getElementById('passTip').textContent = '口令至少 4 位。'; return; }
  localStorage.setItem('ai_switch_passhash', await sha(v));
  document.getElementById('passTip').textContent = '已保存。点任意服务的开启/关闭就会生效（第一次按会自动把这个口令设为你的口令）。';
  document.getElementById('passCard').style.display = 'none';
};
if (passHashSaved()) document.getElementById('passCard').style.display = 'none';
function sendReq(service, action){
  var h = passHashSaved();
  if (!h){ document.getElementById('passCard').style.display = 'block'; alert('先设一下开关口令'); window.scrollTo(0,0); return; }
  fetch('/api/request', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({service:service, action:action, passhash:h})})
    .then(function(r){ return r.json(); })
    .then(function(j){
      if (j.ok){ alert('已发送，我这就去' + (action==='START'?'开启':action==='STOP'?'关闭':'续时') + '，状态会自动更新'); setTimeout(refresh, 3000); }
      else if (j.error === 'bad_pass'){ localStorage.removeItem('ai_switch_passhash'); document.getElementById('passCard').style.display = 'block'; alert('口令不对，重新输一次'); window.scrollTo(0,0); }
      else alert('发送失败：' + (j.error || '未知错误'));
    })
    .catch(function(){ alert('网络不通，稍后再试'); });
}
function render(){
  var wrap = document.getElementById('cards');
  wrap.innerHTML = '';
  Object.keys(NAMES).forEach(function(k){
    var s = (status && status[k]) || {state:'off', url:null, note:'', updatedAt:null};
    var card = document.createElement('div'); card.className = 'card';
    var html = '<div class="name">' + NAMES[k] + '</div><div class="model">' + MODELS[k] + '</div>'
      + '<div><span class="dot ' + s.state + '"></span><span class="state">' + (ST[s.state] || s.state) + '</span></div>'
      + (s.note ? '<div class="note">' + s.note + '</div>' : '');
    if (s.state === 'running' && s.url){
      if (k === 'qwen') html += '<a class="open" target="_blank" rel="noopener" href="' + s.url + '">打开聊天页</a>';
      if (k === 'h3-image') html += '<a class="open" target="_blank" rel="noopener" href="' + s.url + '">打开生图界面</a>';
      if (k === 'h3-video') html += '<a class="open" target="_blank" rel="noopener" href="' + s.url + '">打开视频界面</a>';
    }
    html += '<div class="btns">'
      + '<button class="primary" data-s="' + k + '" data-a="START">开启</button>'
      + (k === 'qwen' ? '<button data-s="' + k + '" data-a="KEEP">续时</button>' : '')
      + '<button data-s="' + k + '" data-a="STOP">关闭</button></div>'
      + (s.updatedAt ? '<div class="upd">更新于 ' + String(s.updatedAt).replace('T',' ').slice(0,19) + '</div>' : '');
    if (k === 'qwen' && s.state === 'running' && s.url){
      html += '<textarea id="qmsg" placeholder="直接在这里问千问…"></textarea>'
        + '<div class="btns"><button class="primary" id="qsend">发送</button></div>'
        + '<div class="reply" id="qreply"></div>';
    }
    card.innerHTML = html;
    wrap.appendChild(card);
  });
  wrap.querySelectorAll('button[data-s]').forEach(function(b){
    b.onclick = function(){ sendReq(b.getAttribute('data-s'), b.getAttribute('data-a')); };
  });
  var send = document.getElementById('qsend');
  if (send) send.onclick = sendChat;
}
function sendChat(){
  var box = document.getElementById('qmsg'), reply = document.getElementById('qreply');
  var text = box.value.trim(); if (!text) return;
  var url = status.qwen.url;
  reply.style.display = 'block'; reply.textContent = '思考中…';
  histories.qwen.push({role:'user', content:text});
  fetch(url.replace(/\\/$/,'') + '/v1/chat/completions', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({model:'qwen3.8-27b-uncensored', messages: histories.qwen})})
    .then(function(r){ return r.json(); })
    .then(function(j){
      var c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (c){ histories.qwen.push({role:'assistant', content:c}); reply.textContent = c; box.value = ''; }
      else { reply.textContent = '没拿到回复，可能服务在忙，稍后再试。'; histories.qwen.pop(); }
    })
    .catch(function(){ reply.textContent = '连不上服务，可能刚关掉。用上面的「打开聊天页」试试。'; histories.qwen.pop(); });
}
function refresh(){
  fetch('/api/status', {cache:'no-store'}).then(function(r){ return r.json(); }).then(function(s){ status = s; render(); }).catch(function(){});
}
refresh(); setInterval(refresh, 15000);
</script></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const kv = env.SWITCH_KV;

    if (path === "/" || path === "/index.html") {
      return new Response(pageHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (path === "/api/status" && request.method === "GET") {
      const s = await kv.get("status", "json");
      return json(s || defStatus());
    }
    if (path === "/api/poll" && request.method === "GET") {
      const reqs = (await kv.get("req", "json")) || [];
      const s = await kv.get("status", "json");
      return json({ requests: reqs, status: s || defStatus() });
    }
    if (path === "/api/request" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const { service, action, passhash } = body;
      if (!SERVICES.includes(service) || !ACTIONS.includes(action) || !passhash) {
        return json({ ok: false, error: "bad_params" }, 400);
      }
      let saved = await kv.get("passhash");
      if (!saved) { await kv.put("passhash", passhash); saved = passhash; }
      if (saved !== passhash) return json({ ok: false, error: "bad_pass" }, 401);
      const reqs = (await kv.get("req", "json")) || [];
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      reqs.push({ id, service, action, ts: new Date().toISOString() });
      await kv.put("req", JSON.stringify(reqs.slice(-10)));
      return json({ ok: true, id });
    }
    if (path === "/api/agent" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const key = request.headers.get("x-agent-key") || body.key || "";
      let savedKey = await kv.get("agentkey");
      if (!savedKey) { if (!key) return json({ ok: false, error: "no_key" }, 400); await kv.put("agentkey", key); savedKey = key; }
      if (savedKey !== key) return json({ ok: false, error: "bad_key" }, 401);
      if (body.statusPatch) {
        const cur = (await kv.get("status", "json")) || defStatus();
        for (const k of Object.keys(body.statusPatch)) {
          if (SERVICES.includes(k)) cur[k] = { ...cur[k], ...body.statusPatch[k] };
        }
        await kv.put("status", JSON.stringify(cur));
      }
      if (Array.isArray(body.clearReqIds) && body.clearReqIds.length) {
        const reqs = (await kv.get("req", "json")) || [];
        await kv.put("req", JSON.stringify(reqs.filter(r => !body.clearReqIds.includes(r.id))));
      }
      if (body.resetPass) await kv.delete("passhash");
      return json({ ok: true });
    }
    return json({ ok: false, error: "not_found" }, 404);
  }
};
