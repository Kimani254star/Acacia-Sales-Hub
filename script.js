/* Public home page: single-view navigation, same behaviour as the Support site */
  function hpMore(btn){
    var card=btn.closest('.hp-tier');
    var open=card.classList.toggle('hp-open');
    btn.innerHTML=open?'Show less &#9652;':'Show '+btn.getAttribute('data-n')+' more features &#9662;';
  }
  function hpBillingToggle(){
    var yearly=document.getElementById('hpBilling').checked;
    document.querySelectorAll('#homePage .hp-amt').forEach(function(el){
      var p=yearly?+el.getAttribute('data-year'):+el.getAttribute('data-month');
      el.textContent='KES '+p.toLocaleString('en-US');
      var per=el.parentElement.querySelector('.hp-per');
      if(per) per.textContent=yearly?'/yr':'/mo';
    });
  }
(function(){
  var root=document.getElementById('homePage');
  var slides=root.querySelectorAll('.hp-slide'),si=0;
  setInterval(function(){
    if(root.style.display!=='block'||slides.length<2) return;
    slides[si].classList.remove('active'); si=(si+1)%slides.length; slides[si].classList.add('active');
  },5000);
  var nav=document.getElementById('hpNav'),burger=document.getElementById('hpBurger');
  burger.addEventListener('click',function(){
    var open=nav.classList.toggle('open');
    burger.setAttribute('aria-expanded',open?'true':'false');
  });
  var pages=root.querySelectorAll('.hp-page');
  var valid={top:1,about:1,features:1,process:1,pricing:1,faq:1,contact:1};
  function show(id){
    if(!valid[id]) id='top';
    pages.forEach(function(p){p.classList.toggle('hp-active',p.getAttribute('data-page')===id);});
    root.querySelectorAll('.hp-nav a').forEach(function(a){a.classList.toggle('hp-current',a.getAttribute('href')==='#'+id);});
    nav.classList.remove('open'); burger.setAttribute('aria-expanded','false');
    root.scrollTop=0;
  }
  root.querySelectorAll('a[data-scroll]').forEach(function(a){
    a.addEventListener('click',function(e){ e.preventDefault(); show(a.getAttribute('href').slice(1)); });
  });
  var y=document.getElementById('footerYear'); if(y) y.textContent=new Date().getFullYear();
  show('top');
  window.hpShowPage=show;
})();
function hpShowHome(){
  document.getElementById('authScreen').style.display='none';
  document.getElementById('homePage').style.display='block';
  window.hpShowPage&&window.hpShowPage('top');
}
function hpHideHome(){ document.getElementById('homePage').style.display='none'; }
function hpShowLogin(tab){
  hpHideHome();
  document.getElementById('authScreen').style.display='flex';
  switchAuthTab(tab||'login');
}
function hpTheme(){
  if(typeof toggleTheme==='function'){ toggleTheme(); return; }
  var h=document.documentElement;
  if(h.getAttribute('data-theme')==='dark') h.removeAttribute('data-theme'); else h.setAttribute('data-theme','dark');
}
function hpContact(e){
  e.preventDefault();
  var n=document.getElementById('hpName').value.trim(), m=document.getElementById('hpEmail').value.trim(), t=document.getElementById('hpMsg').value.trim();
  var body='From: '+n+' <'+m+'>\n\n'+t;
  window.location.href='mailto:hello@example.com?subject='+encodeURIComponent('Acacia Sell enquiry')+'&body='+encodeURIComponent(body);
  document.getElementById('contactConfirm').classList.remove('hidden');
  return false;
}

;
/* ===== acacia-cloud: shared Supabase layer for the Acacia apps (same project as Books) =====
   - Sign in / sign up against the same accounts Books uses (table app_accounts)
   - New companies + users show up in Support (acacia_company_status, app_accounts, acacia_app_usage)
   - Each app's data is saved per company in acacia_app_data and loaded on any device
   Needs acacia_apps_cloud.sql to be run once in Supabase. Offline: falls back to this browser's copy. */
(function (w) {
  'use strict';
  var URL_ = 'https://xglsampckermarjpczdf.supabase.co';
  var KEY_ = 'sb_publishable_x-dPR7pzhvJgag9soW0I8w_yfKTmi6A';
  var H = { apikey: KEY_, Authorization: 'Bearer ' + KEY_, 'Content-Type': 'application/json' };
  var cfg = null, ctx = null, timer = 0, hbTimer = 0;
  var rawSet = Storage.prototype.setItem;
  var low = function (v) { return String(v == null ? '' : v).trim().toLowerCase(); };
  var enc = encodeURIComponent;
  var isCloudId = function (id) { return /^ACC-\d+$/i.test(String(id || '')); };
  function err(code, msg) { var e = new Error(msg || code); e.code = code; return e; }

  async function req(path, opt) {
    var ctl = w.AbortController ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, 12000) : null;
    try {
      var r = await fetch(URL_ + '/rest/v1/' + path, Object.assign({ headers: H, signal: ctl ? ctl.signal : undefined }, opt || {}));
      if (t) clearTimeout(t);
      return r;
    } catch (e) { if (t) clearTimeout(t); throw err('offline', 'Cannot reach the Acacia cloud. Check your internet connection.'); }
  }
  async function rpc(name, args) {
    var r = await req('rpc/' + name, { method: 'POST', body: JSON.stringify(args || {}) });
    var j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) {
      var m = (j && (j.message || j.hint)) || ('HTTP ' + r.status);
      var e = err(/already exists|exists/i.test(m) ? 'exists' : (r.status === 404 ? 'missing' : 'rpc'), m); e.status = r.status; throw e;
    }
    return j;
  }

  /* same hashing as Books: SHA-256 of "salt:password" */
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function newSalt() { var a = new Uint8Array(16); crypto.getRandomValues(a); return hex(a); }
  async function hash(pass, salt) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pass))); }
  async function verify(d, pass) {
    d = d || {};
    if (d.passwordHash && d.passwordSalt) return (await hash(pass, d.passwordSalt)) === d.passwordHash;
    return typeof d.password === 'string' && d.password === pass;
  }
  function mapRole(r, d) { return cfg && cfg.mapRole ? cfg.mapRole(r, d) : (/^admin/i.test(String(r || '')) ? 'Administrator' : (r || 'Administrator')); }

  /* deleted / suspended companies are blocked (fails open if the cloud can't be reached) */
  async function gate(cid, login) {
    try { if ((await rpc('acx_account_state', { p_company: low(cid), p_login: low(login) })) === 'deleted') return 'This account was removed by Acacia support.'; } catch (e) {}
    try {
      var r = await req('acacia_company_status?select=status&company_id=eq.' + enc(cid));
      if (r.ok) { var j = await r.json(); var s = j[0] && j[0].status; if (s === 'pending') return 'Your company is waiting for approval by Acacia support. You will be able to sign in as soon as it is approved.'; if (s && s !== 'active') return 'Your company account is "' + s + '". Please contact Acacia support.'; }
    } catch (e) {}
    return null;
  }

  async function signIn(email, pass, company) {
    email = low(email);
    var r = await req('app_accounts?select=login_id,username,company_id,data&login_id=eq.' + enc(email));
    if (!r.ok) throw err('offline', 'Could not read accounts (' + r.status + '). Run acacia_apps_cloud.sql in Supabase.');
    var rows = await r.json(), ok = [], cn = low(company);
    if (cn) rows = rows.filter(function (x) { var d = x.data || {}; return low(d.companyName) === cn || low(x.company_id) === cn || (d.previousCompanyNames || []).map(low).indexOf(cn) > -1; });
    for (var i = 0; i < rows.length; i++) if (await verify(rows[i].data, pass)) ok.push(rows[i]);
    if (!ok.length) return null;
    var row = ok[0];
    if (ok.length > 1) {
      var pick = w.prompt('This login belongs to more than one company:\n' + ok.map(function (x, n) { return (n + 1) + '. ' + ((x.data && x.data.companyName) || x.company_id) + ' (' + x.company_id + ')'; }).join('\n') + '\n\nType the number to open:', '1');
      row = ok[(parseInt(pick, 10) || 1) - 1] || ok[0];
    }
    var msg = await gate(row.company_id, email); if (msg) throw err('blocked', msg);
    var d = row.data || {};
    return { companyId: row.company_id, company: d.companyName || '', name: d.fullName || d.username || email.split('@')[0], email: email, role: mapRole(d.role, d), passwordHash: d.passwordHash, passwordSalt: d.passwordSalt };
  }

  async function register(o) {
    var salt = newSalt(), h = await hash(o.password, salt);
    var id = await rpc('acx_register_company', { p_company: o.company, p_name: o.name, p_email: low(o.email), p_hash: h, p_salt: salt, p_app: cfg.app, p_plan: o.plan || '', p_billing: o.billing || 'monthly' });
    var blocked = await gate(id, o.email);
    return { companyId: id, passwordHash: h, passwordSalt: salt, blocked: blocked };
  }

  /* teammates added inside an app (CRM Users & Roles). The app's own role is kept per app; Books sees admin/user */
  var booksRole = function (r) { return /^admin/i.test(String(r || '')) ? 'admin' : 'user'; };
  async function addUser(o) {
    var salt = newSalt(), h = await hash(o.password, salt);
    await rpc('acx_add_user', { p_company: o.companyId, p_name: o.name, p_email: low(o.email), p_role: booksRole(o.role), p_hash: h, p_salt: salt, p_app: cfg.app, p_app_role: o.role || '' });
    return { passwordHash: h, passwordSalt: salt };
  }
  function setRole(companyId, email, role) { return rpc('acx_set_user_role', { p_company: companyId, p_email: low(email), p_role: booksRole(role), p_app: cfg.app, p_app_role: role || '' }); }
  function removeUser(companyId, email) { return rpc('acx_remove_user', { p_company: companyId, p_email: low(email) }); }

  /* keep a copy of cloud users in this browser so the app's own session code keeps working (and offline sign-in) */
  function cacheUser(usersKey, u) {
    try {
      var list = JSON.parse(localStorage.getItem(usersKey) || '[]');
      var rec = { companyId: u.companyId, company: u.company, name: u.name, email: low(u.email), role: u.role, passwordHash: u.passwordHash, passwordSalt: u.passwordSalt };
      var i = list.findIndex(function (x) { return low(x.email) === rec.email && x.companyId === rec.companyId; });
      if (i > -1) { list[i] = Object.assign({}, list[i], rec); delete list[i].password; } else list.push(rec);
      rawSet.call(localStorage, usersKey, JSON.stringify(list));
    } catch (e) {}
  }
  function verifyLocal(u, pass) { return verify(u, pass); }

  /* accounts that only ever existed in this browser get a cloud company; their data and teammates move with them.
     'all' is the local users array: it is updated in place (caller saves it). Returns the signed-in user's new record. */
  async function migrate(u, pass, all) {
    var oldId = u.companyId, same = (all || [u]).filter(function (x) { return x.companyId === oldId; });
    var owner = same.find(function (x) { return /^admin/i.test(String(x.role || 'Administrator')) && x.password; }) || u;
    var ownerPass = owner === u ? pass : owner.password;
    var r = await register({ company: owner.company, name: owner.name, email: owner.email, password: ownerPass });
    for (var i = 0; i < same.length; i++) {
      var x = same[i];
      if (x === owner) { x.passwordHash = r.passwordHash; x.passwordSalt = r.passwordSalt; }
      else {
        var pw = x === u ? pass : x.password;
        if (pw) { try { var h = await addUser({ companyId: r.companyId, name: x.name, email: x.email, password: pw, role: x.role || 'Administrator' }); x.passwordHash = h.passwordHash; x.passwordSalt = h.passwordSalt; } catch (e) { continue; } }
        else continue;
      }
      delete x.password; x.companyId = r.companyId;
    }
    var o = cfg.dataKey(oldId), n = cfg.dataKey(r.companyId), v = localStorage.getItem(o);
    if (v != null) { rawSet.call(localStorage, n, v); localStorage.removeItem(o); rawSet.call(localStorage, dirtyKey(r.companyId), '1'); }
    return same.find(function (x) { return low(x.email) === low(u.email) && x.companyId === r.companyId; }) || null;
  }

  /* ---- data sync (one JSON blob per company per app) ---- */
  function tsKey(c) { return 'acx_ts_' + cfg.app + '_' + (c || ctx.companyId); }
  function dirtyKey(c) { return 'acx_dirty_' + cfg.app + '_' + (c || ctx.companyId); }
  async function pullRow(app) {
    var r = await req('acacia_app_data?select=value,updated_at&key=eq.data&company_id=eq.' + enc(ctx.companyId) + '&app=eq.' + enc(app));
    if (!r.ok) return null; var j = await r.json(); return j[0] || null;
  }
  async function pushNow() {
    if (!ctx || !isCloudId(ctx.companyId)) return false;
    var v = localStorage.getItem(cfg.dataKey(ctx.companyId)); if (v == null) return false;
    try {
      var r = await req('acacia_app_data?on_conflict=company_id,app,key', { method: 'POST', headers: Object.assign({}, H, { Prefer: 'resolution=merge-duplicates,return=representation' }), body: JSON.stringify({ company_id: ctx.companyId, app: cfg.app, key: 'data', value: v }) });
      if (r.ok) { var j = await r.json(); rawSet.call(localStorage, tsKey(), (j[0] && j[0].updated_at) || ''); localStorage.removeItem(dirtyKey()); return true; }
    } catch (e) {}
    return false;
  }
  function schedule() {
    if (!ctx || !isCloudId(ctx.companyId)) return;
    rawSet.call(localStorage, dirtyKey(), '1');
    clearTimeout(timer); timer = setTimeout(pushNow, 2500);
  }
  function flush() {
    if (!ctx || !isCloudId(ctx.companyId) || localStorage.getItem(dirtyKey()) !== '1') return;
    clearTimeout(timer);
    var v = localStorage.getItem(cfg.dataKey(ctx.companyId)); if (v == null) return;
    try {
      fetch(URL_ + '/rest/v1/acacia_app_data?on_conflict=company_id,app,key', { method: 'POST', keepalive: v.length < 60000, headers: Object.assign({}, H, { Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify({ company_id: ctx.companyId, app: cfg.app, key: 'data', value: v }) }).then(function (r) { if (r.ok) localStorage.removeItem(dirtyKey()); }).catch(function () {});
    } catch (e) {}
  }
  async function pullData() {
    var row = await pullRow(cfg.app);
    var dirty = localStorage.getItem(dirtyKey()) === '1', last = localStorage.getItem(tsKey());
    if (row && !dirty && row.updated_at !== last) { rawSet.call(localStorage, cfg.dataKey(ctx.companyId), row.value); rawSet.call(localStorage, tsKey(), row.updated_at); }
    else if (!row) { if (localStorage.getItem(cfg.dataKey(ctx.companyId)) != null) await pushNow(); }
    else if (dirty) await pushNow();
  }
  /* read-only copies of another app's data (e.g. Expenses reads Payroll) */
  async function pullExtras() {
    var ex = cfg.readFrom || [];
    for (var i = 0; i < ex.length; i++) { try { var row = await pullRow(ex[i].app); if (row) rawSet.call(localStorage, ex[i].dataKey(ctx.companyId), row.value); } catch (e) {} }
  }

  function heartbeat() {
    if (!ctx || !isCloudId(ctx.companyId) || !ctx.email) return;
    var k = 'acx_hb_' + ctx.companyId + '_' + cfg.app + '_' + ctx.email;
    if (Date.now() - Number(localStorage.getItem(k) || 0) < 3e5) return;
    rawSet.call(localStorage, k, String(Date.now()));
    try { fetch(URL_ + '/rest/v1/rpc/acx_heartbeat', { method: 'POST', headers: H, keepalive: true, body: JSON.stringify({ p_company: ctx.companyId, p_app: cfg.app, p_user: ctx.email, p_role: String(ctx.role || '') }) }).catch(function () {}); } catch (e) {}
  }

  /* called when a user enters the app: returns 'ok' | 'local' | 'blocked:<message>' */
  async function start(user) {
    ctx = { companyId: user.companyId, email: low(user.email), role: user.role || '' };
    if (!isCloudId(ctx.companyId)) return 'local';
    var msg = await gate(ctx.companyId, ctx.email); if (msg) return 'blocked:' + msg;
    try { await pullData(); await pullExtras(); } catch (e) {}
    heartbeat(); clearInterval(hbTimer); hbTimer = setInterval(function () { heartbeat(); }, 3e5);
    return 'ok';
  }
  function stop() { flush(); clearInterval(hbTimer); ctx = null; }

  function init(c) {
    cfg = c;
    Storage.prototype.setItem = function (k, v) {
      rawSet.apply(this, arguments);
      try { if (this === w.localStorage && ctx && k === cfg.dataKey(ctx.companyId)) schedule(); } catch (e) {}
    };
    w.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
  }

  /* sign-up plan note: reads #regPlan / #regBilling and shows what the company will pay */
  w.acxPlanChanged = function () {
    var s = document.getElementById('regPlan'), b = document.getElementById('regBilling'), n = document.getElementById('regPlanNote');
    if (!s || !n) return;
    var o = s.options[s.selectedIndex], p = Number((o && o.getAttribute('data-price')) || 0), y = !!b && b.value === 'yearly';
    var f = function (x) { return 'KES ' + x.toLocaleString('en-US'); };
    n.textContent = y ? f(p * 10) + ' for the year (2 months free). Billed after Acacia support approves your account.' : f(p) + ' per month. Billed after Acacia support approves your account.';
  };
  setTimeout(function () { try { if (w.acxPlanChanged) w.acxPlanChanged(); } catch (e) {} }, 0);

  w.AcaciaCloud = { init: init, signIn: signIn, register: register, addUser: addUser, setRole: setRole, removeUser: removeUser, cacheUser: cacheUser, verifyLocal: verifyLocal, migrate: migrate, start: start, stop: stop, flush: flush, isCloudId: isCloudId, gate: gate, URL: URL_, KEY: KEY_, rpc: rpc, req: req };
})(window);
;
/* =====================================================================
   ACACIA SELL — in-memory data model
   (No browser storage is used — this is a working prototype; data
   lives in memory for the session and resets on reload.)
===================================================================== */

