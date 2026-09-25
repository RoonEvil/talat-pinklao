(function(){
  "use strict";

  var DAY = 24*60*60*1000;
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
  function countDays(start,end){
    var s = new Date(start+'T00:00:00');
    var e = new Date(end+'T00:00:00');
    var n = Math.round((e-s)/DAY) + 1;
    return n > 0 ? n : 1;
  }
  function sanitizeUsername(u){ return String(u||'').toLowerCase().replace(/[^a-z0-9_\-]/g,''); }

  var ZONE_COLORS = ['var(--zone-1)','var(--zone-2)','var(--zone-3)','var(--zone-4)'];

  var CATEGORIES = [
    { id:'food', label:'อาหารและเครื่องดื่ม', icon:'🍜' },
    { id:'clothing', label:'เสื้อผ้าและเครื่องประดับ', icon:'👕' },
    { id:'general', label:'สินค้าทั่วไป', icon:'🧺' },
    { id:'service', label:'บริการ', icon:'🔧' },
    { id:'other', label:'อื่นๆ', icon:'📦' }
  ];
  function categoryMeta(id){ return CATEGORIES.find(function(c){ return c.id===id; }) || CATEGORIES[CATEGORIES.length-1]; }

  var PAYMENT_METHODS = [
    { id:'promptpay', label:'โอนผ่านพร้อมเพย์' },
    { id:'bank', label:'โอนผ่านธนาคาร' },
    { id:'cash', label:'เงินสดที่สำนักงานตลาด' }
  ];

  var ANNOUNCE_TYPES = [
    { id:'news', label:'ข่าวสาร' },
    { id:'rule', label:'กฎระเบียบ' },
    { id:'holiday', label:'วันหยุด' },
    { id:'event', label:'กิจกรรม' }
  ];
  function announceTypeLabel(id){ var t = ANNOUNCE_TYPES.find(function(x){ return x.id===id; }); return t ? t.label : id; }

  var STATUS_LABELS = { pending:'รอดำเนินการ', approved:'อนุมัติแล้ว', rejected:'ปฏิเสธแล้ว', cancelled:'ยกเลิกแล้ว' };
  function statusLabel(s){ return STATUS_LABELS[s] || s; }
  var PAY_STATUS_LABELS = { unpaid:'ยังไม่ชำระ', paid:'ชำระแล้ว', confirmed:'ยืนยันแล้ว' };
  function payStatusLabel(s){ return PAY_STATUS_LABELS[s] || s; }
  var RATE_LABELS = { guest:'ทั่วไป', regular:'สมาชิก' };
  function rateLabel(s){ return RATE_LABELS[s] || s; }

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
    var p = { vendorToken: uid(), vendorName:'', vendorPhone:'', isRegistered:false, isAdmin:false, isHeadAdmin:false, adminName:'', adminUsername:'' };
    try { localStorage.setItem('pinklao_profile', JSON.stringify(p)); } catch(e){}
    return p;
  })();
  function saveProfile(){ try { localStorage.setItem('pinklao_profile', JSON.stringify(profile)); } catch(e){} }

  function signOutCompletely(){
    profile = { vendorToken: uid(), vendorName:'', vendorPhone:'', isRegistered:false, isAdmin:false, isHeadAdmin:false, adminName:'', adminUsername:'' };
    saveProfile();
    saveToken(null);
  }

  // ---------- state ----------
  var state = {
    zones: [], stalls: [], activeBookings: [], bookings: [], myBookings: [], myBookingsLoaded:false,
    vendors: [], announcements: [], auditLogs: [], auditDate: null, admins: [], settings: {},
    activeTab: 'map', adminSection: 'approvals', loaded:false,
    bookingsFilter: 'all'
  };

  function zoneById(id){ return state.zones.find(function(z){ return String(z.id)===String(id); }); }
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

  // ---------- data loading ----------
  function loadPublicData(){
    return Promise.all([
      apiGet('/api/zones'), apiGet('/api/stalls'), apiGet('/api/bookings/active'),
      apiGet('/api/announcements'), apiGet('/api/settings')
    ]).then(function(res){
      state.zones = res[0];
      state.stalls = res[1];
      state.activeBookings = res[2];
      state.announcements = res[3];
      state.settings = res[4];
      state.loaded = true;
      render();
    }).catch(function(err){ console.error('loadPublicData', err); });
  }

  function loadMyBookings(){
    return apiGet('/api/bookings?vendorToken=' + encodeURIComponent(profile.vendorToken)).then(function(rows){
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
    return apiGet('/api/vendors').then(function(rows){ state.vendors = rows; render(); })
      .catch(function(err){ handleAuthError(err); });
  }
  function loadAdmins(){
    return apiGet('/api/admins').then(function(rows){ state.admins = rows; render(); })
      .catch(function(err){ handleAuthError(err); });
  }
  function loadAudit(date){
    return apiGet('/api/audit?date=' + encodeURIComponent(date)).then(function(res){
      state.auditDate = res.date;
      state.auditBookings = res.bookings;
      render();
    }).catch(function(err){ handleAuthError(err); });
  }
  function loadFines(){
    return apiGet('/api/audit/fines').then(function(rows){ state.auditLogs = rows; render(); })
      .catch(function(err){ handleAuthError(err); });
  }
  function handleAuthError(err){
    if (err && err.status === 401){
      toast('เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่', true);
      profile.isAdmin = false; profile.isHeadAdmin = false; saveProfile(); saveToken(null);
      if (state.activeTab==='admin') setTab('map');
      render();
    } else {
      console.error(err);
    }
  }

  function refreshAdminData(){
    if (!profile.isAdmin) return;
    if (state.adminSection==='approvals' || state.adminSection==='bookings') loadAdminBookings();
    if (state.adminSection==='vendors') loadVendors();
    if (state.adminSection==='admins' && profile.isHeadAdmin) loadAdmins();
    if (state.adminSection==='audit') { loadAdminBookings(); loadAudit(state.auditDate || todayStr()); loadFines(); }
  }

  // ---------- render: shell ----------
  function render(){
    renderRoleArea();
    renderTabs();
    if (state.activeTab==='map') renderMap();
    if (state.activeTab==='announce') renderAnnouncements();
    if (state.activeTab==='mine') renderMine();
    if (state.activeTab==='admin') renderAdmin();
  }

  function renderRoleArea(){
    var el = document.getElementById('roleArea');
    if (profile.isAdmin){
      el.innerHTML =
        '<span class="pill on-accent">'+esc(profile.adminName||'แอดมิน')+' · '+(profile.isHeadAdmin?'แอดมินใหญ่':'เจ้าหน้าที่')+'</span>' +
        '<button class="btn ghost small" id="logoutBtn">ออกจากระบบ</button>';
      document.getElementById('logoutBtn').onclick = function(){
        profile.isAdmin = false; profile.isHeadAdmin = false; profile.adminName=''; profile.adminUsername=''; saveProfile(); saveToken(null);
        if (state.activeTab==='admin') setTab('map');
        render();
      };
    } else if (profile.isRegistered){
      el.innerHTML =
        '<span class="pill on-primary">'+esc(profile.vendorName||'บัญชีของฉัน')+'</span>' +
        '<button class="btn ghost small" id="vendorLogoutBtn">ออกจากระบบ</button>';
      document.getElementById('vendorLogoutBtn').onclick = function(){
        signOutCompletely();
        if (state.activeTab==='mine') setTab('map');
        toast('ออกจากระบบแล้ว');
        render();
        loadMyBookings();
      };
    } else {
      el.innerHTML =
        (profile.vendorName ? '<span class="pill on-primary">ผู้ขาย: '+esc(profile.vendorName)+'</span>' : '<span class="pill">กำลังเรียกดูแบบผู้เยี่ยมชม</span>') +
        '<button class="btn ghost small" id="staffBtn">เข้าสู่ระบบ</button>';
      document.getElementById('staffBtn').onclick = function(){ openAuthModal('login'); };
    }
  }

  function renderTabs(){
    document.querySelectorAll('.tab').forEach(function(btn){
      btn.classList.toggle('active', btn.dataset.tab===state.activeTab);
    });
    document.getElementById('adminTabBtn').hidden = !profile.isAdmin;
    document.getElementById('view-map').hidden = state.activeTab!=='map';
    document.getElementById('view-announce').hidden = state.activeTab!=='announce';
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

  // ---------- Site plan diagram ----------
  function renderSitePlan(zones){
    var n = Math.max(zones.length, 1);
    var gap = 16, x0 = 24, totalW = 752;
    var w = (totalW - gap*(n-1)) / n;
    var rects = zones.map(function(z, i){
      var x = x0 + i*(w+gap);
      var color = ZONE_COLORS[(z.color_index||0)%4];
      var count = stallsInZone(z.id).length;
      var tentCount = Math.min(count, 8);
      var tents = '';
      if (tentCount > 0){
        var tw = Math.min(26, (w-24)/tentCount);
        var startX = x + (w - tw*tentCount)/2;
        for (var t=0;t<tentCount;t++){
          var tx = startX + t*tw + tw/2;
          tents += '<path class="sp-tent" d="M'+(tx-tw*0.32).toFixed(1)+',108 L'+tx.toFixed(1)+',86 L'+(tx+tw*0.32).toFixed(1)+',108 Z" />';
        }
      }
      return '<g style="color:'+color+'">' +
        '<rect class="sp-zone-rect" x="'+x.toFixed(1)+'" y="34" width="'+w.toFixed(1)+'" height="112" rx="10" />' +
        '<text class="sp-zone-label" x="'+(x+12).toFixed(1)+'" y="52">'+esc(z.name)+'</text>' +
        '<text class="sp-zone-sub" x="'+(x+12).toFixed(1)+'" y="66">'+count+' ล็อก</text>' +
        tents +
        '</g>';
    }).join('');

    return '<svg class="site-plan" viewBox="0 0 800 232" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ผังบริเวณตลาด">' +
      '<text class="sp-context" x="400" y="14" text-anchor="middle">↑ ไปทาง ตึก OPD และอาคารอำนวยการ</text>' +
      '<g class="sp-compass" transform="translate(34,16)">' +
        '<circle r="11" />' +
        '<line x1="0" y1="5" x2="0" y2="-8" />' +
        '<text y="4" text-anchor="middle">N</text>' +
      '</g>' +
      rects +
      '<rect class="sp-parking" x="606" y="150" width="170" height="26" rx="6" />' +
      '<text class="sp-parking-label" x="691" y="167" text-anchor="middle">จุดจอดรถจักรยานยนต์</text>' +
      '<path class="sp-entrance-arrow" d="M400,150 L382,182 L418,182 Z" />' +
      '<text class="sp-entrance-label" x="400" y="200" text-anchor="middle">ทางเข้าหลัก</text>' +
      '<text class="sp-entrance-sub" x="400" y="213" text-anchor="middle">ทางเข้า-ออกหลัก</text>' +
      '</svg>';
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

    var AISLE_ICONS = ['🌿','🌳','🪴'];
    var zonesHtml = state.zones.map(function(z){
      var color = ZONE_COLORS[(z.color_index||0)%4];
      var stalls = stallsInZone(z.id);
      var availableCount = stalls.filter(function(s){ return stallStatus(s)==='available'; }).length;

      var byRow = {};
      stalls.forEach(function(s){
        var r = s.pos_row || 0;
        (byRow[r] = byRow[r] || []).push(s);
      });
      var rowKeys = Object.keys(byRow).sort(function(a,b){ return a-b; });

      function tileHtml(s){
        var status = stallStatus(s);
        var label = { available:'ว่าง', pending:'รอการอนุมัติ', occupied:'จองแล้ว', inactive:'ปิด' }[status];
        var extra = '';
        if (status==='occupied' || status==='pending'){
          var next = activeBookingsForStall(s.id)[0];
          if (next) extra = ' ถึง ' + fmtDate(next.endDate);
        }
        return '<button type="button" class="stall '+status+'" data-stall="'+s.id+'" '+(status==='inactive'?'disabled':'')+'>' +
          '<span class="code">'+categoryMeta(s.category).icon+' '+esc(s.code)+'</span>' +
          '<span class="price">'+fmtMoney(s.price_per_day)+'/วัน</span>' +
          '<span class="status">'+label+extra+'</span>' +
          '</button>';
      }

      var rowsHtml = rowKeys.map(function(rk, ri){
        var rowStalls = byRow[rk].slice().sort(function(a,b){ return (a.pos_col||0)-(b.pos_col||0); });
        var offset = ri * 22;
        var tiles = rowStalls.map(tileHtml).join('');
        var deco = '';
        if (ri < rowKeys.length - 1){
          var icons = '<span>'+AISLE_ICONS[ri % AISLE_ICONS.length]+'</span><span>'+AISLE_ICONS[(ri+1) % AISLE_ICONS.length]+'</span>';
          deco = '<div class="aisle-deco" style="margin-left:'+(offset+11)+'px" aria-hidden="true">'+icons+'</div>';
        }
        return '<div class="stall-row" style="margin-left:'+offset+'px">'+tiles+'</div>' + deco;
      }).join('');

      return '<div class="zone">' +
        '<div class="zone-head" style="--zc:'+color+'">' +
        '<h3>'+esc(z.name)+'</h3>' +
        '<p>'+esc(z.description||'')+'</p>' +
        '<div class="zone-stat">ว่าง '+availableCount+' จาก '+stalls.length+' ล็อก</div>' +
        '</div>' +
        '<div class="stall-grid">'+(rowsHtml||'<div class="empty small">ยังไม่มีล็อก</div>')+'</div>' +
        '</div>';
    }).join('');

    var siteplan = '<div class="card site-plan-card">'+renderSitePlan(state.zones)+'</div>';

    host.innerHTML =
      '<div class="section-head"><h2>ผังโซนตลาด</h2><span class="muted small">แตะที่ล็อกเพื่อขอจอง</span></div>' +
      siteplan +
      legend +
      '<div class="zones">'+(zonesHtml || '<div class="empty">ยังไม่มีการตั้งค่าโซน</div>')+'</div>';

    host.querySelectorAll('.stall:not([disabled])').forEach(function(btn){
      btn.addEventListener('click', function(){ openBookingModal(btn.dataset.stall); });
    });
  }

  // ---------- Announcements (public) ----------
  function renderAnnouncements(){
    var host = document.getElementById('view-announce');
    if (!state.loaded){
      host.innerHTML = '<div class="empty"><div class="big">⏳</div>กำลังโหลดประกาศ…</div>';
      return;
    }
    if (!state.announcements.length){
      host.innerHTML = '<div class="section-head"><h2>ประกาศ</h2></div>' +
        '<div class="empty"><div class="big">📣</div>ยังไม่มีประกาศ</div>';
      return;
    }
    var rows = state.announcements.map(function(a){
      return '<div class="announce-card">' +
        '<div class="announce-head">' +
          '<span class="badge '+ (a.type==='rule'?'rejected':a.type==='holiday'?'pending':a.type==='event'?'approved':'cancelled') +'">'+esc(announceTypeLabel(a.type))+'</span>' +
          (a.pinned ? '<span class="pill on-accent small">ปักหมุด</span>' : '') +
          '<span class="muted small" style="margin-left:auto">'+fmtDate((a.created_at||'').slice(0,10)||todayStr())+'</span>' +
        '</div>' +
        '<h3>'+esc(a.title)+'</h3>' +
        '<p>'+esc(a.body)+'</p>' +
        '</div>';
    }).join('');
    host.innerHTML = '<div class="section-head"><h2>ประกาศ</h2><span class="muted small">ข่าวสาร กฎระเบียบ และกำหนดการ</span></div>' +
      '<div class="announce-list">'+rows+'</div>';
  }

  // ---------- Booking modal ----------
  function openBookingModal(stallId){
    var stall = state.stalls.find(function(s){ return String(s.id)===String(stallId); });
    if (!stall) return;

    var zone = zoneById(stall.zone_id);
    var root = document.getElementById('modalRoot');
    var minDate = todayStr();
    var isRegistered = profile.isRegistered;
    var myCategory = stall.category || 'other';
    var regularRate = stall.regular_price_per_day != null ? stall.regular_price_per_day : stall.price_per_day;

    var catOptions = CATEGORIES.map(function(c){
      return '<option value="'+c.id+'" '+(c.id===myCategory?'selected':'')+'>'+c.icon+' '+esc(c.label)+'</option>';
    }).join('');
    var payOptions = PAYMENT_METHODS.map(function(m){
      return '<option value="'+m.id+'">'+esc(m.label)+'</option>';
    }).join('');

    root.innerHTML =
      '<div class="modal-back" id="mb"><div class="modal">' +
      '<h3>จองล็อก '+esc(stall.code)+'</h3>' +
      '<div class="sub">'+esc(zone?zone.name:'')+' · ราคาทั่วไป '+fmtMoney(stall.price_per_day)+'/วัน · ราคาสมาชิก '+fmtMoney(regularRate)+'/วัน</div>' +
      '<form id="bookForm">' +
        '<div class="field"><label for="bfName">ชื่อผู้ขาย</label><input id="bfName" required value="'+esc(profile.vendorName)+'"></div>' +
        '<div class="field"><label for="bfPhone">เบอร์โทรศัพท์</label><input id="bfPhone" required value="'+esc(profile.vendorPhone)+'" placeholder="08X-XXX-XXXX"></div>' +
        '<div class="field"><label for="bfCat">คุณขายอะไร?</label><select id="bfCat">'+catOptions+'</select></div>' +
        '<div class="field-row">' +
          '<div class="field"><label for="bfStart">วันที่เริ่ม</label><input type="date" id="bfStart" required min="'+minDate+'" value="'+minDate+'"></div>' +
          '<div class="field"><label for="bfEnd">วันที่สิ้นสุด</label><input type="date" id="bfEnd" required min="'+minDate+'" value="'+minDate+'"></div>' +
        '</div>' +
        '<div class="field"><label for="bfNote">ข้อความถึงเจ้าหน้าที่ตลาด (ถ้ามี)</label><textarea id="bfNote" rows="2" placeholder="เช่น ขายลูกชิ้นปิ้ง ต้องการปลั๊กไฟ"></textarea></div>' +
        '<div class="deposit-box">' +
          '<div class="deposit-row"><span id="depositLabel">ค่ามัดจำการจอง (1 วัน)</span><strong id="depositAmount">'+fmtMoney(stall.price_per_day)+'</strong></div>' +
          (state.settings.promptPayQrUrl
            ? '<div class="qr-scan" id="qrScanBlock" '+(PAYMENT_METHODS[0].id!=='promptpay'?'hidden':'')+'><img class="receipt-thumb" style="width:120px;height:120px" src="'+esc(state.settings.promptPayQrUrl)+'" data-full="'+esc(state.settings.promptPayQrUrl)+'" data-title="QR โค้ดพร้อมเพย์" alt="QR โค้ดพร้อมเพย์ แตะเพื่อขยาย"><span class="muted small">สแกนด้วยแอปธนาคาร แล้วติ๊กด้านล่าง</span></div>'
            : '') +
          '<div class="field" style="margin-top:10px"><label for="bfPayMethod">วิธีการชำระเงิน</label><select id="bfPayMethod">'+payOptions+'</select></div>' +
          '<label class="checkline"><input type="checkbox" id="bfPaid"> ฉันโอนเงินมัดจำแล้ว</label>' +
          '<p class="deposit-note">ถ้ายังไม่จ่าย สามารถกดยืนยันได้ที่ "การจองของฉัน" หลังโอนเงิน — เจ้าหน้าที่จะตรวจสอบและยืนยันอีกครั้ง '+(isRegistered?'':'สมาชิกที่ลงทะเบียน/ลูกค้าประจำจะได้ราคาพิเศษโดยอัตโนมัติ')+'</p>' +
        '</div>' +
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
    wireReceiptThumbs(root);
    var qrScanBlock = document.getElementById('qrScanBlock');
    if (qrScanBlock){
      document.getElementById('bfPayMethod').addEventListener('change', function(){
        qrScanBlock.hidden = this.value !== 'promptpay';
      });
    }
    function refreshDeposit(){
      var s = document.getElementById('bfStart').value;
      var e = document.getElementById('bfEnd').value;
      var days = (s && e && e >= s) ? countDays(s, e) : 1;
      document.getElementById('depositLabel').textContent = 'ค่ามัดจำการจอง (' + days + ' วัน, คำนวณโดยระบบ)';
      document.getElementById('depositAmount').textContent = '~' + fmtMoney(stall.price_per_day * days) + ' (แสดงราคาทั่วไป)';
    }
    document.getElementById('bfStart').addEventListener('change', refreshDeposit);
    document.getElementById('bfEnd').addEventListener('change', refreshDeposit);
    document.getElementById('bookForm').addEventListener('submit', function(e){
      e.preventDefault();
      var name = document.getElementById('bfName').value.trim();
      var phone = document.getElementById('bfPhone').value.trim();
      var category = document.getElementById('bfCat').value;
      var start = document.getElementById('bfStart').value;
      var end = document.getElementById('bfEnd').value;
      var note = document.getElementById('bfNote').value.trim();
      var payMethod = document.getElementById('bfPayMethod').value;
      var paid = document.getElementById('bfPaid').checked;
      var errEl = document.getElementById('bfErr');
      var submitBtn = e.target.querySelector('button[type=submit]');
      if (!name || !phone || !start || !end){ errEl.textContent = 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ'; return; }
      if (end < start){ errEl.textContent = 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม'; return; }

      profile.vendorName = name; profile.vendorPhone = phone; saveProfile();
      submitBtn.disabled = true;

      apiPost('/api/bookings', {
        stallId: stall.id, vendorToken: profile.vendorToken, vendorName: name, vendorPhone: phone,
        category: category, startDate: start, endDate: end, note: note || null,
        paymentMethod: payMethod, alreadyPaid: paid
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
    if (e.key === 'Escape' && document.getElementById('modalRoot').innerHTML){ closeModal(); }
  });

  function confirmAction(message, onConfirm){
    var root = document.getElementById('modalRoot');
    root.innerHTML =
      '<div class="modal-back" id="mb"><div class="modal">' +
      '<h3>ยืนยันหรือไม่?</h3>' +
      '<div class="sub">'+esc(message)+'</div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn ghost" id="cfCancel">ยกเลิก</button>' +
        '<button type="button" class="btn danger" id="cfOk">ลบ</button>' +
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

  // ---------- Account sign-in / registration modal ----------
  function openAuthModal(mode){
    mode = mode === 'register' ? 'register' : 'login';
    var root = document.getElementById('modalRoot');

    var loginFields =
      '<div class="field"><label for="afUser">ชื่อผู้ใช้</label><input id="afUser" autocomplete="username" required></div>' +
      '<div class="field"><label for="afPass">รหัสผ่าน</label><input id="afPass" type="password" autocomplete="current-password" required></div>';

    var registerFields =
      '<div class="field"><label for="afName">ชื่อ-นามสกุล</label><input id="afName" required value="'+esc(profile.vendorName)+'"></div>' +
      '<div class="field"><label for="afPhone">เบอร์โทรศัพท์</label><input id="afPhone" required placeholder="08X-XXX-XXXX" value="'+esc(profile.vendorPhone)+'"></div>' +
      '<div class="field"><label for="afUser">ชื่อผู้ใช้</label><input id="afUser" autocomplete="username" required></div>' +
      '<div class="field"><label for="afPass">รหัสผ่าน</label><input id="afPass" type="password" autocomplete="new-password" required></div>';

    root.innerHTML =
      '<div class="modal-back" id="mb"><div class="modal">' +
      '<div class="auth-toggle" id="authToggle">' +
        '<button type="button" class="auth-toggle-btn '+(mode==='login'?'active':'')+'" data-authmode="login">เข้าสู่ระบบ</button>' +
        '<button type="button" class="auth-toggle-btn '+(mode==='register'?'active':'')+'" data-authmode="register">สร้างบัญชี</button>' +
      '</div>' +
      '<div class="sub" style="margin-bottom:16px">'+(mode==='register'
        ? 'สมัครสมาชิกครั้งเดียว เพื่อติดตามการจองและไม่ต้องกรอกข้อมูลซ้ำในครั้งถัดไป'
        : 'ผู้ขายและเจ้าหน้าที่ตลาดเข้าสู่ระบบที่นี่ — บัญชีเจ้าหน้าที่จะเข้าสู่หน้าแอดมินโดยอัตโนมัติ') + '</div>' +
      '<form id="authForm">' + (mode==='register' ? registerFields : loginFields) +
        '<div class="form-error" id="afErr"></div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn ghost" id="afCancel">ยกเลิก</button>' +
          '<button type="submit" class="btn primary">'+(mode==='register' ? 'สร้างบัญชี' : 'เข้าสู่ระบบ')+'</button>' +
        '</div>' +
      '</form>' +
      (mode!=='register' ? '<p class="deposit-note" style="margin-top:14px">เจ้าหน้าที่ตลาด: ใช้บัญชีที่แอดมินใหญ่มอบให้</p>' : '') +
      '</div></div>';

    var back = document.getElementById('mb');
    back.addEventListener('click', function(e){ if (e.target===back) closeModal(); });
    document.getElementById('afCancel').onclick = closeModal;
    document.getElementById('authToggle').querySelectorAll('.auth-toggle-btn').forEach(function(btn){
      btn.addEventListener('click', function(){ openAuthModal(btn.dataset.authmode); });
    });

    document.getElementById('authForm').addEventListener('submit', function(e){
      e.preventDefault();
      var errEl = document.getElementById('afErr');
      var submitBtn = e.target.querySelector('button[type=submit]');
      var username = document.getElementById('afUser').value.trim();
      var password = document.getElementById('afPass').value;

      if (mode === 'register'){
        var name = document.getElementById('afName').value.trim();
        var phone = document.getElementById('afPhone').value.trim();
        if (!name || !phone || !username || !password){ errEl.textContent = 'กรุณากรอกข้อมูลให้ครบทุกช่อง'; return; }
        submitBtn.disabled = true;
        apiPost('/api/auth/register', { name:name, phone:phone, username:username, password:password })
          .then(function(res){
            saveToken(res.token);
            profile.vendorToken = res.user.id;
            profile.vendorName = res.user.name;
            profile.vendorPhone = res.user.phone;
            profile.isRegistered = true;
            saveProfile();
            closeModal();
            toast('สร้างบัญชีสำเร็จ — เข้าสู่ระบบในชื่อ ' + res.user.name);
            setTab('mine');
          }).catch(function(err){
            errEl.textContent = err.error || 'สร้างบัญชีไม่สำเร็จ';
            submitBtn.disabled = false;
          });
        return;
      }

      if (!username || !password){ errEl.textContent = 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'; return; }
      submitBtn.disabled = true;
      apiPost('/api/auth/login', { username:username, password:password }).then(function(res){
        saveToken(res.token);
        if (res.user.kind === 'admin'){
          profile.isAdmin = true;
          profile.isHeadAdmin = res.user.role === 'head';
          profile.adminName = res.user.name;
          profile.adminUsername = res.user.id;
          saveProfile();
          closeModal();
          setTab('admin');
          toast('เข้าสู่ระบบในชื่อ ' + res.user.name);
        } else {
          profile.vendorToken = res.user.id;
          profile.vendorName = res.user.name;
          profile.vendorPhone = res.user.phone;
          profile.isRegistered = true;
          saveProfile();
          closeModal();
          toast('ยินดีต้อนรับกลับมา ' + res.user.name);
          setTab('mine');
        }
      }).catch(function(err){
        errEl.textContent = err.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
        submitBtn.disabled = false;
      });
    });
  }

  // ---------- My Bookings ----------
  function renderMine(){
    var host = document.getElementById('view-mine');
    if (!state.myBookingsLoaded){
      host.innerHTML = '<div class="empty"><div class="big">⏳</div>กำลังโหลดการจองของคุณ…</div>';
      return;
    }
    var mine = state.myBookings || [];
    if (!mine.length){
      host.innerHTML = '<div class="section-head"><h2>การจองของฉัน</h2></div>' +
        '<div class="empty"><div class="big">🧺</div>ยังไม่มีคำขอจอง<br>ไปที่ผังตลาดเพื่อขอจองล็อก</div>';
      return;
    }
    var rows = mine.map(function(b){
      var canCancel = (b.status==='pending' || b.status==='approved') && b.end_date >= todayStr();
      var payStatus = b.payment_status || 'unpaid';
      var canMarkPaid = payStatus==='unpaid' && b.status!=='cancelled' && b.status!=='rejected';
      var canAttachReceipt = b.status!=='cancelled' && b.status!=='rejected';
      return '<div class="booking-row">' +
        '<div class="who"><div class="name">'+categoryMeta(b.category).icon+' '+esc(b.stall_code||'—')+' · '+esc(b.zone_name||'')+'</div>' +
        '<div class="stalltag">'+fmtMoney(b.deposit_amount)+' มัดจำ · ราคา'+esc(rateLabel(b.rate_type))+'</div></div>' +
        '<div class="dates">'+fmtDate(b.start_date)+' → '+fmtDate(b.end_date)+(b.note?'<br><span class="small">"'+esc(b.note)+'"</span>':'')+'</div>' +
        (b.receipt_path ? '<a href="'+esc(b.receipt_path)+'" target="_blank" rel="noopener"><img class="receipt-thumb" src="'+esc(b.receipt_path)+'" data-full="'+esc(b.receipt_path)+'" alt="สลิปการชำระเงิน แตะเพื่อขยาย"></a>' : '') +
        '<span class="badge '+esc(b.status)+'">'+esc(statusLabel(b.status))+'</span>' +
        '<span class="paybadge '+esc(payStatus)+'">'+esc(payStatusLabel(payStatus))+'</span>' +
        '<div class="row-actions">' +
        (canMarkPaid ? '<button class="btn small ghost" data-markpaid="'+b.id+'">แจ้งชำระมัดจำแล้ว</button>' : '') +
        (canAttachReceipt ? '<button class="btn small ghost" data-addreceipt="'+b.id+'">'+(b.receipt_path?'เปลี่ยนสลิป':'แนบสลิป')+'</button>' : '') +
        (canCancel ? '<button class="btn small danger" data-cancel="'+b.id+'">ยกเลิก</button>' : '') +
        '</div>' +
        '</div>';
    }).join('');
    host.innerHTML = '<div class="section-head"><h2>การจองของฉัน</h2><span class="muted small">'+mine.length+' รายการ</span></div>' +
      '<div class="booking-list">'+rows+'</div>';

    host.querySelectorAll('[data-cancel]').forEach(function(btn){
      btn.addEventListener('click', function(){
        apiDelete('/api/bookings/' + btn.dataset.cancel)
          .then(function(){ toast('ยกเลิกการจองแล้ว'); loadMyBookings(); loadPublicData(); })
          .catch(function(){ toast('ยกเลิกไม่สำเร็จ', true); });
      });
    });
    host.querySelectorAll('[data-markpaid]').forEach(function(btn){
      btn.addEventListener('click', function(){
        apiPut('/api/bookings/' + btn.dataset.markpaid + '/payment', { paymentStatus:'paid' })
          .then(function(){ toast('แจ้งชำระเงินแล้ว — รอเจ้าหน้าที่ยืนยัน'); loadMyBookings(); })
          .catch(function(){ toast('อัปเดตไม่สำเร็จ', true); });
      });
    });
    host.querySelectorAll('[data-addreceipt]').forEach(function(btn){
      btn.addEventListener('click', function(){ requestReceiptUpload(btn.dataset.addreceipt); });
    });
    wireReceiptThumbs(host);
  }

  // ---------- receipt / QR image upload ----------
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
        var fd = new FormData();
        fd.append('receipt', file);
        toast('กำลังอัปโหลดสลิป…');
        apiUpload('/api/bookings/' + bookingId + '/receipt', fd)
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
        var fd = new FormData();
        fd.append('qr', file);
        toast('กำลังอัปโหลด QR โค้ด…');
        apiUpload('/api/settings/qr', fd)
          .then(function(res){ state.settings.promptPayQrUrl = res.promptPayQrUrl; toast('อัปเดต QR พร้อมเพย์แล้ว'); render(); })
          .catch(function(err){ toast(err.error || 'อัปโหลด QR ไม่สำเร็จ', true); });
      });
    }
    return el;
  }
  function requestQrUpload(){
    if (!profile.isHeadAdmin){ toast('เฉพาะแอดมินใหญ่เท่านั้นที่แก้ไขได้', true); return; }
    wantsQrUpload = true;
    ensureQrInput().click();
  }

  // ---------- Admin ----------
  function renderAdmin(){
    var host = document.getElementById('view-admin');
    if (!profile.isAdmin){
      host.innerHTML = '<div class="empty"><div class="big">🔒</div>กรุณาเข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่<br><button class="btn primary" id="goLogin" style="margin-top:10px">เข้าสู่ระบบ</button></div>';
      document.getElementById('goLogin').onclick = function(){ openAuthModal('login'); };
      return;
    }
    var sections = [
      ['approvals','อนุมัติคำขอ'], ['bookings','การจองทั้งหมด'], ['vendors','ผู้ขาย'],
      ['announcements','ประกาศ'], ['audit','ตรวจสอบตลาด'], ['zones','โซน'],
      ['stalls','ล็อก'], ['settings','ตั้งค่า']
    ];
    if (profile.isHeadAdmin) sections.push(['admins','แอดมิน']);

    var nav = sections.map(function(s){
      return '<button class="'+(state.adminSection===s[0]?'active':'')+'" data-sec="'+s[0]+'">'+s[1]+'</button>';
    }).join('');
    var navOptions = sections.map(function(s){
      return '<option value="'+s[0]+'" '+(state.adminSection===s[0]?'selected':'')+'>'+s[1]+'</option>';
    }).join('');

    host.innerHTML =
      '<div class="section-head"><h2>ระบบจัดการของเจ้าหน้าที่ตลาด</h2></div>' +
      '<div class="admin-grid">' +
        '<select class="admin-nav-select" id="adminNavSelect" aria-label="หมวดหมู่ในระบบแอดมิน">'+navOptions+'</select>' +
        '<nav class="admin-nav">'+nav+'</nav>' +
        '<div class="admin-panel" id="adminPanel"></div>' +
      '</div>';

    host.querySelectorAll('.admin-nav button').forEach(function(btn){
      btn.addEventListener('click', function(){ state.adminSection = btn.dataset.sec; render(); refreshAdminData(); });
    });
    var activeNavBtn = host.querySelector('.admin-nav button.active');
    if (activeNavBtn && activeNavBtn.scrollIntoView){
      activeNavBtn.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
    document.getElementById('adminNavSelect').addEventListener('change', function(){
      state.adminSection = this.value; render(); refreshAdminData();
    });

    var panel = document.getElementById('adminPanel');
    if (state.adminSection==='approvals') renderApprovals(panel);
    else if (state.adminSection==='bookings') renderAllBookings(panel);
    else if (state.adminSection==='vendors') renderVendorAdmin(panel);
    else if (state.adminSection==='announcements') renderAnnouncementAdmin(panel);
    else if (state.adminSection==='audit') renderAuditAdmin(panel);
    else if (state.adminSection==='zones') renderZoneAdmin(panel);
    else if (state.adminSection==='stalls') renderStallAdmin(panel);
    else if (state.adminSection==='settings') renderSettingsAdmin(panel);
    else if (state.adminSection==='admins') renderAdminAccounts(panel);
  }

  function renderApprovals(panel){
    var pending = (state.bookings||[]).filter(function(b){ return b.status==='pending'; });
    if (!pending.length){
      panel.innerHTML = '<div class="empty"><div class="big">✅</div>ไม่มีคำขอค้างอนุมัติ เรียบร้อยแล้ว</div>';
      return;
    }
    var rows = pending.map(function(b){
      var payStatus = b.payment_status || 'unpaid';
      return '<div class="booking-row">' +
        '<div class="who"><div class="name">'+categoryMeta(b.category).icon+' '+esc(b.vendor_name)+'</div><div class="stalltag">'+esc(b.vendor_phone)+'</div></div>' +
        '<div class="dates"><span class="stalltag">'+esc(b.stall_code||'—')+' · '+esc(b.zone_name||'')+'</span><br>'+fmtDate(b.start_date)+' → '+fmtDate(b.end_date)+(b.note?'<br><span class="small">"'+esc(b.note)+'"</span>':'')+'</div>' +
        (b.receipt_path ? '<a href="'+esc(b.receipt_path)+'" target="_blank" rel="noopener" title="แตะเพื่อขยาย"><img class="receipt-thumb" src="'+esc(b.receipt_path)+'" data-full="'+esc(b.receipt_path)+'" alt="สลิปการชำระเงิน แตะเพื่อขยาย"></a>' : '<span class="muted small">ไม่มีสลิป</span>') +
        '<span class="paybadge '+esc(payStatus)+'">'+esc(payStatusLabel(payStatus))+' · '+fmtMoney(b.deposit_amount)+' (ราคา'+esc(rateLabel(b.rate_type))+')</span>' +
        '<div class="row-actions">' +
        (payStatus==='paid' ? '<button class="btn small ghost" data-confirmpay="'+b.id+'">ยืนยันรับเงิน</button>' : '') +
        '<button class="btn small primary" data-approve="'+b.id+'">อนุมัติ</button>' +
        '<button class="btn small danger" data-reject="'+b.id+'">ปฏิเสธ</button>' +
        '</div></div>';
    }).join('');
    panel.innerHTML = '<div class="card" style="padding:16px"><div class="booking-list">'+rows+'</div></div>';

    panel.querySelectorAll('[data-approve]').forEach(function(btn){
      btn.addEventListener('click', function(){
        apiPut('/api/bookings/' + btn.dataset.approve + '/status', { status:'approved' })
          .then(function(){ toast('อนุมัติการจองแล้ว'); loadAdminBookings(); loadPublicData(); })
          .catch(function(err){ toast(err.error || 'อัปเดตการจองไม่สำเร็จ', true); });
      });
    });
    panel.querySelectorAll('[data-reject]').forEach(function(btn){
      btn.addEventListener('click', function(){
        apiPut('/api/bookings/' + btn.dataset.reject + '/status', { status:'rejected' })
          .then(function(){ toast('ปฏิเสธการจองแล้ว'); loadAdminBookings(); loadPublicData(); })
          .catch(function(err){ toast(err.error || 'อัปเดตการจองไม่สำเร็จ', true); });
      });
    });
    panel.querySelectorAll('[data-confirmpay]').forEach(function(btn){
      btn.addEventListener('click', function(){
        apiPut('/api/bookings/' + btn.dataset.confirmpay + '/payment', { paymentStatus:'confirmed' })
          .then(function(){ toast('ยืนยันรับเงินแล้ว'); loadAdminBookings(); })
          .catch(function(err){ toast(err.error || 'อัปเดตไม่สำเร็จ', true); });
      });
    });
    wireReceiptThumbs(panel);
  }

  function renderAllBookings(panel){
    var filter = state.bookingsFilter || 'all';
    var list = (state.bookings||[]).filter(function(b){ return filter==='all' || b.status===filter; });
    var statuses = ['all','pending','approved','rejected','cancelled'];
    var bar = statuses.map(function(s){
      return '<button class="btn small '+(filter===s?'primary':'ghost')+'" data-filt="'+s+'">'+(s==='all'?'ทั้งหมด':statusLabel(s))+'</button>';
    }).join('');

    var rowsHtml = list.length ? list.map(function(b){
      var payStatus = b.payment_status || 'unpaid';
      return '<tr><td>'+esc(b.vendor_name)+'<br><span class="muted small">'+esc(b.vendor_phone)+'</span></td>' +
        '<td class="mono">'+categoryMeta(b.category).icon+' '+esc(b.stall_code||'—')+'</td>' +
        '<td>'+esc(b.zone_name||'')+'</td>' +
        '<td>'+fmtDate(b.start_date)+' → '+fmtDate(b.end_date)+'</td>' +
        '<td><span class="badge '+esc(b.status)+'">'+esc(statusLabel(b.status))+'</span></td>' +
        '<td><span class="paybadge '+esc(payStatus)+'">'+esc(payStatusLabel(payStatus))+'</span></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">ไม่มีรายการจองในตัวกรองนี้</td></tr>';

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="filter-bar">'+bar+'</div>' +
      '<div class="table-wrap"><table><thead><tr><th>ผู้ขาย</th><th>ล็อก</th><th>โซน</th><th>วันที่</th><th>สถานะ</th><th>การชำระเงิน</th></tr></thead>' +
      '<tbody>'+rowsHtml+'</tbody></table></div></div>';

    panel.querySelectorAll('[data-filt]').forEach(function(btn){
      btn.addEventListener('click', function(){ state.bookingsFilter = btn.dataset.filt; renderAllBookings(panel); });
    });
  }

  function renderZoneAdmin(panel){
    var rows = state.zones.map(function(z){
      var color = ZONE_COLORS[(z.color_index||0)%4];
      var count = stallsInZone(z.id).length;
      return '<tr><td><span class="zone-chip"><span class="zone-dot" style="background:'+color+'"></span>'+esc(z.name)+'</span></td>' +
        '<td>'+esc(z.description||'')+'</td><td>'+count+'</td>' +
        '<td><button type="button" class="btn small danger" data-delzone="'+z.id+'">ลบ</button></td></tr>';
    }).join('');

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="table-wrap"><table><thead><tr><th>โซน</th><th>รายละเอียด</th><th>จำนวนล็อก</th><th></th></tr></thead>' +
      '<tbody>'+(rows||'<tr><td colspan="4" class="empty">ยังไม่มีโซน</td></tr>')+'</tbody></table></div>' +
      '<div class="add-row" style="margin-top:14px">' +
        '<div class="field"><label for="zName">ชื่อโซน</label><input id="zName" placeholder="โซนโปรโมชั่นตามฤดูกาล"></div>' +
        '<div class="field"><label for="zDesc">รายละเอียด</label><input id="zDesc" placeholder="ระบุตำแหน่งโดยย่อ"></div>' +
        '<button type="button" class="btn primary" id="zAdd">เพิ่มโซน</button>' +
      '</div></div>';

    var zAddBtn = document.getElementById('zAdd');
    zAddBtn.onclick = function(){
      var name = document.getElementById('zName').value.trim();
      var desc = document.getElementById('zDesc').value.trim();
      if (!name){ toast('กรุณากรอกชื่อโซน', true); return; }
      zAddBtn.disabled = true;
      apiPost('/api/zones', { name:name, description:desc||null, colorIndex: state.zones.length % 4 })
        .then(function(){ toast('เพิ่มโซนแล้ว'); document.getElementById('zName').value=''; document.getElementById('zDesc').value=''; loadPublicData(); })
        .catch(function(err){ toast(err.error || 'เพิ่มโซนไม่สำเร็จ', true); })
        .then(function(){ zAddBtn.disabled = false; });
    };
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

  function renderStallAdmin(panel){
    if (!state.zones.length){
      panel.innerHTML = '<div class="empty">กรุณาเพิ่มโซนก่อนเพิ่มล็อก</div>';
      return;
    }
    var rows = state.stalls.map(function(s){
      var z = zoneById(s.zone_id);
      return '<tr><td class="mono">'+categoryMeta(s.category).icon+' '+esc(s.code)+'</td><td>'+esc(z?z.name:'—')+'</td>' +
        '<td>'+fmtMoney(s.price_per_day)+'</td>' +
        '<td>'+fmtMoney(s.regular_price_per_day)+'</td>' +
        '<td><span class="badge '+(s.active?'approved':'cancelled')+'">'+(s.active?'เปิดใช้งาน':'ปิด')+'</span></td>' +
        '<td><button type="button" class="btn small ghost" data-editprice="'+s.id+'">แก้ไขราคา</button> ' +
        '<button type="button" class="btn small ghost" data-toggle="'+s.id+'">'+(s.active?'ปิดล็อก':'เปิดล็อก')+'</button> ' +
        '<button type="button" class="btn small danger" data-delstall="'+s.id+'">ลบ</button></td></tr>';
    }).join('');

    var zoneOptions = state.zones.map(function(z){ return '<option value="'+z.id+'">'+esc(z.name)+'</option>'; }).join('');
    var catOptions = CATEGORIES.map(function(c){ return '<option value="'+c.id+'">'+c.icon+' '+esc(c.label)+'</option>'; }).join('');

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="table-wrap"><table><thead><tr><th>รหัส</th><th>โซน</th><th>ราคาทั่วไป/วัน</th><th>ราคาสมาชิก/วัน</th><th>สถานะ</th><th></th></tr></thead>' +
      '<tbody>'+(rows||'<tr><td colspan="6" class="empty">ยังไม่มีล็อก</td></tr>')+'</tbody></table></div>' +
      '<div class="add-row" style="margin-top:14px">' +
        '<div class="field"><label for="sZone">โซน</label><select id="sZone">'+zoneOptions+'</select></div>' +
        '<div class="field"><label for="sCode">รหัสล็อก</label><input id="sCode" placeholder="F9" style="max-width:100px"></div>' +
        '<div class="field"><label for="sCat">ประเภทสินค้า</label><select id="sCat">'+catOptions+'</select></div>' +
        '<div class="field"><label for="sPrice">ราคาทั่วไป/วัน (฿)</label><input id="sPrice" type="number" min="0" step="10" value="650" style="max-width:120px"></div>' +
        '<div class="field"><label for="sRegPrice">ราคาสมาชิก/วัน (฿)</label><input id="sRegPrice" type="number" min="0" step="10" value="450" style="max-width:120px"></div>' +
        '<button type="button" class="btn primary" id="sAdd">เพิ่มล็อก</button>' +
      '</div></div>';

    var sAddBtn = document.getElementById('sAdd');
    sAddBtn.onclick = function(){
      var zoneId = document.getElementById('sZone').value;
      var code = document.getElementById('sCode').value.trim();
      var category = document.getElementById('sCat').value;
      var price = parseFloat(document.getElementById('sPrice').value);
      var regPrice = parseFloat(document.getElementById('sRegPrice').value);
      if (!code || !(price>=0) || !(regPrice>=0)){ toast('กรุณากรอกรหัสล็อกและราคาทั้งสองแบบ', true); return; }
      sAddBtn.disabled = true;
      apiPost('/api/stalls', { zoneId:zoneId, code:code, category:category, pricePerDay:price, regularPricePerDay:regPrice })
        .then(function(){ toast('เพิ่มล็อกแล้ว'); document.getElementById('sCode').value=''; loadPublicData(); })
        .catch(function(err){ toast(err.error || 'เพิ่มล็อกไม่สำเร็จ', true); })
        .then(function(){ sAddBtn.disabled = false; });
    };
    panel.querySelectorAll('[data-toggle]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var s = state.stalls.find(function(x){ return String(x.id)===btn.dataset.toggle; });
        apiPut('/api/stalls/' + btn.dataset.toggle, { active: !s.active })
          .then(function(){ toast(s.active?'ปิดล็อกแล้ว':'เปิดล็อกแล้ว'); loadPublicData(); });
      });
    });
    panel.querySelectorAll('[data-delstall]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var s = state.stalls.find(function(x){ return String(x.id)===btn.dataset.delstall; });
        confirmAction('ลบล็อก "' + (s?s.code:'ล็อกนี้') + '"? ไม่สามารถย้อนกลับได้', function(){
          apiDelete('/api/stalls/' + btn.dataset.delstall)
            .then(function(){ toast('ลบล็อกแล้ว'); loadPublicData(); })
            .catch(function(err){ toast(err.error || 'ลบล็อกไม่สำเร็จ', true); });
        });
      });
    });
    panel.querySelectorAll('[data-editprice]').forEach(function(btn){
      btn.addEventListener('click', function(){ openEditStallPriceModal(btn.dataset.editprice); });
    });
  }

  function openEditStallPriceModal(stallId){
    var s = state.stalls.find(function(x){ return String(x.id)===String(stallId); });
    if (!s) return;
    var root = document.getElementById('modalRoot');
    root.innerHTML =
      '<div class="modal-back" id="mb"><div class="modal">' +
      '<h3>แก้ไขราคา — ล็อก '+esc(s.code)+'</h3>' +
      '<form id="priceForm">' +
        '<div class="field"><label for="epGuest">ราคาทั่วไป/วัน (฿)</label><input id="epGuest" type="number" min="0" step="10" value="'+(Number(s.price_per_day)||0)+'" required></div>' +
        '<div class="field"><label for="epRegular">ราคาสมาชิก/วัน (฿)</label><input id="epRegular" type="number" min="0" step="10" value="'+(Number(s.regular_price_per_day)||0)+'" required></div>' +
        '<div class="form-error" id="epErr"></div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn ghost" id="epCancel">ยกเลิก</button>' +
          '<button type="submit" class="btn primary">บันทึก</button>' +
        '</div>' +
      '</form>' +
      '</div></div>';
    var back = document.getElementById('mb');
    back.addEventListener('click', function(e){ if (e.target===back) closeModal(); });
    document.getElementById('epCancel').onclick = closeModal;
    document.getElementById('priceForm').addEventListener('submit', function(e){
      e.preventDefault();
      var guest = parseFloat(document.getElementById('epGuest').value);
      var regular = parseFloat(document.getElementById('epRegular').value);
      var errEl = document.getElementById('epErr');
      if (!(guest>=0) || !(regular>=0)){ errEl.textContent = 'กรุณากรอกราคาที่ถูกต้อง'; return; }
      apiPut('/api/stalls/' + stallId, { pricePerDay: guest, regularPricePerDay: regular })
        .then(function(){ toast('อัปเดตราคาแล้ว'); closeModal(); loadPublicData(); })
        .catch(function(){ errEl.textContent = 'อัปเดตราคาไม่สำเร็จ'; });
    });
  }

  function renderVendorAdmin(panel){
    if (!state.vendors.length){
      panel.innerHTML = '<div class="empty"><div class="big">🧑‍🌾</div>ยังไม่มีผู้ขาย — จะแสดงที่นี่หลังจากจองครั้งแรก</div>';
      return;
    }
    var rows = state.vendors.map(function(v){
      var blocked = !v.active;
      var regular = !!v.is_regular;
      return '<tr><td>'+esc(v.name)+(regular?' <span class="pill on-primary small">ลูกค้าประจำ</span>':'')+'</td><td>'+esc(v.phone)+'</td>' +
        '<td>'+categoryMeta(v.category).icon+' '+esc(categoryMeta(v.category).label)+'</td>' +
        '<td>'+v.booking_total+' ครั้ง · อนุมัติ '+v.booking_approved+'</td>' +
        '<td>'+fmtDate((v.joined_at||todayStr()).slice(0,10))+'</td>' +
        '<td><span class="badge '+(blocked?'cancelled':'approved')+'">'+(blocked?'ถูกระงับ':'ใช้งานอยู่')+'</span></td>' +
        '<td><button type="button" class="btn small ghost" data-regulartoggle="'+esc(v.id)+'">'+(regular?'ยกเลิกลูกค้าประจำ':'ตั้งเป็นลูกค้าประจำ')+'</button> ' +
        '<button type="button" class="btn small '+(blocked?'primary':'danger')+'" data-vendortoggle="'+esc(v.id)+'">'+(blocked?'ยกเลิกระงับ':'ระงับ')+'</button></td></tr>';
    }).join('');

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<p class="muted small" style="margin:0 0 12px">ลูกค้าประจำ (ขาประจำ) จะได้รับราคาพิเศษต่อวันสำหรับการจองครั้งถัดไป</p>' +
      '<div class="table-wrap"><table><thead><tr><th>ผู้ขาย</th><th>เบอร์โทร</th><th>สินค้าที่ขาย</th><th>การจอง</th><th>วันที่เข้าร่วม</th><th>สถานะ</th><th></th></tr></thead>' +
      '<tbody>'+rows+'</tbody></table></div></div>';

    panel.querySelectorAll('[data-vendortoggle]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var v = state.vendors.find(function(x){ return x.id===btn.dataset.vendortoggle; });
        apiPut('/api/vendors/' + encodeURIComponent(btn.dataset.vendortoggle), { active: !v.active, isRegular: !!v.is_regular })
          .then(function(){ toast(v.active ? 'ระงับผู้ขายแล้ว' : 'ยกเลิกระงับผู้ขายแล้ว'); loadVendors(); })
          .catch(function(){ toast('อัปเดตผู้ขายไม่สำเร็จ', true); });
      });
    });
    panel.querySelectorAll('[data-regulartoggle]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var v = state.vendors.find(function(x){ return x.id===btn.dataset.regulartoggle; });
        apiPut('/api/vendors/' + encodeURIComponent(btn.dataset.regulartoggle), { active: !!v.active, isRegular: !v.is_regular })
          .then(function(){ toast(!v.is_regular ? 'ตั้งเป็นลูกค้าประจำแล้ว' : 'ยกเลิกลูกค้าประจำแล้ว'); loadVendors(); })
          .catch(function(){ toast('อัปเดตผู้ขายไม่สำเร็จ', true); });
      });
    });
  }

  function renderAnnouncementAdmin(panel){
    var typeOptions = ANNOUNCE_TYPES.map(function(t){ return '<option value="'+t.id+'">'+esc(t.label)+'</option>'; }).join('');
    var rows = state.announcements.map(function(a){
      var cls = a.type==='rule' ? 'rejected' : a.type==='holiday' ? 'pending' : a.type==='event' ? 'approved' : 'cancelled';
      return '<tr><td><span class="badge '+cls+'">'+esc(announceTypeLabel(a.type))+'</span></td>' +
        '<td>'+esc(a.title)+(a.pinned?' <span class="pill on-accent small">ปักหมุด</span>':'')+'<br><span class="muted small">'+esc(a.body)+'</span></td>' +
        '<td>'+fmtDate((a.created_at||todayStr()).slice(0,10))+'</td>' +
        '<td><button type="button" class="btn small ghost" data-pin="'+a.id+'">'+(a.pinned?'ยกเลิกปักหมุด':'ปักหมุด')+'</button> ' +
        '<button type="button" class="btn small danger" data-delannounce="'+a.id+'">ลบ</button></td></tr>';
    }).join('');

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="table-wrap"><table><thead><tr><th>ประเภท</th><th>ประกาศ</th><th>วันที่</th><th></th></tr></thead>' +
      '<tbody>'+(rows||'<tr><td colspan="4" class="empty">ยังไม่มีประกาศ</td></tr>')+'</tbody></table></div>' +
      '<div class="add-row" style="margin-top:14px; flex-direction:column; align-items:stretch">' +
        '<div class="field-row">' +
          '<div class="field"><label for="anTitle">หัวข้อ</label><input id="anTitle" placeholder="ตลาดปิดช่วงสงกรานต์"></div>' +
          '<div class="field"><label for="anType">ประเภท</label><select id="anType">'+typeOptions+'</select></div>' +
        '</div>' +
        '<div class="field"><label for="anBody">ข้อความ</label><textarea id="anBody" rows="2" placeholder="รายละเอียดสำหรับผู้ขาย"></textarea></div>' +
        '<div><button type="button" class="btn primary" id="anAdd">โพสต์ประกาศ</button></div>' +
      '</div></div>';

    var anAddBtn = document.getElementById('anAdd');
    anAddBtn.onclick = function(){
      var title = document.getElementById('anTitle').value.trim();
      var type = document.getElementById('anType').value;
      var body = document.getElementById('anBody').value.trim();
      if (!title || !body){ toast('กรุณากรอกหัวข้อและข้อความ', true); return; }
      anAddBtn.disabled = true;
      apiPost('/api/announcements', { title:title, type:type, body:body })
        .then(function(){
          toast('โพสต์ประกาศแล้ว');
          document.getElementById('anTitle').value='';
          document.getElementById('anBody').value='';
          loadPublicData();
        })
        .catch(function(err){ toast(err.error || 'โพสต์ประกาศไม่สำเร็จ', true); })
        .then(function(){ anAddBtn.disabled = false; });
    };
    panel.querySelectorAll('[data-pin]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var a = state.announcements.find(function(x){ return String(x.id)===btn.dataset.pin; });
        apiPut('/api/announcements/' + btn.dataset.pin, { pinned: !a.pinned })
          .then(function(){ toast(a.pinned ? 'ยกเลิกปักหมุดแล้ว' : 'ปักหมุดแล้ว'); loadPublicData(); });
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

  function renderAuditAdmin(panel){
    var date = state.auditDate || todayStr();
    var covering = state.auditBookings || [];

    var rows = covering.map(function(b){
      var log = b.audit;
      var present = log ? !!log.present : true;
      var catMatch = log ? !!log.category_match : true;
      var fine = log ? (Number(log.fine_amount)||0) : 0;
      var reason = log ? (log.fine_reason||'') : '';
      return '<tr data-bookingid="'+b.id+'">' +
        '<td class="mono">'+categoryMeta(b.category).icon+' '+esc(b.stall_code||'—')+'</td>' +
        '<td>'+esc(b.vendor_name)+'</td>' +
        '<td>'+esc(categoryMeta(b.category).label)+'</td>' +
        '<td><select class="au-present"><option value="1" '+(present?'selected':'')+'>มาขาย</option><option value="0" '+(!present?'selected':'')+'>ไม่มาขาย</option></select></td>' +
        '<td><select class="au-catmatch"><option value="1" '+(catMatch?'selected':'')+'>ตรงกัน</option><option value="0" '+(!catMatch?'selected':'')+'>ไม่ตรงกัน</option></select></td>' +
        '<td><input type="number" class="au-fine" min="0" step="10" value="'+fine+'" style="width:84px"></td>' +
        '<td><input type="text" class="au-reason" value="'+esc(reason)+'" placeholder="เหตุผล" style="width:130px"></td>' +
        '<td><button type="button" class="btn small primary au-save">บันทึก</button></td></tr>';
    }).join('');

    var fines = state.auditLogs || [];
    var finesRows = fines.map(function(l){
      return '<tr><td>'+fmtDate(l.date)+'</td><td>'+esc(l.vendor_name)+'</td><td class="mono">'+esc(l.stall_code||'—')+'</td>' +
        '<td>'+fmtMoney(l.fine_amount)+'</td><td>'+esc(l.fine_reason||'')+'</td></tr>';
    }).join('');

    panel.innerHTML =
      '<div class="card" style="padding:16px">' +
        '<div class="field" style="max-width:200px"><label for="auDate">วันที่ตรวจสอบ</label><input type="date" id="auDate" value="'+date+'"></div>' +
        (covering.length ?
          '<div class="table-wrap"><table><thead><tr><th>ล็อก</th><th>ผู้ขาย</th><th>ลงทะเบียนเป็น</th><th>มาขาย</th><th>ประเภทสินค้า</th><th>ค่าปรับ (฿)</th><th>เหตุผล</th><th></th></tr></thead>' +
          '<tbody>'+rows+'</tbody></table></div>'
          : '<div class="empty small">ไม่มีการจองที่อนุมัติแล้วในวันนี้</div>') +
      '</div>' +
      '<div class="card" style="padding:16px; margin-top:16px">' +
        '<div class="section-head" style="margin-bottom:8px"><h2 style="font-size:1rem">ค่าปรับล่าสุด</h2></div>' +
        (fines.length ? '<div class="table-wrap"><table><thead><tr><th>วันที่</th><th>ผู้ขาย</th><th>ล็อก</th><th>ค่าปรับ</th><th>เหตุผล</th></tr></thead><tbody>'+finesRows+'</tbody></table></div>' : '<div class="empty small">ยังไม่มีค่าปรับ</div>') +
      '</div>';

    document.getElementById('auDate').addEventListener('change', function(){
      loadAudit(this.value);
    });

    panel.querySelectorAll('.au-save').forEach(function(btn){
      btn.addEventListener('click', function(){
        var tr = btn.closest('tr');
        var bookingId = tr.dataset.bookingid;
        var present = tr.querySelector('.au-present').value === '1';
        var catMatch = tr.querySelector('.au-catmatch').value === '1';
        var fineAmount = parseFloat(tr.querySelector('.au-fine').value) || 0;
        var fineReason = tr.querySelector('.au-reason').value.trim();
        apiPut('/api/audit', { bookingId:bookingId, date:date, present:present, categoryMatch:catMatch, fineAmount:fineAmount, fineReason:fineReason||null })
          .then(function(){ toast('บันทึกการตรวจสอบแล้ว'); loadAudit(date); loadFines(); })
          .catch(function(err){ toast(err.error || 'บันทึกการตรวจสอบไม่สำเร็จ', true); });
      });
    });
  }

  function renderSettingsAdmin(panel){
    var qrUrl = state.settings.promptPayQrUrl;
    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="section-head" style="margin-bottom:8px"><h2 style="font-size:1rem">QR โค้ดพร้อมเพย์</h2></div>' +
      '<p class="muted small" style="margin:0 0 12px">แสดงให้ผู้ขายเห็นตอนชำระค่ามัดจำ เฉพาะแอดมินใหญ่เท่านั้นที่แก้ไขได้</p>' +
      (qrUrl
        ? '<img class="qr-preview receipt-thumb" style="width:150px;height:150px" src="'+esc(qrUrl)+'" data-full="'+esc(qrUrl)+'" data-title="QR โค้ดพร้อมเพย์" alt="QR โค้ดพร้อมเพย์ปัจจุบัน แตะเพื่อขยาย">'
        : '<div class="empty small" style="padding:16px 0">ยังไม่มี QR โค้ด</div>') +
      '<div style="margin-top:14px">' +
      (profile.isHeadAdmin
        ? '<button type="button" class="btn primary" id="qrUploadBtn">'+(qrUrl?'เปลี่ยน QR โค้ด':'อัปโหลด QR โค้ด')+'</button>'
        : '<span class="muted small">🔒 เฉพาะบัญชีแอดมินใหญ่เท่านั้นที่อัปโหลดหรือเปลี่ยนรูปนี้ได้</span>') +
      '</div>' +
      '</div>';

    wireReceiptThumbs(panel);
    if (profile.isHeadAdmin){
      document.getElementById('qrUploadBtn').onclick = requestQrUpload;
    }
  }

  function renderAdminAccounts(panel){
    if (!profile.isHeadAdmin){
      panel.innerHTML = '<div class="empty"><div class="big">🔒</div>เฉพาะแอดมินใหญ่เท่านั้นที่จัดการบัญชีเจ้าหน้าที่ได้</div>';
      return;
    }
    var rows = state.admins.map(function(a){
      var isMe = a.username === profile.adminUsername;
      var deactivated = !a.active;
      return '<tr><td>'+esc(a.name)+(isMe?' <span class="pill on-primary small">คุณ</span>':'')+'</td>' +
        '<td class="mono">'+esc(a.username)+'</td>' +
        '<td><span class="badge '+(a.role==='head'?'approved':'pending')+'">'+(a.role==='head'?'แอดมินใหญ่':'เจ้าหน้าที่')+'</span></td>' +
        '<td><span class="badge '+(deactivated?'cancelled':'approved')+'">'+(deactivated?'ปิดใช้งาน':'ใช้งานอยู่')+'</span></td>' +
        '<td>'+(isMe ? '<span class="muted small">—</span>' : '<button type="button" class="btn small '+(deactivated?'primary':'danger')+'" data-admintoggle="'+esc(a.username)+'">'+(deactivated?'เปิดใช้งานอีกครั้ง':'ปิดใช้งาน')+'</button>') +
        '</td></tr>';
    }).join('');

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="table-wrap"><table><thead><tr><th>ชื่อ</th><th>ชื่อผู้ใช้</th><th>บทบาท</th><th>สถานะ</th><th></th></tr></thead>' +
      '<tbody>'+(rows||'<tr><td colspan="5" class="empty">ยังไม่มีบัญชีแอดมิน</td></tr>')+'</tbody></table></div>' +
      '<div class="add-row" style="margin-top:14px; flex-direction:column; align-items:stretch">' +
        '<div class="field-row">' +
          '<div class="field"><label for="adName">ชื่อ-นามสกุล</label><input id="adName" placeholder="สมชาย ใจดี"></div>' +
          '<div class="field"><label for="adUser">ชื่อผู้ใช้</label><input id="adUser" placeholder="somchai"></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label for="adPass">รหัสผ่าน</label><input id="adPass" type="password" placeholder="ตั้งรหัสผ่าน"></div>' +
          '<div class="field"><label for="adRole">บทบาท</label><select id="adRole"><option value="staff">เจ้าหน้าที่</option><option value="head">แอดมินใหญ่</option></select></div>' +
        '</div>' +
        '<div class="form-error" id="adErr"></div>' +
        '<div><button type="button" class="btn primary" id="adAdd">สร้างบัญชี</button></div>' +
      '</div></div>';

    var adAddBtn = document.getElementById('adAdd');
    adAddBtn.onclick = function(){
      var name = document.getElementById('adName').value.trim();
      var username = document.getElementById('adUser').value.trim();
      var password = document.getElementById('adPass').value;
      var role = document.getElementById('adRole').value;
      var errEl = document.getElementById('adErr');
      if (!name || !username || !password){ errEl.textContent = 'กรุณากรอกชื่อ ชื่อผู้ใช้ และรหัสผ่านให้ครบ'; return; }
      adAddBtn.disabled = true;
      apiPost('/api/admins', { name:name, username:username, password:password, role:role })
        .then(function(){
          toast('สร้างบัญชีให้ ' + name + ' แล้ว');
          errEl.textContent = '';
          document.getElementById('adName').value='';
          document.getElementById('adUser').value='';
          document.getElementById('adPass').value='';
          loadAdmins();
        })
        .catch(function(err){ errEl.textContent = err.error || 'สร้างบัญชีไม่สำเร็จ'; })
        .then(function(){ adAddBtn.disabled = false; });
    };
    panel.querySelectorAll('[data-admintoggle]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var a = state.admins.find(function(x){ return x.username===btn.dataset.admintoggle; });
        apiPut('/api/admins/' + encodeURIComponent(btn.dataset.admintoggle), { active: !a.active })
          .then(function(){ toast(a.active ? 'ปิดใช้งานบัญชีแล้ว' : 'เปิดใช้งานบัญชีอีกครั้งแล้ว'); loadAdmins(); })
          .catch(function(){ toast('อัปเดตบัญชีไม่สำเร็จ', true); });
      });
    });
  }

  // ---------- boot ----------
  render();
  loadPublicData();
  loadMyBookings();
  setInterval(function(){
    loadPublicData();
    if (state.activeTab==='mine') loadMyBookings();
    if (state.activeTab==='admin') refreshAdminData();
  }, 10000);
})();
