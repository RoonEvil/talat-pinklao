(function(){
  "use strict";

  var TH_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  function todayStr(){ return new Date().toISOString().slice(0,10); }
  function fmtDate(s){
    var d = new Date(s+"T00:00:00");
    return d.getDate() + ' ' + TH_MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function fmtMoney(n){ return '฿' + Number(n).toLocaleString('en-US'); }
  function uid(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function overlaps(aStart,aEnd,bStart,bEnd){ return aStart <= bEnd && aEnd >= bStart; }
  function sanitizeUsername(u){ return String(u||'').toLowerCase().replace(/[^a-z0-9_\-]/g,''); }

  // Zone colours are stored as keys ('zone-1' …) so light and dark themes can each pick their own shade.
  var ZONE_COLOR_KEYS = ['zone-1','zone-2','zone-3','zone-4'];

  // Goods come from the categories table (D3): top-level categories, and kinds under some of them
  // (e.g. kinds of food). CATEGORIES holds the top level; KINDS[parentId] the kinds under a category.
  var CATEGORY_ICONS = {
    'อาหารและเครื่องดื่ม':'🍜', 'เสื้อผ้าและเครื่องประดับ':'👕', 'สินค้าทั่วไป':'🧺', 'บริการ':'🔧', 'อื่นๆ':'📦',
    'ข้าวแกง / อาหารปรุงสำเร็จ':'🍛', 'อาหารตามสั่ง / ก๋วยเตี๋ยว':'🍜', 'ปิ้งย่าง / ของทอด':'🍢', 'ขนมไทย / ของหวาน':'🍡',
    'เบเกอรี่':'🥐', 'เครื่องดื่ม':'🥤', 'ผลไม้':'🍉', 'อาหารสด (ผัก เนื้อ ปลา)':'🥬'
  };
  var CATEGORIES = [], KINDS = {}, CATEGORY_ROWS = [];
  function setCategories(rows){
    CATEGORY_ROWS = rows || [];
    var meta = function(r){ return { id:r.id, label:r.name, icon:CATEGORY_ICONS[r.name] || (r.parentId ? '•' : '📦'), parentId:r.parentId || null }; };
    CATEGORIES = CATEGORY_ROWS.filter(function(r){ return !r.parentId; }).map(meta);
    KINDS = {};
    CATEGORY_ROWS.filter(function(r){ return r.parentId; }).forEach(function(r){ (KINDS[r.parentId] = KINDS[r.parentId] || []).push(meta(r)); });
  }
  var NO_CATEGORY = { id:null, label:'ไม่ระบุ', icon:'📦' };
  function categoryMeta(id){ return CATEGORIES.find(function(c){ return String(c.id)===String(id); }) || NO_CATEGORY; }
  function kindsOf(catId){ return KINDS[catId] || []; }
  function hasKinds(catId){ return kindsOf(catId).length > 0; }
  function kindMeta(id){
    for (var k in KINDS){ var f = KINDS[k].find(function(x){ return String(x.id)===String(id); }); if (f) return f; }
    return null;
  }
  function foodTypeLabel(id){ var f = kindMeta(id); return f ? f.label : ''; }
  function anyCategoryLabel(id){ var k = kindMeta(id); return k ? k.label : categoryMeta(id).label; }
  // Goods a zone accepts (same rules as server/goods.js): a list of category or kind ids; empty = anything.
  function zoneAllowed(zone){ return zone && Array.isArray(zone.allowed) ? zone.allowed : []; }
  function zoneAllowsCategory(zone, catId){
    var a = zoneAllowed(zone).map(String);
    if (!a.length || a.indexOf(String(catId)) !== -1) return true;
    return kindsOf(catId).some(function(k){ return a.indexOf(String(k.id)) !== -1; });
  }
  function zoneAllowsFood(zone, kindId){
    var a = zoneAllowed(zone).map(String);
    if (!a.length || a.indexOf(String(kindId)) !== -1) return true;
    var k = kindMeta(kindId);
    return !!(k && a.indexOf(String(k.parentId)) !== -1);
  }
  function zoneAllowedLabel(zone){ return zoneAllowed(zone).map(anyCategoryLabel).join(', '); }
  // Zone key under the map: colour, what the zone accepts and how many stalls are free.
  function zoneRulesHtml(){
    var items = state.zones.map(function(z){
      var stalls = stallsInZone(z.id);
      var free = stalls.filter(function(s){ return stallStatus(s) === 'available'; }).length;
      return '<li style="--zc:'+zoneColor(z)+'"><span class="zone-swatch" aria-hidden="true"></span>' +
        '<span class="zone-key-text"><b>'+esc(z.name)+'</b>' +
        '<span>'+(zoneAllowed(z).length ? 'รับเฉพาะ '+esc(zoneAllowedLabel(z)) : 'รับสินค้าทุกประเภท')+'</span>' +
        '<span class="zone-key-count">ว่าง '+free+' จาก '+stalls.length+' ล็อก</span></span></li>';
    }).join('');
    return items ? '<ul class="zone-rules" aria-label="สีและสินค้าที่แต่ละโซนรับ">'+items+'</ul>' : '';
  }
  function checkedValues(root, name){
    return [].slice.call(root.querySelectorAll('input[name="'+name+'"]:checked')).map(function(i){ return i.value; });
  }

  var PAYMENT_METHODS = [
    { id:'promptpay', label:'โอนผ่านพร้อมเพย์' },
    { id:'transfer', label:'โอนผ่านธนาคาร' },
    { id:'cash', label:'เงินสดที่สำนักงานตลาด' }
  ];
  function methodLabel(id){ var m = PAYMENT_METHODS.find(function(x){ return x.id===id; }); return m ? m.label : (id || '—'); }

  var ANNOUNCE_TYPES = [
    { id:'news', label:'ข่าวสาร' },
    { id:'rule', label:'กฎระเบียบ' },
    { id:'holiday', label:'วันหยุด' },
    { id:'event', label:'กิจกรรม' }
  ];
  function announceTypeLabel(id){ var t = ANNOUNCE_TYPES.find(function(x){ return x.id===id; }); return t ? t.label : id; }

  var STATUS_LABELS = { pending:'รอดำเนินการ', approved:'อนุมัติแล้ว', rejected:'ปฏิเสธแล้ว', cancelled:'ยกเลิกแล้ว' };
  function statusLabel(s){ return STATUS_LABELS[s] || s; }
  var PAY_STATUS_LABELS = { unpaid:'ยังไม่ชำระ', paid:'แจ้งชำระแล้ว', confirmed:'ยืนยันรับเงินแล้ว' };
  function payStatusLabel(s){ return PAY_STATUS_LABELS[s] || s; }
  var RATE_LABELS = { walkin:'ขาจร', regular:'ขาประจำ' };
  function rateLabel(s){ return RATE_LABELS[s] || s; }
  var ROLE = { ADMIN:1, STAFF:2, VENDOR:3 };
  var ROLE_LABELS = { 1:'ผู้ดูแลระบบ', 2:'เจ้าหน้าที่ตลาด', 3:'ผู้ค้า' };

  // ---------- API ----------
  var authToken = null;
  try { authToken = localStorage.getItem('pinklao_token'); } catch(e){}
  function saveToken(t){ authToken = t; try{ t ? localStorage.setItem('pinklao_token', t) : localStorage.removeItem('pinklao_token'); }catch(e){} }

  function apiFetch(path, options){
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    var isForm = (typeof FormData !== 'undefined') && options.body instanceof FormData;
    if (!isForm) headers['Content-Type'] = 'application/json';
    if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
    if (profile && profile.vendorToken) headers['X-Vendor-Token'] = profile.vendorToken;
    return fetch(path, Object.assign({}, options, { headers: headers })).then(function(res){
      return res.text().then(function(text){
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch(e){}
        if (!res.ok) return Promise.reject({ status: res.status, error: data.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
        return data;
      });
    });
  }
  function apiGet(path){ return apiFetch(path); }
  function apiPost(path, body){ return apiFetch(path, { method:'POST', body: JSON.stringify(body||{}) }); }
  function apiPut(path, body){ return apiFetch(path, { method:'PUT', body: JSON.stringify(body||{}) }); }
  function apiDelete(path){ return apiFetch(path, { method:'DELETE' }); }
  function apiUpload(path, formData){ return apiFetch(path, { method:'POST', body: formData }); }

  // ---------- local identity (per browser) ----------
  var profile = (function(){
    try {
      var raw = localStorage.getItem('pinklao_profile');
      if (raw) return JSON.parse(raw);
    } catch(e){}
    var p = blankProfile();
    try { localStorage.setItem('pinklao_profile', JSON.stringify(p)); } catch(e){}
    return p;
  })();
  function blankProfile(){
    return { vendorToken: uid(), vendorName:'', vendorPhone:'', isRegistered:false, isAdmin:false, isHeadAdmin:false,
      userId:null, roleId:null, menus:[], adminName:'', category:null, foodType:null, user:null };
  }
  function saveProfile(){ try { localStorage.setItem('pinklao_profile', JSON.stringify(profile)); } catch(e){} }

  // Copies the signed-in user (from /api/auth/login, /register or /me) into this browser's profile.
  function applySessionUser(u){
    var keepToken = profile.vendorToken && profile.vendorToken.length >= 8 && !profile.isRegistered ? profile.vendorToken : uid();
    var staff = u.roleId !== ROLE.VENDOR;
    profile = Object.assign(blankProfile(), {
      vendorToken: keepToken,
      userId: u.id, roleId: u.roleId, user: u,
      isAdmin: staff, isHeadAdmin: u.roleId === ROLE.ADMIN, menus: staff ? (u.menus || []) : [],
      adminName: staff ? u.name : '',
      isRegistered: !staff, vendorName: staff ? '' : u.name, vendorPhone: staff ? '' : u.phone,
      category: staff ? null : u.category, foodType: staff ? null : u.foodType
    });
    saveProfile();
  }
  function canMenu(key){ return profile.isAdmin && (profile.menus || []).indexOf(key) !== -1; }

  function signOutCompletely(){
    profile = blankProfile();
    saveProfile();
    saveToken(null);
  }

  // ---------- state ----------
  var state = {
    zones: [], stalls: [], activeBookings: [], bookings: [], myBookings: [], myBookingsLoaded:false,
    vendors: [], users: [], roles: [], announcements: [], auditLogs: [], auditDate: null, settings: {},
    activeTab: 'map', adminMenu: 'bookings', adminTabs: {}, loaded:false,
    bookingsFilter: 'all', myFilter: 'all', userQuery: '', fineQuery: '', annQuery: '', zoneQuery: '', stallQuery: '', bookingQuery: '', payQuery: '',
    mapView: { s:1, tx:0, ty:0, fitted:false }, mapHighlight: null, mapInteracting: false,
    editView: { s:1, tx:0, ty:0, fitted:false }, mapDraft: null, mapDirty: false,
    mapTool: 'select', mapSelected: -1, mapPlaceStall: null, mapPlaceSize: '1x1',
    dash: null
  };

  function zoneById(id){ return state.zones.find(function(z){ return String(z.id)===String(id); }); }
  function stallById(id){ return state.stalls.find(function(s){ return String(s.id)===String(id); }); }
  function stallsInZone(zid){ return state.stalls.filter(function(s){ return String(s.zone_id)===String(zid); }); }
  function bookingsForStall(sid){ return state.activeBookings.filter(function(b){ return String(b.stallId)===String(sid); }); }
  function activeBookingsForStall(sid){
    var t = todayStr();
    return bookingsForStall(sid).filter(function(b){ return b.endDate >= t; })
      .sort(function(a,b){ return a.startDate < b.startDate ? -1:1; });
  }
  function stallStatus(stall){
    if (!stall.active) return 'inactive';
    var active = activeBookingsForStall(stall.id);
    if (active.some(function(b){ return b.status==='approved'; })) return 'occupied';
    if (active.length) return 'pending';
    return 'available';
  }

  // ---------- toasts ----------
  function toast(msg, isErr){
    var el = document.createElement('div');
    el.className = 'toast' + (isErr?' err':'');
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(function(){ el.remove(); }, 3200);
  }

  // ---------- announcements: game-style title broadcast ----------
  // A new announcement pops up over whatever page the viewer is on (they poll every 10s), fades in, holds,
  // then fades out. Each browser remembers the newest id it has shown, so every announcement fires once.
  // A first-time visitor only catches one that went out within ANNOUNCE_FRESH_MS.
  var ANNOUNCE_SEEN_KEY = 'pinklao_announce_seen';
  var ANNOUNCE_FRESH_MS = 12 * 3600 * 1000;
  var annQueue = [], annShowing = false, annSeen = null;
  try {
    var storedSeen = localStorage.getItem(ANNOUNCE_SEEN_KEY);
    if (storedSeen != null) annSeen = Number(storedSeen) || 0;
  } catch(e){}

  function queueNewAnnouncements(list){
    var maxId = (list || []).reduce(function(m, a){ return Math.max(m, a.id); }, 0);
    var fresh;
    if (annSeen == null){
      fresh = list.filter(function(a){ return Date.now() - Date.parse(a.created_at) < ANNOUNCE_FRESH_MS; });
      fresh = fresh.sort(function(a, b){ return a.id - b.id; }).slice(-1);
    } else {
      // Ids only grow, except after a restore rewinds them; then start counting from the restored data.
      if (maxId < annSeen) annSeen = maxId;
      fresh = list.filter(function(a){ return a.id > annSeen; }).sort(function(a, b){ return a.id - b.id; }).slice(-3);
    }
    if (annSeen !== maxId){
      annSeen = maxId;
      try { localStorage.setItem(ANNOUNCE_SEEN_KEY, String(maxId)); } catch(e){}
    }
    fresh.forEach(function(a){ annQueue.push(a); });
    showNextAnnouncement();
  }

  function showNextAnnouncement(){
    if (annShowing || !annQueue.length) return;
    var a = annQueue.shift();
    annShowing = true;
    var el = document.createElement('div');
    el.className = 'mc-title mc-' + esc(a.type || 'news');
    el.innerHTML =
      '<div class="mc-box" role="alert" tabindex="-1" title="แตะเพื่อปิด">' +
        '<div class="mc-kicker">ประกาศ · ' + esc(announceTypeLabel(a.type)) + '</div>' +
        '<div class="mc-main">' + esc(a.title) + '</div>' +
        '<div class="mc-sub">' + esc(a.body) + '</div>' +
      '</div>';
    document.body.appendChild(el);
    var hold = Math.min(12000, 4000 + (a.title.length + a.body.length) * 40);
    var closed = false;
    var close = function(){
      if (closed) return;
      closed = true;
      el.classList.add('is-out');
      setTimeout(function(){ el.remove(); annShowing = false; showNextAnnouncement(); }, 900);
    };
    el.close = close;
    el.querySelector('.mc-box').addEventListener('click', close);
    setTimeout(close, 500 + hold);
  }
  function previewAnnouncement(a){
    annQueue.push(a);
    showNextAnnouncement();
  }

  // ---------- data loading ----------
  function loadPublicData(){
    return Promise.all([
      apiGet('/api/zones'), apiGet('/api/stalls'), apiGet('/api/bookings/active'),
      apiGet('/api/announcements'), apiGet('/api/settings'), apiGet('/api/categories')
    ]).then(function(res){
      state.zones = res[0];
      state.stalls = res[1];
      state.activeBookings = res[2];
      state.announcements = res[3];
      state.settings = res[4];
      setCategories(res[5]);
      state.loaded = true;
      render();
      queueNewAnnouncements(state.announcements);
    }).catch(function(err){ console.error('loadPublicData', err); });
  }

  function loadMyBookings(){
    return apiGet('/api/bookings/mine').then(function(rows){
      state.myBookings = rows;
      state.myBookingsLoaded = true;
      render();
    }).catch(function(err){ console.error('loadMyBookings', err); });
  }

  function loadAdminBookings(){
    return apiGet('/api/bookings').then(function(rows){ state.bookings = rows; render(); })
      .catch(function(err){ handleAuthError(err); });
  }
  function loadVendors(){
    return apiGet('/api/users?role=3').then(function(rows){ state.vendors = rows; render(); })
      .catch(function(err){ handleAuthError(err); });
  }
  function loadUsers(){
    return apiGet('/api/users').then(function(rows){ state.users = rows; state.vendors = rows.filter(function(u){ return u.roleId === ROLE.VENDOR; }); render(); })
      .catch(function(err){ handleAuthError(err); });
  }
  function loadRoles(){
    return apiGet('/api/roles').then(function(rows){ state.roles = rows; render(); })
      .catch(function(err){ handleAuthError(err); });
  }
  function loadAudit(date){
    return apiGet('/api/inspections?date=' + encodeURIComponent(date)).then(function(res){
      state.auditDate = res.date;
      state.auditBookings = res.bookings;
      render();
    }).catch(function(err){ handleAuthError(err); });
  }
  function loadFines(){
    return apiGet('/api/inspections/fines').then(function(rows){ state.auditLogs = rows; render(); })
      .catch(function(err){ handleAuthError(err); });
  }
  function handleAuthError(err){
    if (err && err.status === 401){
      toast('เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่', true);
      signOutCompletely();
      if (state.activeTab==='admin') state.activeTab = 'map';
      render();
    } else {
      console.error(err);
    }
  }

  // Data each staff menu works with; reloaded when the menu opens and every 10 seconds.
  function refreshAdminData(){
    if (!profile.isAdmin) return;
    var m = state.adminMenu;
    if (['bookings','payments','reports','users'].indexOf(m) !== -1) loadAdminBookings();
    if (m === 'users') loadUsers();
    if (m === 'bookings' && adminTab('bookings') === 'walkin') loadVendors();
    if (m === 'settings') loadRoles();
    if (m === 'inspections') { loadAudit(state.auditDate || todayStr()); loadFines(); }
  }

  // Re-reads the signed-in account, so a suspended account or changed permissions take effect without signing in again.
  function refreshSession(){
    if (!authToken) return Promise.resolve();
    return apiGet('/api/auth/me').then(function(u){
      var wasStaff = profile.isAdmin;
      applySessionUser(u);
      if (profile.isAdmin && !wasStaff) state.activeTab = 'admin';
      render();
    }).catch(function(err){
      if (err && (err.status === 401 || err.status === 403)){
        signOutCompletely();
        state.activeTab = 'map';
        toast('กรุณาเข้าสู่ระบบใหม่', true);
        render();
      }
    });
  }

  // ---------- render: shell ----------
  function render(){
    // Staff work only in "ระบบจัดการข้อมูล"; the vendor tabs are hidden for them.
    if (profile.isAdmin && state.activeTab !== 'admin') state.activeTab = 'admin';
    if (!profile.isAdmin && state.activeTab === 'admin') state.activeTab = 'map';
    renderRoleArea();
    renderTabs();
    if (state.activeTab==='map') renderMap();
    if (state.activeTab==='mine') renderMine();
    if (state.activeTab==='admin') renderAdmin();
  }

  function logout(){
    signOutCompletely();
    state.myBookings = []; state.bookings = []; state.users = []; state.vendors = []; state.auditLogs = []; state.finesLoaded = false;
    state.activeTab = 'map';
    toast('ออกจากระบบแล้ว');
    render();
    loadMyBookings();
  }

  function renderRoleArea(){
    var el = document.getElementById('roleArea');
    if (profile.isAdmin){
      el.innerHTML =
        '<span class="pill on-accent">'+esc(profile.adminName||'เจ้าหน้าที่')+' · '+esc(ROLE_LABELS[profile.roleId]||'')+'</span>' +
        '<button class="btn ghost small" id="profileBtn">ข้อมูลส่วนตัว</button>' +
        '<button class="btn ghost small" id="logoutBtn">ออกจากระบบ</button>';
    } else if (profile.isRegistered){
      el.innerHTML =
        '<span class="pill on-primary">ผู้ค้า: '+esc(profile.vendorName||'บัญชีของฉัน')+'</span>' +
        '<button class="btn ghost small" id="profileBtn">ข้อมูลส่วนตัว</button>' +
        '<button class="btn ghost small" id="logoutBtn">ออกจากระบบ</button>';
    } else {
      el.innerHTML =
        (profile.vendorName ? '<span class="pill on-primary">ผู้ค้า: '+esc(profile.vendorName)+'</span>' : '<span class="pill">กำลังเรียกดูแบบผู้เยี่ยมชม</span>') +
        '<button class="btn ghost small" id="staffBtn">เข้าสู่ระบบ</button>';
      document.getElementById('staffBtn').onclick = function(){ openAuthModal('login'); };
      return;
    }
    document.getElementById('logoutBtn').onclick = logout;
    document.getElementById('profileBtn').onclick = openProfileModal;
  }

  function renderTabs(){
    document.querySelectorAll('.tab').forEach(function(btn){
      btn.classList.toggle('active', btn.dataset.tab===state.activeTab);
    });
    document.getElementById('tabs').hidden = profile.isAdmin;
    document.getElementById('view-map').hidden = state.activeTab!=='map';
    document.getElementById('view-mine').hidden = state.activeTab!=='mine';
    document.getElementById('view-admin').hidden = state.activeTab!=='admin';
  }

  function setTab(t){
    if (t==='admin' && !profile.isAdmin){ openAuthModal('login'); return; }
    state.activeTab = t; render();
    if (t==='mine') loadMyBookings();
    if (t==='admin') refreshAdminData();
  }
  document.getElementById('tabs').addEventListener('click', function(e){
    var btn = e.target.closest('.tab'); if (!btn) return;
    setTab(btn.dataset.tab);
  });

  // ---------- Isometric map: shared helpers ----------
  var STALL_STATUS_LABELS = { available:'ว่าง', pending:'รอการอนุมัติ', occupied:'จองแล้ว', inactive:'ปิด' };
  var STALL_STATUS_COLORS = { available:'var(--success)', pending:'var(--warning)', occupied:'var(--danger)', inactive:'var(--muted)' };
  var MAP_KIND_LABELS = { stall:'ล็อก', entrance:'ทางเข้า', toilet:'ห้องน้ำ', tree:'ต้นไม้', stage:'เวที', parking:'ที่จอดรถ', text:'ป้าย', object:'สิ่งของ' };

  // Stalls in creation order (mirrors server/neighbors.js autoLayoutStalls).
  function byRowCol(a, b){ return a.id - b.id; }

  function autoLayout(){
    var LEFT = 3;
    var items = [];
    var y = 1, widest = 6;
    state.zones.forEach(function(z){
      var list = stallsInZone(z.id).slice().sort(byRowCol);
      if (!list.length) return;
      // Evenly filled rows of at most 9 stalls (at least 2 rows), separated by aisles,
      // so a big zone stays compact and never ends with a lone stall on its own row.
      var rowCount = list.length > 1 ? Math.max(2, Math.ceil(list.length / 9)) : 1;
      var perRow = Math.ceil(list.length / rowCount);
      widest = Math.max(widest, perRow);
      items.push({ kind:'text', x:0, y:y, w:2, h:1, label:z.name });
      list.forEach(function(s, i){
        items.push({ kind:'stall', stallId:s.id, x:LEFT + (i % perRow), y:y + Math.floor(i / perRow) * 2, w:1, h:1 });
      });
      y += rowCount * 2;
    });
    var cols = LEFT + widest + 2;
    items.push({ kind:'text', x:cols - 3, y:0, w:3, h:1, label:'↑ ไปทาง ตึก OPD' });
    items.push({ kind:'toilet', x:cols - 1, y:1, w:1, h:1 });
    items.push({ kind:'parking', x:0, y:y, w:2, h:1 });
    items.push({ kind:'entrance', x:Math.floor(cols / 2) - 1, y:y, w:2, h:1 });
    return { cols:cols, rows:y + 1, items:items };
  }

  function cloneLayout(l){ return JSON.parse(JSON.stringify(l)); }
  // Drops stalls that no longer exist, and trees (no longer used on the market map; older saved maps may still have them).
  function withoutMissingStalls(l){
    l.items = l.items.filter(function(it){ return it.kind !== 'tree' && (it.kind !== 'stall' || stallById(it.stallId)); });
    return l;
  }
  function savedOrAutoLayout(){
    return withoutMissingStalls(cloneLayout(state.settings.mapLayout || autoLayout()));
  }
  function zoneColor(z){ return 'var(--' + (z && ZONE_COLOR_KEYS.indexOf(z.color) !== -1 ? z.color : 'zone-1') + ')'; }

  // Public map only: stalls the admin has not placed yet are added in blocks below the map, one per zone,
  // so vendors still see (and can book) every stall.
  function placeMissingStalls(l){
    var placed = {};
    l.items.forEach(function(it){ if (it.kind === 'stall') placed[it.stallId] = true; });
    var LEFT = 3, y = l.rows;
    state.zones.forEach(function(z){
      var list = stallsInZone(z.id).filter(function(s){ return !placed[s.id]; }).sort(byRowCol);
      if (!list.length) return;
      var rowCount = list.length > 1 ? Math.max(2, Math.ceil(list.length / 9)) : 1;
      var perRow = Math.ceil(list.length / rowCount);
      if (!l.items.some(function(it){ return it.kind === 'text' && it.label === z.name; })) {
        l.items.push({ kind:'text', x:0, y:y, w:2, h:1, label:z.name });
      }
      list.forEach(function(s, i){
        l.items.push({ kind:'stall', stallId:s.id, x:LEFT + (i % perRow), y:y + Math.floor(i / perRow) * 2, w:1, h:1 });
      });
      l.cols = Math.max(l.cols, LEFT + perRow + 1);
      y += rowCount * 2;
    });
    l.rows = y;
    return l;
  }

  // One coloured ground area per zone: the box around its stalls (and its name sign), slightly padded.
  function zoneAreas(l){
    return state.zones.map(function(z){
      var parts = l.items.filter(function(it){
        if (it.kind === 'text') return it.label === z.name;
        var s = it.kind === 'stall' && stallById(it.stallId);
        return s && String(s.zone_id) === String(z.id);
      });
      if (!parts.some(function(it){ return it.kind === 'stall'; })) return null;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, PAD = 0.4;
      parts.forEach(function(it){
        x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y);
        x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + it.h);
      });
      x0 = Math.max(0, x0 - PAD); y0 = Math.max(0, y0 - PAD);
      x1 = Math.min(l.cols, x1 + PAD); y1 = Math.min(l.rows, y1 + PAD);
      return { x:x0, y:y0, w:x1 - x0, h:y1 - y0, color:zoneColor(z) };
    }).filter(Boolean);
  }

  function rectsOverlap(a, b){ return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
  function spotFree(l, rect, ignoreIdx){
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > l.cols || rect.y + rect.h > l.rows) return false;
    return !l.items.some(function(it, i){ return i !== ignoreIdx && rectsOverlap(it, rect); });
  }

  // ---------- identical goods may not stand side by side ----------
  // Same rule as server/neighbors.js (the server has the final say): stalls whose map squares share an edge
  // are neighbours, and neighbours may not sell the same thing in overlapping dates.
  function rectsTouch(a, b){
    var xOver = a.x < b.x + b.w && b.x < a.x + a.w, yOver = a.y < b.y + b.h && b.y < a.y + a.h;
    return (xOver && (a.y + a.h === b.y || b.y + b.h === a.y)) || (yOver && (a.x + a.w === b.x || b.x + b.w === a.x));
  }
  function neighborStallIds(stallId){
    var items = savedOrAutoLayout().items.filter(function(it){ return it.kind === 'stall'; });
    var me = items.find(function(it){ return String(it.stallId) === String(stallId); });
    if (!me) return [];
    return items.filter(function(it){ return it !== me && rectsTouch(me, it); }).map(function(it){ return String(it.stallId); });
  }
  // Same as server/goods.js goodsKey: compare kinds when the category has kinds; "อื่นๆ" is too vague to compare.
  function goodsKey(category, foodType){
    if (!category || categoryMeta(category).label === 'อื่นๆ') return null;
    if (hasKinds(category)) return foodType ? 'k' + foodType : null;
    return 'c' + category;
  }
  function goodsLabel(category, foodType){
    return foodType && kindMeta(foodType) ? foodTypeLabel(foodType) : categoryMeta(category).label;
  }
  function neighborClash(stallId, category, foodType, start, end){
    var key = goodsKey(category, foodType);
    if (!key || !start || !end) return null;
    var ids = neighborStallIds(stallId);
    var hit = state.activeBookings.find(function(b){
      return ids.indexOf(String(b.stallId)) !== -1 && overlaps(start, end, b.startDate, b.endDate) && goodsKey(b.category, b.foodType) === key;
    });
    if (!hit) return null;
    var s = stallById(hit.stallId);
    return '⚠ ล็อก ' + (s ? s.code : '?') + ' ที่อยู่ติดกันขาย' + goodsLabel(category, foodType) +
      ' ช่วง ' + fmtDate(hit.startDate) + ' – ' + fmtDate(hit.endDate) + ' อยู่แล้ว ตลาดไม่ให้ร้านที่ขายของเหมือนกันอยู่ติดกัน ' +
      'กรุณาเลือกล็อกอื่นหรือช่วงวันอื่น';
  }
  function foodOptionsHtml(choices, selected, placeholder){
    return (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '') + choices.map(function(f){
      return '<option value="'+f.id+'" '+(String(f.id)===String(selected)?'selected':'')+'>'+f.icon+' '+esc(f.label)+'</option>';
    }).join('');
  }

  // ---------- Market Map ----------
  function renderMap(){
    var host = document.getElementById('view-map');
    if (!state.loaded){
      host.innerHTML = '<div class="empty"><div class="big">⏳</div>กำลังโหลดผังตลาด…</div>';
      return;
    }
    var legend =
      '<div class="legend">' +
      '<span><span class="dot" style="background:var(--success)"></span>ว่าง</span>' +
      '<span><span class="dot" style="background:var(--warning)"></span>รอการอนุมัติ</span>' +
      '<span><span class="dot" style="background:var(--danger)"></span>จองแล้ว</span>' +
      '<span><span class="dot" style="background:var(--muted)"></span>ปิด</span>' +
      '</div>';

    var zoneButtons = state.zones.map(function(z){
      return '<button type="button" class="btn small ghost zone-btn" style="--zc:'+zoneColor(z)+'" data-mapzone="'+z.id+'"><span class="zone-dot" style="background:'+zoneColor(z)+'"></span>'+esc(z.name)+'</button>';
    }).join('');

    var oldNews = host.querySelector('.news-list');
    var newsScroll = oldNews ? oldNews.scrollLeft : 0;
    host.innerHTML =
      newsBoardHtml() +
      '<div class="section-head"><h2>ผังตลาด</h2><span class="muted small">แตะที่ล็อกบนแผนผังเพื่อขอจอง</span></div>' +
      '<div class="card isomap-card">' +
        '<div class="isomap-toolbar">' + zoneButtons +
          '<input type="search" class="map-search" id="mapSearch" value="'+esc(state.mapQuery || '')+'" placeholder="ค้นหาล็อก เช่น F3, อาหาร, เครื่องดื่ม, เสื้อผ้า" aria-label="ค้นหารหัสล็อกหรือประเภทสินค้า">' +
        '</div>' +
        mapGoodsResultHtml() +
        '<div class="isomap-wrap"><div class="isomap" id="publicMap"></div>' + mapZoomControls() + '</div>' +
        '<div class="isomap-hint muted small">ลากเพื่อเลื่อนแผนผัง · ใช้ปุ่ม + / − หรือ Ctrl + ล้อเมาส์เพื่อซูม</div>' +
        zoneRulesHtml() +
      '</div>' +
      legend;

    var newsList = host.querySelector('.news-list');
    if (newsList) newsList.scrollLeft = newsScroll;
    host.querySelectorAll('[data-news]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var a = state.announcements.find(function(x){ return String(x.id) === btn.dataset.news; });
        if (a) previewAnnouncement(a);
      });
    });
    mountPublicMap(host);
  }

  // News strip at the top of the market page, so an announcement can still be read after its pop-up has gone.
  var NEWS_NEW_MS = 3 * 24 * 3600 * 1000;
  var NEWS_BADGE = { rule:'rejected', holiday:'pending', event:'approved', news:'cancelled' };
  function newsBoardHtml(){
    var list = (state.announcements || []).slice().sort(function(a, b){ return b.id - a.id; });
    var items = list.map(function(a){
      var isNew = Date.now() - Date.parse(a.created_at) < NEWS_NEW_MS;
      return '<li><button type="button" class="news-item" data-news="'+a.id+'" title="แตะเพื่อเปิดประกาศ">' +
        '<span class="news-meta"><span class="badge '+(NEWS_BADGE[a.type] || 'cancelled')+'">'+esc(announceTypeLabel(a.type))+'</span>' +
          (isNew ? '<span class="pill on-accent small">ใหม่</span>' : '') +
          '<span class="muted small">'+fmtDate((a.created_at || '').slice(0, 10) || todayStr())+'</span></span>' +
        '<span class="news-title">'+esc(a.title)+'</span>' +
        '<span class="news-body">'+esc(a.body)+'</span>' +
      '</button></li>';
    }).join('');
    return '<aside class="card news-board" aria-labelledby="newsHead">' +
      '<div class="news-head"><h3 id="newsHead">ข่าวประกาศ</h3><span class="muted small">'+list.length+' รายการ</span></div>' +
      (items ? '<ul class="news-list">'+items+'</ul>' : '<div class="empty small">ยังไม่มีประกาศ</div>') +
      '</aside>';
  }

  function mapZoomControls(){
    return '<div class="iso-zoom">' +
      '<button type="button" data-mapzoom="in" aria-label="ซูมเข้า">+</button>' +
      '<button type="button" data-mapzoom="out" aria-label="ซูมออก">−</button>' +
      '<button type="button" data-mapzoom="fit" aria-label="ดูทั้งแผนผัง">⤢</button>' +
      '</div>';
  }
  function wireZoomControls(host, ctrl){
    host.querySelectorAll('[data-mapzoom]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var z = btn.dataset.mapzoom;
        if (z === 'in') ctrl.zoom(1.25); else if (z === 'out') ctrl.zoom(0.8); else ctrl.fit();
      });
    });
  }

  function mountPublicMap(host){
    var layout = placeMissingStalls(savedOrAutoLayout());
    var ctrl = IsoMap.create(document.getElementById('publicMap'), {
      layout: layout,
      view: state.mapView,
      wheelNeedsCtrl: true,
      fitToItems: true,
      areas: zoneAreas(layout),
      ariaLabel: 'แผนผังตลาด แตะล็อกเพื่อจอง',
      itemStyle: function(it){
        if (it.kind !== 'stall'){
          var signZone = it.kind === 'text' && state.zones.find(function(z){ return z.name === it.label; });
          return signZone
            ? { title: it.label, color: zoneColor(signZone), cls: 'is-zone-sign' }
            : { title: MAP_KIND_LABELS[it.kind] + (it.label ? ': ' + it.label : '') };
        }
        var s = stallById(it.stallId);
        var st = stallStatus(s);
        var z = zoneById(s.zone_id);
        var hl = state.mapHighlight;
        var hit = !!hl && hl.indexOf(String(s.id)) !== -1;
        return {
          color: STALL_STATUS_COLORS[st],
          zone: zoneColor(z),
          label: s.code,
          title: s.code + ' · ' + (z ? z.name + ' · ' : '') + STALL_STATUS_LABELS[st] + ' · ' + fmtMoney(s.price_per_day) + '/วัน',
          clickable: st !== 'inactive',
          // While a search is active, everything that did not match fades back.
          cls: (st === 'inactive' ? 'is-disabled' : '') + (hl && !hit ? ' is-dim' : ''),
          highlight: hit
        };
      },
      onItemClick: function(idx){
        var it = layout.items[idx];
        if (it.kind !== 'stall') return;
        var s = stallById(it.stallId);
        if (s && stallStatus(s) !== 'inactive') openBookingModal(s.id, state.mapGoods);
      },
      onInteract: function(on){ state.mapInteracting = on; }
    });
    wireZoomControls(host, ctrl);

    host.querySelectorAll('[data-mapzone]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var idxs = [];
        layout.items.forEach(function(it, i){
          var s = it.kind === 'stall' && stallById(it.stallId);
          if (s && String(s.zone_id) === btn.dataset.mapzone) idxs.push(i);
        });
        if (idxs.length) ctrl.focusItems(idxs); else toast('โซนนี้ยังไม่มีล็อกบนแผนผัง', true);
      });
    });

    var idxOf = function(id){
      return layout.items.findIndex(function(it){ return it.kind === 'stall' && String(it.stallId) === String(id); });
    };
    var search = document.getElementById('mapSearch');
    search.addEventListener('keydown', function(e){
      if (e.key !== 'Enter') return;
      var raw = this.value.trim(), q = raw.toLowerCase();
      state.mapQuery = raw;
      if (!q){ clearMapSearch(); return; }
      var s = state.stalls.find(function(x){ return x.code.toLowerCase() === q; }) ||
              state.stalls.find(function(x){ return x.code.toLowerCase().indexOf(q) === 0; });
      if (s){
        var idx = idxOf(s.id);
        if (idx < 0){ toast('ล็อก ' + s.code + ' ยังไม่ได้วางบนแผนผัง', true); return; }
        state.mapGoods = null;
        state.mapHighlight = [String(s.id)];
        state.mapFocusPending = true;
        renderMap();
        return;
      }
      // Not a stall code: maybe goods ("อาหาร", "เครื่องดื่ม", "เสื้อผ้า", "ของใช้" ...).
      var goods = goodsFromQuery(q);
      if (!goods){ toast('ไม่พบล็อกหรือหมวดสินค้า "' + raw + '"', true); return; }
      state.mapGoods = goods;
      state.mapHighlight = freeStallsForGoods(goods).map(function(x){ return String(x.id); });
      state.mapFocusPending = true;
      renderMap();
    });
    search.addEventListener('search', function(){ if (!this.value.trim()) clearMapSearch(); });

    // After a search, zoom to what was found (once; later re-renders keep the user's view).
    if (state.mapFocusPending && state.mapHighlight && state.mapHighlight.length){
      state.mapFocusPending = false;
      var found = state.mapHighlight.map(idxOf).filter(function(i){ return i >= 0; });
      if (found.length) ctrl.focusItems(found);
    }
    host.querySelectorAll('[data-goodsstall]').forEach(function(btn){
      btn.addEventListener('click', function(){ openBookingModal(btn.dataset.goodsstall, state.mapGoods); });
    });
    var clr = document.getElementById('mapSearchClear');
    if (clr) clr.onclick = clearMapSearch;
  }

  function clearMapSearch(){
    state.mapQuery = ''; state.mapGoods = null; state.mapHighlight = null;
    renderMap();
  }

  // Words people type when looking for a kind of stall. The longest matching word wins,
  // so "อาหารสด" finds fresh food rather than all food.
  // Everyday words for the default categories (by name); any category name, or a word of it, also matches.
  var GOODS_SYNONYMS = {
    'อาหารและเครื่องดื่ม':['อาหาร','ของกิน','กิน','food'],
    'เครื่องดื่ม':['เครื่องดื่ม','น้ำ','ดื่ม','กาแฟ','ชา','drink'],
    'ข้าวแกง / อาหารปรุงสำเร็จ':['ข้าวแกง','อาหารปรุงสำเร็จ','กับข้าว'],
    'อาหารตามสั่ง / ก๋วยเตี๋ยว':['ตามสั่ง','ก๋วยเตี๋ยว','อาหารตามสั่ง'],
    'ปิ้งย่าง / ของทอด':['ปิ้งย่าง','ของทอด','ทอด','ย่าง'],
    'ขนมไทย / ของหวาน':['ขนม','ขนมไทย','ของหวาน','หวาน'],
    'เบเกอรี่':['เบเกอรี่','ขนมปัง','เค้ก'],
    'ผลไม้':['ผลไม้'],
    'อาหารสด (ผัก เนื้อ ปลา)':['อาหารสด','ผัก','เนื้อ','ปลา','หมู','ไก่'],
    'เสื้อผ้าและเครื่องประดับ':['เสื้อผ้า','เสื้อ','กางเกง','เครื่องประดับ','แฟชั่น','รองเท้า','กระเป๋า'],
    'สินค้าทั่วไป':['สินค้าทั่วไป','ทั่วไป','ของใช้','ของใช้ในบ้าน'],
    'บริการ':['บริการ'],
    'อื่นๆ':['อื่นๆ','อื่น']
  };
  // The longest matching word wins, so "อาหารสด" finds fresh food rather than all food.
  function goodsFromQuery(q){
    var best = null, bestLen = 0;
    CATEGORY_ROWS.forEach(function(r){
      var words = (GOODS_SYNONYMS[r.name] || []).concat([r.name.toLowerCase()], r.name.toLowerCase().split(/\s*[\/()]\s*|\s+/));
      words.forEach(function(w){
        if (w && w.length >= 2 && q.indexOf(w) !== -1 && w.length > bestLen){ best = r; bestLen = w.length; }
      });
    });
    if (!best) return null;
    return best.parentId
      ? { category: best.parentId, foodType: best.id, label: best.name }
      : { category: best.id, foodType: null, label: best.name };
  }
  function freeStallsForGoods(goods){
    return state.stalls.filter(function(s){
      if (stallStatus(s) !== 'available') return false;
      var z = zoneById(s.zone_id);
      if (!zoneAllowsCategory(z, goods.category)) return false;
      return !goods.foodType || zoneAllowsFood(z, goods.foodType);
    }).sort(function(a, b){
      var za = state.zones.findIndex(function(z){ return String(z.id) === String(a.zone_id); });
      var zb = state.zones.findIndex(function(z){ return String(z.id) === String(b.zone_id); });
      return za - zb || byRowCol(a, b);
    });
  }
  // Result box under the map toolbar after searching for goods.
  function mapGoodsResultHtml(){
    var g = state.mapGoods;
    if (!g) return '';
    var list = freeStallsForGoods(g);
    var zoneNames = [];
    list.forEach(function(s){ var z = zoneById(s.zone_id); if (z && zoneNames.indexOf(z.name) === -1) zoneNames.push(z.name); });
    var head = list.length
      ? 'ล็อกว่างสำหรับ <b>'+esc(g.label)+'</b> '+list.length+' ล็อก · '+esc(zoneNames.join(', '))+' <span class="muted">— แตะรหัสล็อกเพื่อจอง</span>'
      : 'ตอนนี้ไม่มีล็อกว่างที่รับ <b>'+esc(g.label)+'</b>';
    return '<div class="map-goods-result" role="status">' +
      '<div class="map-goods-head"><span>'+head+'</span><button type="button" class="link-btn" id="mapSearchClear">ล้างการค้นหา</button></div>' +
      (list.length ? '<div class="map-goods-list">' + list.map(function(s){
        var z = zoneById(s.zone_id);
        return '<button type="button" class="goods-stall" style="--zc:'+zoneColor(z)+'" data-goodsstall="'+s.id+'">'+esc(s.code)+
          '<span>'+fmtMoney(s.price_per_day)+'</span></button>';
      }).join('') + '</div>' : '') +
    '</div>';
  }

  // ---------- Booking modal ----------
  // What the vendor chose last time: saved in this browser after each booking, otherwise taken from their
  // most recent booking in "my bookings" (so a member gets it on a new device too).
  function lastBookingChoices(){
    if (profile.lastBooking) return profile.lastBooking;
    var latest = (state.myBookings || []).slice().sort(function(a, b){ return b.id - a.id; })[0];
    if (!latest) return {};
    return { category: latest.category, foodType: latest.food_type || null,
      days: daysInclusive(latest.start_date, latest.end_date), note: latest.note || '' };
  }

  function openBookingModal(stallId, goodsHint){
    var stall = state.stalls.find(function(s){ return String(s.id)===String(stallId); });
    if (!stall) return;

    var zone = zoneById(stall.zone_id);
    var root = document.getElementById('modalRoot');
    var minDate = todayStr();
    var isRegistered = profile.isRegistered;
    var regularRate = stall.regular_price_per_day != null ? stall.regular_price_per_day : stall.price_per_day;
    // A registered account picks only the goods it signed up to sell (the server checks this too),
    // and only goods this stall's zone accepts (e.g. a drinks-only row).
    var myCat = isRegistered && profile.category ? String(profile.category) : null;
    var myKind = isRegistered && profile.foodType ? String(profile.foodType) : null;
    var kindChoicesFor = function(catId){
      return kindsOf(catId).filter(function(f){ return (!myKind || String(f.id) === myKind) && zoneAllowsFood(zone, f.id); });
    };
    var catChoices = CATEGORIES.filter(function(c){
      return (!myCat || String(c.id) === myCat) && zoneAllowsCategory(zone, c.id) && (!hasKinds(c.id) || kindChoicesFor(c.id).length);
    });
    var zoneRule = zoneAllowed(zone).length ? zoneAllowedLabel(zone) : '';
    if (!catChoices.length){
      root.innerHTML =
        '<div class="modal-back" id="mb"><div class="modal">' +
        '<h3>จองล็อก '+esc(stall.code)+' ไม่ได้</h3>' +
        '<div class="clash-note" role="alert">ล็อกนี้อยู่ใน'+esc(zone ? zone.name : 'โซนนี้')+' ซึ่งรับเฉพาะ'+esc(zoneRule)+
          ' ไม่ตรงกับสินค้าที่บัญชีนี้ลงทะเบียนไว้ กรุณาเลือกล็อกในโซนอื่น</div>' +
        '<div class="form-actions"><button type="button" class="btn primary" id="bfCancel">ตกลง</button></div>' +
        '</div></div>';
      document.getElementById('bfCancel').onclick = closeModal;
      document.getElementById('mb').addEventListener('click', function(e){ if (e.target.id === 'mb') closeModal(); });
      return;
    }
    // Auto-fill from what this vendor did last time: remembered in this browser, or their latest booking.
    var prev = lastBookingChoices();
    var inChoices = function(id){ return id != null && catChoices.some(function(c){ return String(c.id) === String(id); }); };
    // Goods the vendor searched for on the map come first.
    var hint = goodsHint || {};
    var myCategory = inChoices(hint.category) ? hint.category : inChoices(prev.category) ? prev.category : catChoices[0].id;
    var autoFilled = !!(prev.category || prev.days || prev.note) || !!(profile.vendorName || profile.vendorPhone);
    var endDefault = prev.days > 1 ? addDaysIso(minDate, prev.days - 1) : minDate;

    var catOptions = catChoices.map(function(c){
      return '<option value="'+c.id+'" '+(String(c.id)===String(myCategory)?'selected':'')+'>'+c.icon+' '+esc(c.label)+'</option>';
    }).join('');
    var kindPick = function(catId){
      var list = kindChoicesFor(catId);
      var has = function(id){ return id != null && list.some(function(f){ return String(f.id) === String(id); }); };
      return list.length === 1 ? list[0].id : has(hint.foodType) ? hint.foodType : has(prev.foodType) ? prev.foodType : '';
    };
    var kindOptions = function(catId){
      var list = kindChoicesFor(catId);
      return foodOptionsHtml(list, kindPick(catId), list.length === 1 ? null : '— เลือกชนิดสินค้า —');
    };

    root.innerHTML =
      '<div class="modal-back" id="mb"><div class="modal">' +
      '<h3>จองล็อก '+esc(stall.code)+'</h3>' +
      '<div class="sub">'+esc(zone?zone.name:'')+' · ราคาขาจร '+fmtMoney(stall.price_per_day)+'/วัน · ราคาขาประจำ '+fmtMoney(regularRate)+'/วัน</div>' +
      (zoneRule ? '<p class="zone-rule">โซนนี้รับเฉพาะ: <b>'+esc(zoneRule)+'</b></p>' : '') +
      (autoFilled ? '<p class="autofill-note" id="bfAutoNote">✨ กรอกข้อมูลจากการจองครั้งก่อนให้แล้ว ตรวจสอบแล้วกดส่งคำขอได้เลย <button type="button" class="link-btn" id="bfClearAuto">ล้างข้อมูล</button></p>' : '') +
      '<form id="bookForm" autocomplete="on">' +
        (isRegistered
          ? '<p class="muted small" style="margin:0 0 10px">จองในชื่อ <b>'+esc(profile.vendorName)+'</b> · '+esc(profile.vendorPhone)+'</p>'
          : '<div class="field"><label for="bfName">ชื่อ-นามสกุลผู้ค้า</label><input id="bfName" name="name" autocomplete="name" required value="'+esc(profile.vendorName)+'"></div>' +
            '<div class="field"><label for="bfPhone">เบอร์โทรศัพท์</label><input id="bfPhone" name="tel" type="tel" inputmode="tel" autocomplete="tel" required value="'+esc(profile.vendorPhone)+'" placeholder="08XXXXXXXX"></div>') +
        '<div class="field"><label for="bfCat">ประเภทสินค้า</label><select id="bfCat">'+catOptions+'</select></div>' +
        '<div class="field" id="bfFoodWrap" hidden><label for="bfFood">ชนิดสินค้า</label><select id="bfFood">'+kindOptions(myCategory)+'</select></div>' +
        '<div class="field-row">' +
          '<div class="field"><label for="bfStart">วันที่เริ่ม</label><input type="date" id="bfStart" required min="'+minDate+'" value="'+minDate+'"></div>' +
          '<div class="field"><label for="bfEnd">วันที่สิ้นสุด</label><input type="date" id="bfEnd" required min="'+minDate+'" value="'+endDefault+'"></div>' +
        '</div>' +
        '<div class="clash-note" id="bfClash" role="alert" hidden></div>' +
        '<div class="field"><label for="bfNote">ข้อความถึงเจ้าหน้าที่ตลาด (ถ้ามี)</label><textarea id="bfNote" rows="2" placeholder="เช่น ขายลูกชิ้นปิ้ง ต้องการปลั๊กไฟ">'+esc(prev.note || '')+'</textarea></div>' +
        '<p class="deposit-note" id="bfTotal"></p>' +
        '<p class="deposit-note">ยังไม่ต้องจ่ายเงินตอนนี้ — เมื่อเจ้าหน้าที่ตลาดอนุมัติแล้ว ปุ่ม "ชำระเงิน" จะขึ้นในหน้า "การจองของฉัน" ผู้ค้าขาประจำได้ราคาขาประจำโดยอัตโนมัติ</p>' +
        (isRegistered ? '' : '<label class="checkline consent"><input type="checkbox" id="bfConsent"' + (profile.consent ? ' checked' : '') + '> ' +
          'ยินยอมให้ตลาดเก็บชื่อและเบอร์โทรศัพท์ เพื่อใช้ติดต่อเรื่องการจองเท่านั้น (พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล)</label>') +
        '<div class="form-error" id="bfErr"></div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn ghost" id="bfCancel">ยกเลิก</button>' +
          '<button type="submit" class="btn primary">ส่งคำขอ</button>' +
        '</div>' +
      '</form>' +
      '</div></div>';

    var back = document.getElementById('mb');
    back.addEventListener('click', function(e){ if (e.target===back) closeModal(); });
    document.getElementById('bfCancel').onclick = closeModal;
    var catSel = document.getElementById('bfCat'), foodSel = document.getElementById('bfFood');
    var startEl = document.getElementById('bfStart'), endEl = document.getElementById('bfEnd');
    var clashEl = document.getElementById('bfClash');
    var submitBtn = root.querySelector('#bookForm button[type=submit]');
    var rateNow = profile.isRegistered && profile.user && profile.user.isRegular ? regularRate : stall.price_per_day;
    var syncGoods = function(){
      var withKinds = hasKinds(catSel.value);
      document.getElementById('bfFoodWrap').hidden = !withKinds;
      var clash = neighborClash(stall.id, catSel.value, withKinds ? foodSel.value : null, startEl.value, endEl.value);
      clashEl.hidden = !clash;
      clashEl.textContent = clash || '';
      submitBtn.disabled = !!clash;
      var days = startEl.value && endEl.value && endEl.value >= startEl.value ? daysInclusive(startEl.value, endEl.value) : 0;
      document.getElementById('bfTotal').innerHTML = days
        ? 'ยอดเงินรวม ' + fmtMoney(rateNow) + ' × ' + days + ' วัน = <strong>' + fmtMoney(rateNow * days) + '</strong>'
        : '';
    };
    catSel.addEventListener('change', function(){ foodSel.innerHTML = kindOptions(catSel.value); syncGoods(); });
    [foodSel, startEl, endEl].forEach(function(el){ el.addEventListener('change', syncGoods); });
    // Moving the start date keeps the same number of days; the end date never falls before the start.
    var lastStart = startEl.value;
    startEl.addEventListener('change', function(){
      if (lastStart && endEl.value >= lastStart && startEl.value){
        endEl.value = addDaysIso(startEl.value, daysInclusive(lastStart, endEl.value) - 1);
      } else if (endEl.value < startEl.value){
        endEl.value = startEl.value;
      }
      endEl.min = startEl.value || minDate;
      lastStart = startEl.value;
      syncGoods();
    });
    var clearBtn = document.getElementById('bfClearAuto');
    if (clearBtn) clearBtn.onclick = function(){
      if (!isRegistered){ document.getElementById('bfName').value = ''; document.getElementById('bfPhone').value = ''; }
      catSel.value = catChoices[0].id;
      foodSel.innerHTML = kindOptions(catSel.value);
      var only = kindChoicesFor(catSel.value);
      foodSel.value = only.length === 1 ? only[0].id : '';
      startEl.value = minDate; endEl.value = minDate; lastStart = minDate;
      document.getElementById('bfNote').value = '';
      document.getElementById('bfAutoNote').hidden = true;
      syncGoods();
    };
    syncGoods();
    document.getElementById('bookForm').addEventListener('submit', function(e){
      e.preventDefault();
      var name = isRegistered ? profile.vendorName : document.getElementById('bfName').value.trim();
      var phone = isRegistered ? profile.vendorPhone : document.getElementById('bfPhone').value.trim();
      var consent = isRegistered || document.getElementById('bfConsent').checked;
      var category = Number(catSel.value);
      var foodType = hasKinds(category) ? Number(foodSel.value) || null : null;
      var start = startEl.value;
      var end = endEl.value;
      var note = document.getElementById('bfNote').value.trim();
      var errEl = document.getElementById('bfErr');
      if (!name || !phone || !start || !end){ errEl.textContent = 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ'; return; }
      if (end < start){ errEl.textContent = 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม'; return; }
      if (hasKinds(category) && !foodType){ errEl.textContent = 'กรุณาเลือกชนิดสินค้า'; return; }
      if (!consent){ errEl.textContent = 'กรุณาติ๊กยินยอมให้เก็บชื่อและเบอร์โทรศัพท์ก่อนส่งคำขอ'; return; }

      if (!isRegistered){ profile.vendorName = name; profile.vendorPhone = phone; profile.consent = true; }
      profile.lastBooking = { category: category, foodType: foodType, days: daysInclusive(start, end), note: note };
      saveProfile();
      submitBtn.disabled = true;

      apiPost('/api/bookings', {
        stallId: stall.id, vendorToken: profile.vendorToken, vendorName: name, vendorPhone: phone, consent: true,
        category: category, foodType: foodType, startDate: start, endDate: end, note: note || null
      }).then(function(){
        toast('ส่งคำขอจองล็อก ' + stall.code + ' แล้ว');
        closeModal();
        setTab('mine');
        loadPublicData();
      }).catch(function(err){
        errEl.textContent = err.error || 'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่';
        submitBtn.disabled = false;
      });
    });
  }
  function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    var title = document.querySelector('.mc-title');
    if (title) title.close();
    else if (document.getElementById('modalRoot').innerHTML) closeModal();
  });

  function confirmAction(message, onConfirm, okLabel){
    var root = document.getElementById('modalRoot');
    root.innerHTML =
      '<div class="modal-back" id="mb"><div class="modal">' +
      '<h3>ยืนยันหรือไม่?</h3>' +
      '<div class="sub">'+esc(message)+'</div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn ghost" id="cfCancel">ยกเลิก</button>' +
        '<button type="button" class="btn danger" id="cfOk">'+esc(okLabel || 'ลบ')+'</button>' +
      '</div>' +
      '</div></div>';
    var back = document.getElementById('mb');
    back.addEventListener('click', function(e){ if (e.target===back) closeModal(); });
    document.getElementById('cfCancel').onclick = closeModal;
    document.getElementById('cfOk').onclick = function(){ closeModal(); onConfirm(); };
  }

  function openImageModal(url, title){
    var root = document.getElementById('modalRoot');
    root.innerHTML =
      '<div class="modal-back" id="mb"><div class="modal image-modal">' +
      '<h3>'+esc(title||'รูปภาพ')+'</h3>' +
      '<button type="button" class="btn ghost small" id="imgClose">ปิด</button>' +
      '<img src="'+esc(url)+'" alt="'+esc(title||'รูปภาพ')+' ขนาดเต็ม">' +
      '</div></div>';
    var back = document.getElementById('mb');
    back.addEventListener('click', function(e){ if (e.target===back) closeModal(); });
    document.getElementById('imgClose').onclick = closeModal;
  }
  function wireReceiptThumbs(host){
    host.querySelectorAll('.receipt-thumb').forEach(function(img){
      img.addEventListener('click', function(e){
        e.preventDefault();
        openImageModal(img.dataset.full, img.dataset.title || 'สลิปการชำระเงิน');
      });
    });
  }

  // Radio chips for one goods category, plus its kinds when it has them (registration and the user form).
  function goodsPickerHtml(prefix, cat, kind){
    var cats = CATEGORIES.map(function(c){
      return '<label class="check-chip"><input type="radio" name="'+prefix+'Cat" value="'+c.id+'"'+(String(c.id)===String(cat)?' checked':'')+'>'+c.icon+' '+esc(c.label)+'</label>';
    }).join('');
    var kinds = CATEGORIES.filter(function(c){ return hasKinds(c.id); }).map(function(c){
      return '<div class="field food-types" data-kindsof="'+c.id+'"'+(String(c.id)===String(cat)?'':' hidden')+'>' +
        '<span class="field-label">ชนิดของ'+esc(c.label)+' <span class="muted">(เลือก 1 ชนิด)</span></span><div class="check-grid">' +
        kindsOf(c.id).map(function(f){
          return '<label class="check-chip"><input type="radio" name="'+prefix+'Kind" value="'+f.id+'"'+(String(f.id)===String(kind)?' checked':'')+'>'+f.icon+' '+esc(f.label)+'</label>';
        }).join('') + '</div></div>';
    }).join('');
    return '<div class="field"><span class="field-label">ประเภทสินค้าที่ขาย <span class="muted">(เลือก 1 ประเภท)</span></span>' +
      '<div class="check-grid" role="radiogroup">'+cats+'</div></div>' + kinds;
  }
  function bindGoodsPicker(root, prefix){
    root.querySelectorAll('input[name="'+prefix+'Cat"]').forEach(function(radio){
      radio.addEventListener('change', function(){
        root.querySelectorAll('[data-kindsof]').forEach(function(box){ box.hidden = box.dataset.kindsof !== radio.value; });
      });
    });
  }
  function readGoodsPicker(root, prefix){
    var cat = checkedValues(root, prefix + 'Cat')[0];
    if (!cat) return { category: null, foodType: null };
    var kind = hasKinds(cat) ? (root.querySelector('[data-kindsof="'+cat+'"] input:checked') || {}).value : null;
    return { category: Number(cat), foodType: kind ? Number(kind) : null };
  }

  var PDPA_NOTICE = 'ตลาดนัดโรงพยาบาลสมเด็จพระปิ่นเกล้าเก็บชื่อ นามสกุล เบอร์โทรศัพท์ ที่อยู่ และ Line ID ของท่าน ' +
    'เพื่อใช้ยืนยันตัวตน ติดต่อเรื่องการจองและการชำระเงินเท่านั้น ไม่เปิดเผยต่อบุคคลภายนอก ' +
    'ท่านขอแก้ไขข้อมูลได้ที่เมนู "ข้อมูลส่วนตัว" หรือขอลบข้อมูลได้ที่สำนักงานตลาด';

  // ---------- Account sign-in / registration modal ----------
  function openAuthModal(mode){
    mode = mode === 'register' ? 'register' : 'login';
    var root = document.getElementById('modalRoot');

    var loginFields =
      '<div class="field"><label for="afUser">ชื่อผู้ใช้</label><input id="afUser" autocomplete="username" required></div>' +
      '<div class="field"><label for="afPass">รหัสผ่าน</label><input id="afPass" type="password" autocomplete="current-password" required></div>';

    var guessName = (profile.vendorName || '').split(/\s+/);
    var registerFields =
      '<div class="field-row">' +
        '<div class="field"><label for="afFirst">ชื่อ</label><input id="afFirst" autocomplete="given-name" required value="'+esc(guessName[0]||'')+'"></div>' +
        '<div class="field"><label for="afLast">นามสกุล</label><input id="afLast" autocomplete="family-name" required value="'+esc(guessName.slice(1).join(' '))+'"></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="afPhone">เบอร์โทรศัพท์</label><input id="afPhone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="08XXXXXXXX" value="'+esc(profile.vendorPhone)+'"></div>' +
        '<div class="field"><label for="afLine">Line ID <span class="muted">(ถ้ามี)</span></label><input id="afLine"></div>' +
      '</div>' +
      '<div class="field"><label for="afAddr">ที่อยู่</label><textarea id="afAddr" rows="2" autocomplete="street-address"></textarea></div>' +
      goodsPickerHtml('af', null, null) +
      '<div class="field-row">' +
        '<div class="field"><label for="afUser">ชื่อผู้ใช้ <span class="muted">(a-z 0-9)</span></label><input id="afUser" autocomplete="username" required></div>' +
        '<div class="field"><label for="afPass">รหัสผ่าน</label><input id="afPass" type="password" autocomplete="new-password" required></div>' +
      '</div>' +
      '<div class="pdpa-box"><p>'+esc(PDPA_NOTICE)+'</p>' +
        '<label class="checkline"><input type="checkbox" id="afConsent"> ยินยอมให้เก็บและใช้ข้อมูลส่วนบุคคลตามที่แจ้งไว้ข้างต้น</label></div>';

    root.innerHTML =
      '<div class="modal-back" id="mb"><div class="modal">' +
      '<div class="auth-toggle" id="authToggle">' +
        '<button type="button" class="auth-toggle-btn '+(mode==='login'?'active':'')+'" data-authmode="login">เข้าสู่ระบบ</button>' +
        '<button type="button" class="auth-toggle-btn '+(mode==='register'?'active':'')+'" data-authmode="register">สมัครสมาชิกผู้ค้า</button>' +
      '</div>' +
      '<div class="sub" style="margin-bottom:16px">'+(mode==='register'
        ? 'สมัครสมาชิกครั้งเดียว เพื่อติดตามการจองจากทุกอุปกรณ์และไม่ต้องกรอกข้อมูลซ้ำ'
        : 'ผู้ดูแลระบบ เจ้าหน้าที่ตลาด และผู้ค้า เข้าสู่ระบบที่นี่ ระบบจะแสดงเมนูตามสิทธิ์ของแต่ละบัญชี') + '</div>' +
      '<form id="authForm">' + (mode==='register' ? registerFields : loginFields) +
        '<div class="form-error" id="afErr"></div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn ghost" id="afCancel">ยกเลิก</button>' +
          '<button type="submit" class="btn primary">'+(mode==='register' ? 'สร้างบัญชี' : 'เข้าสู่ระบบ')+'</button>' +
        '</div>' +
      '</form>' +
      '</div></div>';

    var back = document.getElementById('mb');
    back.addEventListener('click', function(e){ if (e.target===back) closeModal(); });
    document.getElementById('afCancel').onclick = closeModal;
    document.getElementById('authToggle').querySelectorAll('.auth-toggle-btn').forEach(function(btn){
      btn.addEventListener('click', function(){ openAuthModal(btn.dataset.authmode); });
    });
    if (mode === 'register') bindGoodsPicker(root, 'af');

    var signedIn = function(res, welcome){
      saveToken(res.token);
      applySessionUser(res.user);
      closeModal();
      toast(welcome + res.user.name);
      if (profile.isAdmin){ state.adminMenu = firstMenu(); setTab('admin'); }
      else setTab('mine');
    };

    document.getElementById('authForm').addEventListener('submit', function(e){
      e.preventDefault();
      var errEl = document.getElementById('afErr');
      var submitBtn = e.target.querySelector('button[type=submit]');
      var username = document.getElementById('afUser').value.trim();
      var password = document.getElementById('afPass').value;

      if (mode === 'register'){
        var body = {
          firstName: document.getElementById('afFirst').value.trim(),
          lastName: document.getElementById('afLast').value.trim(),
          phone: document.getElementById('afPhone').value.trim(),
          lineId: document.getElementById('afLine').value.trim(),
          address: document.getElementById('afAddr').value.trim(),
          username: username, password: password,
          consent: document.getElementById('afConsent').checked
        };
        var goods = readGoodsPicker(root, 'af');
        body.category = goods.category; body.foodType = goods.foodType;
        if (!body.firstName || !body.lastName || !body.phone || !username || !password){ errEl.textContent = 'กรุณากรอกชื่อ นามสกุล เบอร์โทรศัพท์ ชื่อผู้ใช้ และรหัสผ่านให้ครบ'; return; }
        if (!goods.category){ errEl.textContent = 'กรุณาเลือกประเภทสินค้าที่จะขาย 1 ประเภท'; return; }
        if (hasKinds(goods.category) && !goods.foodType){ errEl.textContent = 'กรุณาเลือกชนิดของ' + categoryMeta(goods.category).label; return; }
        if (!body.consent){ errEl.textContent = 'กรุณาติ๊กยินยอมให้เก็บข้อมูลส่วนบุคคลก่อนสมัครสมาชิก'; return; }
        submitBtn.disabled = true;
        apiPost('/api/auth/register', body)
          .then(function(res){ signedIn(res, 'สร้างบัญชีสำเร็จ — ยินดีต้อนรับ '); })
          .catch(function(err){ errEl.textContent = err.error || 'สร้างบัญชีไม่สำเร็จ'; submitBtn.disabled = false; });
        return;
      }

      if (!username || !password){ errEl.textContent = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'; return; }
      submitBtn.disabled = true;
      apiPost('/api/auth/login', { username:username, password:password })
        .then(function(res){ signedIn(res, 'เข้าสู่ระบบในชื่อ '); })
        .catch(function(err){ errEl.textContent = err.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'; submitBtn.disabled = false; });
    });
  }

  // 1.3 ผู้ใช้แก้ไขข้อมูลส่วนตัวของตนเอง
  function openProfileModal(){
    var u = profile.user || {};
    var root = document.getElementById('modalRoot');
    root.innerHTML =
      '<div class="modal-back" id="mb"><div class="modal">' +
      '<h3>ข้อมูลส่วนตัว</h3>' +
      '<div class="sub">'+esc(ROLE_LABELS[u.roleId]||'')+(u.username ? ' · ชื่อผู้ใช้ '+esc(u.username) : '')+
        (u.roleId === ROLE.VENDOR && u.category ? ' · ขาย'+esc(goodsLabel(u.category, u.foodType)) : '')+'</div>' +
      '<form id="pfForm">' +
        '<div class="field-row">' +
          '<div class="field"><label for="pfFirst">ชื่อ</label><input id="pfFirst" required value="'+esc(u.firstName||'')+'"></div>' +
          '<div class="field"><label for="pfLast">นามสกุล</label><input id="pfLast" required value="'+esc(u.lastName||'')+'"></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label for="pfPhone">เบอร์โทรศัพท์</label><input id="pfPhone" type="tel" required value="'+esc(u.phone||'')+'"></div>' +
          '<div class="field"><label for="pfLine">Line ID</label><input id="pfLine" value="'+esc(u.lineId||'')+'"></div>' +
        '</div>' +
        '<div class="field"><label for="pfAddr">ที่อยู่</label><textarea id="pfAddr" rows="2">'+esc(u.address||'')+'</textarea></div>' +
        '<details class="pf-pass"><summary>เปลี่ยนรหัสผ่าน</summary><div class="field-row">' +
          '<div class="field"><label for="pfCur">รหัสผ่านปัจจุบัน</label><input id="pfCur" type="password" autocomplete="current-password"></div>' +
          '<div class="field"><label for="pfNew">รหัสผ่านใหม่</label><input id="pfNew" type="password" autocomplete="new-password"></div>' +
        '</div></details>' +
        '<div class="form-error" id="pfErr"></div>' +
        '<div class="form-actions"><button type="button" class="btn ghost" id="pfCancel">ยกเลิก</button><button type="submit" class="btn primary">บันทึก</button></div>' +
      '</form></div></div>';
    var back = document.getElementById('mb');
    back.addEventListener('click', function(e){ if (e.target===back) closeModal(); });
    document.getElementById('pfCancel').onclick = closeModal;
    document.getElementById('pfForm').addEventListener('submit', function(e){
      e.preventDefault();
      var btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      apiPut('/api/auth/me', {
        firstName: document.getElementById('pfFirst').value.trim(), lastName: document.getElementById('pfLast').value.trim(),
        phone: document.getElementById('pfPhone').value.trim(), lineId: document.getElementById('pfLine').value.trim(),
        address: document.getElementById('pfAddr').value.trim(),
        currentPassword: document.getElementById('pfCur').value, newPassword: document.getElementById('pfNew').value || undefined
      }).then(function(user){
        applySessionUser(user);
        closeModal();
        toast('บันทึกข้อมูลส่วนตัวแล้ว');
        render();
      }).catch(function(err){
        document.getElementById('pfErr').textContent = err.error || 'บันทึกไม่สำเร็จ';
        btn.disabled = false;
      });
    });
  }

  // Booking progress like a parcel tracker: 1 ส่งคำขอ → 2 อนุมัติ → 3 ชำระเงิน → 4 ยืนยันรับเงิน.
  function bookingTimelineHtml(b){
    var pay = b.payment_status || 'unpaid';
    var stopped = b.status === 'rejected' || b.status === 'cancelled';
    var reached = 1;
    if (b.status === 'approved') reached = pay === 'confirmed' ? 4 : pay === 'paid' ? 3 : 2;
    var steps = [
      ['ส่งคำขอ', fmtDateTime(b.created_at)],
      [b.status === 'rejected' ? 'ถูกปฏิเสธ' : 'อนุมัติ', b.decided_at && b.status !== 'cancelled' ? fmtDateTime(b.decided_at) : ''],
      ['ชำระเงิน', b.paid_at ? fmtDateTime(b.paid_at) : ''],
      ['ยืนยันรับเงิน', b.confirmed_at ? fmtDateTime(b.confirmed_at) : '']
    ];
    var html = steps.map(function(s, i){
      var n = i + 1;
      var cls = n <= reached ? 'done' : (n === reached + 1 && !stopped ? 'next' : '');
      if (stopped && n === 2) cls = 'stop';
      return '<li class="tl-step '+cls+'"><span class="tl-dot">'+(cls === 'stop' ? '✕' : n)+'</span>' +
        '<span class="tl-label">'+esc(s[0])+'</span>'+(s[1] ? '<span class="tl-time">'+esc(s[1])+'</span>' : '')+'</li>';
    }).join('');
    return '<ol class="timeline'+(stopped ? ' is-stopped' : '')+'" aria-label="สถานะการจอง">'+html+'</ol>' +
      (b.status === 'cancelled' ? '<div class="muted small">การจองนี้ถูกยกเลิกแล้ว</div>' : '');
  }
  function fmtDateTime(iso){
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getDate() + ' ' + TH_MONTHS[d.getMonth()] + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // ---------- My Bookings (4.4 ติดตามสถานะการจอง) ----------
  function renderMine(){
    var host = document.getElementById('view-mine');
    if (!state.myBookingsLoaded){
      host.innerHTML = '<div class="empty"><div class="big">⏳</div>กำลังโหลดการจองของคุณ…</div>';
      return;
    }
    var all = state.myBookings || [];
    if (!all.length){
      host.innerHTML = '<div class="section-head"><h2>การจองของฉัน</h2></div>' +
        '<div class="empty"><div class="big">🧺</div>ยังไม่มีคำขอจอง<br>ไปที่ผังตลาดเพื่อขอจองล็อก</div>';
      return;
    }
    var filter = state.myFilter || 'all';
    var mine = all.filter(function(b){ return filter === 'all' || b.status === filter; });
    var bar = ['all','pending','approved','rejected','cancelled'].map(function(s){
      var n = s === 'all' ? all.length : all.filter(function(b){ return b.status === s; }).length;
      return '<button class="btn small '+(filter===s?'primary':'ghost')+'" data-myfilt="'+s+'">'+(s==='all'?'ทั้งหมด':statusLabel(s))+' ('+n+')</button>';
    }).join('');
    var rows = mine.map(function(b){
      var payStatus = b.payment_status || 'unpaid';
      var approved = b.status === 'approved';
      var upcoming = b.end_date >= todayStr();
      var canCancel = (b.status==='pending' || approved) && upcoming && payStatus === 'unpaid';
      var canPay = approved && upcoming && payStatus === 'unpaid';
      var canAttachReceipt = approved && payStatus === 'paid' && b.payment_method !== 'cash';
      var hint = '';
      if (b.status === 'pending') hint = 'รอเจ้าหน้าที่ตลาดอนุมัติก่อนชำระเงิน';
      else if (approved && payStatus === 'unpaid') hint = 'อนุมัติแล้ว กรุณาชำระเงิน';
      else if (approved && payStatus === 'paid') hint = b.payment_method === 'cash' ? 'แจ้งชำระเงินสดแล้ว — รอเจ้าหน้าที่ตลาดยืนยัน' : (b.receipt_path ? 'ส่งสลิปแล้ว — รอเจ้าหน้าที่ตลาดยืนยัน' : 'กรุณาแนบสลิปเพื่อให้เจ้าหน้าที่ตลาดตรวจสอบ');
      else if (approved && payStatus === 'confirmed') hint = 'เจ้าหน้าที่ตลาดยืนยันรับเงินแล้ว';
      return '<div class="booking-card">' +
        '<div class="booking-row">' +
        '<div class="who"><div class="name">'+categoryMeta(b.category).icon+' '+esc(b.stall_code||'—')+' · '+esc(b.zone_name||'')+'</div>' +
        '<div class="stalltag">'+esc(b.goods_label || goodsLabel(b.category, b.food_type))+' · '+fmtMoney(b.total_amount)+' (ราคา'+esc(rateLabel(b.rate_type))+')</div>' +
        (hint ? '<div class="muted small">'+esc(hint)+'</div>' : '') + '</div>' +
        '<div class="dates">'+fmtDate(b.start_date)+' → '+fmtDate(b.end_date)+(b.note?'<br><span class="small">"'+esc(b.note)+'"</span>':'')+'</div>' +
        (b.receipt_path ? '<a href="'+esc(b.receipt_path)+'" target="_blank" rel="noopener"><img class="receipt-thumb" src="'+esc(b.receipt_path)+'" data-full="'+esc(b.receipt_path)+'" alt="สลิปการชำระเงิน แตะเพื่อขยาย"></a>' : '') +
        '<div class="row-actions">' +
        (canPay ? '<button class="btn small primary" data-pay="'+b.id+'">ชำระเงิน '+fmtMoney(b.total_amount)+'</button>' : '') +
        (canAttachReceipt ? '<button class="btn small ghost" data-addreceipt="'+b.id+'">'+(b.receipt_path?'เปลี่ยนสลิป':'แนบสลิป')+'</button>' : '') +
        (canCancel ? '<button class="btn small danger" data-cancel="'+b.id+'">ยกเลิกการจอง</button>' : '') +
        '</div>' +
        '</div>' +
        bookingTimelineHtml(b) +
        '</div>';
    }).join('');
    host.innerHTML = '<div class="section-head"><h2>การจองของฉัน</h2><span class="muted small">'+all.length+' รายการ</span></div>' +
      '<div class="filter-bar">'+bar+'</div>' +
      '<div class="booking-list">'+(rows || '<div class="empty small">ไม่มีการจองในสถานะนี้</div>')+'</div>';

    host.querySelectorAll('[data-myfilt]').forEach(function(btn){
      btn.addEventListener('click', function(){ state.myFilter = btn.dataset.myfilt; renderMine(); });
    });
    host.querySelectorAll('[data-cancel]').forEach(function(btn){
      btn.addEventListener('click', function(){
        confirmAction('ยกเลิกการจองนี้? ล็อกจะกลับเป็นว่างให้ผู้อื่นจองได้', function(){
          apiDelete('/api/bookings/' + btn.dataset.cancel)
            .then(function(){ toast('ยกเลิกการจองแล้ว'); loadMyBookings(); loadPublicData(); })
            .catch(function(err){ toast((err && err.error) || 'ยกเลิกไม่สำเร็จ', true); });
        }, 'ยกเลิกการจอง');
      });
    });
    host.querySelectorAll('[data-pay]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var b = all.find(function(x){ return String(x.id) === btn.dataset.pay; });
        if (b) openPayModal(b);
      });
    });
    host.querySelectorAll('[data-addreceipt]').forEach(function(btn){
      btn.addEventListener('click', function(){ requestReceiptUpload(btn.dataset.addreceipt); });
    });
    wireReceiptThumbs(host);
  }

  function openPayModal(b){
    var root = document.getElementById('modalRoot');
    var qr = state.settings.promptPayQrUrl;
    var payOptions = PAYMENT_METHODS.map(function(m){ return '<option value="'+m.id+'">'+esc(m.label)+'</option>'; }).join('');
    root.innerHTML =
      '<div class="modal-back" id="mb"><div class="modal">' +
      '<h3>ชำระค่าเช่าล็อก '+esc(b.stall_code||'')+'</h3>' +
      '<div class="sub">'+fmtDate(b.start_date)+' → '+fmtDate(b.end_date)+' · ราคา'+esc(rateLabel(b.rate_type))+'</div>' +
      '<div class="deposit-box">' +
        '<div class="deposit-row"><span>ยอดที่ต้องชำระ</span><strong>'+fmtMoney(b.total_amount)+'</strong></div>' +
        '<div class="field" style="margin-top:10px"><label for="payMethod">วิธีการชำระเงิน</label><select id="payMethod">'+payOptions+'</select></div>' +
        (qr ? '<div class="qr-scan" id="payQr"><img class="receipt-thumb" style="width:150px;height:150px" src="'+esc(qr)+'" data-full="'+esc(qr)+'" data-title="QR โค้ดพร้อมเพย์" alt="QR โค้ดพร้อมเพย์ แตะเพื่อขยาย"><span class="muted small">สแกนด้วยแอปธนาคาร แล้วโอน '+fmtMoney(b.total_amount)+'</span></div>'
            : '<p class="deposit-note" id="payQr">ยังไม่มี QR พร้อมเพย์ กรุณาสอบถามเลขบัญชีจากเจ้าหน้าที่ตลาด</p>') +
        '<p class="deposit-note" id="payHint"></p>' +
      '</div>' +
      '<div class="form-error" id="payErr"></div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn ghost" id="payCancel">ยกเลิก</button>' +
        '<button type="button" class="btn primary" id="payDone">โอนเงินแล้ว</button>' +
      '</div>' +
      '</div></div>';

    var back = document.getElementById('mb');
    back.addEventListener('click', function(e){ if (e.target===back) closeModal(); });
    document.getElementById('payCancel').onclick = closeModal;
    wireReceiptThumbs(root);
    var methodSel = document.getElementById('payMethod');
    var syncMethod = function(){
      var m = methodSel.value;
      document.getElementById('payQr').hidden = m !== 'promptpay';
      document.getElementById('payHint').textContent = m === 'cash'
        ? 'ชำระเป็นเงินสดที่สำนักงานตลาด แล้วกด "แจ้งชำระแล้ว" เจ้าหน้าที่จะยืนยันเมื่อได้รับเงิน'
        : 'โอนเสร็จแล้วกด "โอนเงินแล้ว" จากนั้นกด "แนบสลิป" ในหน้าการจองของฉัน เพื่อให้เจ้าหน้าที่ตรวจสอบ';
      document.getElementById('payDone').textContent = m === 'cash' ? 'แจ้งชำระแล้ว' : 'โอนเงินแล้ว';
    };
    methodSel.addEventListener('change', syncMethod);
    syncMethod();
    document.getElementById('payDone').onclick = function(){
      var btn = this;
      var method = methodSel.value;
      btn.disabled = true;
      apiPut('/api/bookings/' + b.id + '/payment', { paymentStatus: 'paid', paymentMethod: method })
        .then(function(){
          closeModal();
          toast(method === 'cash' ? 'แจ้งชำระแล้ว — รอเจ้าหน้าที่ยืนยัน' : 'บันทึกการโอนแล้ว — กรุณากด "แนบสลิป"');
          loadMyBookings();
        })
        .catch(function(err){
          document.getElementById('payErr').textContent = (err && err.error) || 'บันทึกไม่สำเร็จ กรุณาลองใหม่';
          btn.disabled = false;
        });
    };
  }

  // ---------- receipt / QR image upload ----------
  // Phone photos are several MB; downscale in the browser so the free database doesn't fill up.
  // QR codes stay PNG (lossless) so they remain scannable. Falls back to the original file on any failure.
  function shrinkImage(file, maxDim, outType, quality){
    var SMALL_ENOUGH = 400 * 1024;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= SMALL_ENOUGH) return Promise.resolve(file);
    return new Promise(function(resolve){
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function(){
        var scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        var ctx = canvas.getContext('2d');
        if (outType === 'image/jpeg'){ ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function(blob){
          if (!blob || blob.size >= file.size) return resolve(file);
          var ext = outType === 'image/png' ? '.png' : '.jpg';
          resolve(new File([blob], (file.name || 'image').replace(/\.[^.]+$/, '') + ext, { type: outType }));
        }, outType, quality);
      };
      img.onerror = function(){ URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  var pendingReceiptBookingId = null;
  function ensureReceiptInput(){
    var el = document.getElementById('receiptFileInput');
    if (!el){
      el = document.createElement('input');
      el.type = 'file'; el.accept = 'image/*'; el.id = 'receiptFileInput'; el.hidden = true;
      document.body.appendChild(el);
      el.addEventListener('change', function(){
        var file = el.files && el.files[0];
        el.value = '';
        var bookingId = pendingReceiptBookingId;
        pendingReceiptBookingId = null;
        if (!file || !bookingId) return;
        toast('กำลังอัปโหลดสลิป…');
        shrinkImage(file, 1600, 'image/jpeg', 0.82).then(function(img){
          var fd = new FormData();
          fd.append('receipt', img, img.name || 'receipt.jpg');
          return apiUpload('/api/bookings/' + bookingId + '/receipt', fd);
        })
          .then(function(){ toast('แนบสลิปแล้ว'); loadMyBookings(); })
          .catch(function(err){ toast(err.error || 'แนบสลิปไม่สำเร็จ', true); });
      });
    }
    return el;
  }
  function requestReceiptUpload(bookingId){
    pendingReceiptBookingId = bookingId;
    ensureReceiptInput().click();
  }

  var wantsQrUpload = false;
  function ensureQrInput(){
    var el = document.getElementById('qrFileInput');
    if (!el){
      el = document.createElement('input');
      el.type = 'file'; el.accept = 'image/*'; el.id = 'qrFileInput'; el.hidden = true;
      document.body.appendChild(el);
      el.addEventListener('change', function(){
        var file = el.files && el.files[0];
        el.value = '';
        var wanted = wantsQrUpload;
        wantsQrUpload = false;
        if (!file || !wanted) return;
        toast('กำลังอัปโหลด QR โค้ด…');
        shrinkImage(file, 1200, 'image/png').then(function(img){
          var fd = new FormData();
          fd.append('qr', img, img.name || 'qr.png');
          return apiUpload('/api/settings/qr', fd);
        })
          .then(function(res){ state.settings.promptPayQrUrl = res.promptPayQrUrl; toast('อัปเดต QR พร้อมเพย์แล้ว'); render(); })
          .catch(function(err){ toast(err.error || 'อัปโหลด QR ไม่สำเร็จ', true); });
      });
    }
    return el;
  }
  function requestQrUpload(){
    if (!canMenu('settings')){ toast('เฉพาะผู้ดูแลระบบเท่านั้นที่แก้ไขได้', true); return; }
    wantsQrUpload = true;
    ensureQrInput().click();
  }

  // ---------- ระบบจัดการข้อมูล (staff side) ----------
  // Menus and their tabs follow the screen design (3.10). A role sees only the menus in roles.menu_access.
  var ADMIN_MENUS = [
    { key:'users', label:'จัดการผู้ใช้', icon:'👥', tabs:[['admin','ผู้ดูแลระบบ'],['staff','เจ้าหน้าที่ตลาด'],['vendor','ผู้ค้า']] },
    { key:'market', label:'จัดการผังตลาด', icon:'🗺️', tabs:[['categories','ประเภทสินค้า'],['zones','โซน'],['stalls','ล็อก'],['map','แผนผังตลาด']] },
    { key:'bookings', label:'จัดการการจอง', icon:'📋', tabs:[['approvals','อนุมัติคำขอ'],['walkin','จองแทนผู้ค้า'],['all','การจองทั้งหมด']] },
    { key:'payments', label:'การชำระเงิน', icon:'💳', tabs:[['pending','รอยืนยันรับเงิน'],['history','ประวัติการชำระเงิน']] },
    { key:'inspections', label:'ตรวจสอบตลาด', icon:'🔍', tabs:[['daily','บันทึกผลตรวจ'],['fines','ประวัติค่าปรับ']] },
    { key:'announcements', label:'ประกาศ', icon:'📢', tabs:[] },
    { key:'reports', label:'รายงานสรุปยอด', icon:'📊', tabs:[] },
    { key:'settings', label:'ตั้งค่าระบบ', icon:'⚙️', tabs:[['qr','QR พร้อมเพย์'],['roles','สิทธิ์การใช้งาน'],['backup','สำรองและกู้คืนข้อมูล']] }
  ];
  function visibleMenus(){ return ADMIN_MENUS.filter(function(m){ return canMenu(m.key); }); }
  function firstMenu(){ var v = visibleMenus(); return v.length ? (v.find(function(m){ return m.key === 'bookings'; }) || v[0]).key : 'bookings'; }
  function menuTabs(key){
    var m = ADMIN_MENUS.find(function(x){ return x.key === key; });
    var tabs = m ? m.tabs : [];
    // Market staff manage vendors only.
    if (key === 'users' && !profile.isHeadAdmin) tabs = tabs.filter(function(t){ return t[0] === 'vendor'; });
    return tabs;
  }
  function adminTab(key){
    var tabs = menuTabs(key);
    var t = state.adminTabs[key];
    return tabs.some(function(x){ return x[0] === t; }) ? t : (tabs[0] ? tabs[0][0] : '');
  }
  function openAdmin(menu, tab){
    state.adminMenu = menu;
    if (tab) state.adminTabs[menu] = tab;
    render();
    refreshAdminData();
  }

  function renderAdmin(){
    var host = document.getElementById('view-admin');
    if (!profile.isAdmin){
      host.innerHTML = '<div class="empty"><div class="big">🔒</div>กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบหรือเจ้าหน้าที่ตลาด<br><button class="btn primary" id="goLogin" style="margin-top:10px">เข้าสู่ระบบ</button></div>';
      document.getElementById('goLogin').onclick = function(){ openAuthModal('login'); };
      return;
    }
    var menus = visibleMenus();
    if (!menus.length){
      host.innerHTML = '<div class="empty"><div class="big">🔒</div>สิทธิ์ของบัญชีนี้ยังไม่มีเมนูที่ใช้งานได้ กรุณาติดต่อผู้ดูแลระบบ</div>';
      return;
    }
    if (!canMenu(state.adminMenu)) state.adminMenu = firstMenu();
    var menu = state.adminMenu;
    var counts = {
      bookings: (state.bookings || []).filter(function(b){ return b.status === 'pending'; }).length,
      payments: (state.bookings || []).filter(function(b){ return b.status === 'approved' && b.payment_status === 'paid'; }).length
    };
    var nav = menus.map(function(m){
      return '<button class="'+(menu===m.key?'active':'')+'" data-menu="'+m.key+'"><span class="nav-ico" aria-hidden="true">'+m.icon+'</span>' +
        '<span class="nav-label">'+m.label+'</span>'+(counts[m.key] ? '<span class="nav-count">'+counts[m.key]+'</span>' : '')+'</button>';
    }).join('');
    var navOptions = menus.map(function(m){
      return '<option value="'+m.key+'" '+(menu===m.key?'selected':'')+'>'+m.icon+' '+m.label+(counts[m.key] ? ' ('+counts[m.key]+')' : '')+'</option>';
    }).join('');
    var tabs = menuTabs(menu);
    var tab = adminTab(menu);
    var tabBar = tabs.length > 1 ? '<div class="sub-tabs" role="tablist">' + tabs.map(function(t){
      return '<button type="button" role="tab" class="sub-tab'+(t[0]===tab?' active':'')+'" aria-selected="'+(t[0]===tab)+'" data-subtab="'+t[0]+'">'+t[1]+'</button>';
    }).join('') + '</div>' : '';
    var current = ADMIN_MENUS.find(function(m){ return m.key === menu; });

    host.innerHTML =
      '<div class="section-head admin-head"><h2>ระบบจัดการข้อมูล</h2><span class="muted small">'+esc(ROLE_LABELS[profile.roleId]||'')+'</span></div>' +
      '<div class="admin-grid">' +
        '<select class="admin-nav-select" id="adminNavSelect" aria-label="เมนูระบบจัดการข้อมูล">'+navOptions+'</select>' +
        '<nav class="admin-nav" aria-label="เมนูระบบจัดการข้อมูล">'+nav+'</nav>' +
        '<div class="admin-main">' +
          '<div class="admin-title"><span aria-hidden="true">'+current.icon+'</span> '+current.label+'</div>' +
          tabBar +
          '<div class="admin-panel" id="adminPanel"></div>' +
        '</div>' +
      '</div>';

    host.querySelectorAll('.admin-nav button').forEach(function(btn){
      btn.addEventListener('click', function(){ openAdmin(btn.dataset.menu); });
    });
    document.getElementById('adminNavSelect').addEventListener('change', function(){ openAdmin(this.value); });
    host.querySelectorAll('[data-subtab]').forEach(function(btn){
      btn.addEventListener('click', function(){ openAdmin(menu, btn.dataset.subtab); });
    });

    var panel = document.getElementById('adminPanel');
    if (menu === 'users') renderUserAdmin(panel, tab);
    else if (menu === 'market'){
      if (tab === 'categories') renderCategoryAdmin(panel);
      else if (tab === 'zones') renderZoneAdmin(panel);
      else if (tab === 'stalls') renderStallAdmin(panel);
      else renderMapAdmin(panel);
    }
    else if (menu === 'bookings'){
      if (tab === 'walkin') renderWalkinAdmin(panel);
      else if (tab === 'all') renderAllBookings(panel);
      else renderApprovals(panel);
    }
    else if (menu === 'payments') renderPaymentAdmin(panel, tab);
    else if (menu === 'inspections') renderAuditAdmin(panel, tab);
    else if (menu === 'announcements') renderAnnouncementAdmin(panel);
    else if (menu === 'reports') renderSummaryAdmin(panel);
    else if (menu === 'settings') renderSettingsAdmin(panel, tab);
  }

  function searchBoxHtml(id, value, placeholder){
    return '<input type="search" class="admin-search" id="'+id+'" value="'+esc(value||'')+'" placeholder="'+esc(placeholder)+'" aria-label="'+esc(placeholder)+'">';
  }
  // Live filtering without losing focus on each keystroke.
  function bindSearch(id, key, rerender){
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function(){
      state[key] = el.value;
      var pos = el.selectionStart;
      rerender();
      var again = document.getElementById(id);
      if (again){ again.focus(); try { again.setSelectionRange(pos, pos); } catch(e){} }
    });
  }
  function matches(q, parts){
    q = String(q || '').trim().toLowerCase();
    if (!q) return true;
    return parts.join(' ').toLowerCase().indexOf(q) !== -1;
  }
  function bookingWhoHtml(b){
    return '<div class="who"><div class="name">'+categoryMeta(b.category).icon+' '+esc(b.vendor_name)+'</div><div class="stalltag">'+esc(b.vendor_phone)+'</div></div>' +
      '<div class="dates"><span class="stalltag">'+esc(b.stall_code||'—')+' · '+esc(b.zone_name||'')+' · '+esc(b.goods_label || goodsLabel(b.category, b.food_type))+'</span><br>' +
      fmtDate(b.start_date)+' → '+fmtDate(b.end_date)+(b.note?'<br><span class="small">"'+esc(b.note)+'"</span>':'')+'</div>';
  }

  // 4.1 ตรวจสอบคำขอจอง พร้อมประวัติการจองของผู้ค้า / 4.2 อนุมัติ-ปฏิเสธ
  function vendorHistoryHtml(b){
    var mine = (state.bookings || []).filter(function(x){ return x.vendor_id === b.vendor_id && x.id !== b.id; });
    var count = function(s){ return mine.filter(function(x){ return x.status === s; }).length; };
    var fines = (state.auditLogs || []).filter(function(l){ return mine.some(function(x){ return x.id === l.booking_id; }); });
    var summary = mine.length
      ? 'เคยจอง '+mine.length+' ครั้ง · อนุมัติ '+count('approved')+' · ปฏิเสธ '+count('rejected')+' · ยกเลิก '+count('cancelled') +
        (fines.length ? ' · ถูกปรับ '+fines.length+' ครั้ง' : '')
      : 'ผู้ค้ารายใหม่ ยังไม่เคยจองมาก่อน';
    var list = mine.slice(0, 6).map(function(x){
      return '<li><span class="mono">'+esc(x.stall_code)+'</span> '+fmtDate(x.start_date)+' → '+fmtDate(x.end_date)+
        ' <span class="badge '+esc(x.status)+'">'+esc(statusLabel(x.status))+'</span>' +
        (x.status === 'approved' ? ' <span class="paybadge '+esc(x.payment_status)+'">'+esc(payStatusLabel(x.payment_status))+'</span>' : '')+'</li>';
    }).join('');
    return '<details class="vendor-history"><summary>📜 ประวัติการจองของผู้ค้ารายนี้: '+esc(summary)+'</summary>' +
      (list ? '<ul>'+list+'</ul>' : '') + '</details>';
  }

  function renderApprovals(panel){
    var pending = (state.bookings || []).filter(function(b){ return b.status==='pending'; });
    var rows = pending.map(function(b){
      return '<div class="booking-card"><div class="booking-row">' + bookingWhoHtml(b) +
        '<span class="muted small">'+fmtMoney(b.total_amount)+' (ราคา'+esc(rateLabel(b.rate_type))+')</span>' +
        '<div class="row-actions">' +
        '<button class="btn small primary" data-approve="'+b.id+'">อนุมัติ</button>' +
        '<button class="btn small danger" data-reject="'+b.id+'">ปฏิเสธ</button>' +
        '</div></div>' + vendorHistoryHtml(b) + '</div>';
    }).join('');
    panel.innerHTML =
      '<div class="card" style="padding:16px">' +
        '<div class="section-head" style="margin-bottom:8px"><h2 style="font-size:1rem">คำขอจองรออนุมัติ</h2><span class="muted small">'+pending.length+' รายการ</span></div>' +
        (rows ? '<div class="booking-list">'+rows+'</div>' : '<div class="empty small">✅ ไม่มีคำขอค้างอนุมัติ</div>') +
      '</div>';
    var decide = function(id, status){
      apiPut('/api/bookings/' + id + '/status', { status: status })
        .then(function(){ toast(status === 'approved' ? 'อนุมัติการจองแล้ว' : 'ปฏิเสธการจองแล้ว'); loadAdminBookings(); loadPublicData(); })
        .catch(function(err){ toast(err.error || 'อัปเดตการจองไม่สำเร็จ', true); });
    };
    panel.querySelectorAll('[data-approve]').forEach(function(btn){
      btn.addEventListener('click', function(){ decide(btn.dataset.approve, 'approved'); });
    });
    panel.querySelectorAll('[data-reject]').forEach(function(btn){
      btn.addEventListener('click', function(){
        confirmAction('ปฏิเสธคำขอจองนี้?', function(){ decide(btn.dataset.reject, 'rejected'); }, 'ปฏิเสธ');
      });
    });
    // Fines feed the vendor history; load them once (loadFines re-renders, so never call it on every render).
    if (!state.finesLoaded && canMenu('inspections')){ state.finesLoaded = true; loadFines(); }
  }

  // 5.3 ตรวจสอบหลักฐานการชำระเงิน / 5.4 ยืนยันการรับเงิน
  function renderPaymentAdmin(panel, tab){
    var all = state.bookings || [];
    var confirmPay = function(id, method){
      apiPut('/api/bookings/' + id + '/payment', { paymentStatus:'confirmed', paymentMethod: method || undefined })
        .then(function(){ toast('ยืนยันรับเงินแล้ว'); loadAdminBookings(); })
        .catch(function(err){ toast(err.error || 'อัปเดตไม่สำเร็จ', true); });
    };
    if (tab === 'history'){
      var q = state.payQuery;
      var list = all.filter(function(b){
        return b.status === 'approved' && matches(q, [b.vendor_name, b.vendor_phone, b.stall_code, b.zone_name, payStatusLabel(b.payment_status), methodLabel(b.payment_method)]);
      });
      var rowsHtml = list.map(function(b){
        var st = b.payment_status || 'unpaid';
        return '<tr><td>'+esc(b.vendor_name)+'<br><span class="muted small">'+esc(b.vendor_phone)+'</span></td>' +
          '<td class="mono">'+esc(b.stall_code)+'</td><td>'+fmtDate(b.start_date)+' → '+fmtDate(b.end_date)+'</td>' +
          '<td class="mono">'+fmtMoney(b.total_amount)+'</td><td>'+esc(st === 'unpaid' ? '—' : methodLabel(b.payment_method))+'</td>' +
          '<td>'+(b.receipt_path ? '<img class="receipt-thumb" src="'+esc(b.receipt_path)+'" data-full="'+esc(b.receipt_path)+'" alt="สลิป แตะเพื่อขยาย">' : '<span class="muted small">—</span>')+'</td>' +
          '<td><span class="paybadge '+esc(st)+'">'+esc(payStatusLabel(st))+'</span>' +
            (b.confirmed_by_name ? '<br><span class="muted small">โดย '+esc(b.confirmed_by_name)+'</span>' : '')+'</td>' +
          '<td>'+(st !== 'confirmed' ? '<button type="button" class="btn small ghost" data-cashpay="'+b.id+'">รับเงินสดแล้ว</button>' : '')+'</td></tr>';
      }).join('');
      panel.innerHTML = '<div class="card" style="padding:16px">' +
        '<div class="toolbar-row">'+searchBoxHtml('paySearch', q, 'ค้นหาชื่อ เบอร์โทร รหัสล็อก หรือสถานะ')+'<span class="muted small">'+list.length+' รายการ</span></div>' +
        '<div class="table-wrap"><table><thead><tr><th>ผู้ค้า</th><th>ล็อก</th><th>วันที่</th><th>ยอดเงิน</th><th>วิธีชำระ</th><th>สลิป</th><th>สถานะ</th><th></th></tr></thead>' +
        '<tbody>'+(rowsHtml || '<tr><td colspan="8" class="empty">ไม่พบรายการ</td></tr>')+'</tbody></table></div></div>';
      bindSearch('paySearch', 'payQuery', function(){ renderPaymentAdmin(panel, tab); });
      panel.querySelectorAll('[data-cashpay]').forEach(function(btn){
        btn.addEventListener('click', function(){
          confirmAction('ยืนยันว่ารับเงินสดสำหรับการจองนี้แล้ว?', function(){ confirmPay(btn.dataset.cashpay, 'cash'); }, 'ยืนยันรับเงิน');
        });
      });
      wireReceiptThumbs(panel);
      return;
    }
    var awaiting = all.filter(function(b){ return b.status==='approved' && b.payment_status==='paid'; });
    var rows = awaiting.map(function(b){
      var cash = b.payment_method === 'cash';
      return '<div class="booking-row">' + bookingWhoHtml(b) +
        (b.receipt_path ? '<a href="'+esc(b.receipt_path)+'" target="_blank" rel="noopener" title="แตะเพื่อขยาย"><img class="receipt-thumb" src="'+esc(b.receipt_path)+'" data-full="'+esc(b.receipt_path)+'" alt="สลิปการชำระเงิน แตะเพื่อขยาย"></a>'
          : '<span class="muted small">'+(cash ? 'ชำระเงินสด' : 'ยังไม่แนบสลิป')+'</span>') +
        '<span class="paybadge paid">'+esc(methodLabel(b.payment_method))+' · '+fmtMoney(b.total_amount)+'</span>' +
        '<div class="row-actions"><button class="btn small primary" data-confirmpay="'+b.id+'">ยืนยันรับเงิน</button></div>' +
        '</div>';
    }).join('');
    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="section-head" style="margin-bottom:8px"><h2 style="font-size:1rem">ผู้ค้าแจ้งชำระแล้ว รอยืนยันรับเงิน</h2><span class="muted small">'+awaiting.length+' รายการ</span></div>' +
      (rows ? '<div class="booking-list">'+rows+'</div>' : '<div class="empty small">✅ ไม่มีรายการรอยืนยันรับเงิน</div>') +
      '</div>';
    panel.querySelectorAll('[data-confirmpay]').forEach(function(btn){
      btn.addEventListener('click', function(){ confirmPay(btn.dataset.confirmpay); });
    });
    wireReceiptThumbs(panel);
  }

  // ---------- 3.6 จองแทนผู้ค้า (Walk-in) ----------
  // The form lives in state.walkin so the 10-second refresh, which re-renders the panel, keeps what was typed.
  function newWalkin(){
    return { stallId:'', start:todayStr(), end:todayStr(), mode:'new', vendorId:'', name:'', phone:'', category:'', foodType:'', note:'', paid:false };
  }
  function stallBusy(stallId, start, end){
    return bookingsForStall(stallId).some(function(b){ return overlaps(start, end, b.startDate, b.endDate); });
  }

  function renderWalkinAdmin(panel){
    var w = state.walkin || (state.walkin = newWalkin());
    var vendor = w.mode === 'existing' ? state.vendors.find(function(v){ return String(v.id) === String(w.vendorId); }) : null;
    var vCat = vendor && vendor.hasLogin && vendor.category ? String(vendor.category) : null;
    var vKind = vendor && vendor.hasLogin && vendor.foodType ? String(vendor.foodType) : null;
    // Goods are limited by the vendor's registration and by the zone of the chosen stall.
    var pickedStall = w.stallId ? stallById(w.stallId) : null;
    var pickedZone = pickedStall ? zoneById(pickedStall.zone_id) : null;
    var kindChoicesFor = function(catId){
      return kindsOf(catId).filter(function(f){ return (!vKind || String(f.id) === vKind) && zoneAllowsFood(pickedZone, f.id); });
    };
    var catChoices = CATEGORIES.filter(function(c){
      return (!vCat || String(c.id) === vCat) && zoneAllowsCategory(pickedZone, c.id) && (!hasKinds(c.id) || kindChoicesFor(c.id).length);
    });
    var zoneMismatch = pickedStall && !catChoices.length
      ? 'ล็อก ' + pickedStall.code + ' อยู่ใน' + (pickedZone ? pickedZone.name : 'โซนนี้') + ' ซึ่งรับเฉพาะ' + zoneAllowedLabel(pickedZone) +
        (vendor ? ' ไม่ตรงกับสินค้าที่ผู้ค้ารายนี้ลงทะเบียนไว้' : '') + ' กรุณาเลือกล็อกอื่น'
      : null;
    if (w.category && !catChoices.some(function(c){ return String(c.id) === String(w.category); })) w.category = '';
    if (!w.category && (vCat || catChoices.length === 1) && catChoices.length) w.category = String(catChoices[0].id);
    var foodChoices = w.category ? kindChoicesFor(w.category) : [];
    if (w.foodType && !foodChoices.some(function(f){ return String(f.id) === String(w.foodType); })) w.foodType = '';
    if (!w.foodType && foodChoices.length === 1) w.foodType = String(foodChoices[0].id);

    var datesOk = w.start && w.end && w.end >= w.start;
    var stallOptions = state.zones.map(function(z){
      var opts = stallsInZone(z.id).filter(function(s){ return s.active; }).sort(byRowCol).map(function(s){
        var busy = datesOk && stallBusy(s.id, w.start, w.end);
        return '<option value="'+s.id+'" '+(String(s.id)===String(w.stallId)?'selected':'')+(busy?' disabled':'')+'>' +
          esc(s.code)+' · '+fmtMoney(s.price_per_day)+'/วัน'+(busy?' — ไม่ว่างช่วงนี้':'')+'</option>';
      }).join('');
      return opts ? '<optgroup label="'+esc(z.name)+'">'+opts+'</optgroup>' : '';
    }).join('');
    var stall = w.stallId ? stallById(w.stallId) : null;
    if (stall && datesOk && stallBusy(stall.id, w.start, w.end)) { w.stallId = ''; stall = null; }

    var vendorOptions = '<option value="">— เลือกผู้ค้า —</option>' + state.vendors.filter(function(v){ return v.active; })
      .slice().sort(function(a, b){ return String(a.name).localeCompare(String(b.name), 'th'); })
      .map(function(v){
        return '<option value="'+v.id+'" '+(String(v.id)===String(w.vendorId)?'selected':'')+'>'+esc(v.name)+' · '+esc(v.phone)+(v.isRegular?' · ขาประจำ':'')+'</option>';
      }).join('');
    var catOptions = (vCat ? '' : '<option value="">— เลือกประเภทสินค้า —</option>') + catChoices.map(function(c){
      return '<option value="'+c.id+'" '+(String(c.id)===String(w.category)?'selected':'')+'>'+c.icon+' '+esc(c.label)+'</option>';
    }).join('');

    var isRegular = !!(vendor && vendor.isRegular);
    var price = '';
    if (stall && datesOk){
      var rate = isRegular ? stall.regular_price_per_day : stall.price_per_day;
      var days = daysInclusive(w.start, w.end);
      price = 'ยอดเงินรวม ' + fmtMoney(rate) + ' × ' + days + ' วัน = <strong class="mono">' + fmtMoney(rate * days) + '</strong> (ราคา' + (isRegular ? 'ขาประจำ' : 'ขาจร') + ')';
    }
    var withKinds = w.category && hasKinds(w.category);
    var clash = stall && datesOk ? neighborClash(stall.id, w.category, withKinds ? w.foodType : null, w.start, w.end) : null;

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<p class="muted small" style="margin:0 0 12px">สำหรับผู้ค้าที่จองผ่านระบบเองไม่สะดวก เช่น ผู้สูงอายุ การจองที่เจ้าหน้าที่ตลาดทำให้จะอนุมัติทันที</p>' +
      '<div class="field-row">' +
        '<div class="field"><label for="wkStart">วันที่เริ่ม</label><input type="date" id="wkStart" value="'+esc(w.start)+'"></div>' +
        '<div class="field"><label for="wkEnd">วันที่สิ้นสุด</label><input type="date" id="wkEnd" value="'+esc(w.end)+'"></div>' +
      '</div>' +
      '<div class="field"><label for="wkStall">ล็อก</label><select id="wkStall"><option value="">— เลือกล็อก —</option>'+stallOptions+'</select></div>' +
      '<div class="field"><span class="field-label">ผู้ค้า</span><div class="seg" role="group" aria-label="ประเภทผู้ค้า">' +
        '<button type="button" class="seg-btn'+(w.mode==='new'?' active':'')+'" data-wkmode="new" aria-pressed="'+(w.mode==='new')+'">ผู้ค้าใหม่ / ขาจร</button>' +
        '<button type="button" class="seg-btn'+(w.mode==='existing'?' active':'')+'" data-wkmode="existing" aria-pressed="'+(w.mode==='existing')+'">ผู้ค้าที่มีในระบบ</button>' +
      '</div></div>' +
      (w.mode === 'new'
        ? '<div class="field-row">' +
            '<div class="field"><label for="wkName">ชื่อ-นามสกุลผู้ค้า</label><input id="wkName" value="'+esc(w.name)+'"></div>' +
            '<div class="field"><label for="wkPhone">เบอร์โทรศัพท์</label><input id="wkPhone" value="'+esc(w.phone)+'" placeholder="08XXXXXXXX"></div>' +
          '</div><p class="muted small" style="margin:-4px 0 8px">ถ้าเบอร์นี้มีในระบบแล้ว ระบบจะใช้ข้อมูลผู้ค้าเดิม</p>'
        : '<div class="field"><label for="wkVendor">ผู้ค้า</label><select id="wkVendor">'+vendorOptions+'</select></div>') +
      '<div class="field-row">' +
        '<div class="field"><label for="wkCat">ประเภทสินค้า</label><select id="wkCat">'+catOptions+'</select></div>' +
        (withKinds
          ? '<div class="field"><label for="wkFood">ชนิดสินค้า</label><select id="wkFood">'+foodOptionsHtml(foodChoices, w.foodType, foodChoices.length === 1 ? null : '— เลือกชนิดสินค้า —')+'</select></div>'
          : '<div></div>') +
      '</div>' +
      '<div class="field"><label for="wkNote">หมายเหตุ (ถ้ามี)</label><input id="wkNote" value="'+esc(w.note)+'" placeholder="เช่น ผู้ค้าโทรมาจอง"></div>' +
      '<label class="checkline"><input type="checkbox" id="wkPaid" '+(w.paid?'checked':'')+'> รับเงินสดแล้ว</label>' +
      (price ? '<p class="deposit-note" style="font-size:.88rem">'+price+'</p>' : '') +
      (zoneMismatch ? '<div class="clash-note" role="alert">'+esc(zoneMismatch)+'</div>' : '') +
      (clash ? '<div class="clash-note" role="alert">'+esc(clash)+'</div>' : '') +
      '<div class="form-error" id="wkErr"></div>' +
      '<div class="form-actions"><button type="button" class="btn ghost" id="wkReset">ล้างฟอร์ม</button>' +
        '<button type="button" class="btn primary" id="wkSubmit"'+(clash||zoneMismatch?' disabled':'')+'>จองแทนผู้ค้า</button></div>' +
      '</div>';

    var bindChange = function(id, key){
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function(){ w[key] = el.type === 'checkbox' ? el.checked : el.value; render(); });
    };
    var bindInput = function(id, key){
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', function(){ w[key] = el.value; });
    };
    bindChange('wkStart', 'start'); bindChange('wkEnd', 'end'); bindChange('wkStall', 'stallId');
    bindChange('wkVendor', 'vendorId'); bindChange('wkCat', 'category'); bindChange('wkFood', 'foodType'); bindChange('wkPaid', 'paid');
    bindInput('wkName', 'name'); bindInput('wkPhone', 'phone'); bindInput('wkNote', 'note');
    panel.querySelectorAll('[data-wkmode]').forEach(function(btn){
      btn.addEventListener('click', function(){ w.mode = btn.dataset.wkmode; w.category = ''; w.foodType = ''; render(); });
    });
    document.getElementById('wkReset').onclick = function(){ state.walkin = newWalkin(); render(); };
    document.getElementById('wkSubmit').onclick = function(){
      var errEl = document.getElementById('wkErr');
      var problem = !w.stallId ? 'กรุณาเลือกล็อก' :
        !datesOk ? 'กรุณาตรวจวันที่ (วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม)' :
        w.mode === 'new' && (!w.name.trim() || !w.phone.trim()) ? 'กรุณากรอกชื่อและเบอร์โทรศัพท์ของผู้ค้า' :
        w.mode === 'existing' && !w.vendorId ? 'กรุณาเลือกผู้ค้า' :
        !w.category ? 'กรุณาเลือกประเภทสินค้า' :
        withKinds && !w.foodType ? 'กรุณาเลือกชนิดสินค้า' : '';
      if (problem){ errEl.textContent = problem; return; }
      var btn = this;
      btn.disabled = true;
      apiPost('/api/bookings/staff', {
        stallId: Number(w.stallId), vendorId: w.mode === 'existing' ? Number(w.vendorId) : null,
        vendorName: w.name.trim(), vendorPhone: w.phone.trim(),
        category: Number(w.category), foodType: withKinds ? Number(w.foodType) : null,
        startDate: w.start, endDate: w.end, note: w.note.trim() || null, paidCash: w.paid
      }).then(function(b){
        toast('จองล็อก ' + b.stall_code + ' ให้ ' + b.vendor_name + ' แล้ว');
        state.walkin = newWalkin();
        loadPublicData(); loadVendors(); loadAdminBookings();
      }).catch(function(err){
        errEl.textContent = (err && err.error) || 'จองไม่สำเร็จ กรุณาลองใหม่';
        btn.disabled = false;
      });
    };
  }

  // 8.3 ค้นหาการจองทั้งหมด
  function renderAllBookings(panel){
    var filter = state.bookingsFilter || 'all';
    var q = state.bookingQuery;
    var list = (state.bookings||[]).filter(function(b){
      return (filter==='all' || b.status===filter) &&
        matches(q, [b.vendor_name, b.vendor_phone, b.stall_code, b.zone_name, b.goods_label, b.start_date, b.end_date]);
    });
    var statuses = ['all','pending','approved','rejected','cancelled'];
    var bar = statuses.map(function(s){
      return '<button class="btn small '+(filter===s?'primary':'ghost')+'" data-filt="'+s+'">'+(s==='all'?'ทั้งหมด':statusLabel(s))+'</button>';
    }).join('');

    var rowsHtml = list.length ? list.map(function(b){
      var payStatus = b.payment_status || 'unpaid';
      var open = (b.status === 'pending' || b.status === 'approved') && b.end_date >= todayStr();
      return '<tr><td>'+esc(b.vendor_name)+'<br><span class="muted small">'+esc(b.vendor_phone)+'</span>' +
          (b.created_by_name ? '<br><span class="pill small">จองแทนโดย '+esc(b.created_by_name)+'</span>' : '') + '</td>' +
        '<td class="mono">'+categoryMeta(b.category).icon+' '+esc(b.stall_code||'—')+'<br><span class="muted small">'+esc(b.goods_label || goodsLabel(b.category, b.food_type))+'</span></td>' +
        '<td>'+esc(b.zone_name||'')+'</td>' +
        '<td>'+fmtDate(b.start_date)+' → '+fmtDate(b.end_date)+'</td>' +
        '<td class="mono">'+fmtMoney(b.total_amount)+'</td>' +
        '<td><span class="badge '+esc(b.status)+'">'+esc(statusLabel(b.status))+'</span>' +
          (b.approved_by_name ? '<br><span class="muted small">โดย '+esc(b.approved_by_name)+'</span>' : '')+'</td>' +
        '<td><span class="paybadge '+esc(payStatus)+'">'+esc(payStatusLabel(payStatus))+'</span></td>' +
        '<td>'+(open ? '<button type="button" class="btn small danger" data-staffcancel="'+b.id+'">ยกเลิก</button>' : '')+'</td></tr>';
    }).join('') : '<tr><td colspan="8" class="empty">ไม่มีรายการจองในตัวกรองนี้</td></tr>';

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="toolbar-row">'+searchBoxHtml('bkSearch', q, 'ค้นหาชื่อผู้ค้า เบอร์โทร รหัสล็อก โซน หรือสินค้า')+'<span class="muted small">'+list.length+' รายการ</span></div>' +
      '<div class="filter-bar">'+bar+'</div>' +
      '<div class="table-wrap"><table><thead><tr><th>ผู้ค้า</th><th>ล็อก</th><th>โซน</th><th>วันที่</th><th>ยอดเงิน</th><th>สถานะ</th><th>การชำระเงิน</th><th></th></tr></thead>' +
      '<tbody>'+rowsHtml+'</tbody></table></div></div>';

    bindSearch('bkSearch', 'bookingQuery', function(){ renderAllBookings(panel); });
    panel.querySelectorAll('[data-filt]').forEach(function(btn){
      btn.addEventListener('click', function(){ state.bookingsFilter = btn.dataset.filt; renderAllBookings(panel); });
    });
    panel.querySelectorAll('[data-staffcancel]').forEach(function(btn){
      btn.addEventListener('click', function(){
        confirmAction('ยกเลิกการจองนี้? ล็อกจะกลับเป็นว่าง', function(){
          apiDelete('/api/bookings/' + btn.dataset.staffcancel)
            .then(function(){ toast('ยกเลิกการจองแล้ว'); loadAdminBookings(); loadPublicData(); })
            .catch(function(err){ toast(err.error || 'ยกเลิกไม่สำเร็จ', true); });
        }, 'ยกเลิกการจอง');
      });
    });
  }

  // ---------- revenue dashboard ----------
  // Dates are 'YYYY-MM-DD' strings handled in UTC so a day never shifts with the viewer's timezone.
  var TH_MONTHS_FULL = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  var DAY_NAMES = ['จ.','อ.','พ.','พฤ.','ศ.','ส.','อา.'];
  var DAY_NAMES_FULL = ['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'];
  var DAY_MS = 86400000;
  function isoToMs(s){ return Date.UTC(+s.slice(0,4), +s.slice(5,7) - 1, +s.slice(8,10)); }
  function msToIso(ms){ return new Date(ms).toISOString().slice(0,10); }
  function addDaysIso(s, n){ return msToIso(isoToMs(s) + n * DAY_MS); }
  function daysInclusive(a, b){ return Math.round((isoToMs(b) - isoToMs(a)) / DAY_MS) + 1; }
  function weekdayIdx(s){ return (new Date(isoToMs(s)).getUTCDay() + 6) % 7; } // 0 = Monday
  function mondayOf(s){ return addDaysIso(s, -weekdayIdx(s)); }
  function monthStart(y, m){ return msToIso(Date.UTC(y, m, 1)); }
  function monthEnd(y, m){ return msToIso(Date.UTC(y, m + 1, 0)); }
  function shortDate(s){ var d = new Date(isoToMs(s)); return d.getUTCDate() + ' ' + TH_MONTHS[d.getUTCMonth()]; }
  function rangeLabel(a, b){
    var da = new Date(isoToMs(a)), db = new Date(isoToMs(b));
    if (a === b) return shortDate(a);
    if (da.getUTCMonth() === db.getUTCMonth()) return da.getUTCDate() + '–' + db.getUTCDate() + ' ' + TH_MONTHS[db.getUTCMonth()];
    return shortDate(a) + ' – ' + shortDate(b);
  }
  function money0(n){ return fmtMoney(Math.round(n)); }

  // Each approved booking is spread over its days at (total ÷ days) per day, so a booking that crosses
  // a week or month boundary counts in each period only for the days it covers there.
  function revenueBetween(from, to){
    var t = { from:from, to:to, days:daysInclusive(from, to), amount:0, confirmed:0, stallDays:0, bookings:0,
      guest:{ amount:0, confirmed:0, bookings:0 }, regular:{ amount:0, confirmed:0, bookings:0 }, zones:[], stalls:[] };
    var zones = {}, stalls = {};
    (state.bookings || []).forEach(function(b){
      if (b.status !== 'approved') return;
      var s = b.start_date > from ? b.start_date : from;
      var e = b.end_date < to ? b.end_date : to;
      if (s > e) return;
      var days = daysInclusive(s, e);
      var amount = (Number(b.total_amount) || 0) / daysInclusive(b.start_date, b.end_date) * days;
      var paid = b.payment_status === 'confirmed' ? amount : 0;
      var g = b.rate_type === 'regular' ? t.regular : t.guest;
      t.amount += amount; t.confirmed += paid; t.stallDays += days; t.bookings++;
      g.amount += amount; g.confirmed += paid; g.bookings++;
      var z = zones[b.zone_id] || (zones[b.zone_id] = { name: b.zone_name || '—', amount:0, stallDays:0 });
      z.amount += amount; z.stallDays += days;
      var st = stalls[b.stall_id] || (stalls[b.stall_id] = { code: b.stall_code || '—', amount:0, stallDays:0 });
      st.amount += amount; st.stallDays += days;
    });
    var byAmount = function(a, b){ return b.amount - a.amount || b.stallDays - a.stallDays; };
    t.zones = Object.keys(zones).map(function(k){ return zones[k]; }).sort(byAmount);
    t.stalls = Object.keys(stalls).map(function(k){ return stalls[k]; }).sort(byAmount).slice(0, 5);
    return t;
  }

  // Approved bookings that cover one day, with that day's share of each booking's total.
  function bookingsOnDay(day){
    return (state.bookings || []).filter(function(b){
      return b.status === 'approved' && b.start_date <= day && b.end_date >= day;
    }).map(function(b){
      return {
        code: b.stall_code || '—', vendor: b.vendor_name, zone: b.zone_name || '—', rateType: b.rate_type,
        amount: (Number(b.total_amount) || 0) / daysInclusive(b.start_date, b.end_date),
        payStatus: b.payment_status || 'unpaid'
      };
    }).sort(function(a, b){ return a.code.localeCompare(b.code, undefined, { numeric:true }); });
  }

  function dashState(){
    if (!state.dash){
      var t = todayStr();
      state.dash = { mode:'month', year:+t.slice(0,4), month:+t.slice(5,7) - 1, week:mondayOf(t), day:t };
    }
    return state.dash;
  }

  // The selected period, the 12 periods charted around it, and the rows the report breaks it into.
  function dashPeriods(d){
    var p = {};
    if (d.mode === 'month'){
      p.from = monthStart(d.year, d.month); p.to = monthEnd(d.year, d.month);
      p.title = 'รายงานประจำเดือน' + TH_MONTHS_FULL[d.month] + ' ' + d.year;
      p.navLabel = TH_MONTHS_FULL[d.month] + ' ' + d.year;
      p.prev = { from: monthStart(d.year, d.month - 1), to: monthEnd(d.year, d.month - 1) };
      p.compareLabel = 'เดือนก่อน';
      p.trendTitle = 'ยอดค่าเช่ารายเดือน ปี ' + d.year;
      p.trend = TH_MONTHS.map(function(name, m){
        return { key:String(m), label:name, longLabel:TH_MONTHS_FULL[m] + ' ' + d.year, from:monthStart(d.year, m), to:monthEnd(d.year, m) };
      });
      p.selectedKey = String(d.month);
      p.rowsHead = 'สัปดาห์';
      p.rows = [];
      for (var w = mondayOf(p.from); w <= p.to; w = addDaysIso(w, 7)){
        var a = w < p.from ? p.from : w, b = addDaysIso(w, 6) > p.to ? p.to : addDaysIso(w, 6);
        p.rows.push({ label: rangeLabel(a, b), from:a, to:b });
      }
    } else if (d.mode === 'day'){
      var wd = weekdayIdx(d.day);
      p.from = d.day; p.to = d.day;
      p.title = 'สรุปประจำวัน' + DAY_NAMES_FULL[wd] + 'ที่ ' + fmtDate(d.day);
      p.navLabel = DAY_NAMES[wd] + ' ' + fmtDate(d.day);
      p.prev = { from: addDaysIso(d.day, -1), to: addDaysIso(d.day, -1) };
      p.compareLabel = 'วันก่อน';
      p.trendTitle = 'ยอดค่าเช่ารายวัน (14 วันล่าสุดถึงวันที่เลือก)';
      p.trend = [];
      for (var k = 13; k >= 0; k--){
        var day = addDaysIso(d.day, -k);
        p.trend.push({ key:day, label:shortDate(day), longLabel:DAY_NAMES_FULL[weekdayIdx(day)] + ' ' + fmtDate(day), from:day, to:day });
      }
      p.selectedKey = d.day;
      p.rowsHead = null;
      p.rows = [];
    } else {
      p.from = d.week; p.to = addDaysIso(d.week, 6);
      p.title = 'สรุปประจำสัปดาห์ ' + rangeLabel(p.from, p.to) + ' ' + p.to.slice(0,4);
      p.navLabel = rangeLabel(p.from, p.to) + ' ' + p.to.slice(0,4);
      p.prev = { from: addDaysIso(p.from, -7), to: addDaysIso(p.to, -7) };
      p.compareLabel = 'สัปดาห์ก่อน';
      p.trendTitle = 'ยอดค่าเช่ารายสัปดาห์ (12 สัปดาห์ล่าสุดถึงสัปดาห์ที่เลือก)';
      p.trend = [];
      for (var i = 11; i >= 0; i--){
        var ws = addDaysIso(d.week, -7 * i), we = addDaysIso(ws, 6);
        p.trend.push({ key:ws, label:shortDate(ws), longLabel:'สัปดาห์ ' + rangeLabel(ws, we), from:ws, to:we });
      }
      p.selectedKey = d.week;
      p.rowsHead = 'วัน';
      p.rows = DAY_NAMES.map(function(name, k){
        var day = addDaysIso(p.from, k);
        return { label: name + ' ' + shortDate(day), from:day, to:day };
      });
    }
    return p;
  }

  // Y-axis scale: a round tick step (1, 2, 2.5 or 5 × 10ⁿ) giving about four gridlines above zero.
  function niceScale(v){
    if (v <= 0) return { step:250, top:1000 };
    var raw = v / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var step = [1, 2, 2.5, 5, 10].map(function(s){ return s * mag; }).filter(function(s){ return s >= raw; })[0];
    return { step:step, top:Math.ceil(v / step) * step };
  }
  function shortMoney(n){
    if (n >= 1000000) return '฿' + (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + 'M';
    if (n >= 1000) return '฿' + (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k';
    return '฿' + n;
  }
  // Rectangle with only the top corners rounded, so stacks stay flush on the baseline.
  function topRoundedRect(x, y, w, h, r){
    r = Math.min(r, w / 2, h);
    return 'M' + x + ',' + (y + h) + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h) + 'Z';
  }

  // Stacked bars (ขาจร at the base, ขาประจำ on top) with one y-axis in baht.
  function revenueChartSvg(buckets, selectedKey, width){
    var H = 230, padL = 52, padR = 8, padT = 22, padB = 26;
    var plotW = Math.max(120, width - padL - padR), plotH = H - padT - padB;
    var scale = niceScale(buckets.reduce(function(m, b){ return Math.max(m, b.data.amount); }, 0));
    var max = scale.top;
    var y = function(v){ return padT + plotH - v / max * plotH; };
    var colW = plotW / buckets.length;
    var barW = Math.max(6, Math.min(36, colW * 0.56));
    var labelEvery = Math.ceil(46 / colW);
    var out = ['<svg class="dash-chart-svg" width="' + width + '" height="' + H + '" viewBox="0 0 ' + width + ' ' + H + '" role="img" aria-label="กราฟยอดค่าเช่า แยกขาจรและขาประจำ">'];
    for (var v = 0; v <= max + 1e-9; v += scale.step){
      var gy = y(v).toFixed(1);
      out.push('<line class="dash-grid' + (v === 0 ? ' is-base' : '') + '" x1="' + padL + '" x2="' + (width - padR) + '" y1="' + gy + '" y2="' + gy + '"/>');
      out.push('<text class="dash-axis" x="' + (padL - 8) + '" y="' + gy + '" text-anchor="end" dominant-baseline="middle">' + shortMoney(v) + '</text>');
    }
    buckets.forEach(function(b, i){
      var cx = padL + colW * i + colW / 2, x = cx - barW / 2;
      var selected = b.key === selectedKey;
      if (selected) out.push('<rect class="dash-sel" x="' + (padL + colW * i + 1) + '" y="' + padT + '" width="' + (colW - 2) + '" height="' + plotH + '" rx="6"/>');
      var gH = b.data.guest.amount / max * plotH, rH = b.data.regular.amount / max * plotH;
      var base = padT + plotH;
      var gap = gH > 0 && rH > 0 ? 2 : 0;
      if (gH > 0) out.push('<path class="dash-bar dash-guest" d="' + (rH > 0 ? 'M' + x + ',' + base + 'V' + (base - gH) + 'H' + (x + barW) + 'V' + base + 'Z' : topRoundedRect(x, base - gH, barW, gH, 4)) + '"/>');
      if (rH > 0) out.push('<path class="dash-bar dash-regular" d="' + topRoundedRect(x, base - gH - gap - rH, barW, rH, 4) + '"/>');
      if (selected && b.data.amount > 0) out.push('<text class="dash-value" x="' + cx + '" y="' + (base - gH - gap - rH - 6) + '" text-anchor="middle">' + money0(b.data.amount) + '</text>');
      if (i % labelEvery === 0 || selected) out.push('<text class="dash-axis' + (selected ? ' is-sel' : '') + '" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(b.label) + '</text>');
      out.push('<rect class="dash-hit" data-key="' + esc(b.key) + '" data-idx="' + i + '" x="' + (padL + colW * i) + '" y="' + padT + '" width="' + colW + '" height="' + (plotH + padB) + '" tabindex="0" role="button" aria-label="' + esc(b.longLabel + ' ยอด ' + money0(b.data.amount)) + '"/>');
    });
    out.push('</svg>');
    return out.join('');
  }

  function kpiTile(label, value, sub){
    return '<div class="kpi"><div class="kpi-label">' + label + '</div><div class="kpi-value mono">' + value + '</div>' + (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
  }
  function changeNote(now, before, label){
    if (!before) return now ? 'ไม่มียอด' + label + 'ให้เทียบ' : '';
    var p = Math.round((now - before) / before * 100);
    if (p === 0) return 'เท่ากับ' + label;
    return (p > 0 ? '▲ ' : '▼ ') + Math.abs(p) + '% เทียบ' + label;
  }

  function renderSummaryAdmin(panel){
    var d = dashState();
    var p = dashPeriods(d);
    var cur = revenueBetween(p.from, p.to);
    var prev = revenueBetween(p.prev.from, p.prev.to);
    var activeStalls = state.stalls.filter(function(s){ return s.active; }).length;
    var occupancy = activeStalls ? Math.round(cur.stallDays / (activeStalls * cur.days) * 1000) / 10 : 0;
    p.trend.forEach(function(b){ b.data = revenueBetween(b.from, b.to); });
    var rows = p.rows.map(function(r){ r.data = revenueBetween(r.from, r.to); return r; });
    var dayList = d.mode === 'day' ? bookingsOnDay(d.day) : [];

    var breakdownCard;
    if (d.mode === 'day'){
      var dayRows = dayList.map(function(b){
        return '<tr><td class="mono">' + esc(b.code) + '</td><td>' + esc(b.vendor) + '</td><td>' + esc(b.zone) + '</td>' +
          '<td>' + (b.rateType === 'regular' ? 'ขาประจำ' : 'ขาจร') + '</td><td class="mono">' + money0(b.amount) + '</td>' +
          '<td><span class="paybadge ' + esc(b.payStatus) + '">' + esc(payStatusLabel(b.payStatus)) + '</span></td></tr>';
      }).join('');
      breakdownCard = '<div class="card" style="padding:16px">' +
        '<div class="kicker">รายการจองที่ใช้ล็อกวันนี้</div>' +
        '<div class="table-wrap"><table><thead><tr><th>ล็อก</th><th>ผู้ขาย</th><th>โซน</th><th>ประเภท</th><th>ยอดวันนี้</th><th>การชำระเงิน</th></tr></thead>' +
        '<tbody>' + (dayRows
          ? dayRows + '<tr class="total-row"><td colspan="4">รวม ' + dayList.length + ' ล็อก</td><td class="mono">' + money0(cur.amount) + '</td><td></td></tr>'
          : '<tr><td colspan="6" class="empty small">ไม่มีการจองที่อนุมัติในวันนี้</td></tr>') +
        '</tbody></table></div></div>';
    } else {
      var rowHtml = rows.map(function(r){
        var x = r.data;
        return '<tr><td>' + esc(r.label) + '</td><td class="mono">' + money0(x.guest.amount) + '</td><td class="mono">' + money0(x.regular.amount) + '</td>' +
          '<td class="mono"><strong>' + money0(x.amount) + '</strong></td><td class="mono">' + money0(x.confirmed) + '</td><td class="mono">' + x.stallDays + '</td></tr>';
      }).join('');
      breakdownCard = '<div class="card" style="padding:16px">' +
        '<div class="kicker">แยกตาม' + p.rowsHead + '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>' + p.rowsHead + '</th><th>ขาจร</th><th>ขาประจำ</th><th>รวม</th><th>รับเงินแล้ว</th><th>ล็อก-วัน</th></tr></thead>' +
        '<tbody>' + rowHtml +
          '<tr class="total-row"><td>รวมทั้งหมด</td><td class="mono">' + money0(cur.guest.amount) + '</td><td class="mono">' + money0(cur.regular.amount) + '</td>' +
          '<td class="mono">' + money0(cur.amount) + '</td><td class="mono">' + money0(cur.confirmed) + '</td><td class="mono">' + cur.stallDays + '</td></tr>' +
        '</tbody></table></div></div>';
    }
    var zoneRows = cur.zones.map(function(z){
      return '<tr><td>' + esc(z.name) + '</td><td class="mono">' + z.stallDays + '</td><td class="mono">' + money0(z.amount) + '</td></tr>';
    }).join('');
    var stallRows = cur.stalls.map(function(s, i){
      return '<tr><td class="mono">' + (i + 1) + '. ' + esc(s.code) + '</td><td class="mono">' + s.stallDays + '</td><td class="mono">' + money0(s.amount) + '</td></tr>';
    }).join('');
    var none = '<tr><td colspan="3" class="empty small">ไม่มีการจองที่อนุมัติในช่วงนี้</td></tr>';

    panel.innerHTML =
      '<div class="card dash-controls no-print">' +
        '<div class="seg" role="group" aria-label="รูปแบบรายงาน">' +
          '<button type="button" class="seg-btn' + (d.mode === 'month' ? ' active' : '') + '" data-dashmode="month" aria-pressed="' + (d.mode === 'month') + '">รายเดือน</button>' +
          '<button type="button" class="seg-btn' + (d.mode === 'week' ? ' active' : '') + '" data-dashmode="week" aria-pressed="' + (d.mode === 'week') + '">รายสัปดาห์</button>' +
          '<button type="button" class="seg-btn' + (d.mode === 'day' ? ' active' : '') + '" data-dashmode="day" aria-pressed="' + (d.mode === 'day') + '">รายวัน</button>' +
        '</div>' +
        '<div class="dash-nav">' +
          '<button type="button" class="btn small ghost" data-dashstep="-1" aria-label="ช่วงก่อนหน้า">‹</button>' +
          '<strong>' + esc(p.navLabel) + '</strong>' +
          '<button type="button" class="btn small ghost" data-dashstep="1" aria-label="ช่วงถัดไป">›</button>' +
          '<button type="button" class="btn small ghost" id="dashToday">ปัจจุบัน</button>' +
        '</div>' +
        '<div class="dash-actions">' +
          '<button type="button" class="btn small ghost" id="dashCsv">ดาวน์โหลด CSV</button>' +
          '<button type="button" class="btn small primary" id="dashPrint">พิมพ์รายงาน</button>' +
        '</div>' +
      '</div>' +
      '<div class="dash-report">' +
        '<div class="section-head" style="margin-bottom:0"><h2>' + esc(p.title) + '</h2>' +
          (p.from !== p.to ? '<span class="muted small">' + fmtDate(p.from) + ' – ' + fmtDate(p.to) + '</span>' : '') + '</div>' +
        '<div class="kpi-row">' +
          kpiTile('ยอดค่าเช่า (อนุมัติแล้ว)', money0(cur.amount), esc(changeNote(cur.amount, prev.amount, p.compareLabel))) +
          kpiTile('รับเงินแล้ว', money0(cur.confirmed), cur.amount ? 'คิดเป็น ' + Math.round(cur.confirmed / cur.amount * 100) + '% ของยอด' : '') +
          kpiTile('จำนวนการจอง', String(cur.bookings), 'ขาจร ' + cur.guest.bookings + ' · ขาประจำ ' + cur.regular.bookings) +
          kpiTile('อัตราการใช้ล็อก', occupancy + '%', cur.stallDays + ' ล็อก-วัน จาก ' + activeStalls + ' ล็อก × ' + cur.days + ' วัน') +
        '</div>' +
        '<div class="card dash-chart-card">' +
          '<div class="dash-chart-head"><span class="kicker" style="margin:0">' + esc(p.trendTitle) + '</span>' +
            '<span class="dash-legend"><span><i class="dash-key dash-guest"></i>ขาจร</span><span><i class="dash-key dash-regular"></i>ขาประจำ</span></span></div>' +
          '<div class="dash-chart" id="dashChart"></div>' +
          '<div class="muted small no-print">แตะแท่งกราฟเพื่อดูรายงานของช่วงนั้น</div>' +
        '</div>' +
        breakdownCard +
        '<div class="dash-split">' +
          '<div class="card" style="padding:16px"><div class="kicker">แยกตามโซน</div><div class="table-wrap"><table><thead><tr><th>โซน</th><th>ล็อก-วัน</th><th>ยอด</th></tr></thead><tbody>' + (zoneRows || none) + '</tbody></table></div></div>' +
          '<div class="card" style="padding:16px"><div class="kicker">ล็อกยอดนิยม</div><div class="table-wrap"><table><thead><tr><th>ล็อก</th><th>ล็อก-วัน</th><th>ยอด</th></tr></thead><tbody>' + (stallRows || none) + '</tbody></table></div></div>' +
        '</div>' +
        '<p class="muted small">นับเฉพาะการจองที่อนุมัติแล้ว ยอดของการจองหลายวันจะเฉลี่ยลงแต่ละวันที่จองจริง ส่วน "รับเงินแล้ว" คือรายการที่เจ้าหน้าที่ยืนยันรับเงิน</p>' +
      '</div>';

    var chartHost = document.getElementById('dashChart');
    chartHost.innerHTML = revenueChartSvg(p.trend, p.selectedKey, Math.max(280, chartHost.clientWidth || 640));
    var tip = document.createElement('div');
    tip.className = 'dash-tip';
    tip.hidden = true;
    chartHost.appendChild(tip);
    var selectBucket = function(key){
      if (d.mode === 'month') d.month = +key;
      else if (d.mode === 'day') d.day = key;
      else d.week = key;
      render();
    };
    chartHost.querySelectorAll('.dash-hit').forEach(function(hit){
      var b = p.trend[+hit.dataset.idx];
      var show = function(){
        tip.innerHTML = '<strong>' + esc(b.longLabel) + '</strong>' +
          '<div><i class="dash-key dash-guest"></i>ขาจร <span class="mono">' + money0(b.data.guest.amount) + '</span></div>' +
          '<div><i class="dash-key dash-regular"></i>ขาประจำ <span class="mono">' + money0(b.data.regular.amount) + '</span></div>' +
          '<div class="dash-tip-total">รวม <span class="mono">' + money0(b.data.amount) + '</span> · ' + b.data.bookings + ' การจอง</div>';
        tip.hidden = false;
        var hostBox = chartHost.getBoundingClientRect(), box = hit.getBoundingClientRect();
        var left = box.left - hostBox.left + box.width / 2 - tip.offsetWidth / 2;
        tip.style.left = Math.max(0, Math.min(hostBox.width - tip.offsetWidth, left)) + 'px';
      };
      hit.addEventListener('mouseenter', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('mouseleave', function(){ tip.hidden = true; });
      hit.addEventListener('blur', function(){ tip.hidden = true; });
      hit.addEventListener('click', function(){ selectBucket(hit.dataset.key); });
      hit.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); selectBucket(hit.dataset.key); }
      });
    });

    panel.querySelectorAll('[data-dashmode]').forEach(function(btn){
      btn.addEventListener('click', function(){ d.mode = btn.dataset.dashmode; render(); });
    });
    panel.querySelectorAll('[data-dashstep]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var step = +btn.dataset.dashstep;
        if (d.mode === 'month'){
          var m = d.month + step;
          d.year += Math.floor(m / 12);
          d.month = ((m % 12) + 12) % 12;
        } else if (d.mode === 'day'){
          d.day = addDaysIso(d.day, step);
        } else {
          d.week = addDaysIso(d.week, 7 * step);
        }
        render();
      });
    });
    document.getElementById('dashToday').onclick = function(){ state.dash = null; dashState().mode = d.mode; render(); };
    document.getElementById('dashPrint').onclick = function(){ window.print(); };
    document.getElementById('dashCsv').onclick = function(){
      var lines = [[p.title], []];
      if (d.mode === 'day'){
        lines.push(['ล็อก', 'ผู้ขาย', 'โซน', 'ประเภท', 'ยอดวันนี้ (บาท)', 'การชำระเงิน']);
        dayList.forEach(function(b){
          lines.push([b.code, b.vendor, b.zone, b.rateType === 'regular' ? 'ขาประจำ' : 'ขาจร', Math.round(b.amount), payStatusLabel(b.payStatus)]);
        });
        lines.push(['รวม', dayList.length + ' ล็อก', '', '', Math.round(cur.amount), '']);
      } else {
        lines.push([p.rowsHead, 'ขาจร (บาท)', 'ขาประจำ (บาท)', 'รวม (บาท)', 'รับเงินแล้ว (บาท)', 'ล็อก-วัน']);
        rows.forEach(function(r){
          lines.push([r.label, Math.round(r.data.guest.amount), Math.round(r.data.regular.amount), Math.round(r.data.amount), Math.round(r.data.confirmed), r.data.stallDays]);
        });
        lines.push(['รวมทั้งหมด', Math.round(cur.guest.amount), Math.round(cur.regular.amount), Math.round(cur.amount), Math.round(cur.confirmed), cur.stallDays]);
      }
      lines.push([]);
      lines.push(['จำนวนการจอง', cur.bookings, 'ขาจร', cur.guest.bookings, 'ขาประจำ', cur.regular.bookings]);
      lines.push(['อัตราการใช้ล็อก (%)', occupancy]);
      var csv = lines.map(function(l){ return l.map(function(v){ return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
      // The BOM makes Excel open the Thai text as UTF-8.
      var blob = new Blob(['﻿' + csv], { type:'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'talat-pinklao-' + (d.mode === 'month' ? 'month-' + p.from.slice(0,7) : d.mode + '-' + p.from) + '.csv';
      document.body.appendChild(a);
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
  }

  // Generic modal with a form; onSubmit(form, errEl, btn) does the saving.
  function openFormModal(title, sub, fieldsHtml, onSubmit, okLabel){
    var root = document.getElementById('modalRoot');
    root.innerHTML =
      '<div class="modal-back" id="mb"><div class="modal">' +
      '<h3>'+esc(title)+'</h3>' + (sub ? '<div class="sub">'+sub+'</div>' : '') +
      '<form id="fmForm">' + fieldsHtml +
        '<div class="form-error" id="fmErr"></div>' +
        '<div class="form-actions"><button type="button" class="btn ghost" id="fmCancel">ยกเลิก</button>' +
        '<button type="submit" class="btn primary">'+esc(okLabel || 'บันทึก')+'</button></div>' +
      '</form></div></div>';
    var back = document.getElementById('mb');
    back.addEventListener('click', function(e){ if (e.target===back) closeModal(); });
    document.getElementById('fmCancel').onclick = closeModal;
    var form = document.getElementById('fmForm');
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var btn = form.querySelector('button[type=submit]');
      var errEl = document.getElementById('fmErr');
      errEl.textContent = '';
      onSubmit(form, errEl, btn);
    });
    return form;
  }
  function fval(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; }

  // ---------- 2.1 ประเภทสินค้า ----------
  function renderCategoryAdmin(panel){
    var rows = CATEGORIES.map(function(c){
      var kids = kindsOf(c.id);
      var row = function(item, isKind){
        return '<tr'+(isKind?' class="sub-row"':'')+'><td>'+(isKind?'<span class="muted">└</span> ':'')+item.icon+' '+esc(item.label)+'</td>' +
          '<td>'+(isKind ? esc(c.label) : (kids.length ? kids.length+' ชนิด' : '<span class="muted">—</span>'))+'</td>' +
          '<td><button type="button" class="btn small ghost" data-editcat="'+item.id+'">แก้ไข</button> ' +
          '<button type="button" class="btn small danger" data-delcat="'+item.id+'">ลบ</button></td></tr>';
      };
      return row(c, false) + kids.map(function(k){ return row(k, true); }).join('');
    }).join('');
    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="toolbar-row"><p class="muted small" style="margin:0">ประเภทหลัก เช่น อาหาร เสื้อผ้า และชนิดย่อยภายใต้ประเภทหลัก เช่น ชนิดของอาหาร ใช้กำหนดว่าโซนรับสินค้าอะไร</p>' +
      '<button type="button" class="btn primary" id="catAdd">+ เพิ่มประเภทสินค้า</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>ประเภทสินค้า</th><th>ประเภทหลัก / ชนิดย่อย</th><th>จัดการ</th></tr></thead>' +
      '<tbody>'+(rows || '<tr><td colspan="3" class="empty">ยังไม่มีประเภทสินค้า</td></tr>')+'</tbody></table></div></div>';
    var openCat = function(id){
      var row = CATEGORY_ROWS.find(function(r){ return String(r.id) === String(id); });
      var parents = CATEGORIES.filter(function(c){ return !row || c.id !== row.id; }).map(function(c){
        return '<option value="'+c.id+'"'+(row && String(row.parentId)===String(c.id)?' selected':'')+'>'+esc(c.label)+'</option>';
      }).join('');
      openFormModal(row ? 'แก้ไขประเภทสินค้า' : 'เพิ่มประเภทสินค้า', '',
        '<div class="field"><label for="ctName">ชื่อประเภทสินค้า</label><input id="ctName" required maxlength="100" value="'+esc(row ? row.name : '')+'"></div>' +
        '<div class="field"><label for="ctParent">อยู่ภายใต้ประเภทหลัก</label><select id="ctParent"><option value="">— เป็นประเภทหลัก —</option>'+parents+'</select></div>',
        function(form, errEl, btn){
          btn.disabled = true;
          var body = { name: fval('ctName'), parentId: fval('ctParent') ? Number(fval('ctParent')) : null };
          (row ? apiPut('/api/categories/' + row.id, body) : apiPost('/api/categories', body))
            .then(function(){ toast('บันทึกประเภทสินค้าแล้ว'); closeModal(); loadPublicData(); })
            .catch(function(err){ errEl.textContent = err.error || 'บันทึกไม่สำเร็จ'; btn.disabled = false; });
        });
    };
    document.getElementById('catAdd').onclick = function(){ openCat(null); };
    panel.querySelectorAll('[data-editcat]').forEach(function(btn){ btn.addEventListener('click', function(){ openCat(btn.dataset.editcat); }); });
    panel.querySelectorAll('[data-delcat]').forEach(function(btn){
      btn.addEventListener('click', function(){
        confirmAction('ลบประเภทสินค้า "' + anyCategoryLabel(btn.dataset.delcat) + '" และชนิดย่อยทั้งหมด? ลบได้เฉพาะประเภทที่ยังไม่ถูกใช้', function(){
          apiDelete('/api/categories/' + btn.dataset.delcat)
            .then(function(){ toast('ลบประเภทสินค้าแล้ว'); loadPublicData(); })
            .catch(function(err){ toast(err.error || 'ลบไม่สำเร็จ', true); });
        });
      });
    });
  }

  // Checkboxes for "what this zone accepts" (D5 zone_categories). Ticking a category covers all its kinds.
  function allowedPickerHtml(name, selected){
    selected = (selected || []).map(String);
    var chip = function(value, text, extra){
      return '<label class="check-chip"><input type="checkbox" name="'+name+'" value="'+value+'"'+
        (selected.indexOf(String(value)) !== -1 ? ' checked' : '')+(extra||'')+'>'+text+'</label>';
    };
    var tops = CATEGORIES.map(function(c){ return chip(c.id, c.icon+' '+esc(c.label)+(hasKinds(c.id) ? ' (ทุกชนิด)' : '')); }).join('');
    var kinds = CATEGORIES.filter(function(c){ return hasKinds(c.id); }).map(function(c){
      var all = selected.indexOf(String(c.id)) !== -1;
      return '<span class="field-label muted small" style="margin-top:8px">หรือเฉพาะบางชนิดของ'+esc(c.label)+' เช่น แถวเครื่องดื่มอย่างเดียว</span>' +
        '<div class="check-grid" data-kindgroup="'+c.id+'">' + kindsOf(c.id).map(function(k){ return chip(k.id, k.icon+' '+esc(k.label), all ? ' disabled' : ''); }).join('') + '</div>';
    }).join('');
    return '<div class="field"><span class="field-label">ประเภทสินค้าที่โซนนี้รับ <span class="muted">(ไม่ติ๊กเลย = รับทุกประเภท)</span></span>' +
      '<div class="check-grid">'+tops+'</div>' + kinds + '</div>';
  }
  function bindAllowedPicker(root, name){
    CATEGORIES.filter(function(c){ return hasKinds(c.id); }).forEach(function(c){
      var all = root.querySelector('input[name="'+name+'"][value="'+c.id+'"]');
      if (!all) return;
      all.addEventListener('change', function(){
        root.querySelectorAll('[data-kindgroup="'+c.id+'"] input').forEach(function(i){
          i.disabled = all.checked; if (all.checked) i.checked = false;
        });
      });
    });
  }

  // ---------- 2.1 โซน ----------
  var ZONE_COLOR_LABELS = { 'zone-1':'ส้มอิฐ', 'zone-2':'น้ำเงิน', 'zone-3':'ม่วง', 'zone-4':'เขียว' };
  function openZoneModal(zoneId){
    var z = zoneId ? zoneById(zoneId) : null;
    var colors = ZONE_COLOR_KEYS.map(function(k, i){
      var on = z ? z.color === k : i === state.zones.length % 4;
      return '<label class="color-chip" style="--zc:var(--'+k+')"><input type="radio" name="zColor" value="'+k+'"'+(on?' checked':'')+'><span></span>'+ZONE_COLOR_LABELS[k]+'</label>';
    }).join('');
    var form = openFormModal(z ? 'แก้ไขโซน — ' + z.name : 'เพิ่มโซน', '',
      '<div class="field"><label for="zName">ชื่อโซน</label><input id="zName" required maxlength="100" value="'+esc(z ? z.name : '')+'" placeholder="แถวเครื่องดื่ม"></div>' +
      '<div class="field"><label for="zDesc">รายละเอียด</label><input id="zDesc" value="'+esc(z ? z.description || '' : '')+'" placeholder="ระบุตำแหน่งโดยย่อ"></div>' +
      '<div class="field"><span class="field-label">สีของโซนบนแผนผัง</span><div class="check-grid">'+colors+'</div></div>' +
      allowedPickerHtml('zAllow', z ? zoneAllowed(z) : []) +
      (z ? '<p class="muted small">การจองที่มีอยู่แล้วไม่ถูกยกเลิก แต่คำขอที่ยังรออนุมัติจะอนุมัติได้เฉพาะสินค้าที่โซนรับ</p>' : ''),
      function(f, errEl, btn){
        if (!fval('zName')){ errEl.textContent = 'กรุณากรอกชื่อโซน'; return; }
        btn.disabled = true;
        var body = { name: fval('zName'), description: fval('zDesc') || null, color: checkedValues(f, 'zColor')[0],
          allowed: checkedValues(f, 'zAllow').map(Number) };
        (z ? apiPut('/api/zones/' + z.id, body) : apiPost('/api/zones', body))
          .then(function(){ toast('บันทึกโซนแล้ว'); closeModal(); loadPublicData(); })
          .catch(function(err){ errEl.textContent = (err && err.error) || 'บันทึกโซนไม่สำเร็จ'; btn.disabled = false; });
      });
    bindAllowedPicker(form, 'zAllow');
  }

  function renderZoneAdmin(panel){
    var q = state.zoneQuery;
    var list = state.zones.filter(function(z){ return matches(q, [z.name, z.description, zoneAllowedLabel(z)]); });
    var rows = list.map(function(z){
      var count = stallsInZone(z.id).length;
      return '<tr><td><span class="zone-chip"><span class="zone-dot" style="background:'+zoneColor(z)+'"></span>'+esc(z.name)+'</span>' +
          (z.description ? '<br><span class="muted small">'+esc(z.description)+'</span>' : '')+'</td>' +
        '<td>'+esc(ZONE_COLOR_LABELS[z.color] || '')+'</td>' +
        '<td>'+(zoneAllowed(z).length ? esc(zoneAllowedLabel(z)) : '<span class="muted">ทุกประเภท</span>')+'</td>' +
        '<td>'+count+'</td>' +
        '<td><button type="button" class="btn small ghost" data-editzone="'+z.id+'">แก้ไข</button> ' +
        '<button type="button" class="btn small danger" data-delzone="'+z.id+'">ลบ</button></td></tr>';
    }).join('');
    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="toolbar-row">'+searchBoxHtml('zoneSearch', q, 'ค้นหาโซน')+'<button type="button" class="btn primary" id="zAdd">+ เพิ่มโซน</button></div>' +
      '<p class="muted small" style="margin:0 0 12px">กำหนดว่าแต่ละโซนรับสินค้าอะไร เช่น แถวนี้รับเฉพาะเครื่องดื่ม ระบบจะไม่ให้จองหรืออนุมัติสินค้าที่โซนไม่รับ</p>' +
      '<div class="table-wrap"><table><thead><tr><th>ชื่อโซน</th><th>สี</th><th>ประเภทสินค้าที่รับ</th><th>จำนวนล็อก</th><th>จัดการ</th></tr></thead>' +
      '<tbody>'+(rows||'<tr><td colspan="5" class="empty">ไม่พบโซน</td></tr>')+'</tbody></table></div></div>';
    bindSearch('zoneSearch', 'zoneQuery', function(){ renderZoneAdmin(panel); });
    document.getElementById('zAdd').onclick = function(){ openZoneModal(null); };
    panel.querySelectorAll('[data-editzone]').forEach(function(btn){
      btn.addEventListener('click', function(){ openZoneModal(btn.dataset.editzone); });
    });
    panel.querySelectorAll('[data-delzone]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var z = zoneById(btn.dataset.delzone);
        confirmAction('ลบโซน "' + (z?z.name:'โซนนี้') + '"? ไม่สามารถย้อนกลับได้', function(){
          apiDelete('/api/zones/' + btn.dataset.delzone)
            .then(function(){ toast('ลบโซนแล้ว'); loadPublicData(); })
            .catch(function(err){ toast(err.error || 'ลบโซนไม่สำเร็จ', true); });
        });
      });
    });
  }

  // ---------- 2.2 ล็อกและราคา ----------
  function openStallModal(stallId){
    var s = stallId ? stallById(stallId) : null;
    var zoneOptions = state.zones.map(function(z){
      return '<option value="'+z.id+'"'+(s && String(z.id)===String(s.zone_id)?' selected':'')+'>'+esc(z.name)+
        (zoneAllowed(z).length ? ' (รับเฉพาะ'+esc(zoneAllowedLabel(z))+')' : '')+'</option>';
    }).join('');
    openFormModal(s ? 'แก้ไขล็อก ' + s.code : 'เพิ่มล็อก', '',
      '<div class="field-row">' +
        '<div class="field"><label for="stCode">รหัสล็อก</label><input id="stCode" required maxlength="10" value="'+esc(s ? s.code : '')+'" placeholder="F29"></div>' +
        '<div class="field"><label for="stSize">ขนาด (ตร.ม.)</label><input id="stSize" type="number" min="0.5" step="0.5" value="'+(s ? Number(s.size_sqm)||4 : 4)+'"></div>' +
      '</div>' +
      '<div class="field"><label for="stZone">โซน</label><select id="stZone">'+zoneOptions+'</select></div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="stPrice">ราคาขาจร/วัน (฿)</label><input id="stPrice" type="number" min="0" step="10" required value="'+(s ? Number(s.price_per_day)||0 : 650)+'"></div>' +
        '<div class="field"><label for="stRegular">ราคาขาประจำ/วัน (฿)</label><input id="stRegular" type="number" min="0" step="10" required value="'+(s ? Number(s.regular_price_per_day)||0 : 450)+'"></div>' +
      '</div>',
      function(f, errEl, btn){
        var price = parseFloat(fval('stPrice')), regular = parseFloat(fval('stRegular'));
        if (!fval('stCode') || !(price >= 0) || !(regular >= 0)){ errEl.textContent = 'กรุณากรอกรหัสล็อกและราคาทั้งสองแบบ'; return; }
        btn.disabled = true;
        var body = { code: fval('stCode'), zoneId: Number(fval('stZone')), sizeSqm: parseFloat(fval('stSize')) || 4, pricePerDay: price, regularPricePerDay: regular };
        (s ? apiPut('/api/stalls/' + s.id, body) : apiPost('/api/stalls', body))
          .then(function(){ toast('บันทึกล็อกแล้ว'); closeModal(); loadPublicData(); })
          .catch(function(err){ errEl.textContent = (err && err.error) || 'บันทึกล็อกไม่สำเร็จ'; btn.disabled = false; });
      });
  }

  function renderStallAdmin(panel){
    if (!state.zones.length){
      panel.innerHTML = '<div class="empty">กรุณาเพิ่มโซนก่อนเพิ่มล็อก</div>';
      return;
    }
    var q = state.stallQuery;
    var list = state.stalls.filter(function(s){ var z = zoneById(s.zone_id); return matches(q, [s.code, z ? z.name : '']); });
    var rows = list.map(function(s){
      var z = zoneById(s.zone_id);
      return '<tr><td class="mono">'+esc(s.code)+'</td><td><span class="zone-chip"><span class="zone-dot" style="background:'+zoneColor(z)+'"></span>'+esc(z?z.name:'—')+'</span></td>' +
        '<td>'+(Number(s.size_sqm)||4)+'</td><td>'+fmtMoney(s.price_per_day)+'</td><td>'+fmtMoney(s.regular_price_per_day)+'</td>' +
        '<td><span class="badge '+(s.active?'approved':'cancelled')+'">'+(s.active?'เปิดให้จอง':'ปิด')+'</span></td>' +
        '<td><button type="button" class="btn small ghost" data-editstall="'+s.id+'">แก้ไข</button> ' +
        '<button type="button" class="btn small ghost" data-toggle="'+s.id+'">'+(s.active?'ปิดล็อก':'เปิดล็อก')+'</button> ' +
        '<button type="button" class="btn small danger" data-delstall="'+s.id+'">ลบ</button></td></tr>';
    }).join('');
    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="toolbar-row">'+searchBoxHtml('stallSearch', q, 'ค้นหารหัสล็อกหรือโซน')+'<span class="muted small">'+list.length+' ล็อก</span><button type="button" class="btn primary" id="sAdd">+ เพิ่มล็อก</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>รหัสล็อก</th><th>โซน</th><th>ขนาด (ตร.ม.)</th><th>ราคาขาจร/วัน</th><th>ราคาขาประจำ/วัน</th><th>สถานะ</th><th>จัดการ</th></tr></thead>' +
      '<tbody>'+(rows||'<tr><td colspan="7" class="empty">ไม่พบล็อก</td></tr>')+'</tbody></table></div></div>';
    bindSearch('stallSearch', 'stallQuery', function(){ renderStallAdmin(panel); });
    document.getElementById('sAdd').onclick = function(){ openStallModal(null); };
    panel.querySelectorAll('[data-editstall]').forEach(function(btn){ btn.addEventListener('click', function(){ openStallModal(btn.dataset.editstall); }); });
    panel.querySelectorAll('[data-toggle]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var s = stallById(btn.dataset.toggle);
        apiPut('/api/stalls/' + btn.dataset.toggle, { active: !s.active })
          .then(function(){ toast(s.active?'ปิดล็อกแล้ว':'เปิดล็อกแล้ว'); loadPublicData(); })
          .catch(function(err){ toast(err.error || 'อัปเดตล็อกไม่สำเร็จ', true); });
      });
    });
    panel.querySelectorAll('[data-delstall]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var s = stallById(btn.dataset.delstall);
        confirmAction('ลบล็อก "' + (s?s.code:'ล็อกนี้') + '"? ประวัติการจองของล็อกนี้จะถูกลบด้วย ไม่สามารถย้อนกลับได้', function(){
          apiDelete('/api/stalls/' + btn.dataset.delstall)
            .then(function(){ toast('ลบล็อกแล้ว'); loadPublicData(); })
            .catch(function(err){ toast(err.error || 'ลบล็อกไม่สำเร็จ', true); });
        });
      });
    });
  }

  // ---------- 1.3 จัดการข้อมูลผู้ใช้ (one table for all roles, a tab per role) ----------
  var USER_TABS = { admin: ROLE.ADMIN, staff: ROLE.STAFF, vendor: ROLE.VENDOR };
  function openUserModal(userId, roleId){
    var u = userId ? (state.users.concat(state.vendors)).find(function(x){ return String(x.id) === String(userId); }) : null;
    roleId = u ? u.roleId : roleId;
    var isVendor = roleId === ROLE.VENDOR;
    var roleSelect = profile.isHeadAdmin
      ? '<div class="field"><label for="uRole">สิทธิ์</label><select id="uRole">' + [1,2,3].map(function(r){
          return '<option value="'+r+'"'+(r===roleId?' selected':'')+'>'+ROLE_LABELS[r]+'</option>';
        }).join('') + '</select></div>'
      : '<input type="hidden" id="uRole" value="3">';
    var form = openFormModal(u ? 'แก้ไขข้อมูล ' + u.name : 'เพิ่ม' + ROLE_LABELS[roleId], u && u.consentAt ? 'ยินยอม PDPA เมื่อ ' + fmtDateTime(u.consentAt) : '',
      '<div class="field-row">' +
        '<div class="field"><label for="uFirst">ชื่อ</label><input id="uFirst" required value="'+esc(u ? u.firstName : '')+'"></div>' +
        '<div class="field"><label for="uLast">นามสกุล</label><input id="uLast" required value="'+esc(u ? u.lastName : '')+'"></div>' +
      '</div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="uPhone">เบอร์โทรศัพท์</label><input id="uPhone" type="tel" required value="'+esc(u ? u.phone : '')+'" placeholder="08XXXXXXXX"></div>' +
        '<div class="field"><label for="uLine">Line ID</label><input id="uLine" value="'+esc(u ? u.lineId : '')+'"></div>' +
      '</div>' +
      '<div class="field"><label for="uAddr">ที่อยู่</label><textarea id="uAddr" rows="2">'+esc(u ? u.address : '')+'</textarea></div>' +
      '<div class="field-row">' +
        '<div class="field"><label for="uUser">ชื่อผู้ใช้'+(isVendor?' <span class="muted">(เว้นว่างได้)</span>':'')+'</label><input id="uUser" value="'+esc(u && u.username ? u.username : '')+'"></div>' +
        '<div class="field"><label for="uPass">รหัสผ่าน'+(u && u.hasLogin ? ' <span class="muted">(เว้นว่าง = ไม่เปลี่ยน)</span>' : '')+'</label><input id="uPass" type="password" autocomplete="new-password"></div>' +
      '</div>' +
      roleSelect +
      '<div id="uVendorBox"'+(isVendor?'':' hidden')+'>' + goodsPickerHtml('u', u ? u.category : null, u ? u.foodType : null) +
        '<label class="checkline"><input type="checkbox" id="uRegular"'+(u && u.isRegular?' checked':'')+'> ผู้ค้าขาประจำ (ได้ราคาขาประจำ)</label></div>' +
      '<label class="checkline"><input type="checkbox" id="uActive"'+(!u || u.active?' checked':'')+'> เปิดใช้งานบัญชี</label>' +
      (!u && isVendor ? '<label class="checkline"><input type="checkbox" id="uConsent"> ผู้ค้ายินยอมให้เก็บข้อมูลส่วนบุคคลแล้ว (PDPA)</label>' : ''),
      function(f, errEl, btn, confirmDup){
        var role = Number(fval('uRole'));
        var goods = readGoodsPicker(f, 'u');
        var body = {
          roleId: role, firstName: fval('uFirst'), lastName: fval('uLast'), phone: fval('uPhone'), lineId: fval('uLine'), address: fval('uAddr'),
          username: fval('uUser'), active: document.getElementById('uActive').checked,
          isRegular: role === ROLE.VENDOR && document.getElementById('uRegular').checked,
          category: role === ROLE.VENDOR ? goods.category : null, foodType: role === ROLE.VENDOR ? goods.foodType : null
        };
        if (document.getElementById('uPass').value) body.password = document.getElementById('uPass').value;
        var consentEl = document.getElementById('uConsent');
        if (consentEl) body.consent = consentEl.checked;
        if (role === ROLE.VENDOR && goods.category && hasKinds(goods.category) && !goods.foodType){ errEl.textContent = 'กรุณาเลือกชนิดของ' + categoryMeta(goods.category).label; return; }
        var save = function(confirmDuplicateName){
          btn.disabled = true;
          if (confirmDuplicateName) body.confirmDuplicateName = true;
          (u ? apiPut('/api/users/' + u.id, body) : apiPost('/api/users', body))
            .then(function(){ toast('บันทึกข้อมูลผู้ใช้แล้ว'); closeModal(); loadUsers(); })
            .catch(function(err){
              btn.disabled = false;
              if (err && err.status === 409 && /อยู่ในระบบแล้ว/.test(err.error || '')){
                errEl.innerHTML = esc(err.error) + ' <button type="button" class="btn small primary" id="uDupOk">บันทึกต่อ</button>';
                document.getElementById('uDupOk').onclick = function(){ save(true); };
              } else {
                errEl.textContent = (err && err.error) || 'บันทึกไม่สำเร็จ';
              }
            });
        };
        save(false);
      });
    bindGoodsPicker(form, 'u');
    var roleEl = document.getElementById('uRole');
    if (roleEl && roleEl.tagName === 'SELECT') roleEl.addEventListener('change', function(){
      document.getElementById('uVendorBox').hidden = Number(roleEl.value) !== ROLE.VENDOR;
    });
  }

  function renderUserAdmin(panel, tab){
    var roleId = USER_TABS[tab] || ROLE.VENDOR;
    var isVendor = roleId === ROLE.VENDOR;
    var q = state.userQuery;
    var list = state.users.filter(function(u){
      return u.roleId === roleId && matches(q, [u.name, u.phone, u.username, u.lineId, u.address]);
    });
    var rows = list.map(function(u){
      var isMe = u.id === profile.userId;
      return '<tr><td>'+esc(u.name)+(isMe?' <span class="pill on-primary small">คุณ</span>':'')+(u.isRegular?' <span class="pill on-primary small">ขาประจำ</span>':'') +
          '<br><span class="muted small">'+(u.username ? esc(u.username) : (isVendor ? 'ไม่มีบัญชีเข้าสู่ระบบ' : ''))+'</span></td>' +
        '<td>'+esc(u.phone || '—')+'</td>' +
        '<td class="small">'+esc(u.address || '—')+'</td>' +
        '<td>'+esc(u.lineId || '—')+'</td>' +
        (isVendor ? '<td class="small">'+(u.category ? esc(goodsLabel(u.category, u.foodType)) : '<span class="muted">—</span>')+'</td>' +
          '<td class="small">'+u.bookingTotal+' ครั้ง<br><span class="muted">อนุมัติ '+u.bookingApproved+'</span></td>' : '') +
        '<td><span class="badge '+(u.active?'approved':'cancelled')+'">'+(u.active?'ใช้งานอยู่':'ระงับ')+'</span></td>' +
        '<td><button type="button" class="btn small ghost" data-edituser="'+u.id+'">แก้ไข</button>' +
          (profile.isHeadAdmin && !isMe ? ' <button type="button" class="btn small danger" data-deluser="'+u.id+'">ลบ</button>' : '') +
          (!profile.isHeadAdmin ? ' <button type="button" class="btn small '+(u.active?'danger':'primary')+'" data-toggleuser="'+u.id+'">'+(u.active?'ระงับ':'เปิดใช้')+'</button>' : '') +
        '</td></tr>';
    }).join('');
    var cols = isVendor ? 8 : 6;
    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="toolbar-row">'+searchBoxHtml('userSearch', q, 'ค้นหาชื่อ / เบอร์โทรศัพท์ / ชื่อผู้ใช้')+'<span class="muted small">'+list.length+' คน</span>' +
        '<button type="button" class="btn primary" id="uAdd">+ เพิ่ม'+ROLE_LABELS[roleId]+'</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>ชื่อ-นามสกุล</th><th>เบอร์โทร</th><th>ที่อยู่</th><th>Line ID</th>' +
        (isVendor ? '<th>ประเภทสินค้า</th><th>การจอง</th>' : '') + '<th>สถานะ</th><th>จัดการ</th></tr></thead>' +
      '<tbody>'+(rows || '<tr><td colspan="'+cols+'" class="empty">ไม่พบผู้ใช้</td></tr>')+'</tbody></table></div></div>';
    bindSearch('userSearch', 'userQuery', function(){ renderUserAdmin(panel, tab); });
    document.getElementById('uAdd').onclick = function(){ openUserModal(null, roleId); };
    panel.querySelectorAll('[data-edituser]').forEach(function(btn){ btn.addEventListener('click', function(){ openUserModal(btn.dataset.edituser); }); });
    panel.querySelectorAll('[data-deluser]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var u = state.users.find(function(x){ return String(x.id) === btn.dataset.deluser; });
        confirmAction('ลบผู้ใช้ "' + (u ? u.name : '') + '"? ไม่สามารถย้อนกลับได้ (ผู้ใช้ที่มีประวัติการจองลบไม่ได้ ให้ระงับบัญชีแทน)', function(){
          apiDelete('/api/users/' + btn.dataset.deluser)
            .then(function(){ toast('ลบผู้ใช้แล้ว'); loadUsers(); })
            .catch(function(err){ toast(err.error || 'ลบไม่สำเร็จ', true); });
        });
      });
    });
    panel.querySelectorAll('[data-toggleuser]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var u = state.users.find(function(x){ return String(x.id) === btn.dataset.toggleuser; });
        apiPut('/api/users/' + u.id, { active: !u.active })
          .then(function(){ toast(u.active ? 'ระงับบัญชีแล้ว' : 'เปิดใช้บัญชีแล้ว'); loadUsers(); })
          .catch(function(err){ toast(err.error || 'อัปเดตไม่สำเร็จ', true); });
      });
    });
  }

  // ---------- 7.0 จัดการประกาศ ----------
  function openAnnouncementModal(id){
    var a = id ? state.announcements.find(function(x){ return String(x.id) === String(id); }) : null;
    var typeOptions = ANNOUNCE_TYPES.map(function(t){ return '<option value="'+t.id+'"'+(a && a.type===t.id?' selected':'')+'>'+esc(t.label)+'</option>'; }).join('');
    openFormModal(a ? 'แก้ไขประกาศ' : 'เพิ่มประกาศ', a ? '' : 'ประกาศใหม่จะเด้งขึ้นกลางจอของทุกคนที่เปิดเว็บอยู่ภายในประมาณ 10 วินาที',
      '<div class="field"><label for="anTitle">หัวข้อ</label><input id="anTitle" maxlength="60" required value="'+esc(a ? a.title : '')+'" placeholder="ตลาดปิดช่วงสงกรานต์"></div>' +
      '<div class="field"><label for="anType">ประเภท (สีของประกาศ)</label><select id="anType">'+typeOptions+'</select></div>' +
      '<div class="field"><label for="anBody">ข้อความ</label><textarea id="anBody" rows="3" maxlength="300" required placeholder="รายละเอียดสำหรับผู้ค้า">'+esc(a ? a.body : '')+'</textarea></div>' +
      '<label class="checkline"><input type="checkbox" id="anPin"'+(a && a.pinned?' checked':'')+'> ปักหมุดไว้บนสุด</label>' +
      '<div><button type="button" class="btn small ghost" id="anPreview">ดูตัวอย่าง</button></div>',
      function(f, errEl, btn){
        var body = { title: fval('anTitle'), type: fval('anType'), body: fval('anBody'), pinned: document.getElementById('anPin').checked };
        if (!body.title || !body.body){ errEl.textContent = 'กรุณากรอกหัวข้อและข้อความ'; return; }
        btn.disabled = true;
        (a ? apiPut('/api/announcements/' + a.id, body) : apiPost('/api/announcements', body))
          .then(function(){ toast(a ? 'บันทึกประกาศแล้ว' : 'ยิงประกาศแล้ว'); closeModal(); loadPublicData(); })
          .catch(function(err){ errEl.textContent = err.error || 'บันทึกประกาศไม่สำเร็จ'; btn.disabled = false; });
      }, a ? 'บันทึก' : 'ยิงประกาศ');
    document.getElementById('anPreview').onclick = function(){
      if (!fval('anTitle') || !fval('anBody')){ toast('กรอกหัวข้อและข้อความก่อนดูตัวอย่าง', true); return; }
      previewAnnouncement({ title: fval('anTitle'), body: fval('anBody'), type: fval('anType') });
    };
  }

  function renderAnnouncementAdmin(panel){
    var q = state.annQuery;
    var list = state.announcements.filter(function(a){ return matches(q, [a.title, a.body, announceTypeLabel(a.type)]); });
    var rows = list.map(function(a){
      var cls = a.type==='rule' ? 'rejected' : a.type==='holiday' ? 'pending' : a.type==='event' ? 'approved' : 'cancelled';
      return '<tr><td><span class="badge '+cls+'">'+esc(announceTypeLabel(a.type))+'</span>'+(a.pinned?'<br><span class="pill small">📌 ปักหมุด</span>':'')+'</td>' +
        '<td>'+esc(a.title)+'<br><span class="muted small">'+esc(a.body)+'</span></td>' +
        '<td>'+fmtDate((a.created_at||todayStr()).slice(0,10))+(a.created_by_name?'<br><span class="muted small">'+esc(a.created_by_name)+'</span>':'')+'</td>' +
        '<td><button type="button" class="btn small ghost" data-previewannounce="'+a.id+'">ดูตัวอย่าง</button> ' +
        '<button type="button" class="btn small ghost" data-editannounce="'+a.id+'">แก้ไข</button> ' +
        '<button type="button" class="btn small danger" data-delannounce="'+a.id+'">ลบ</button></td></tr>';
    }).join('');
    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="toolbar-row">'+searchBoxHtml('annSearch', q, 'ค้นหาประกาศ')+'<span class="muted small">'+list.length+' รายการ</span>' +
        '<button type="button" class="btn primary" id="anAdd">+ เพิ่มประกาศ</button></div>' +
      '<div class="table-wrap"><table><thead><tr><th>ประเภท</th><th>ประกาศ</th><th>วันที่</th><th>จัดการ</th></tr></thead>' +
      '<tbody>'+(rows||'<tr><td colspan="4" class="empty">ไม่พบประกาศ</td></tr>')+'</tbody></table></div></div>';
    bindSearch('annSearch', 'annQuery', function(){ renderAnnouncementAdmin(panel); });
    document.getElementById('anAdd').onclick = function(){ openAnnouncementModal(null); };
    panel.querySelectorAll('[data-editannounce]').forEach(function(btn){ btn.addEventListener('click', function(){ openAnnouncementModal(btn.dataset.editannounce); }); });
    panel.querySelectorAll('[data-previewannounce]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var a = state.announcements.find(function(x){ return String(x.id)===btn.dataset.previewannounce; });
        if (a) previewAnnouncement(a);
      });
    });
    panel.querySelectorAll('[data-delannounce]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var a = state.announcements.find(function(x){ return String(x.id)===btn.dataset.delannounce; });
        confirmAction('ลบประกาศ "' + (a?a.title:'ประกาศนี้') + '"? ไม่สามารถย้อนกลับได้', function(){
          apiDelete('/api/announcements/' + btn.dataset.delannounce)
            .then(function(){ toast('ลบประกาศแล้ว'); loadPublicData(); })
            .catch(function(err){ toast(err.error || 'ลบประกาศไม่สำเร็จ', true); });
        });
      });
    });
  }

  // ---------- 6.0 ตรวจสอบตลาด ----------
  function renderAuditAdmin(panel, tab){
    if (tab === 'fines'){
      var q = state.fineQuery;
      var fines = (state.auditLogs || []).filter(function(l){ return matches(q, [l.vendor_name, l.stall_code, l.fine_reason, l.date]); });
      var total = fines.reduce(function(s, l){ return s + (Number(l.fine_amount) || 0); }, 0);
      var finesRows = fines.map(function(l){
        return '<tr><td>'+fmtDate(l.date)+'</td><td>'+esc(l.vendor_name)+'<br><span class="muted small">'+esc(l.vendor_phone||'')+'</span></td><td class="mono">'+esc(l.stall_code||'—')+'</td>' +
          '<td>'+(l.present?'มาขาย':'ไม่มาขาย')+' · '+(l.category_match?'สินค้าตรง':'สินค้าไม่ตรง')+'</td>' +
          '<td class="mono">'+fmtMoney(l.fine_amount)+'</td><td>'+esc(l.fine_reason||'')+'</td><td class="small">'+esc(l.inspected_by_name||'')+'</td>' +
          '<td><button type="button" class="btn small danger" data-delinspect="'+l.id+'">ลบ</button></td></tr>';
      }).join('');
      panel.innerHTML = '<div class="card" style="padding:16px">' +
        '<div class="toolbar-row">'+searchBoxHtml('fineSearch', q, 'ค้นหาชื่อผู้ค้า รหัสล็อก หรือเหตุผล')+'<span class="muted small">'+fines.length+' รายการ · รวม '+fmtMoney(total)+'</span></div>' +
        '<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ผู้ค้า</th><th>ล็อก</th><th>ผลตรวจ</th><th>ค่าปรับ</th><th>เหตุผล</th><th>ผู้ตรวจ</th><th></th></tr></thead>' +
        '<tbody>'+(finesRows || '<tr><td colspan="8" class="empty">ไม่พบค่าปรับ</td></tr>')+'</tbody></table></div></div>';
      bindSearch('fineSearch', 'fineQuery', function(){ renderAuditAdmin(panel, tab); });
      wireDeleteInspection(panel);
      return;
    }
    var date = state.auditDate || todayStr();
    var covering = state.auditBookings || [];
    var rows = covering.map(function(b){
      var log = b.audit;
      var present = log ? !!log.present : true;
      var catMatch = log ? !!log.category_match : true;
      var fine = log ? (Number(log.fine_amount)||0) : 0;
      var reason = log ? (log.fine_reason||'') : '';
      return '<tr data-bookingid="'+b.id+'">' +
        '<td class="mono">'+esc(b.stall_code||'—')+'</td>' +
        '<td>'+esc(b.vendor_name)+'</td>' +
        '<td class="small">'+esc(anyCategoryLabel(b.category_id))+'</td>' +
        '<td><select class="au-present"><option value="1" '+(present?'selected':'')+'>มาขาย</option><option value="0" '+(!present?'selected':'')+'>ไม่มาขาย</option></select></td>' +
        '<td><select class="au-catmatch"><option value="1" '+(catMatch?'selected':'')+'>ตรงกัน</option><option value="0" '+(!catMatch?'selected':'')+'>ไม่ตรงกัน</option></select></td>' +
        '<td><input type="number" class="au-fine" min="0" step="10" value="'+fine+'" style="width:84px"></td>' +
        '<td><input type="text" class="au-reason" value="'+esc(reason)+'" placeholder="เหตุผล" style="width:130px"></td>' +
        '<td><button type="button" class="btn small primary au-save">'+(log?'แก้ไขผล':'บันทึก')+'</button>' +
          (log ? ' <button type="button" class="btn small danger" data-delinspect="'+log.id+'">ลบ</button><br><span class="muted small">บันทึกแล้ว</span>' : '')+'</td></tr>';
    }).join('');
    panel.innerHTML = '<div class="card" style="padding:16px">' +
        '<div class="field" style="max-width:200px"><label for="auDate">วันที่ตรวจ</label><input type="date" id="auDate" value="'+date+'"></div>' +
        (covering.length ?
          '<div class="table-wrap"><table><thead><tr><th>ล็อก</th><th>ผู้ค้า</th><th>จองขาย</th><th>มาขาย</th><th>ประเภทสินค้า</th><th>ค่าปรับ (฿)</th><th>เหตุผล</th><th></th></tr></thead>' +
          '<tbody>'+rows+'</tbody></table></div>'
          : '<div class="empty small">ไม่มีการจองที่อนุมัติแล้วในวันนี้</div>') +
      '</div>';
    document.getElementById('auDate').addEventListener('change', function(){ loadAudit(this.value); });
    panel.querySelectorAll('.au-save').forEach(function(btn){
      btn.addEventListener('click', function(){
        var tr = btn.closest('tr');
        apiPut('/api/inspections', {
          bookingId: Number(tr.dataset.bookingid), date: date,
          present: tr.querySelector('.au-present').value === '1', categoryMatch: tr.querySelector('.au-catmatch').value === '1',
          fineAmount: parseFloat(tr.querySelector('.au-fine').value) || 0, fineReason: tr.querySelector('.au-reason').value.trim() || null
        }).then(function(){ toast('บันทึกผลตรวจแล้ว'); loadAudit(date); loadFines(); })
          .catch(function(err){ toast(err.error || 'บันทึกผลตรวจไม่สำเร็จ', true); });
      });
    });
    wireDeleteInspection(panel);
  }
  function wireDeleteInspection(panel){
    panel.querySelectorAll('[data-delinspect]').forEach(function(btn){
      btn.addEventListener('click', function(){
        confirmAction('ลบผลการตรวจนี้?', function(){
          apiDelete('/api/inspections/' + btn.dataset.delinspect)
            .then(function(){ toast('ลบผลการตรวจแล้ว'); loadAudit(state.auditDate || todayStr()); loadFines(); })
            .catch(function(err){ toast(err.error || 'ลบไม่สำเร็จ', true); });
        });
      });
    });
  }

  var MAP_TOOL_GROUPS = [
    ['จัดการ', [['select','เลือก/ย้าย'], ['erase','เอาออก']]],
    ['ล็อก', [['stall','วางล็อก']]],
    ['จุดบริการ', [['entrance','ทางเข้า'], ['toilet','ห้องน้ำ'], ['parking','ที่จอดรถ']]],
    ['ตกแต่งลาน', [['text','ป้าย'], ['stage','เวที'], ['object','สิ่งของ']]]
  ];
  var MAP_SIZES = ['1x1','1x2','2x1','2x2'];
  var editMapCtrl = null;

  function placedStallIds(L){
    var placed = {};
    L.items.forEach(function(it){ if (it.kind === 'stall') placed[it.stallId] = true; });
    return placed;
  }
  function nextUnplacedStallId(L, afterId){
    var placed = placedStallIds(L);
    var start = afterId != null ? state.stalls.findIndex(function(s){ return String(s.id) === String(afterId); }) + 1 : 0;
    for (var k = 0; k < state.stalls.length; k++){
      var s = state.stalls[(start + k) % state.stalls.length];
      if (!placed[s.id]) return s.id;
    }
    return null;
  }
  function syncMapDirtyUi(){
    var save = document.getElementById('mapSave');
    var revert = document.getElementById('mapRevert');
    var pill = document.getElementById('mapDirtyPill');
    if (save) save.disabled = !state.mapDirty;
    if (revert) revert.disabled = !(state.mapDirty && state.settings.mapLayout);
    if (pill){
      pill.className = 'pill small' + (state.mapDirty ? ' on-accent' : '');
      pill.textContent = state.mapDirty ? 'ยังไม่ได้บันทึก' : 'บันทึกแล้ว';
    }
  }
  function removeMapItem(idx){
    state.mapDraft.items.splice(idx, 1);
    state.mapSelected = -1;
    state.mapDirty = true;
    render();
  }
  function placeOnMap(x, y){
    var L = state.mapDraft, tool = state.mapTool;
    if (tool === 'select'){
      if (state.mapSelected !== -1){ state.mapSelected = -1; render(); }
      return;
    }
    if (tool === 'erase') return;
    var dims = state.mapPlaceSize.split('x');
    var item = { kind:tool, x:x, y:y, w:+dims[0], h:+dims[1] };
    if (tool === 'stall'){
      var sid = state.mapPlaceStall || nextUnplacedStallId(L, null);
      if (!sid){ toast('ทุกล็อกอยู่บนผังแล้ว', true); return; }
      item.stallId = +sid;
    }
    if (tool === 'text') item.label = 'ป้าย';
    if (!spotFree(L, item, -1)){
      var outside = item.x + item.w > L.cols || item.y + item.h > L.rows;
      toast(outside ? 'พื้นที่ไม่พอสำหรับขนาดนี้' : 'ช่องนี้มีของวางอยู่แล้ว', true);
      return;
    }
    L.items.push(item);
    state.mapDirty = true;
    if (tool === 'stall'){
      state.mapPlaceStall = nextUnplacedStallId(L, item.stallId);
      state.mapSelected = -1;
    } else {
      state.mapSelected = L.items.length - 1;
    }
    render();
  }

  function renderMapAdmin(panel){
    if (!state.loaded){
      panel.innerHTML = '<div class="empty"><div class="big">⏳</div>กำลังโหลดแผนผัง…</div>';
      return;
    }
    if (!state.mapDraft){
      state.mapDraft = savedOrAutoLayout();
      state.mapDirty = !state.settings.mapLayout;
      state.mapSelected = -1;
    } else {
      var before = state.mapDraft.items.length;
      withoutMissingStalls(state.mapDraft);
      if (state.mapDraft.items.length !== before) state.mapSelected = -1;
    }
    var L = state.mapDraft;
    var placed = placedStallIds(L);
    var unplaced = state.stalls.filter(function(s){ return !placed[s.id]; });
    if (state.mapPlaceStall && placed[state.mapPlaceStall]) state.mapPlaceStall = null;
    var tool = state.mapTool;
    var sel = state.mapSelected >= 0 ? L.items[state.mapSelected] : null;
    if (!sel) state.mapSelected = -1;

    var toolsHtml = MAP_TOOL_GROUPS.map(function(group){
      return '<div class="tool-group"><span class="tool-group-label">'+group[0]+'</span><div class="tool-group-btns">' +
        group[1].map(function(t){
          var on = tool === t[0];
          return '<button type="button" class="map-tool'+(t[0]==='erase'?' danger':'')+(on?' active':'')+'" data-tool="'+t[0]+'" aria-pressed="'+on+'">'+IsoMap.icon(t[0])+'<span>'+t[1]+'</span></button>';
        }).join('') + '</div></div>';
    }).join('');

    var hint = { select:'แตะเพื่อเลือก ลากเพื่อย้าย', stall:'แตะช่องว่างบนลานเพื่อวางล็อกที่เลือกไว้', erase:'แตะสิ่งที่ต้องการเอาออกจากผัง' }[tool] ||
      ('แตะช่องว่างบนลานเพื่อวาง' + MAP_KIND_LABELS[tool]);

    var chips = unplaced.length ? unplaced.map(function(s){
      return '<button type="button" class="map-chip'+(String(state.mapPlaceStall)===String(s.id)?' active':'')+'" data-placestall="'+s.id+'" data-code="'+esc(s.code.toLowerCase())+'">'+esc(s.code)+'</button>';
    }).join('') : '<div class="muted small">✓ ทุกล็อกอยู่บนผังแล้ว</div>';

    var sizeBtns = MAP_SIZES.map(function(sz){
      var on = sel ? (sel.w + 'x' + sel.h === sz) : state.mapPlaceSize === sz;
      return '<button type="button" class="btn small '+(on?'primary':'ghost')+'" data-size="'+sz+'">'+sz.replace('x','×')+'</button>';
    }).join('');

    var props = '<div class="muted small">คลิกวัตถุบนแผนผังเพื่อดูรายละเอียด</div>';
    if (sel){
      var selStall = sel.kind === 'stall' ? stallById(sel.stallId) : null;
      var selZone = selStall ? zoneById(selStall.zone_id) : null;
      props = '<dl class="map-props">' +
          '<dt>ประเภท</dt><dd>'+MAP_KIND_LABELS[sel.kind]+'</dd>' +
          (selStall ? '<dt>รหัสล็อก</dt><dd class="mono">'+esc(selStall.code)+'</dd><dt>โซน</dt><dd>'+esc(selZone ? selZone.name : '—')+'</dd>' : '') +
          '<dt>ตำแหน่ง</dt><dd class="mono">'+sel.x+', '+sel.y+'</dd>' +
          '<dt>ขนาด</dt><dd class="mono">'+sel.w+'×'+sel.h+'</dd>' +
        '</dl>' +
        (sel.kind !== 'stall' ? '<div class="field" style="margin:10px 0 0"><label for="mapLabel">'+(sel.kind==='text'?'ข้อความบนป้าย':'ชื่อ (ถ้ามี)')+'</label><input id="mapLabel" maxlength="40" value="'+esc(sel.label||'')+'"></div>' : '') +
        '<button type="button" class="btn small danger" id="mapRemove" style="margin-top:10px">ลบออกจากแผนผัง</button>';
    }

    panel.innerHTML =
      '<div class="card map-tools" role="toolbar" aria-label="เครื่องมือแผนผัง">' + toolsHtml + '</div>' +
      '<div class="map-editor">' +
        '<div class="card isomap-card">' +
          '<div class="isomap-wrap"><div class="isomap" id="editMap"></div>' + mapZoomControls() + '</div>' +
          '<div class="isomap-hint muted small">'+esc(hint)+' · ลากลานเพื่อเลื่อน · ล้อเมาส์เพื่อซูม</div>' +
        '</div>' +
        '<div class="map-side">' +
          '<div class="card map-side-card"><div class="kicker">ล็อกที่ยังไม่อยู่บนผัง</div><span class="muted small">'+unplaced.length+' ล็อก — แตะรหัสแล้วแตะบนลาน</span>' +
            (unplaced.length ? '<input type="search" id="mapStallSearch" placeholder="ค้นหารหัสล็อก" aria-label="ค้นหารหัสล็อก" style="margin-top:8px">' : '') +
            '<div class="map-unplaced">'+chips+'</div></div>' +
          '<div class="card map-side-card"><div class="kicker">พื้นที่ที่ใช้ (ช่อง)</div><div class="size-row">'+sizeBtns+'</div></div>' +
          '<div class="card map-side-card"><div class="kicker">สิ่งที่เลือกอยู่</div>'+props+'</div>' +
          '<div class="card map-side-card"><div class="kicker">ขนาดลานตลาด</div><div class="field-row">' +
            '<div class="field"><label for="mapCols">กว้าง (ช่อง)</label><input id="mapCols" type="number" min="4" max="60" value="'+L.cols+'"></div>' +
            '<div class="field"><label for="mapRows">ยาว (ช่อง)</label><input id="mapRows" type="number" min="4" max="60" value="'+L.rows+'"></div>' +
          '</div><button type="button" class="btn small ghost" id="mapResize">ใช้ขนาดนี้</button></div>' +
          '<div class="map-actions">' +
            '<span id="mapDirtyPill"></span>' +
            '<button type="button" class="btn primary" id="mapSave">บันทึกแผนผัง</button>' +
            '<button type="button" class="btn ghost" id="mapRevert">ยกเลิกการแก้ไข</button>' +
            '<button type="button" class="btn ghost" id="mapAuto">จัดวางอัตโนมัติ</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    syncMapDirtyUi();

    editMapCtrl = IsoMap.create(document.getElementById('editMap'), {
      layout: L,
      view: state.editView,
      editable: true,
      ariaLabel: 'ตัวแก้ไขแผนผังตลาด',
      selected: function(){ return state.mapSelected; },
      itemStyle: function(it){
        if (it.kind !== 'stall') return { clickable:true, title: MAP_KIND_LABELS[it.kind] + (it.label ? ': ' + it.label : '') };
        var s = stallById(it.stallId);
        var z = s && zoneById(s.zone_id);
        return {
          clickable: true,
          color: z ? zoneColor(z) : 'var(--zone-2)',
          label: s ? s.code : '?',
          title: (s ? s.code : '') + (z ? ' · ' + z.name : '')
        };
      },
      canDrag: function(){ return state.mapTool === 'select'; },
      onItemMoved: function(idx){
        if (!spotFree(L, L.items[idx], idx)){ toast('วางซ้อนกับวัตถุอื่นไม่ได้', true); return false; }
        state.mapSelected = idx;
        state.mapDirty = true;
        render();
        return true;
      },
      onItemClick: function(idx){
        if (state.mapTool === 'erase'){ removeMapItem(idx); return; }
        if (state.mapTool !== 'select'){ toast('ช่องนี้มีของวางอยู่แล้ว', true); return; }
        state.mapSelected = idx;
        render();
      },
      onCellClick: placeOnMap,
      onInteract: function(on){ state.mapInteracting = on; }
    });
    wireZoomControls(panel, editMapCtrl);

    panel.querySelectorAll('[data-tool]').forEach(function(btn){
      btn.addEventListener('click', function(){
        state.mapTool = btn.dataset.tool;
        if (state.mapTool !== 'select') state.mapSelected = -1;
        render();
      });
    });
    panel.querySelectorAll('[data-placestall]').forEach(function(btn){
      btn.addEventListener('click', function(){
        state.mapPlaceStall = +btn.dataset.placestall;
        state.mapTool = 'stall';
        state.mapSelected = -1;
        render();
      });
    });
    var stallSearch = document.getElementById('mapStallSearch');
    if (stallSearch){
      stallSearch.addEventListener('input', function(){
        var q = this.value.trim().toLowerCase();
        panel.querySelectorAll('[data-placestall]').forEach(function(btn){
          btn.hidden = q && btn.dataset.code.indexOf(q) === -1;
        });
      });
    }
    panel.querySelectorAll('[data-size]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var dims = btn.dataset.size.split('x');
        state.mapPlaceSize = btn.dataset.size;
        if (sel){
          var resized = { x:sel.x, y:sel.y, w:+dims[0], h:+dims[1] };
          if (!spotFree(L, resized, state.mapSelected)){ toast('ขยายไม่ได้ พื้นที่ข้างๆ ไม่ว่าง', true); return; }
          sel.w = resized.w; sel.h = resized.h;
          state.mapDirty = true;
        }
        render();
      });
    });
    var labelInput = document.getElementById('mapLabel');
    if (labelInput){
      labelInput.addEventListener('input', function(){
        sel.label = this.value.slice(0, 40);
        state.mapDirty = true;
        editMapCtrl.draw();
        syncMapDirtyUi();
      });
    }
    var removeBtn = document.getElementById('mapRemove');
    if (removeBtn) removeBtn.addEventListener('click', function(){ removeMapItem(state.mapSelected); });

    document.getElementById('mapResize').addEventListener('click', function(){
      var cols = parseInt(document.getElementById('mapCols').value, 10);
      var rows = parseInt(document.getElementById('mapRows').value, 10);
      if (!(cols >= 4 && cols <= 60 && rows >= 4 && rows <= 60)){ toast('ขนาดต้องอยู่ระหว่าง 4–60 ช่อง', true); return; }
      var fits = L.items.every(function(it){ return it.x + it.w <= cols && it.y + it.h <= rows; });
      if (!fits){ toast('มีวัตถุอยู่นอกขนาดใหม่ ย้ายหรือลบออกก่อน', true); return; }
      L.cols = cols; L.rows = rows;
      state.mapDirty = true;
      state.editView.fitted = false;
      render();
    });

    var saveBtn = document.getElementById('mapSave');
    saveBtn.addEventListener('click', function(){
      saveBtn.disabled = true;
      apiPut('/api/layout', { cols:L.cols, rows:L.rows, items:L.items })
        .then(function(res){
          state.settings.mapLayout = res.mapLayout;
          state.mapDraft = cloneLayout(res.mapLayout);
          state.mapDirty = false;
          state.mapSelected = -1;
          state.mapView.fitted = false;
          toast('บันทึกแผนผังแล้ว');
          render();
        })
        .catch(function(err){ toast(err.error || 'บันทึกแผนผังไม่สำเร็จ', true); saveBtn.disabled = false; });
    });
    document.getElementById('mapRevert').addEventListener('click', function(){
      confirmAction('ยกเลิกการแก้ไขทั้งหมดที่ยังไม่ได้บันทึก?', function(){
        state.mapDraft = null;
        state.editView.fitted = false;
        render();
      }, 'ยกเลิกการแก้ไข');
    });
    document.getElementById('mapAuto').addEventListener('click', function(){
      confirmAction('จัดวางล็อกทั้งหมดใหม่อัตโนมัติ? ตำแหน่งที่วางไว้จะถูกแทนที่ (ยังไม่บันทึกจนกว่าจะกดบันทึก)', function(){
        state.mapDraft = withoutMissingStalls(autoLayout());
        state.mapDirty = true;
        state.mapSelected = -1;
        state.editView.fitted = false;
        render();
      }, 'จัดวางใหม่');
    });
  }

  // ---------- 9.0 ตั้งค่าระบบ (และ 1.4 กำหนดสิทธิ์การใช้งาน) ----------
  function renderSettingsAdmin(panel, tab){
    if (tab === 'roles') return renderRolesAdmin(panel);
    if (tab === 'backup'){
      panel.innerHTML = '<div class="card" style="padding:16px">' +
        '<p class="muted small" style="margin:0 0 12px">ดาวน์โหลดข้อมูลทั้งหมดทั้ง 12 ตาราง (ผู้ใช้ สิทธิ์ ประเภทสินค้า โซน ล็อก แผนผัง การจอง การชำระเงิน การตรวจตลาด ประกาศ และรูปสลิป/QR) ' +
          'เก็บไว้ในเครื่อง แนะนำให้ทำอย่างน้อยสัปดาห์ละครั้ง ไฟล์นี้มีข้อมูลส่วนบุคคลและรหัสผ่านที่เข้ารหัสแล้ว อย่าส่งต่อหรืออัปโหลดขึ้นที่สาธารณะ</p>' +
        '<div class="row-actions" style="flex-wrap:wrap">' +
          '<button type="button" class="btn primary" id="backupFull">ดาวน์โหลดไฟล์สำรอง (รวมรูป)</button>' +
          '<button type="button" class="btn ghost" id="backupLite">ดาวน์โหลดแบบไม่รวมรูป</button>' +
          '<button type="button" class="btn danger" id="backupRestore">กู้คืนจากไฟล์สำรอง</button>' +
        '</div></div>';
      document.getElementById('backupFull').onclick = function(){ downloadBackup(true, this); };
      document.getElementById('backupLite').onclick = function(){ downloadBackup(false, this); };
      document.getElementById('backupRestore').onclick = function(){ ensureRestoreInput().click(); };
      return;
    }
    var qrUrl = state.settings.promptPayQrUrl;
    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<p class="muted small" style="margin:0 0 12px">แสดงให้ผู้ค้าเห็นตอนชำระค่าเช่า</p>' +
      (qrUrl
        ? '<img class="qr-preview receipt-thumb" style="width:150px;height:150px" src="'+esc(qrUrl)+'" data-full="'+esc(qrUrl)+'" data-title="QR โค้ดพร้อมเพย์" alt="QR โค้ดพร้อมเพย์ปัจจุบัน แตะเพื่อขยาย">'
        : '<div class="empty small" style="padding:16px 0">ยังไม่มี QR โค้ด</div>') +
      '<div style="margin-top:14px"><button type="button" class="btn primary" id="qrUploadBtn">'+(qrUrl?'เปลี่ยน QR โค้ด':'อัปโหลด QR โค้ด')+'</button></div>' +
      '</div>';
    wireReceiptThumbs(panel);
    document.getElementById('qrUploadBtn').onclick = requestQrUpload;
  }

  // 1.4 กำหนดสิทธิ์การใช้งาน: which menus each role opens (roles.menu_access).
  function renderRolesAdmin(panel){
    var roles = state.roles || [];
    if (!roles.length){ panel.innerHTML = '<div class="empty"><div class="big">⏳</div>กำลังโหลดสิทธิ์…</div>'; return; }
    var cards = roles.map(function(r){
      var editable = r.id === ROLE.STAFF && profile.isHeadAdmin;
      var menus = r.id === ROLE.VENDOR
        ? '<p class="muted small">ใช้งานหน้า "ผังตลาด" และ "การจองของฉัน" (จองล็อก ชำระเงิน ติดตามการจอง แก้ไขข้อมูลส่วนตัว)</p>'
        : '<div class="check-grid">' + ADMIN_MENUS.map(function(m){
            var on = r.menus.indexOf(m.key) !== -1;
            var lock = !editable || m.key === 'settings';
            return '<label class="check-chip"><input type="checkbox" name="roleMenu'+r.id+'" value="'+m.key+'"'+(on?' checked':'')+(lock?' disabled':'')+'>'+m.icon+' '+m.label+'</label>';
          }).join('') + '</div>' +
          (r.id === ROLE.ADMIN ? '<p class="muted small">ผู้ดูแลระบบเข้าถึงได้ทุกเมนูเสมอ</p>' : '<p class="muted small">เมนูตั้งค่าระบบสงวนไว้สำหรับผู้ดูแลระบบ</p>');
      return '<div class="card role-card" style="padding:16px">' +
        '<div class="section-head" style="margin-bottom:6px"><h2 style="font-size:1rem">'+esc(r.name)+'</h2><span class="muted small">role_id '+r.id+'</span></div>' +
        '<div class="field"><label for="roleDesc'+r.id+'">คำอธิบายสิทธิ์</label><input id="roleDesc'+r.id+'" value="'+esc(r.description)+'"'+(profile.isHeadAdmin?'':' disabled')+'></div>' +
        menus +
        (profile.isHeadAdmin ? '<div class="row-actions"><button type="button" class="btn small primary" data-saverole="'+r.id+'">บันทึกสิทธิ์</button></div>' : '') +
        '</div>';
    }).join('');
    panel.innerHTML = '<p class="muted small" style="margin:0 0 12px">กำหนดว่าผู้ใช้แต่ละประเภทเข้าเมนูใดได้บ้าง เมื่อบันทึกแล้วจะมีผลกับผู้ใช้ทันที</p>' + cards;
    panel.querySelectorAll('[data-saverole]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var id = Number(btn.dataset.saverole);
        var body = { description: fval('roleDesc' + id) };
        if (id === ROLE.STAFF) body.menus = checkedValues(panel, 'roleMenu' + id);
        btn.disabled = true;
        apiPut('/api/roles/' + id, body)
          .then(function(){ toast('บันทึกสิทธิ์แล้ว'); loadRoles(); })
          .catch(function(err){ toast(err.error || 'บันทึกสิทธิ์ไม่สำเร็จ', true); btn.disabled = false; });
      });
    });
  }

  // ---------- backup / restore ----------
  function downloadBackup(withImages, btn){
    btn.disabled = true;
    toast('กำลังเตรียมไฟล์สำรอง…');
    fetch('/api/backup' + (withImages ? '' : '?images=0'), { headers: { 'Authorization': 'Bearer ' + authToken } })
      .then(function(res){
        if (!res.ok) return res.json().catch(function(){ return {}; }).then(function(d){ throw { status: res.status, error: d.error }; });
        var name = ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'talat-pinklao-backup.json';
        return res.blob().then(function(blob){ return { blob: blob, name: name }; });
      })
      .then(function(file){
        var a = document.createElement('a');
        a.href = URL.createObjectURL(file.blob);
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        toast('ดาวน์โหลดไฟล์สำรองแล้ว (' + Math.max(1, Math.round(file.blob.size / 1024)) + ' KB)');
      })
      .catch(function(err){ handleAuthError(err); toast((err && err.error) || 'สำรองข้อมูลไม่สำเร็จ', true); })
      .then(function(){ btn.disabled = false; });
  }

  function ensureRestoreInput(){
    var el = document.getElementById('restoreFileInput');
    if (!el){
      el = document.createElement('input');
      el.type = 'file'; el.accept = '.json,application/json'; el.id = 'restoreFileInput'; el.hidden = true;
      document.body.appendChild(el);
      el.addEventListener('change', function(){
        var file = el.files && el.files[0];
        el.value = '';
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(){
          var backup;
          try { backup = JSON.parse(reader.result); } catch(e){ toast('อ่านไฟล์ไม่ได้ — ไม่ใช่ไฟล์สำรองข้อมูล', true); return; }
          if (!backup || backup.format !== 'talat-pinklao-backup' || !backup.tables){ toast('ไม่ใช่ไฟล์สำรองข้อมูลของระบบนี้', true); return; }
          var t = backup.tables;
          var count = function(name){ return Array.isArray(t[name]) ? t[name].length : 0; };
          var files = Array.isArray(backup.images) ? backup.images : [];
          var when = backup.createdAt ? new Date(backup.createdAt).toLocaleString('th-TH') : '-';
          confirmAction(
            'ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่ด้วยไฟล์สำรองวันที่ ' + when + ' ' +
            '(ผู้ใช้ ' + count('users') + ', การจอง ' + count('bookings') + ', การชำระเงิน ' + count('payments') + ', ล็อก ' + count('stalls') + ', รูป ' + files.length + ') ' +
            (backup.includesImages ? '' : 'ไฟล์นี้ไม่มีรูป สลิปและ QR เดิมจะหาย ') +
            'แนะนำให้ดาวน์โหลดไฟล์สำรองของข้อมูลปัจจุบันเก็บไว้ก่อน หลังกู้คืนต้องเข้าสู่ระบบใหม่',
            function(){ runRestore(backup, files); },
            'กู้คืนข้อมูล'
          );
        };
        reader.onerror = function(){ toast('อ่านไฟล์ไม่ได้', true); };
        reader.readAsText(file);
      });
    }
    return el;
  }

  function runRestore(backup, files){
    toast('กำลังกู้คืนข้อมูล…');
    var payload = { format: backup.format, version: backup.version, createdAt: backup.createdAt, includesImages: backup.includesImages, tables: backup.tables };
    var dataRestored = false;
    apiPost('/api/backup/restore', payload).then(function(res){
      dataRestored = true;
      var uploadFiles = function(batch){
        return fetch('/api/backup/restore-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + res.restoreToken },
          body: JSON.stringify({ images: batch })
        }).then(function(r){
          if (!r.ok) return r.json().catch(function(){ return {}; }).then(function(d){ throw { error: d.error || 'อัปโหลดรูปไม่สำเร็จ' }; });
          return r.json();
        });
      };
      var batches = [], current = [], size = 0;
      files.forEach(function(f){
        var len = (f && f.data && f.data.length) || 0;
        if (current.length && size + len > 4 * 1024 * 1024){ batches.push(current); current = []; size = 0; }
        current.push(f); size += len;
      });
      if (current.length) batches.push(current);
      return batches.reduce(function(chain, batch, i){
        return chain.then(function(){
          if (batches.length > 1) toast('กำลังกู้คืนรูป ' + (i + 1) + '/' + batches.length);
          return uploadFiles(batch);
        });
      }, Promise.resolve());
    }).then(function(){
      toast('กู้คืนข้อมูลสำเร็จ กรุณาเข้าสู่ระบบใหม่');
      signOutCompletely();
      state.mapDraft = null; state.mapView.fitted = false; state.editView.fitted = false;
      setTab('map');
      loadPublicData();
    }).catch(function(err){
      if (dataRestored){
        toast('ข้อมูลกู้คืนแล้ว แต่รูปบางส่วนยังไม่ครบ — กดกู้คืนจากไฟล์เดิมอีกครั้งได้', true);
      } else {
        toast((err && err.error) || 'กู้คืนไม่สำเร็จ ข้อมูลเดิมยังอยู่ครบ', true);
      }
    });
  }

  // ---------- boot ----------
  var resizeTimer = null;
  window.addEventListener('resize', function(){
    if (state.activeTab !== 'admin' || state.adminMenu !== 'reports') return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 200);
  });
  if (profile.isAdmin) state.adminMenu = firstMenu();
  render();
  loadPublicData();
  refreshSession().then(function(){
    if (profile.isAdmin) refreshAdminData(); else loadMyBookings();
  });
  setInterval(function(){
    var ae = document.activeElement;
    if (state.mapInteracting || (ae && ae.matches && ae.matches('main input, main textarea'))) return;
    loadPublicData();
    if (state.activeTab==='mine') loadMyBookings();
    if (state.activeTab==='admin') refreshAdminData();
  }, 10000);
})();