const fmt = n => 'KES ' + Number(n||0).toLocaleString('en-KE', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmtShort = n => 'KES ' + Number(n||0).toLocaleString('en-KE', {maximumFractionDigits:0});
const todayISO = () => new Date().toISOString().slice(0,10);
const uid = (p) => p + '-' + Math.random().toString(36).slice(2,7).toUpperCase();

/* Blank starting dataset — no demo data. Every new account starts empty. */
function blankDB(){
  return {
    seq: { quote:0, order:0, invoice:0, payment:0, ret:0, cust:0, prod:0 },
    customers: [], products: [], quotes: [], orders: [], invoices: [], payments: [], returns: []
  };
}
let DB = null;
let CURRENT_USER = null;

/* ---------- Persistence (per-company, in this browser) ---------- */
const USERS_KEY = 'acaciaSellUsers';
const SESSION_KEY = 'acaciaSellSession';
const STORAGE_KEY = 'acaciaSellData';
const dataKeyFor = (companyId) => STORAGE_KEY + '_' + companyId;

function loadCompanyData(companyId){
  try{
    const raw = localStorage.getItem(dataKeyFor(companyId));
    if(raw) return JSON.parse(raw);
  }catch(e){}
  const blank = blankDB();
  try{ localStorage.setItem(dataKeyFor(companyId), JSON.stringify(blank)); }catch(e){}
  return blank;
}
function saveCompanyData(){
  if(!CURRENT_USER) return;
  try{ localStorage.setItem(dataKeyFor(CURRENT_USER.companyId), JSON.stringify(DB)); }catch(e){}
}
AcaciaCloud.init({app:'sell', dataKey:dataKeyFor});
function getUsers(){
  try{ return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); }catch(e){ return []; }
}
function saveUsers(list){ try{ localStorage.setItem(USERS_KEY, JSON.stringify(list)); }catch(e){} }
function getSession(){
  try{ return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }catch(e){ return null; }
}
function setSession(user){
  try{ localStorage.setItem(SESSION_KEY, JSON.stringify({email:user.email, companyId:user.companyId, name:user.name, company:user.company})); }catch(e){}
}
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); }catch(e){} }

/* ---------- Auth screen behaviour ---------- */
function switchAuthTab(which){
  document.getElementById('tabLoginBtn').classList.toggle('active', which==='login');
  document.getElementById('tabRegisterBtn').classList.toggle('active', which==='register');
  document.getElementById('loginPane').style.display = which==='login' ? 'block' : 'none';
  document.getElementById('registerPane').style.display = which==='register' ? 'block' : 'none';
  document.getElementById('loginError').classList.remove('show');
  document.getElementById('registerError').classList.remove('show');
}
function showAuthError(id, msg){
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('show');
}
async function handleRegister(){
  const company = document.getElementById('regCompany').value.trim();
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const password = document.getElementById('regPassword').value;
  if(!company || !name || !email || !password){ showAuthError('registerError','Please fill in every field.'); return; }
  if(password.length < 6){ showAuthError('registerError','Password must be at least 6 characters.'); return; }
  const users = getUsers();
  let user, viaCloud = false;
  try{
    const c = await AcaciaCloud.register({company, name, email, password, plan:(document.getElementById('regPlan')||{}).value||'', billing:(document.getElementById('regBilling')||{}).value||'monthly'});
    if(c.blocked){ showAuthError('registerError','Account created. ' + c.blocked); return; }
    user = {companyId:c.companyId, company, name, email, role:'Administrator', passwordHash:c.passwordHash, passwordSalt:c.passwordSalt};
    viaCloud = true;
  }catch(e){
    if(e.code === 'exists'){ showAuthError('registerError','This company already has an account with that email. Please sign in instead.'); return; }
    if(e.code !== 'offline'){ showAuthError('registerError', e.message || 'Could not create the account. Please try again.'); return; }
    if(users.some(u=>u.email===email)){ showAuthError('registerError','An account with that email already exists.'); return; }
    user = {companyId:uid('co'), company, name, email, password, role:'Administrator'};   // offline: uploaded the next time you sign in online
  }
  if(viaCloud) AcaciaCloud.cacheUser(USERS_KEY, user); else { users.push(user); saveUsers(users); }
  setSession(user);
  await enterApp(user);
}
async function handleLogin(){
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  const company = (document.getElementById('loginCompany').value || '').trim();
  if(!company || !email || !password){ showAuthError('loginError','Please enter your company name, email and password.'); return; }
  let user = null;
  try{
    user = await AcaciaCloud.signIn(email, password, company);
    if(user) AcaciaCloud.cacheUser(USERS_KEY, user);
  }catch(e){
    if(e.code === 'blocked'){ showAuthError('loginError', e.message); return; }
  }
  if(!user){
    const users = getUsers();
    for(const u of users){ if(u.email === email && String(u.company||'').trim().toLowerCase() === company.toLowerCase() && await AcaciaCloud.verifyLocal(u, password)){ user = u; break; } }
    if(!user){ showAuthError('loginError','That email and password combination was not found.'); return; }
    if(!AcaciaCloud.isCloudId(user.companyId)){
      try{ const moved = await AcaciaCloud.migrate(user, password, users); if(moved){ saveUsers(users); user = moved; } }catch(e){ /* offline: stays on this device for now */ }
    }
  }
  setSession(user);
  await enterApp(user);
}
function handleLogout(){
  AcaciaCloud.stop();
  clearSession();
  CURRENT_USER = null; DB = null;
  document.getElementById('app').classList.remove('ready');
  hpShowHome();
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
  switchAuthTab('login');
}
function toggleUserMenu(e){
  e.stopPropagation();
  document.getElementById('userMenu').classList.toggle('open');
}
document.addEventListener('click', (e)=>{
  const m = document.getElementById('userMenu');
  if(m && m.classList.contains('open') && !m.contains(e.target) && e.target.id!=='userChip') m.classList.remove('open');
});
async function enterApp(user){
  let res = 'local';
  try{ res = await AcaciaCloud.start(user); }catch(e){}
  if(String(res).indexOf('blocked:') === 0){
    try{ clearSession(); }catch(e){}
    AcaciaCloud.stop();
    alert(String(res).slice(8));
    location.reload();
    return;
  }
  return __enterAppLocal(user);
}
function __enterAppLocal(user){
  CURRENT_USER = user;
  DB = loadCompanyData(user.companyId);
  document.getElementById('authScreen').style.display = 'none'; hpHideHome();
  document.getElementById('app').classList.add('ready');
  const initials = (user.name||'').split(' ').filter(Boolean).slice(0,2).map(s=>s[0].toUpperCase()).join('') || 'U';
  document.getElementById('userAvatar').textContent = initials;
  document.getElementById('userNameLabel').textContent = user.name;
  document.getElementById('userCompanyLabel').textContent = user.company;
  currentPage = 'dashboard'; pageState = {};
  renderNav(); renderPage();
}
function clearCompanyData(){
  if(!confirm('This will permanently delete every customer, product, quote, order, invoice, payment and return for '+CURRENT_USER.company+'. Continue?')) return;
  DB = blankDB();
  saveCompanyData();
  toast('All sales data cleared.');
  goTo('dashboard');
}
function checkSessionOnLoad(){
  const session = getSession();
  if(session){
    const users = getUsers();
    const user = users.find(u=>u.email===session.email && u.companyId===session.companyId);
    if(user){ enterApp(user); return; }
  }
  hpShowHome();
}

/* ---------- calculations ---------- */
function lineTotal(l){
  const gross = l.qty * l.price;
  const afterDisc = gross * (1 - (l.disc||0)/100);
  return afterDisc;
}
function computeTotals(lines){
  const subtotal = lines.reduce((s,l)=> s + l.qty*l.price, 0);
  const discountTotal = lines.reduce((s,l)=> s + (l.qty*l.price)*((l.disc||0)/100), 0);
  const taxable = subtotal - discountTotal;
  const vat = lines.reduce((s,l)=> {
    const prod = DB.products.find(p=>p.id===l.pid);
    const rate = prod ? prod.vat/100 : 0.16;
    return s + lineTotal(l)*rate;
  }, 0);
  const grand = taxable + vat;
  return { subtotal, discountTotal, vat, grand };
}

/* ---------- creation / conversion ---------- */
function makeQuote(custId, lines, status){
  DB.seq.quote++;
  const t = computeTotals(lines);
  const q = {
    id:'QT-'+DB.seq.quote, custId, lines, status: status||'Draft',
    date: todayISO(), total: t.grand, converted:{order:null}
  };
  DB.quotes.unshift(q);
  return q;
}
function convertQuoteToOrder(quoteId, opts){
  const q = DB.quotes.find(x=>x.id===quoteId);
  if(!q) return null;
  if(q.converted.order){ if(!opts||!opts.silent) toast('Already converted to an order.'); return DB.orders.find(o=>o.id===q.converted.order); }
  DB.seq.order++;
  const o = { id:'SO-'+DB.seq.order, custId:q.custId, lines:q.lines.map(l=>({...l})), status:'Pending', date: todayISO(), quoteId:q.id, total:q.total, converted:{invoice:null} };
  DB.orders.unshift(o);
  q.converted.order = o.id;
  q.status = 'Accepted';
  if(!opts||!opts.silent) toast('Quote '+q.id+' converted to order '+o.id);
  return o;
}
function convertOrderToInvoice(orderId, opts){
  const o = DB.orders.find(x=>x.id===orderId);
  if(!o) return null;
  if(o.converted.invoice){ if(!opts||!opts.silent) toast('Already invoiced.'); return DB.invoices.find(i=>i.id===o.converted.invoice); }
  DB.seq.invoice++;
  const t = computeTotals(o.lines);
  const inv = {
    id:'INV-'+String(DB.seq.invoice).padStart(4,'0'), custId:o.custId, lines:o.lines.map(l=>({...l})),
    date: todayISO(), dueDate: addDays(todayISO(),14), orderId:o.id,
    subtotal:t.subtotal, discount:t.discountTotal, vat:t.vat, total:t.grand,
    paid:0, status:'Sent'
  };
  DB.invoices.unshift(inv);
  o.converted.invoice = inv.id;
  o.status = 'Delivered';
  // reduce stock
  o.lines.forEach(l=>{
    const p = DB.products.find(pp=>pp.id===l.pid);
    if(p) p.stock = Math.max(0, p.stock - l.qty);
  });
  if(!opts||!opts.silent) toast('Order '+o.id+' converted to invoice '+inv.id);
  return inv;
}
function recordPayment(invoiceId, amount, method, opts){
  const inv = DB.invoices.find(i=>i.id===invoiceId);
  if(!inv) return null;
  amount = Math.min(amount, inv.total - inv.paid);
  if(amount<=0) return null;
  DB.seq.payment++;
  const p = { id:'PMT-'+DB.seq.payment, invoiceId, custId:inv.custId, amount, method: method||'Cash', date: todayISO() };
  DB.payments.unshift(p);
  inv.paid += amount;
  inv.status = inv.paid >= inv.total ? 'Paid' : 'Partially Paid';
  const cust = DB.customers.find(c=>c.id===inv.custId);
  if(cust) cust.balance = Math.max(0, cust.balance - amount);
  if(!opts||!opts.silent) toast('Payment of '+fmt(amount)+' recorded for '+inv.id);
  return p;
}
function makeReturn(invoiceId, lines, reason){
  const inv = DB.invoices.find(i=>i.id===invoiceId);
  if(!inv) return null;
  DB.seq.ret++;
  const amount = lines.reduce((s,l)=> s + l.qty*l.price, 0);
  const r = { id:'RET-'+DB.seq.ret, invoiceId, custId:inv.custId, lines, amount, reason: reason||'', date: todayISO() };
  DB.returns.unshift(r);
  lines.forEach(l=>{
    const p = DB.products.find(pp=>pp.id===l.pid);
    if(p) p.stock += l.qty;
  });
  return r;
}
function addDays(iso, n){
  const d = new Date(iso); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10);
}
function daysOverdue(inv){
  if(inv.status==='Paid') return 0;
  const due = new Date(inv.dueDate); const now = new Date('2026-09-05');
  const diff = Math.floor((now-due)/86400000);
  return diff>0? diff : 0;
}
function custName(id){ const c = DB.customers.find(c=>c.id===id); return c? c.name : '—'; }
function prodName(id){ const p = DB.products.find(p=>p.id===id); return p? p.name : '—'; }

/* =====================================================================
   NAVIGATION
===================================================================== */
const NAV = [
  {key:'dashboard', label:'Dashboard', icon:'&#9632;'},
  {sec:'Sales Hub'},
  {key:'customers', label:'Customer', icon:'&#9679;'},
  {key:'invoices', label:'Invoices', icon:'&#128196;'},
  {key:'quotes', label:'Quotes', icon:'&#9998;'},
  {key:'orders', label:'Orders', icon:'&#128230;'},
  {key:'bulkinv', label:'Bulk Invoicing', icon:'&#128209;'},
  {key:'creditnotes', label:'Credit Notes', icon:'&#128221;'},
  {key:'returns', label:'Sales Returns', icon:'&#8630;'},
  {key:'payments', label:'Receipts', icon:'&#128176;'},
  {key:'recurring', label:'Recurring Invoices', icon:'&#128257;'},
  {key:'delivery', label:'Delivery', icon:'&#128666;'},
  {key:'statement', label:'Statement', icon:'&#128195;'},
  {sec:'More'},
  {key:'products', label:'Products', icon:'&#9635;'},
  {key:'reports', label:'Reports', icon:'&#128202;'},
  {key:'settings', label:'Settings', icon:'&#9881;'}
];
let currentPage = 'dashboard';
let pageState = {}; // per-page filters (tab, search)

function renderNav(){
  const el = document.getElementById('navList');
  el.innerHTML = NAV.map(n => n.sec ? `<div class="nav-sec" style="padding:10px 16px 4px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.6">${n.sec}</div>` : `
    <div class="nav-item ${currentPage===n.key?'active':''}" onclick="goTo('${n.key}')">
      <span class="icon">${n.icon}</span><span>${n.label}</span>
    </div>`).join('');
}
function goTo(key){
  currentPage = key;
  pageState = {};
  renderNav();
  renderPage();
  document.querySelector('.content').scrollTop = 0;
  window.scrollTo(0,0);
}
function renderPage(){
  DB.creditNotes=DB.creditNotes||[]; DB.recurring=DB.recurring||[]; DB.seq.cn=DB.seq.cn||0; DB.seq.rec=DB.seq.rec||0;
  saveCompanyData();
  const c = document.getElementById('content');
  const renderers = {
    dashboard: renderDashboard,
    customers: renderCustomers,
    products: renderProducts,
    quotes: renderQuotes,
    orders: renderOrders,
    invoices: renderInvoices,
    payments: renderPayments,
    returns: renderReturns, bulkinv: renderBulkInv, creditnotes: renderCreditNotes, recurring: renderRecurring, delivery: renderDelivery, statement: renderStatement,
    reports: renderReports,
    settings: renderSettings
  };
  c.innerHTML = (renderers[currentPage] || renderDashboard)();
  enhanceTables();
}

/* =====================================================================
   DASHBOARD
===================================================================== */
function renderDashboard(){
  const todayInvoices = DB.invoices.filter(i=> i.date === todayISO());
  const salesToday = todayInvoices.reduce((s,i)=>s+i.total,0);
  const monthInvoices = DB.invoices; // demo dataset only spans a short window
  const salesMonth = monthInvoices.reduce((s,i)=>s+i.total,0);
  const outstanding = DB.invoices.reduce((s,i)=> s + (i.total-i.paid), 0);
  const paymentsReceived = DB.payments.reduce((s,p)=>s+p.amount,0);
  const pendingOrders = DB.orders.filter(o=>o.status==='Pending'||o.status==='Confirmed').length;

  const lowStock = DB.products.filter(p=>p.stock <= p.reorder);
  const topProducts = [...DB.products].map(p=>{
    const sold = DB.invoices.flatMap(i=>i.lines).filter(l=>l.pid===p.id).reduce((s,l)=>s+l.qty,0);
    return {...p, sold};
  }).sort((a,b)=>b.sold-a.sold).slice(0,5);

  const recent = DB.invoices.slice(0,6);

  return `
    <div class="page-head">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-sub">Saturday, 5 September 2026 — here's where sales stand today.</div>
      </div>
      <div class="head-actions">
        <button class="btn" onclick="goTo('quotes')">New Quote</button>
        <button class="btn btn-primary" onclick="openNewSaleModal()">+ New Sale</button>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Sales Today</div>
        <div class="kpi-value">${fmtShort(salesToday)}</div>
        <div class="kpi-note">${todayInvoices.length} invoice${todayInvoices.length===1?'':'s'} issued</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Sales This Month</div>
        <div class="kpi-value">${fmtShort(salesMonth)}</div>
        <div class="kpi-note">${monthInvoices.length} invoices total</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Outstanding Invoices</div>
        <div class="kpi-value">${fmtShort(outstanding)}</div>
        <div class="kpi-note ${outstanding>0?'warn':''}">${DB.invoices.filter(i=>i.status!=='Paid').length} unpaid or partial</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Payments Received</div>
        <div class="kpi-value">${fmtShort(paymentsReceived)}</div>
        <div class="kpi-note">${DB.payments.length} payments logged</div>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">Quotes</div>
        <div class="kpi-value">${DB.quotes.length}</div>
        <div class="kpi-note">${DB.quotes.filter(q=>q.status==='Draft'||q.status==='Sent').length} awaiting response</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Sales Orders</div>
        <div class="kpi-value">${DB.orders.length}</div>
        <div class="kpi-note">${pendingOrders} pending fulfilment</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Invoices</div>
        <div class="kpi-value">${DB.invoices.length}</div>
        <div class="kpi-note">${DB.invoices.filter(i=>daysOverdue(i)>0).length} overdue</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Low-stock Alerts</div>
        <div class="kpi-value">${lowStock.length}</div>
        <div class="kpi-note ${lowStock.length?'warn':''}">${lowStock.length? 'Needs reordering' : 'All items healthy'}</div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-head"><h3>Recent Sales</h3><span class="row-link" onclick="goTo('invoices')">View all invoices</span></div>
        <div class="card-body flush table-scroll">
          <table>
            <thead><tr><th>Customer</th><th>Invoice</th><th>Date</th><th class="num">Total</th><th>Status</th></tr></thead>
            <tbody>
              ${recent.length? recent.map(i=>`
                <tr>
                  <td>${custName(i.custId)}</td>
                  <td><span class="row-link" onclick="openInvoiceDetail('${i.id}')">${i.id}</span></td>
                  <td>${i.date}</td>
                  <td class="num">${fmt(i.total)}</td>
                  <td>${statusPill(i.status)}</td>
                </tr>`).join('') : `<tr class="empty-row"><td colspan="5">No invoices yet — sales you record will show up here.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-head"><h3>Top-selling Products</h3></div>
          <div class="card-body flush table-scroll">
            <table>
              <thead><tr><th>Product</th><th class="num">Units sold</th></tr></thead>
              <tbody>
                ${topProducts.length? topProducts.map(p=>`<tr><td>${p.name}</td><td class="num">${p.sold}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="2">No sales recorded yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Low-stock Alerts</h3><span class="row-link" onclick="goTo('products')">View products</span></div>
          <div class="card-body flush table-scroll">
            <table>
              <thead><tr><th>Product</th><th class="num">In stock</th><th class="num">Reorder at</th></tr></thead>
              <tbody>
                ${lowStock.length? lowStock.map(p=>`
                  <tr><td>${p.name}</td><td class="num">${p.stock}</td><td class="num">${p.reorder}</td></tr>`).join('')
                  : `<tr class="empty-row"><td colspan="3">Every product is above its reorder level.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function statusPill(status){
  const map = {
    'Draft':'pill-gray','Sent':'pill-blue','Accepted':'pill-green','Rejected':'pill-red',
    'Pending':'pill-gray','Confirmed':'pill-blue','Packed':'pill-gold','Delivered':'pill-green','Cancelled':'pill-red',
    'Partially Paid':'pill-gold','Paid':'pill-green','Overdue':'pill-red'
  };
  let label = status;
  return `<span class="pill ${map[status]||'pill-gray'}">${label}</span>`;
}

/* =====================================================================
   CUSTOMERS
===================================================================== */
function renderCustomers(){
  const q = (pageState.search||'').toLowerCase();
  const rows = DB.customers.filter(c => !q || c.name.toLowerCase().includes(q) || c.contact.toLowerCase().includes(q));
  return `
    <div class="page-head">
      <div><div class="page-title">Customers</div><div class="page-sub">${DB.customers.length} customers on file</div></div>
      <div class="head-actions"><button class="btn btn-primary" onclick="openCustomerModal()">+ Add Customer</button></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="toolbar-search">&#128269;<input type="text" placeholder="Search customers…" value="${pageState.search||''}" oninput="pageState.search=this.value; renderPage();"></div>
      </div>
      <div class="card-body flush table-scroll">
        <table>
          <thead><tr><th>Customer</th><th>Contact</th><th>Phone</th><th>Location</th><th class="num">Credit limit</th><th class="num">Balance</th><th></th></tr></thead>
          <tbody>
            ${rows.length? rows.map(c=>`
              <tr>
                <td><span class="row-link" onclick="openCustomerDetail('${c.id}')">${c.name}</span></td>
                <td>${c.contact}</td>
                <td>${c.phone}</td>
                <td>${c.location}</td>
                <td class="num">${fmt(c.credit)}</td>
                <td class="num">${c.balance>0? fmt(c.balance) : '—'}</td>
                <td><button class="icon-btn" onclick="openCustomerModal('${c.id}')" title="Edit">&#9998;</button></td>
              </tr>`).join('') : `<tr class="empty-row"><td colspan="7">No customers match your search.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
function openCustomerModal(id){
  const c = id ? DB.customers.find(x=>x.id===id) : null;
  showModal(`
    <div class="modal-head"><h3>${c?'Edit Customer':'Add Customer'}</h3><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="field"><label>Business / Customer Name</label><input type="text" id="f_name" value="${c?c.name:''}"></div>
        <div class="field"><label>Contact Person</label><input type="text" id="f_contact" value="${c?c.contact:''}"></div>
        <div class="field"><label>Phone</label><input type="text" id="f_phone" value="${c?c.phone:''}"></div>
        <div class="field"><label>Email</label><input type="text" id="f_email" value="${c?c.email:''}"></div>
        <div class="field"><label>Location</label><input type="text" id="f_location" value="${c?c.location:''}"></div>
        <div class="field"><label>Credit Limit (KES)</label><input type="number" id="f_credit" value="${c?c.credit:0}"></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCustomer('${c?c.id:''}')">${c?'Save changes':'Add customer'}</button>
    </div>
  `);
}
function saveCustomer(id){
  const name = document.getElementById('f_name').value.trim();
  if(!name){ toast('Customer name is required.'); return; }
  const data = {
    name,
    contact: document.getElementById('f_contact').value.trim(),
    phone: document.getElementById('f_phone').value.trim(),
    email: document.getElementById('f_email').value.trim(),
    location: document.getElementById('f_location').value.trim(),
    credit: Number(document.getElementById('f_credit').value)||0
  };
  if(id){
    Object.assign(DB.customers.find(c=>c.id===id), data);
    toast('Customer updated.');
  } else {
    DB.seq.cust++;
    DB.customers.unshift({id:'C-'+DB.seq.cust, balance:0, ...data});
    toast('Customer added.');
  }
  closeModal(); renderPage();
}
function openCustomerDetail(id){
  const c = DB.customers.find(x=>x.id===id);
  const invs = DB.invoices.filter(i=>i.custId===id);
  const pays = DB.payments.filter(p=>p.custId===id);
  showModal(`
    <div class="modal-head"><h3>${c.name}</h3><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <div><span class="subtle">Contact</span><div>${c.contact} · ${c.phone}</div></div>
        <div><span class="subtle">Location</span><div>${c.location}</div></div>
        <div><span class="subtle">Credit limit</span><div>${fmt(c.credit)}</div></div>
        <div><span class="subtle">Outstanding balance</span><div style="color:${c.balance>0?'var(--red-600)':'var(--green-700)'}; font-weight:700;">${fmt(c.balance)}</div></div>
      </div>
      <div class="divider"></div>
      <h4 style="margin:0 0 8px 0; color:var(--green-900); font-size:14px;">Customer Statement</h4>
      <div class="table-scroll">
      <table>
        <thead><tr><th>Invoice</th><th>Date</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th></tr></thead>
        <tbody>
          ${invs.length? invs.map(i=>`
            <tr>
              <td><span class="row-link" onclick="closeModal(); openInvoiceDetail('${i.id}')">${i.id}</span></td>
              <td>${i.date}</td><td class="num">${fmt(i.total)}</td><td class="num">${fmt(i.paid)}</td>
              <td class="num">${fmt(i.total-i.paid)}</td><td>${statusPill(i.status)}</td>
            </tr>`).join('') : `<tr class="empty-row"><td colspan="6">No transactions yet.</td></tr>`}
        </tbody>
      </table>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" onclick="closeModal(); openCustomerModal('${c.id}')">Edit customer</button>
    </div>
  `, 'wide');
}

/* =====================================================================
   PRODUCTS
===================================================================== */
function renderProducts(){
  const q = (pageState.search||'').toLowerCase();
  const rows = DB.products.filter(p => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  return `
    <div class="page-head">
      <div><div class="page-title">Products</div><div class="page-sub">${DB.products.length} items in the catalogue</div></div>
      <div class="head-actions"><button class="btn btn-primary" onclick="openProductModal()">+ Add Product</button></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="toolbar-search">&#128269;<input type="text" placeholder="Search by name or SKU…" value="${pageState.search||''}" oninput="pageState.search=this.value; renderPage();"></div>
      </div>
      <div class="card-body flush table-scroll">
        <table>
          <thead><tr><th>Product</th><th>SKU</th><th class="num">Price</th><th class="num">VAT</th><th class="num">Stock</th><th></th></tr></thead>
          <tbody>
          ${rows.length? rows.map(p=>`
            <tr>
              <td>${p.name}</td>
              <td>${p.sku}</td>
              <td class="num">${fmt(p.price)}</td>
              <td class="num">${p.vat}%</td>
              <td class="num" style="color:${p.stock<=p.reorder?'var(--red-600)':'inherit'}; font-weight:${p.stock<=p.reorder?'700':'400'};">${p.stock} ${p.unit}${p.stock<=p.reorder?' ⚠':''}</td>
              <td><button class="icon-btn" onclick="openProductModal('${p.id}')" title="Edit">&#9998;</button></td>
            </tr>`).join('') : `<tr class="empty-row"><td colspan="6">No products match your search.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
function openProductModal(id){
  const p = id ? DB.products.find(x=>x.id===id) : null;
  showModal(`
    <div class="modal-head"><h3>${p?'Edit Product':'Add Product'}</h3><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <div class="field"><label>Product Name</label><input type="text" id="f_name" value="${p?p.name:''}"></div>
        <div class="field"><label>SKU</label><input type="text" id="f_sku" value="${p?p.sku:''}"></div>
        <div class="field"><label>Selling Price (KES)</label><input type="number" id="f_price" value="${p?p.price:0}"></div>
        <div class="field"><label>VAT / Tax (%)</label><input type="number" id="f_vat" value="${p?p.vat:16}"></div>
        <div class="field"><label>Available Stock</label><input type="number" id="f_stock" value="${p?p.stock:0}"></div>
        <div class="field"><label>Reorder Level</label><input type="number" id="f_reorder" value="${p?p.reorder:10}"></div>
        <div class="field"><label>Unit</label><input type="text" id="f_unit" value="${p?p.unit:'piece'}"></div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveProduct('${p?p.id:''}')">${p?'Save changes':'Add product'}</button>
    </div>
  `);
}
function saveProduct(id){
  const name = document.getElementById('f_name').value.trim();
  if(!name){ toast('Product name is required.'); return; }
  const data = {
    name, sku: document.getElementById('f_sku').value.trim() || 'AC-'+Math.floor(Math.random()*9000+1000),
    price: Number(document.getElementById('f_price').value)||0,
    vat: Number(document.getElementById('f_vat').value)||0,
    stock: Number(document.getElementById('f_stock').value)||0,
    reorder: Number(document.getElementById('f_reorder').value)||0,
    unit: document.getElementById('f_unit').value.trim()||'piece'
  };
  if(id){ Object.assign(DB.products.find(p=>p.id===id), data); toast('Product updated.'); }
  else { DB.seq.prod++; DB.products.unshift({id:'P-'+DB.seq.prod, ...data}); toast('Product added.'); }
  closeModal(); renderPage();
}

/* =====================================================================
   LINE-ITEM EDITOR (shared by Quote / Order-as-quote / New Sale)
===================================================================== */
let editorLines = [];
function lineEditorHTML(){
  const rows = editorLines.map((l,idx)=>{
    const p = DB.products.find(pp=>pp.id===l.pid);
    const total = lineTotal(l);
    return `
      <tr>
        <td style="min-width:170px;">
          <select onchange="editorLines[${idx}].pid=this.value; editorLines[${idx}].price=DB.products.find(p=>p.id===this.value).price; refreshEditor();">
            ${DB.products.map(pp=>`<option value="${pp.id}" ${pp.id===l.pid?'selected':''}>${pp.name}</option>`).join('')}
          </select>
        </td>
        <td style="width:80px;"><input type="number" min="1" value="${l.qty}" onchange="editorLines[${idx}].qty=Number(this.value)||1; refreshEditor();"></td>
        <td style="width:110px;"><input type="number" value="${l.price}" onchange="editorLines[${idx}].price=Number(this.value)||0; refreshEditor();"></td>
        <td style="width:80px;"><input type="number" value="${l.disc||0}" onchange="editorLines[${idx}].disc=Number(this.value)||0; refreshEditor();"></td>
        <td class="num" style="width:110px;">${fmt(total)}</td>
        <td style="width:34px;"><button class="icon-btn" onclick="editorLines.splice(${idx},1); refreshEditor();">&#10005;</button></td>
      </tr>`;
  }).join('');
  const t = computeTotals(editorLines);
  return `
    <div class="table-scroll">
    <table class="li-table">
      <thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Disc %</th><th class="num">Total</th><th></th></tr></thead>
      <tbody id="editorRows">
        ${rows || `<tr class="empty-row"><td colspan="6">Add a product line to begin.</td></tr>`}
        <tr class="li-total-row"><td colspan="4">Subtotal</td><td class="num">${fmt(t.subtotal)}</td><td></td></tr>
        <tr><td colspan="4" class="subtle">Discount</td><td class="num subtle">- ${fmt(t.discountTotal)}</td><td></td></tr>
        <tr><td colspan="4" class="subtle">VAT</td><td class="num subtle">+ ${fmt(t.vat)}</td><td></td></tr>
        <tr class="li-total-row"><td colspan="4">Grand Total</td><td class="num">${fmt(t.grand)}</td><td></td></tr>
      </tbody>
    </table>
    </div>
    <button class="btn btn-sm add-line-btn" onclick="editorLines.push({pid:DB.products[0].id, qty:1, price:DB.products[0].price, disc:0}); refreshEditor();">+ Add line</button>
  `;
}
function refreshEditor(){
  const el = document.getElementById('lineEditorHost');
  if(el) el.innerHTML = lineEditorHTML();
}

/* =====================================================================
   QUOTES
===================================================================== */
function renderQuotes(){
  const tab = pageState.tab || 'All';
  const tabs = ['All','Draft','Sent','Accepted','Rejected'];
  const rows = DB.quotes.filter(q=> tab==='All' || q.status===tab);
  return `
    <div class="page-head">
      <div><div class="page-title">Quotes</div><div class="page-sub">Prepare and send price quotes to customers</div></div>
      <div class="head-actions"><button class="btn btn-primary" onclick="openQuoteModal()">+ New Quote</button></div>
    </div>
    <div class="card">
      <div class="tabbar">
        ${tabs.map(t=>`<div class="tab ${tab===t?'active':''}" onclick="pageState.tab='${t}'; renderPage();">${t}<span class="count">${t==='All'?DB.quotes.length:DB.quotes.filter(q=>q.status===t).length}</span></div>`).join('')}
      </div>
      <div class="card-body flush table-scroll">
        <table>
          <thead><tr><th>Quote</th><th>Customer</th><th>Date</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
          ${rows.length? rows.map(q=>`
            <tr>
              <td><span class="row-link" onclick="openQuoteDetail('${q.id}')">${q.id}</span></td>
              <td>${custName(q.custId)}</td>
              <td>${q.date}</td>
              <td class="num">${fmt(q.total)}</td>
              <td>${statusPill(q.status)}</td>
              <td>
                ${!q.converted.order ? `<button class="btn btn-sm" onclick="convertQuoteToOrder('${q.id}'); renderPage();">Convert → Order</button>` : `<span class="subtle">→ ${q.converted.order}</span>`}
              </td>
            </tr>`).join('') : `<tr class="empty-row"><td colspan="6">No quotes in this view.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
function openQuoteModal(){
  if(!DB.products.length){ toast('Add a product before creating a quote.'); goTo('products'); return; }
  if(!DB.customers.length){ toast('Add a customer before creating a quote.'); goTo('customers'); return; }
  editorLines = [{pid:DB.products[0].id, qty:1, price:DB.products[0].price, disc:0}];
  showModal(`
    <div class="modal-head"><h3>New Quote</h3><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="field"><label>Customer</label>
        <select id="f_cust">${DB.customers.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select>
      </div>
      <div id="lineEditorHost">${lineEditorHTML()}</div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveQuote('Draft')">Save as Draft</button>
      <button class="btn btn-primary" onclick="saveQuote('Sent')">Save &amp; Send</button>
    </div>
  `, 'wide');
}
function saveQuote(status){
  if(!editorLines.length){ toast('Add at least one product line.'); return; }
  const custId = document.getElementById('f_cust').value;
  const q = makeQuote(custId, editorLines.map(l=>({...l})), status);
  closeModal(); toast('Quote '+q.id+' created.'); goTo('quotes');
}
function openQuoteDetail(id){
  const q = DB.quotes.find(x=>x.id===id);
  const t = computeTotals(q.lines);
  showModal(`
    <div class="modal-head"><h3>${q.id}</h3><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      ${flowStrip('quote', q)}
      <div class="form-grid">
        <div><span class="subtle">Customer</span><div>${custName(q.custId)}</div></div>
        <div><span class="subtle">Date</span><div>${q.date}</div></div>
      </div>
      <div class="divider"></div>
      <div class="table-scroll">
      <table>
        <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Disc</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${q.lines.map(l=>`<tr><td>${prodName(l.pid)}</td><td class="num">${l.qty}</td><td class="num">${fmt(l.price)}</td><td class="num">${l.disc||0}%</td><td class="num">${fmt(lineTotal(l))}</td></tr>`).join('')}
          <tr class="li-total-row"><td colspan="4">Grand Total</td><td class="num">${fmt(t.grand)}</td></tr>
        </tbody>
      </table>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Close</button>
      ${q.status==='Draft' ? `<button class="btn" onclick="q.status='Sent'; closeModal(); renderPage();">Mark as Sent</button>`:''}
      ${!q.converted.order ? `<button class="btn btn-primary" onclick="convertQuoteToOrder('${q.id}'); closeModal(); renderPage();">Convert to Order</button>` : `<button class="btn btn-primary" onclick="closeModal(); openOrderDetail('${q.converted.order}')">View Order ${q.converted.order}</button>`}
    </div>
  `, 'wide');
}
function flowStrip(stage, obj){
  const nodes = [
    {k:'quote', l:'Quote'}, {k:'order', l:'Order'}, {k:'invoice', l:'Invoice'}, {k:'payment', l:'Payment'}
  ];
  let reached = {quote:true, order:false, invoice:false, payment:false};
  if(stage==='quote'){ reached.order = !!obj.converted.order; }
  if(stage==='order'){ reached.order=true; reached.invoice = !!obj.converted.invoice; }
  if(stage==='invoice'){ reached.order=true; reached.invoice=true; reached.payment = obj.paid>0; }
  return `<div class="flow-strip">${nodes.map((n,i)=>`
    ${i>0?'<span class="arrow">&#8594;</span>':''}
    <span class="node ${reached[n.k] && (n.k===stage) ? 'here':''} ${reached[n.k] && n.k!==stage ? '':''}">${n.l}</span>
  `).join('')}</div>`;
}

/* =====================================================================
   SALES ORDERS
===================================================================== */
function renderOrders(){
  const tab = pageState.tab || 'All';
  const tabs = ['All','Pending','Confirmed','Packed','Delivered','Cancelled'];
  const rows = DB.orders.filter(o=> tab==='All' || o.status===tab);
  return `
    <div class="page-head">
      <div><div class="page-title">Orders</div><div class="page-sub">Track orders through fulfilment to invoicing</div></div>
    </div>
    <div class="card">
      <div class="tabbar">
        ${tabs.map(t=>`<div class="tab ${tab===t?'active':''}" onclick="pageState.tab='${t}'; renderPage();">${t}<span class="count">${t==='All'?DB.orders.length:DB.orders.filter(o=>o.status===t).length}</span></div>`).join('')}
      </div>
      <div class="card-body flush table-scroll">
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Date</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
          <tbody>
          ${rows.length? rows.map(o=>`
            <tr>
              <td><span class="row-link" onclick="openOrderDetail('${o.id}')">${o.id}</span></td>
              <td>${custName(o.custId)}</td>
              <td>${o.date}</td>
              <td class="num">${fmt(o.total)}</td>
              <td>${statusPill(o.status)}</td>
              <td>
                ${!o.converted.invoice ? `<button class="btn btn-sm" onclick="convertOrderToInvoice('${o.id}'); renderPage();">Convert → Invoice</button>` : `<span class="subtle">→ ${o.converted.invoice}</span>`}
              </td>
            </tr>`).join('') : `<tr class="empty-row"><td colspan="6">No orders in this view.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
function openOrderDetail(id){
  const o = DB.orders.find(x=>x.id===id);
  const t = computeTotals(o.lines);
  showModal(`
    <div class="modal-head"><h3>${o.id}</h3><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      ${flowStrip('order', o)}
      <div class="form-grid">
        <div><span class="subtle">Customer</span><div>${custName(o.custId)}</div></div>
        <div><span class="subtle">Order date</span><div>${o.date}</div></div>
        <div><span class="subtle">From quote</span><div>${o.quoteId || '—'}</div></div>
        <div><span class="subtle">Status</span><div>
          <select onchange="o.status=this.value; renderPage();" style="width:auto; display:inline-block;">
            ${['Pending','Confirmed','Packed','Delivered','Cancelled'].map(s=>`<option ${o.status===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div></div>
      </div>
      <div class="divider"></div>
      <div class="table-scroll">
      <table>
        <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${o.lines.map(l=>`<tr><td>${prodName(l.pid)}</td><td class="num">${l.qty}</td><td class="num">${fmt(l.price)}</td><td class="num">${fmt(lineTotal(l))}</td></tr>`).join('')}
          <tr class="li-total-row"><td colspan="3">Grand Total</td><td class="num">${fmt(t.grand)}</td></tr>
        </tbody>
      </table>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Close</button>
      ${!o.converted.invoice ? `<button class="btn btn-primary" onclick="convertOrderToInvoice('${o.id}'); closeModal(); renderPage();">Convert to Invoice</button>` : `<button class="btn btn-primary" onclick="closeModal(); openInvoiceDetail('${o.converted.invoice}')">View Invoice ${o.converted.invoice}</button>`}
    </div>
  `, 'wide');
}

/* =====================================================================
   INVOICES
===================================================================== */
function renderInvoices(){
  const tab = pageState.tab || 'All';
  const tabs = ['All','Draft','Sent','Partially Paid','Paid','Overdue','Cancelled'];
  const rows = DB.invoices.filter(i=>{
    if(tab==='All') return true;
    if(tab==='Overdue') return daysOverdue(i)>0;
    return i.status===tab;
  });
  return `
    <div class="page-head">
      <div><div class="page-title">Invoices</div><div class="page-sub">Bill customers and track what's owed</div></div>
      <div class="head-actions"><button class="btn" onclick="goTo('orders')">From an Order</button><button class="btn btn-primary" onclick="openNewSaleModal()">+ New Invoice</button></div>
    </div>
    <div class="card">
      <div class="tabbar">
        ${tabs.map(t=>{
          const count = t==='All'? DB.invoices.length : t==='Overdue'? DB.invoices.filter(i=>daysOverdue(i)>0).length : DB.invoices.filter(i=>i.status===t).length;
          return `<div class="tab ${tab===t?'active':''}" onclick="pageState.tab='${t}'; renderPage();">${t}<span class="count">${count}</span></div>`;
        }).join('')}
      </div>
      <div class="card-body flush table-scroll">
        <table>
          <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th>Due</th><th class="num">Total</th><th class="num">Balance</th><th>Status</th><th></th></tr></thead>
          <tbody>
          ${rows.length? rows.map(i=>`
            <tr>
              <td><span class="row-link" onclick="openInvoiceDetail('${i.id}')">${i.id}</span></td>
              <td>${custName(i.custId)}</td>
              <td>${i.date}</td>
              <td>${i.dueDate}${daysOverdue(i)>0?` <span class="subtle">(${daysOverdue(i)}d overdue)</span>`:''}</td>
              <td class="num">${fmt(i.total)}</td>
              <td class="num">${fmt(i.total-i.paid)}</td>
              <td>${statusPill(daysOverdue(i)>0 && i.status!=='Paid' ? 'Overdue' : i.status)}</td>
              <td>${i.status!=='Paid' ? `<button class="btn btn-sm btn-gold" onclick="openPaymentModal('${i.id}')">Receive Payment</button>` : `<span class="subtle">Settled</span>`}</td>
            </tr>`).join('') : `<tr class="empty-row"><td colspan="8">No invoices in this view.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
function openInvoiceDetail(id){
  const i = DB.invoices.find(x=>x.id===id);
  const pays = DB.payments.filter(p=>p.invoiceId===id);
  showModal(`
    <div class="modal-head"><h3>${i.id}</h3><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      ${flowStrip('invoice', i)}
      <div class="form-grid">
        <div><span class="subtle">Customer</span><div>${custName(i.custId)}</div></div>
        <div><span class="subtle">Order</span><div>${i.orderId||'—'}</div></div>
        <div><span class="subtle">Date</span><div>${i.date}</div></div>
        <div><span class="subtle">Due</span><div>${i.dueDate}</div></div>
      </div>
      <div class="divider"></div>
      <div class="table-scroll">
      <table>
        <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
        <tbody>
          ${i.lines.map(l=>`<tr><td>${prodName(l.pid)}</td><td class="num">${l.qty}</td><td class="num">${fmt(l.price)}</td><td class="num">${fmt(lineTotal(l))}</td></tr>`).join('')}
          <tr><td colspan="3">Subtotal</td><td class="num">${fmt(i.subtotal)}</td></tr>
          <tr><td colspan="3" class="subtle">Discount</td><td class="num subtle">- ${fmt(i.discount)}</td></tr>
          <tr><td colspan="3" class="subtle">VAT</td><td class="num subtle">+ ${fmt(i.vat)}</td></tr>
          <tr class="li-total-row"><td colspan="3">Grand Total</td><td class="num">${fmt(i.total)}</td></tr>
          <tr><td colspan="3">Amount Paid</td><td class="num" style="color:var(--green-700);">${fmt(i.paid)}</td></tr>
          <tr class="li-total-row"><td colspan="3">Balance Due</td><td class="num" style="color:${i.total-i.paid>0?'var(--red-600)':'var(--green-700)'};">${fmt(i.total-i.paid)}</td></tr>
        </tbody>
      </table>
      </div>
      ${pays.length? `
        <div class="divider"></div>
        <h4 style="margin:0 0 8px 0; color:var(--green-900); font-size:14px;">Payments against this invoice</h4>
        <div class="table-scroll"><table>
          <thead><tr><th>Payment</th><th>Date</th><th>Method</th><th class="num">Amount</th></tr></thead>
          <tbody>${pays.map(p=>`<tr><td>${p.id}</td><td>${p.date}</td><td>${p.method}</td><td class="num">${fmt(p.amount)}</td></tr>`).join('')}</tbody>
        </table></div>` : ''}
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Close</button>
      <button class="btn" onclick="closeModal(); openReturnModal('${i.id}')">Create Return / Credit Note</button>
      ${i.status!=='Paid' ? `<button class="btn btn-primary" onclick="closeModal(); openPaymentModal('${i.id}')">Receive Payment</button>`:''}
    </div>
  `, 'wide');
}
function openPaymentModal(invoiceId){
  const i = DB.invoices.find(x=>x.id===invoiceId);
  const balance = i.total - i.paid;
  showModal(`
    <div class="modal-head"><h3>Receive Payment — ${i.id}</h3><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-grid">
        <div><span class="subtle">Customer</span><div>${custName(i.custId)}</div></div>
        <div><span class="subtle">Balance due</span><div style="font-weight:700;">${fmt(balance)}</div></div>
      </div>
      <div class="divider"></div>
      <div class="form-grid">
        <div class="field"><label>Amount Received (KES)</label><input type="number" id="f_amount" value="${balance}" max="${balance}"></div>
        <div class="field"><label>Payment Method</label>
          <select id="f_method">
            <option>Cash</option><option>M-Pesa</option><option>Bank Transfer</option><option>Cheque</option><option>Card</option>
          </select>
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitPayment('${i.id}')">Record Payment &amp; Print Receipt</button>
    </div>
  `);
}
function submitPayment(invoiceId){
  const amount = Number(document.getElementById('f_amount').value)||0;
  const method = document.getElementById('f_method').value;
  if(amount<=0){ toast('Enter an amount greater than zero.'); return; }
  const p = recordPayment(invoiceId, amount, method);
  closeModal();
  if(p) openReceipt(p.id);
  renderPage();
}
function openReceipt(paymentId){
  const p = DB.payments.find(x=>x.id===paymentId);
  const i = DB.invoices.find(x=>x.id===p.invoiceId);
  showModal(`
    <div class="modal-head"><h3>Receipt — ${p.id}</h3><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div style="text-align:center; margin-bottom:14px;">
        <div style="font-size:18px; font-weight:700; color:var(--green-900);">Acacia Sell</div>
        <div class="subtle">Official Payment Receipt</div>
      </div>
      <div class="divider"></div>
      <div class="form-grid">
        <div><span class="subtle">Received from</span><div>${custName(i.custId)}</div></div>
        <div><span class="subtle">Date</span><div>${p.date}</div></div>
        <div><span class="subtle">Against invoice</span><div>${i.id}</div></div>
        <div><span class="subtle">Method</span><div>${p.method}</div></div>
      </div>
      <div class="divider"></div>
      <div style="text-align:center; padding:14px 0;">
        <div class="subtle">Amount Received</div>
        <div style="font-size:26px; font-weight:700; color:var(--green-900);">${fmt(p.amount)}</div>
      </div>
      <div class="divider"></div>
      <div class="subtle">Remaining balance on ${i.id}: <strong style="color:var(--ink-900);">${fmt(i.total-i.paid)}</strong></div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" onclick="window.print()">Print</button>
    </div>
  `);
}

/* =====================================================================
   NEW SALE — fast path (Customer → Product → Qty → Price → Discount → VAT → Total → Payment)
===================================================================== */
function openNewSaleModal(){
  if(!DB.products.length){ toast('Add a product before recording a sale.'); goTo('products'); return; }
  if(!DB.customers.length){ toast('Add a customer before recording a sale.'); goTo('customers'); return; }
  editorLines = [{pid:DB.products[0].id, qty:1, price:DB.products[0].price, disc:0}];
  showModal(`
    <div class="modal-head"><h3>New Sale</h3><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="field"><label>Customer</label>
        <select id="f_cust">${DB.customers.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select>
      </div>
      <div id="lineEditorHost">${lineEditorHTML()}</div>
      <div class="divider"></div>
      <div class="field"><label>Amount Paid Now (KES) — leave 0 to invoice only</label><input type="number" id="f_paidnow" value="0"></div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitNewSale()">Save &amp; Create Invoice</button>
    </div>
  `, 'wide');
}
function submitNewSale(){
  if(!editorLines.length){ toast('Add at least one product line.'); return; }
  const custId = document.getElementById('f_cust').value;
  const paidNow = Number(document.getElementById('f_paidnow').value)||0;
  const q = makeQuote(custId, editorLines.map(l=>({...l})), 'Accepted');
  const o = convertQuoteToOrder(q.id, {silent:true});
  const inv = convertOrderToInvoice(o.id, {silent:true});
  closeModal();
  if(paidNow>0){
    const p = recordPayment(inv.id, paidNow, 'Cash', {silent:true});
    toast('Sale saved. Invoice '+inv.id+' created.');
    if(p) { openReceipt(p.id); return; }
  } else {
    toast('Sale saved. Invoice '+inv.id+' created.');
  }
  goTo('invoices');
}

/* =====================================================================
   PAYMENTS
===================================================================== */
function renderPayments(){
  const q = (pageState.search||'').toLowerCase();
  const rows = DB.payments.filter(p=> !q || custName(p.custId).toLowerCase().includes(q) || p.invoiceId.toLowerCase().includes(q));
  const total = DB.payments.reduce((s,p)=>s+p.amount,0);
  return `
    <div class="page-head">
      <div><div class="page-title">Receipts</div><div class="page-sub">${DB.payments.length} payments · ${fmt(total)} received in total</div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="toolbar-search">&#128269;<input type="text" placeholder="Search by customer or invoice…" value="${pageState.search||''}" oninput="pageState.search=this.value; renderPage();"></div>
      </div>
      <div class="card-body flush table-scroll">
        <table>
          <thead><tr><th>Payment</th><th>Customer</th><th>Invoice</th><th>Date</th><th>Method</th><th class="num">Amount</th><th></th></tr></thead>
          <tbody>
          ${rows.length? rows.map(p=>`
            <tr>
              <td>${p.id}</td>
              <td>${custName(p.custId)}</td>
              <td><span class="row-link" onclick="openInvoiceDetail('${p.invoiceId}')">${p.invoiceId}</span></td>
              <td>${p.date}</td>
              <td>${p.method}</td>
              <td class="num">${fmt(p.amount)}</td>
              <td><button class="btn btn-sm" onclick="openReceipt('${p.id}')">Receipt</button></td>
            </tr>`).join('') : `<tr class="empty-row"><td colspan="7">No payments recorded yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* =====================================================================
   SALES RETURNS
===================================================================== */
function renderReturns(){
  return `
    <div class="page-head">
      <div><div class="page-title">Sales Returns</div><div class="page-sub">Customer returns and credit notes</div></div>
    </div>
    <div class="card">
      <div class="card-body flush table-scroll">
        <table>
          <thead><tr><th>Return</th><th>Customer</th><th>Invoice</th><th>Date</th><th>Reason</th><th class="num">Amount</th></tr></thead>
          <tbody>
          ${DB.returns.length? DB.returns.map(r=>`
            <tr>
              <td>${r.id}</td>
              <td>${custName(r.custId)}</td>
              <td><span class="row-link" onclick="openInvoiceDetail('${r.invoiceId}')">${r.invoiceId}</span></td>
              <td>${r.date}</td>
              <td>${r.reason||'—'}</td>
              <td class="num">${fmt(r.amount)}</td>
            </tr>`).join('') : `<tr class="empty-row"><td colspan="6">No returns recorded yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
let returnLines = [];
function openReturnModal(invoiceId){
  const i = DB.invoices.find(x=>x.id===invoiceId);
  returnLines = i.lines.map(l=>({...l, maxQty:l.qty, qty:0}));
  showModal(`
    <div class="modal-head"><h3>Return against ${i.id}</h3><button class="close-x" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="table-scroll">
      <table class="li-table">
        <thead><tr><th>Product</th><th>Originally sold</th><th>Return qty</th><th class="num">Price</th></tr></thead>
        <tbody>
          ${returnLines.map((l,idx)=>`
            <tr>
              <td>${prodName(l.pid)}</td>
              <td class="num">${l.maxQty}</td>
              <td style="width:90px;"><input type="number" min="0" max="${l.maxQty}" value="0" onchange="returnLines[${idx}].qty=Math.min(Number(this.value)||0, ${l.maxQty});"></td>
              <td class="num">${fmt(l.price)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>
      <div class="field" style="margin-top:14px;"><label>Reason</label><input type="text" id="f_reason" placeholder="e.g. damaged in transit, wrong item"></div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitReturn('${i.id}')">Save Return &amp; Issue Credit Note</button>
    </div>
  `, 'wide');
}
function submitReturn(invoiceId){
  const lines = returnLines.filter(l=>l.qty>0).map(l=>({pid:l.pid, qty:l.qty, price:l.price}));
  if(!lines.length){ toast('Enter a return quantity for at least one item.'); return; }
  const reason = document.getElementById('f_reason').value.trim();
  const r = makeReturn(invoiceId, lines, reason);
  closeModal();
  toast('Return '+r.id+' saved — '+fmt(r.amount)+' credit note issued.');
  renderPage();
}

/* =====================================================================
   REPORTS
===================================================================== */
function renderReports(){
  const byCustomer = DB.customers.map(c=>{
    const invs = DB.invoices.filter(i=>i.custId===c.id);
    return { name:c.name, count:invs.length, total: invs.reduce((s,i)=>s+i.total,0) };
  }).filter(r=>r.count>0).sort((a,b)=>b.total-a.total);

  const byProduct = DB.products.map(p=>{
    const lines = DB.invoices.flatMap(i=>i.lines).filter(l=>l.pid===p.id);
    const qty = lines.reduce((s,l)=>s+l.qty,0);
    const revenue = lines.reduce((s,l)=>s+lineTotal(l),0);
    return { name:p.name, qty, revenue };
  }).filter(r=>r.qty>0).sort((a,b)=>b.revenue-a.revenue);

  const totalSales = DB.invoices.reduce((s,i)=>s+i.total,0);
  const totalVat = DB.invoices.reduce((s,i)=>s+i.vat,0);
  const totalReceivable = DB.invoices.reduce((s,i)=>s+(i.total-i.paid),0);
  const estCost = DB.invoices.flatMap(i=>i.lines).reduce((s,l)=>s+l.qty*l.price*0.68,0); // illustrative COGS estimate
  const margin = totalSales - estCost;

  return `
    <div class="page-head">
      <div><div class="page-title">Reports</div><div class="page-sub">Sales performance at a glance</div></div>
    </div>
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-label">Total Sales</div><div class="kpi-value">${fmtShort(totalSales)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Outstanding Receivables</div><div class="kpi-value">${fmtShort(totalReceivable)}</div></div>
      <div class="kpi-card"><div class="kpi-label">VAT Collected</div><div class="kpi-value">${fmtShort(totalVat)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Est. Gross Margin</div><div class="kpi-value">${fmtShort(margin)}</div><div class="kpi-note">${totalSales? Math.round(margin/totalSales*100):0}% of sales</div></div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-head"><h3>Sales by Customer</h3></div>
        <div class="card-body flush table-scroll">
          <table>
            <thead><tr><th>Customer</th><th class="num">Invoices</th><th class="num">Total Sales</th></tr></thead>
            <tbody>${byCustomer.length? byCustomer.map(r=>`<tr><td>${r.name}</td><td class="num">${r.count}</td><td class="num">${fmt(r.total)}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="3">No sales recorded yet.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Sales by Product</h3></div>
        <div class="card-body flush table-scroll">
          <table>
            <thead><tr><th>Product</th><th class="num">Units</th><th class="num">Revenue</th></tr></thead>
            <tbody>${byProduct.length? byProduct.map(r=>`<tr><td>${r.name}</td><td class="num">${r.qty}</td><td class="num">${fmt(r.revenue)}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="3">No sales recorded yet.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h3>Invoice Report</h3></div>
      <div class="card-body flush table-scroll">
        <table>
          <thead><tr><th>Invoice</th><th>Customer</th><th>Date</th><th class="num">Total</th><th class="num">VAT</th><th>Status</th></tr></thead>
          <tbody>${DB.invoices.length? DB.invoices.map(i=>`<tr><td>${i.id}</td><td>${custName(i.custId)}</td><td>${i.date}</td><td class="num">${fmt(i.total)}</td><td class="num">${fmt(i.vat)}</td><td>${statusPill(i.status)}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="6">No invoices yet.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

/* =====================================================================
   SETTINGS
===================================================================== */
function renderSettings(){
  return `
    <div class="page-head">
      <div><div class="page-title">Settings</div><div class="page-sub">Configure Acacia Sell for your business</div></div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-head"><h3>Company Information</h3></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field"><label>Company Name</label><input type="text" value="${CURRENT_USER.company}"></div>
            <div class="field"><label>KRA PIN</label><input type="text" placeholder="e.g. P05123456X"></div>
            <div class="field"><label>Phone</label><input type="text" placeholder="e.g. 0722 000 000"></div>
            <div class="field"><label>Email</label><input type="text" value="${CURRENT_USER.email}"></div>
            <div class="field" style="grid-column:1/-1;"><label>Address</label><input type="text" value="Biashara Street, Nairobi"></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Tax &amp; Currency</h3></div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field"><label>Default VAT Rate</label><input type="text" value="16%"></div>
            <div class="field"><label>Currency</label><input type="text" value="KES — Kenyan Shilling"></div>
            <div class="field"><label>Invoice Numbering</label><input type="text" value="INV-0001"></div>
            <div class="field"><label>Quote Numbering</label><input type="text" value="QT-001"></div>
          </div>
        </div>
      </div>
    </div>
    <div class="two-col">
      <div class="card">
        <div class="card-head"><h3>Payment Methods</h3></div>
        <div class="card-body">
          ${['Cash','M-Pesa','Bank Transfer','Cheque','Card'].map(m=>`<div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;"><input type="checkbox" checked style="width:auto;"><span>${m}</span></div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Salespersons</h3></div>
        <div class="card-body flush table-scroll">
          <table>
            <thead><tr><th>Name</th><th>Role</th></tr></thead>
            <tbody>
              <tr><td>${CURRENT_USER.name}</td><td>Owner</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Account &amp; Data</h3></div>
      <div class="card-body">
        <p class="subtle" style="margin:0 0 12px 0;">Signed in as <strong style="color:var(--ink-900);">${CURRENT_USER.name}</strong> (${CURRENT_USER.email}) at <strong style="color:var(--ink-900);">${CURRENT_USER.company}</strong>. Records are saved in this browser, under this account.</p>
        <div style="display:flex; gap:10px;">
          <button class="btn btn-danger" onclick="clearCompanyData()">Clear all sales data</button>
          <button class="btn" onclick="handleLogout()">Log out</button>
        </div>
      </div>
    </div>
  `;
}

/* =====================================================================
   MODAL / TOAST HELPERS
===================================================================== */
function showModal(html, size){
  const box = document.getElementById('modalBox');
  box.className = 'modal' + (size==='wide' ? ' wide' : '');
  box.innerHTML = html;
  document.getElementById('modalBackdrop').classList.add('open');
}
function closeModal(){ document.getElementById('modalBackdrop').classList.remove('open'); }
document.getElementById('modalBackdrop').addEventListener('click', (e)=>{ if(e.target.id==='modalBackdrop') closeModal(); });

let toastTimer;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), 2600);
}

/* ---------- Global search: jumps to a matching invoice/customer/product ---------- */
document.getElementById('globalSearch').addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){
    const q = e.target.value.trim().toLowerCase();
    if(!q) return;
    const inv = DB.invoices.find(i=>i.id.toLowerCase().includes(q));
    if(inv){ openInvoiceDetail(inv.id); return; }
    const cust = DB.customers.find(c=>c.name.toLowerCase().includes(q));
    if(cust){ goTo('customers'); openCustomerDetail(cust.id); return; }
    const prod = DB.products.find(p=>p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    if(prod){ goTo('products'); pageState.search = prod.name; renderPage(); return; }
    toast('No match found for "'+e.target.value+'".');
  }
});

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', checkSessionOnLoad);


/* ===== Sales Hub pages matching Books: Bulk Invoicing, Credit Notes, Recurring Invoices, Delivery, Statement ===== */
const head=(t,sub,act)=>`<div class="page-head"><div><div class="page-title">${t}</div><div class="page-sub">${sub}</div></div>${act||''}</div>`;
const custOpts=()=>'<option value="">Select customer</option>'+DB.customers.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
const invOpts=()=>'<option value="">Select invoice</option>'+DB.invoices.filter(i=>i.total-i.paid>0).map(i=>`<option value="${i.id}">${i.id} · ${custName(i.custId)} · due ${fmt(i.total-i.paid)}</option>`).join('');
const gid=id=>document.getElementById(id);

function renderBulkInv(){
  const open=DB.orders.filter(o=>!o.converted.invoice&&o.status!=='Cancelled');
  return head('Bulk Invoicing','Turn several open orders into invoices at once',`<div class="page-actions"><button class="btn btn-primary" onclick="runBulkInv()">Invoice Selected</button></div>`)+`
  <div class="card"><div class="card-body flush table-scroll"><table><thead><tr><th><input type="checkbox" onclick="document.querySelectorAll('.bi-chk').forEach(c=>c.checked=this.checked)"></th><th>Order</th><th>Customer</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>
  ${open.map(o=>`<tr><td><input type="checkbox" class="bi-chk" value="${o.id}"></td><td>${o.id}</td><td>${custName(o.custId)}</td><td>${statusPill(o.status)}</td><td class="num">${fmt(computeTotals(o.lines).grand)}</td></tr>`).join('')||'<tr class="empty-row"><td colspan="5">No uninvoiced orders.</td></tr>'}
  </tbody></table></div></div>`;
}
function runBulkInv(){
  const ids=[...document.querySelectorAll('.bi-chk:checked')].map(c=>c.value);
  if(!ids.length) return toast('Select at least one order.');
  ids.forEach(id=>convertOrderToInvoice(id,{silent:true}));
  toast(ids.length+' invoice(s) created.'); renderPage();
}

function renderCreditNotes(){
  return head('Credit Notes','Reduce what a customer owes on an invoice')+`
  <div class="card"><div class="card-body"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
    <select id="cnInv">${invOpts()}</select><input id="cnAmt" type="number" min="0" placeholder="Amount"><input id="cnReason" placeholder="Reason">
    <button class="btn btn-primary" onclick="saveCreditNote()">Issue Credit Note</button></div></div></div>
  <div class="card" style="margin-top:16px"><div class="card-body flush table-scroll"><table><thead><tr><th>Credit Note</th><th>Customer</th><th>Invoice</th><th>Date</th><th>Reason</th><th class="num">Amount</th></tr></thead><tbody>
  ${DB.creditNotes.map(n=>`<tr><td>${n.id}</td><td>${custName(n.custId)}</td><td>${n.invoiceId}</td><td>${n.date}</td><td>${n.reason||'—'}</td><td class="num">${fmt(n.amount)}</td></tr>`).join('')||'<tr class="empty-row"><td colspan="6">No credit notes issued.</td></tr>'}
  </tbody></table></div></div>`;
}
function saveCreditNote(){
  const inv=DB.invoices.find(i=>i.id===gid('cnInv').value), amt=parseFloat(gid('cnAmt').value);
  if(!inv||!(amt>0)) return toast('Select an invoice and enter an amount.');
  const a=Math.min(amt,inv.total-inv.paid); DB.seq.cn++;
  DB.creditNotes.unshift({id:'CN-'+String(DB.seq.cn).padStart(4,'0'),invoiceId:inv.id,custId:inv.custId,amount:a,reason:gid('cnReason').value.trim(),date:todayISO()});
  inv.paid+=a; inv.status=inv.paid>=inv.total?'Paid':'Partially Paid';
  const c=DB.customers.find(x=>x.id===inv.custId); if(c) c.balance=Math.max(0,c.balance-a);
  toast('Credit note issued.'); renderPage();
}

function renderRecurring(){
  return head('Recurring Invoices','Schedules that generate invoices automatically',`<div class="page-actions"><button class="btn btn-primary" onclick="runRecurring()">Run Due Now</button></div>`)+`
  <div class="card"><div class="card-body"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
    <select id="rcCust">${custOpts()}</select>
    <select id="rcProd"><option value="">Select product</option>${DB.products.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select>
    <input id="rcQty" type="number" min="1" value="1" placeholder="Qty">
    <select id="rcFreq"><option>Weekly</option><option selected>Monthly</option><option>Quarterly</option></select>
    <input id="rcNext" type="date" value="${todayISO()}"><button class="btn btn-primary" onclick="saveRecurring()">Save Schedule</button></div></div></div>
  <div class="card" style="margin-top:16px"><div class="card-body flush table-scroll"><table><thead><tr><th>Schedule</th><th>Customer</th><th>Product</th><th>Qty</th><th>Frequency</th><th>Next Run</th><th></th></tr></thead><tbody>
  ${DB.recurring.map((r,i)=>`<tr><td>${r.id}</td><td>${custName(r.custId)}</td><td>${prodName(r.pid)}</td><td>${r.qty}</td><td>${r.freq}</td><td>${r.next}</td><td><span class="row-link" onclick="DB.recurring.splice(${i},1);renderPage()">Delete</span></td></tr>`).join('')||'<tr class="empty-row"><td colspan="7">No recurring schedules.</td></tr>'}
  </tbody></table></div></div>`;
}
function saveRecurring(){
  const custId=gid('rcCust').value,pid=gid('rcProd').value,qty=parseFloat(gid('rcQty').value);
  if(!custId||!pid||!(qty>0)) return toast('Choose a customer, product and quantity.');
  DB.seq.rec++; DB.recurring.push({id:'REC-'+String(DB.seq.rec).padStart(3,'0'),custId,pid,qty,freq:gid('rcFreq').value,next:gid('rcNext').value||todayISO()});
  toast('Schedule saved.'); renderPage();
}
function runRecurring(){
  let n=0;
  DB.recurring.forEach(r=>{
    while(r.next<=todayISO()){
      const p=DB.products.find(x=>x.id===r.pid); if(!p) break;
      const lines=[{pid:r.pid,qty:r.qty,price:p.price,disc:0}], t=computeTotals(lines); DB.seq.invoice++;
      DB.invoices.unshift({id:'INV-'+String(DB.seq.invoice).padStart(4,'0'),custId:r.custId,lines,date:r.next,dueDate:addDays(r.next,14),subtotal:t.subtotal,discount:t.discountTotal,vat:t.vat,total:t.grand,paid:0,status:'Sent',recurringId:r.id});
      const c=DB.customers.find(x=>x.id===r.custId); if(c) c.balance=(c.balance||0)+t.grand;
      r.next=addDays(r.next,r.freq==='Weekly'?7:r.freq==='Quarterly'?91:30); n++;
    }
  });
  toast(n?n+' invoice(s) generated.':'Nothing due.'); renderPage();
}

function renderDelivery(){
  const rows=DB.orders.filter(o=>o.status!=='Cancelled');
  return head('Delivery','Track order fulfilment from confirmation to delivery')+`
  <div class="card"><div class="card-body flush table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Delivery Date</th><th>Update</th></tr></thead><tbody>
  ${rows.map(o=>`<tr><td>${o.id}</td><td>${custName(o.custId)}</td><td>${statusPill(o.status)}</td><td>${o.deliveryDate||'—'}</td>
    <td><select onchange="setDelivery('${o.id}',this.value)">${['Pending','Confirmed','Packed','Delivered'].map(s=>`<option ${s===o.status?'selected':''}>${s}</option>`).join('')}</select></td></tr>`).join('')||'<tr class="empty-row"><td colspan="5">No orders to deliver.</td></tr>'}
  </tbody></table></div></div>`;
}
function setDelivery(id,st){ const o=DB.orders.find(x=>x.id===id); o.status=st; if(st==='Delivered') o.deliveryDate=todayISO(); toast(id+' marked '+st+'.'); renderPage(); }

function renderStatement(){
  const cid=pageState.stCust||'', f=pageState.stFrom||'', t=pageState.stTo||'';
  let rows=[];
  if(cid){
    DB.invoices.filter(i=>i.custId===cid).forEach(i=>rows.push({d:i.date,ref:i.id,desc:'Invoice',dr:i.total,cr:0}));
    DB.payments.filter(p=>p.custId===cid).forEach(p=>rows.push({d:p.date,ref:p.id,desc:'Receipt ('+p.method+')',dr:0,cr:p.amount}));
    DB.creditNotes.filter(n=>n.custId===cid).forEach(n=>rows.push({d:n.date,ref:n.id,desc:'Credit note',dr:0,cr:n.amount}));
    rows.sort((a,b)=>a.d.localeCompare(b.d)); let bal=0; rows.forEach(r=>{bal+=r.dr-r.cr; r.bal=bal;});
    rows=rows.filter(r=>(!f||r.d>=f)&&(!t||r.d<=t));
  }
  const set=(k,v)=>`pageState.${k}='${v}'`;
  return head('Customer Statement','Invoices, receipts and credit notes with a running balance',`<div class="page-actions"><button class="btn" onclick="window.print()">Print</button></div>`)+`
  <div class="card"><div class="card-body" style="display:flex;gap:12px;flex-wrap:wrap">
    <select onchange="pageState.stCust=this.value;renderPage()">${custOpts().replace(`value="${cid}"`,`value="${cid}" selected`)}</select>
    <input type="date" value="${f}" onchange="pageState.stFrom=this.value;renderPage()"><input type="date" value="${t}" onchange="pageState.stTo=this.value;renderPage()"></div></div>
  <div class="card" style="margin-top:16px"><div class="card-body flush table-scroll"><table><thead><tr><th>Date</th><th>Ref</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead><tbody>
  ${rows.map(r=>`<tr><td>${r.d}</td><td>${r.ref}</td><td>${r.desc}</td><td class="num">${r.dr?fmt(r.dr):''}</td><td class="num">${r.cr?fmt(r.cr):''}</td><td class="num">${fmt(r.bal)}</td></tr>`).join('')||`<tr class="empty-row"><td colspan="6">${cid?'No activity in this period.':'Select a customer.'}</td></tr>`}
  </tbody></table></div></div>`;
}


/* ===== Books-style table tools: click a header to sort, Export CSV on list pages ===== */
const EXPORT_PAGES=['customers','products','quotes','orders','invoices','payments','returns','bulkinv','creditnotes','recurring','delivery','statement'];
function cellVal(td){ const t=(td?td.innerText:'').trim(); const n=parseFloat(t.replace(/[^0-9.\-]/g,'')); return (t!==''&&/\d/.test(t)&&!isNaN(n)&&/^[A-Za-z]{0,4}\s?[\d,.\-\s]+$/.test(t))?n:t.toLowerCase(); }
function enhanceTables(){
  const c=document.getElementById('content'); if(!c) return;
  c.querySelectorAll('table:not(.li-table)').forEach(tb=>{
    tb.querySelectorAll('thead th').forEach((th,ci)=>{
      if(!th.textContent.trim()||th.querySelector('input')) return;
      th.style.cursor='pointer'; th.title='Click to sort';
      th.onclick=()=>{
        const dir=th.dataset.dir==='asc'?'desc':'asc';
        tb.querySelectorAll('thead th').forEach(x=>{delete x.dataset.dir; x.textContent=x.textContent.replace(/ [▲▼]$/,'');});
        th.dataset.dir=dir; th.textContent+=dir==='asc'?' ▲':' ▼';
        const body=tb.tBodies[0], rows=[...body.rows].filter(r=>!r.classList.contains('empty-row'));
        rows.sort((a,b)=>{const x=cellVal(a.cells[ci]),y=cellVal(b.cells[ci]); const r=(typeof x==='number'&&typeof y==='number')?x-y:String(x).localeCompare(String(y)); return dir==='asc'?r:-r;});
        rows.forEach(r=>body.appendChild(r));
      };
    });
  });
  if(EXPORT_PAGES.includes(currentPage) && !c.querySelector('.csv-export')){
    const head=c.querySelector('.page-head'); if(!head) return;
    let acts=head.querySelector('.page-actions'); if(!acts){ acts=document.createElement('div'); acts.className='page-actions'; head.appendChild(acts); }
    const b=document.createElement('button'); b.className='btn csv-export'; b.textContent='Export CSV'; b.onclick=exportTableCSV; acts.prepend(b);
  }
}
function exportTableCSV(){
  const tb=document.querySelector('#content table:not(.li-table)'); if(!tb) return toast('Nothing to export.');
  const q=v=>'"'+String(v).replace(/"/g,'""')+'"';
  const lines=[...tb.rows].filter(r=>!r.classList.contains('empty-row')).map(r=>[...r.cells].filter(td=>!td.querySelector('input[type=checkbox]')).map(td=>q(td.innerText.replace(/ [▲▼]$/,'').trim())).join(','));
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv'})); a.download=currentPage+'.csv'; a.click();
}
