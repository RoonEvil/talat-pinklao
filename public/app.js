(function(){
  "use strict";

  var DAY = 24*60*60*1000;
  function todayStr(){ return new Date().toISOString().slice(0,10); }
  function fmtDate(s){
    var d = new Date(s+"T00:00:00");
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
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
    { id:'food', label:'Food & Beverage', icon:'🍜' },
    { id:'clothing', label:'Clothing & Accessories', icon:'👕' },
    { id:'general', label:'General Merchandise', icon:'🧺' },
    { id:'service', label:'Services', icon:'🔧' },
    { id:'other', label:'Other', icon:'📦' }
  ];
  function categoryMeta(id){ return CATEGORIES.find(function(c){ return c.id===id; }) || CATEGORIES[CATEGORIES.length-1]; }

  var PAYMENT_METHODS = [
    { id:'promptpay', label:'PromptPay transfer' },
    { id:'bank', label:'Bank transfer' },
    { id:'cash', label:'Cash at market office' }
  ];

  var ANNOUNCE_TYPES = [
    { id:'news', label:'News' },
    { id:'rule', label:'Rule' },
    { id:'holiday', label:'Holiday' },
    { id:'event', label:'Event' }
  ];
  function announceTypeLabel(id){ var t = ANNOUNCE_TYPES.find(function(x){ return x.id===id; }); return t ? t.label : id; }

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
        if (!res.ok) return Promise.reject({ status: res.status, error: data.error || 'Request failed' });
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
      toast('Your session expired — please sign in again', true);
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
        '<span class="pill on-accent">'+esc(profile.adminName||'Admin')+' · '+(profile.isHeadAdmin?'Head Admin':'Staff')+'</span>' +
        '<button class="btn ghost small" id="logoutBtn">Sign out</button>';
      document.getElementById('logoutBtn').onclick = function(){
        profile.isAdmin = false; profile.isHeadAdmin = false; profile.adminName=''; profile.adminUsername=''; saveProfile(); saveToken(null);
        if (state.activeTab==='admin') setTab('map');
        render();
      };
    } else if (profile.isRegistered){
      el.innerHTML =
        '<span class="pill on-primary">'+esc(profile.vendorName||'Account')+'</span>' +
        '<button class="btn ghost small" id="vendorLogoutBtn">Sign out</button>';
      document.getElementById('vendorLogoutBtn').onclick = function(){
        signOutCompletely();
        if (state.activeTab==='mine') setTab('map');
        toast('Signed out');
        render();
        loadMyBookings();
      };
    } else {
      el.innerHTML =
        (profile.vendorName ? '<span class="pill on-primary">Vendor: '+esc(profile.vendorName)+'</span>' : '<span class="pill">Browsing as guest</span>') +
        '<button class="btn ghost small" id="staffBtn">Log in</button>';
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
        '<text class="sp-zone-sub" x="'+(x+12).toFixed(1)+'" y="66">'+count+' stall'+(count===1?'':'s')+'</text>' +
        tents +
        '</g>';
    }).join('');

    return '<svg class="site-plan" viewBox="0 0 800 232" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Market site plan">' +
      '<text class="sp-context" x="400" y="14" text-anchor="middle">↑ toward OPD &amp; Administration Building</text>' +
      '<g class="sp-compass" transform="translate(34,16)">' +
        '<circle r="11" />' +
        '<line x1="0" y1="5" x2="0" y2="-8" />' +
        '<text y="4" text-anchor="middle">N</text>' +
      '</g>' +
      rects +
      '<rect class="sp-parking" x="606" y="150" width="170" height="26" rx="6" />' +
      '<text class="sp-parking-label" x="691" y="167" text-anchor="middle">Motorcycle parking</text>' +
      '<path class="sp-entrance-arrow" d="M400,150 L382,182 L418,182 Z" />' +
      '<text class="sp-entrance-label" x="400" y="200" text-anchor="middle">MAIN ENTRANCE</text>' +
      '<text class="sp-entrance-sub" x="400" y="213" text-anchor="middle">ทางเข้า-ออกหลัก</text>' +
      '</svg>';
  }

  // ---------- Market Map ----------
  function renderMap(){
    var host = document.getElementById('view-map');
    if (!state.loaded){
      host.innerHTML = '<div class="empty"><div class="big">⏳</div>Loading market layout…</div>';
      return;
    }
    var legend =
      '<div class="legend">' +
      '<span><span class="dot" style="background:var(--success)"></span>Available</span>' +
      '<span><span class="dot" style="background:var(--warning)"></span>Requested (pending approval)</span>' +
      '<span><span class="dot" style="background:var(--danger)"></span>Booked</span>' +
      '<span><span class="dot" style="background:var(--muted)"></span>Closed</span>' +
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
        var label = { available:'Available', pending:'Requested', occupied:'Booked', inactive:'Closed' }[status];
        var extra = '';
        if (status==='occupied' || status==='pending'){
          var next = activeBookingsForStall(s.id)[0];
          if (next) extra = ' till ' + fmtDate(next.endDate);
        }
        return '<button type="button" class="stall '+status+'" data-stall="'+s.id+'" '+(status==='inactive'?'disabled':'')+'>' +
          '<span class="code">'+categoryMeta(s.category).icon+' '+esc(s.code)+'</span>' +
          '<span class="price">'+fmtMoney(s.price_per_day)+'/day</span>' +
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
        '<div class="zone-stat">'+availableCount+' of '+stalls.length+' stalls available</div>' +
        '</div>' +
        '<div class="stall-grid">'+(rowsHtml||'<div class="empty small">No stalls yet</div>')+'</div>' +
        '</div>';
    }).join('');

    var siteplan = '<div class="card site-plan-card">'+renderSitePlan(state.zones)+'</div>';

    host.innerHTML =
      '<div class="section-head"><h2>Market zone map</h2><span class="muted small">Tap a stall to request a booking</span></div>' +
      siteplan +
      legend +
      '<div class="zones">'+(zonesHtml || '<div class="empty">No zones configured yet.</div>')+'</div>';

    host.querySelectorAll('.stall:not([disabled])').forEach(function(btn){
      btn.addEventListener('click', function(){ openBookingModal(btn.dataset.stall); });
    });
  }

  // ---------- Announcements (public) ----------
  function renderAnnouncements(){
    var host = document.getElementById('view-announce');
    if (!state.loaded){
      host.innerHTML = '<div class="empty"><div class="big">⏳</div>Loading announcements…</div>';
      return;
    }
    if (!state.announcements.length){
      host.innerHTML = '<div class="section-head"><h2>Announcements</h2></div>' +
        '<div class="empty"><div class="big">📣</div>No announcements yet.</div>';
      return;
    }
    var rows = state.announcements.map(function(a){
      return '<div class="announce-card">' +
        '<div class="announce-head">' +
          '<span class="badge '+ (a.type==='rule'?'rejected':a.type==='holiday'?'pending':a.type==='event'?'approved':'cancelled') +'">'+esc(announceTypeLabel(a.type))+'</span>' +
          (a.pinned ? '<span class="pill on-accent small">Pinned</span>' : '') +
          '<span class="muted small" style="margin-left:auto">'+fmtDate((a.created_at||'').slice(0,10)||todayStr())+'</span>' +
        '</div>' +
        '<h3>'+esc(a.title)+'</h3>' +
        '<p>'+esc(a.body)+'</p>' +
        '</div>';
    }).join('');
    host.innerHTML = '<div class="section-head"><h2>Announcements</h2><span class="muted small">News, rules &amp; upcoming dates</span></div>' +
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
      '<h3>Book stall '+esc(stall.code)+'</h3>' +
      '<div class="sub">'+esc(zone?zone.name:'')+' · guest '+fmtMoney(stall.price_per_day)+'/day · regular '+fmtMoney(regularRate)+'/day</div>' +
      '<form id="bookForm">' +
        '<div class="field"><label for="bfName">Vendor name</label><input id="bfName" required value="'+esc(profile.vendorName)+'"></div>' +
        '<div class="field"><label for="bfPhone">Phone number</label><input id="bfPhone" required value="'+esc(profile.vendorPhone)+'" placeholder="08X-XXX-XXXX"></div>' +
        '<div class="field"><label for="bfCat">What do you sell?</label><select id="bfCat">'+catOptions+'</select></div>' +
        '<div class="field-row">' +
          '<div class="field"><label for="bfStart">Start date</label><input type="date" id="bfStart" required min="'+minDate+'" value="'+minDate+'"></div>' +
          '<div class="field"><label for="bfEnd">End date</label><input type="date" id="bfEnd" required min="'+minDate+'" value="'+minDate+'"></div>' +
        '</div>' +
        '<div class="field"><label for="bfNote">Note to market staff (optional)</label><textarea id="bfNote" rows="2" placeholder="e.g. selling grilled skewers, need power outlet"></textarea></div>' +
        '<div class="deposit-box">' +
          '<div class="deposit-row"><span id="depositLabel">Reservation deposit (1 day)</span><strong id="depositAmount">'+fmtMoney(stall.price_per_day)+'</strong></div>' +
          (state.settings.promptPayQrUrl
            ? '<div class="qr-scan" id="qrScanBlock" '+(PAYMENT_METHODS[0].id!=='promptpay'?'hidden':'')+'><img class="receipt-thumb" style="width:120px;height:120px" src="'+esc(state.settings.promptPayQrUrl)+'" data-full="'+esc(state.settings.promptPayQrUrl)+'" data-title="PromptPay QR code" alt="PromptPay QR code, click to enlarge"><span class="muted small">Scan with your banking app, then tick below</span></div>'
            : '') +
          '<div class="field" style="margin-top:10px"><label for="bfPayMethod">Payment method</label><select id="bfPayMethod">'+payOptions+'</select></div>' +
          '<label class="checkline"><input type="checkbox" id="bfPaid"> I have already transferred the deposit</label>' +
          '<p class="deposit-note">If unpaid, mark it from My Bookings once you’ve sent the transfer — market staff will confirm receipt. '+(isRegistered?'':'Registered/regular customers automatically get the lower rate.')+'</p>' +
        '</div>' +
        '<div class="form-error" id="bfErr"></div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn ghost" id="bfCancel">Cancel</button>' +
          '<button type="submit" class="btn primary">Submit request</button>' +
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
      document.getElementById('depositLabel').textContent = 'Reservation deposit (' + days + ' day' + (days===1?'':'s') + ', server-priced)';
      document.getElementById('depositAmount').textContent = '~' + fmtMoney(stall.price_per_day * days) + ' (guest rate shown)';
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
      if (!name || !phone || !start || !end){ errEl.textContent = 'Please fill in all required fields.'; return; }
      if (end < start){ errEl.textContent = 'End date must be on or after the start date.'; return; }

      profile.vendorName = name; profile.vendorPhone = phone; saveProfile();
      submitBtn.disabled = true;

      apiPost('/api/bookings', {
        stallId: stall.id, vendorToken: profile.vendorToken, vendorName: name, vendorPhone: phone,
        category: category, startDate: start, endDate: end, note: note || null,
        paymentMethod: payMethod, alreadyPaid: paid
      }).then(function(){
        toast('Booking request sent for stall ' + stall.code);
        closeModal();
        setTab('mine');
        loadPublicData();
      }).catch(function(err){
        errEl.textContent = err.error || 'Could not submit — please try again.';
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
      '<h3>Are you sure?</h3>' +
      '<div class="sub">'+esc(message)+'</div>' +
      '<div class="form-actions">' +
        '<button type="button" class="btn ghost" id="cfCancel">Cancel</button>' +
        '<button type="button" class="btn danger" id="cfOk">Delete</button>' +
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
      '<h3>'+esc(title||'Image')+'</h3>' +
      '<button type="button" class="btn ghost small" id="imgClose">Close</button>' +
      '<img src="'+esc(url)+'" alt="'+esc(title||'Image')+', full size">' +
      '</div></div>';
    var back = document.getElementById('mb');
    back.addEventListener('click', function(e){ if (e.target===back) closeModal(); });
    document.getElementById('imgClose').onclick = closeModal;
  }
  function wireReceiptThumbs(host){
    host.querySelectorAll('.receipt-thumb').forEach(function(img){
      img.addEventListener('click', function(e){
        e.preventDefault();
        openImageModal(img.dataset.full, img.dataset.title || 'Payment receipt');
      });
    });
  }

  // ---------- Account sign-in / registration modal ----------
  function openAuthModal(mode){
    mode = mode === 'register' ? 'register' : 'login';
    var root = document.getElementById('modalRoot');

    var loginFields =
      '<div class="field"><label for="afUser">Username</label><input id="afUser" autocomplete="username" required></div>' +
      '<div class="field"><label for="afPass">Password</label><input id="afPass" type="password" autocomplete="current-password" required></div>';

    var registerFields =
      '<div class="field"><label for="afName">Full name</label><input id="afName" required value="'+esc(profile.vendorName)+'"></div>' +
      '<div class="field"><label for="afPhone">Phone number</label><input id="afPhone" required placeholder="08X-XXX-XXXX" value="'+esc(profile.vendorPhone)+'"></div>' +
      '<div class="field"><label for="afUser">Username</label><input id="afUser" autocomplete="username" required></div>' +
      '<div class="field"><label for="afPass">Password</label><input id="afPass" type="password" autocomplete="new-password" required></div>';

    root.innerHTML =
      '<div class="modal-back" id="mb"><div class="modal">' +
      '<div class="auth-toggle" id="authToggle">' +
        '<button type="button" class="auth-toggle-btn '+(mode==='login'?'active':'')+'" data-authmode="login">Log in</button>' +
        '<button type="button" class="auth-toggle-btn '+(mode==='register'?'active':'')+'" data-authmode="register">Create account</button>' +
      '</div>' +
      '<div class="sub" style="margin-bottom:16px">'+(mode==='register'
        ? 'Register once to track your bookings and skip re-entering your details next time.'
        : 'Vendors and market staff both sign in here — staff accounts open the admin panel automatically.') + '</div>' +
      '<form id="authForm">' + (mode==='register' ? registerFields : loginFields) +
        '<div class="form-error" id="afErr"></div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn ghost" id="afCancel">Cancel</button>' +
          '<button type="submit" class="btn primary">'+(mode==='register' ? 'Create account' : 'Log in')+'</button>' +
        '</div>' +
      '</form>' +
      (mode!=='register' ? '<p class="deposit-note" style="margin-top:14px">Market staff: use the login the head admin gave you.</p>' : '') +
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
        if (!name || !phone || !username || !password){ errEl.textContent = 'Please fill in every field.'; return; }
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
            toast('Account created — you are logged in as ' + res.user.name);
            setTab('mine');
          }).catch(function(err){
            errEl.textContent = err.error || 'Could not create account.';
            submitBtn.disabled = false;
          });
        return;
      }

      if (!username || !password){ errEl.textContent = 'Enter your username and password.'; return; }
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
          toast('Signed in as ' + res.user.name);
        } else {
          profile.vendorToken = res.user.id;
          profile.vendorName = res.user.name;
          profile.vendorPhone = res.user.phone;
          profile.isRegistered = true;
          saveProfile();
          closeModal();
          toast('Welcome back, ' + res.user.name);
          setTab('mine');
        }
      }).catch(function(err){
        errEl.textContent = err.error || 'Incorrect username or password.';
        submitBtn.disabled = false;
      });
    });
  }

  // ---------- My Bookings ----------
  function renderMine(){
    var host = document.getElementById('view-mine');
    if (!state.myBookingsLoaded){
      host.innerHTML = '<div class="empty"><div class="big">⏳</div>Loading your bookings…</div>';
      return;
    }
    var mine = state.myBookings || [];
    if (!mine.length){
      host.innerHTML = '<div class="section-head"><h2>My bookings</h2></div>' +
        '<div class="empty"><div class="big">🧺</div>No booking requests yet.<br>Go to the Market Map to request a stall.</div>';
      return;
    }
    var rows = mine.map(function(b){
      var canCancel = (b.status==='pending' || b.status==='approved') && b.end_date >= todayStr();
      var payStatus = b.payment_status || 'unpaid';
      var canMarkPaid = payStatus==='unpaid' && b.status!=='cancelled' && b.status!=='rejected';
      var canAttachReceipt = b.status!=='cancelled' && b.status!=='rejected';
      return '<div class="booking-row">' +
        '<div class="who"><div class="name">'+categoryMeta(b.category).icon+' '+esc(b.stall_code||'—')+' · '+esc(b.zone_name||'')+'</div>' +
        '<div class="stalltag">'+fmtMoney(b.deposit_amount)+' deposit · '+esc(b.rate_type)+' rate</div></div>' +
        '<div class="dates">'+fmtDate(b.start_date)+' → '+fmtDate(b.end_date)+(b.note?'<br><span class="small">"'+esc(b.note)+'"</span>':'')+'</div>' +
        (b.receipt_path ? '<a href="'+esc(b.receipt_path)+'" target="_blank" rel="noopener"><img class="receipt-thumb" src="'+esc(b.receipt_path)+'" data-full="'+esc(b.receipt_path)+'" alt="Payment receipt, click to enlarge"></a>' : '') +
        '<span class="badge '+esc(b.status)+'">'+esc(b.status)+'</span>' +
        '<span class="paybadge '+esc(payStatus)+'">'+esc(payStatus)+'</span>' +
        '<div class="row-actions">' +
        (canMarkPaid ? '<button class="btn small ghost" data-markpaid="'+b.id+'">Mark deposit paid</button>' : '') +
        (canAttachReceipt ? '<button class="btn small ghost" data-addreceipt="'+b.id+'">'+(b.receipt_path?'Replace receipt':'Add receipt')+'</button>' : '') +
        (canCancel ? '<button class="btn small danger" data-cancel="'+b.id+'">Cancel</button>' : '') +
        '</div>' +
        '</div>';
    }).join('');
    host.innerHTML = '<div class="section-head"><h2>My bookings</h2><span class="muted small">'+mine.length+' request(s)</span></div>' +
      '<div class="booking-list">'+rows+'</div>';

    host.querySelectorAll('[data-cancel]').forEach(function(btn){
      btn.addEventListener('click', function(){
        apiDelete('/api/bookings/' + btn.dataset.cancel)
          .then(function(){ toast('Booking cancelled'); loadMyBookings(); loadPublicData(); })
          .catch(function(){ toast('Could not cancel', true); });
      });
    });
    host.querySelectorAll('[data-markpaid]').forEach(function(btn){
      btn.addEventListener('click', function(){
        apiPut('/api/bookings/' + btn.dataset.markpaid + '/payment', { paymentStatus:'paid' })
          .then(function(){ toast('Marked as paid — awaiting staff confirmation'); loadMyBookings(); })
          .catch(function(){ toast('Could not update', true); });
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
        toast('Uploading receipt…');
        apiUpload('/api/bookings/' + bookingId + '/receipt', fd)
          .then(function(){ toast('Receipt attached'); loadMyBookings(); })
          .catch(function(err){ toast(err.error || 'Could not attach receipt', true); });
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
        toast('Uploading QR code…');
        apiUpload('/api/settings/qr', fd)
          .then(function(res){ state.settings.promptPayQrUrl = res.promptPayQrUrl; toast('PromptPay QR updated'); render(); })
          .catch(function(err){ toast(err.error || 'Could not upload QR image', true); });
      });
    }
    return el;
  }
  function requestQrUpload(){
    if (!profile.isHeadAdmin){ toast('Only the head admin can update this', true); return; }
    wantsQrUpload = true;
    ensureQrInput().click();
  }

  // ---------- Admin ----------
  function renderAdmin(){
    var host = document.getElementById('view-admin');
    if (!profile.isAdmin){
      host.innerHTML = '<div class="empty"><div class="big">🔒</div>Sign in with a staff account to continue.<br><button class="btn primary" id="goLogin" style="margin-top:10px">Log in</button></div>';
      document.getElementById('goLogin').onclick = function(){ openAuthModal('login'); };
      return;
    }
    var sections = [
      ['approvals','Approvals'], ['bookings','All bookings'], ['vendors','Vendors'],
      ['announcements','Announcements'], ['audit','Audit'], ['zones','Zones'],
      ['stalls','Stalls'], ['settings','Settings']
    ];
    if (profile.isHeadAdmin) sections.push(['admins','Admins']);

        var nav = sections.map(function(s){
      return '<button class="'+(state.adminSection===s[0]?'active':'')+'" data-sec="'+s[0]+'">'+s[1]+'</button>';
    }).join('');
    var navOptions = sections.map(function(s){
      return '<option value="'+s[0]+'" '+(state.adminSection===s[0]?'selected':'')+'>'+s[1]+'</option>';
    }).join('');

    host.innerHTML =
      '<div class="section-head"><h2>Market staff admin</h2></div>' +
      '<div class="admin-grid">' +
        '<select class="admin-nav-select" id="adminNavSelect" aria-label="Admin section">'+navOptions+'</select>' +
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
      panel.innerHTML = '<div class="empty"><div class="big">✅</div>No pending requests. All caught up.</div>';
      return;
    }
    var rows = pending.map(function(b){
      var payStatus = b.payment_status || 'unpaid';
      return '<div class="booking-row">' +
        '<div class="who"><div class="name">'+categoryMeta(b.category).icon+' '+esc(b.vendor_name)+'</div><div class="stalltag">'+esc(b.vendor_phone)+'</div></div>' +
        '<div class="dates"><span class="stalltag">'+esc(b.stall_code||'—')+' · '+esc(b.zone_name||'')+'</span><br>'+fmtDate(b.start_date)+' → '+fmtDate(b.end_date)+(b.note?'<br><span class="small">"'+esc(b.note)+'"</span>':'')+'</div>' +
        (b.receipt_path ? '<a href="'+esc(b.receipt_path)+'" target="_blank" rel="noopener" title="Click to enlarge"><img class="receipt-thumb" src="'+esc(b.receipt_path)+'" data-full="'+esc(b.receipt_path)+'" alt="Payment receipt, click to enlarge"></a>' : '<span class="muted small">No receipt</span>') +
        '<span class="paybadge '+esc(payStatus)+'">'+esc(payStatus)+' · '+fmtMoney(b.deposit_amount)+' ('+esc(b.rate_type)+')</span>' +
        '<div class="row-actions">' +
        (payStatus==='paid' ? '<button class="btn small ghost" data-confirmpay="'+b.id+'">Confirm receipt</button>' : '') +
        '<button class="btn small primary" data-approve="'+b.id+'">Approve</button>' +
        '<button class="btn small danger" data-reject="'+b.id+'">Reject</button>' +
        '</div></div>';
    }).join('');
    panel.innerHTML = '<div class="card" style="padding:16px"><div class="booking-list">'+rows+'</div></div>';

    panel.querySelectorAll('[data-approve]').forEach(function(btn){
      btn.addEventListener('click', function(){
        apiPut('/api/bookings/' + btn.dataset.approve + '/status', { status:'approved' })
          .then(function(){ toast('Booking approved'); loadAdminBookings(); loadPublicData(); })
          .catch(function(err){ toast(err.error || 'Could not update booking', true); });
      });
    });
    panel.querySelectorAll('[data-reject]').forEach(function(btn){
      btn.addEventListener('click', function(){
        apiPut('/api/bookings/' + btn.dataset.reject + '/status', { status:'rejected' })
          .then(function(){ toast('Booking rejected'); loadAdminBookings(); loadPublicData(); })
          .catch(function(err){ toast(err.error || 'Could not update booking', true); });
      });
    });
    panel.querySelectorAll('[data-confirmpay]').forEach(function(btn){
      btn.addEventListener('click', function(){
        apiPut('/api/bookings/' + btn.dataset.confirmpay + '/payment', { paymentStatus:'confirmed' })
          .then(function(){ toast('Payment confirmed'); loadAdminBookings(); })
          .catch(function(err){ toast(err.error || 'Could not update', true); });
      });
    });
    wireReceiptThumbs(panel);
  }

  function renderAllBookings(panel){
    var filter = state.bookingsFilter || 'all';
    var list = (state.bookings||[]).filter(function(b){ return filter==='all' || b.status===filter; });
    var statuses = ['all','pending','approved','rejected','cancelled'];
    var bar = statuses.map(function(s){
      return '<button class="btn small '+(filter===s?'primary':'ghost')+'" data-filt="'+s+'">'+s+'</button>';
    }).join('');

    var rowsHtml = list.length ? list.map(function(b){
      var payStatus = b.payment_status || 'unpaid';
      return '<tr><td>'+esc(b.vendor_name)+'<br><span class="muted small">'+esc(b.vendor_phone)+'</span></td>' +
        '<td class="mono">'+categoryMeta(b.category).icon+' '+esc(b.stall_code||'—')+'</td>' +
        '<td>'+esc(b.zone_name||'')+'</td>' +
        '<td>'+fmtDate(b.start_date)+' → '+fmtDate(b.end_date)+'</td>' +
        '<td><span class="badge '+esc(b.status)+'">'+esc(b.status)+'</span></td>' +
        '<td><span class="paybadge '+esc(payStatus)+'">'+esc(payStatus)+'</span></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">No bookings in this filter.</td></tr>';

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="filter-bar">'+bar+'</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Vendor</th><th>Stall</th><th>Zone</th><th>Dates</th><th>Status</th><th>Payment</th></tr></thead>' +
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
        '<td><button type="button" class="btn small danger" data-delzone="'+z.id+'">Delete</button></td></tr>';
    }).join('');

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="table-wrap"><table><thead><tr><th>Zone</th><th>Description</th><th>Stalls</th><th></th></tr></thead>' +
      '<tbody>'+(rows||'<tr><td colspan="4" class="empty">No zones yet.</td></tr>')+'</tbody></table></div>' +
      '<div class="add-row" style="margin-top:14px">' +
        '<div class="field"><label for="zName">Zone name</label><input id="zName" placeholder="Seasonal Promotion Zone"></div>' +
        '<div class="field"><label for="zDesc">Description</label><input id="zDesc" placeholder="Short location note"></div>' +
        '<button type="button" class="btn primary" id="zAdd">Add zone</button>' +
      '</div></div>';

    var zAddBtn = document.getElementById('zAdd');
    zAddBtn.onclick = function(){
      var name = document.getElementById('zName').value.trim();
      var desc = document.getElementById('zDesc').value.trim();
      if (!name){ toast('Zone name is required', true); return; }
      zAddBtn.disabled = true;
      apiPost('/api/zones', { name:name, description:desc||null, colorIndex: state.zones.length % 4 })
        .then(function(){ toast('Zone added'); document.getElementById('zName').value=''; document.getElementById('zDesc').value=''; loadPublicData(); })
        .catch(function(err){ toast(err.error || 'Could not add zone', true); })
        .then(function(){ zAddBtn.disabled = false; });
    };
    panel.querySelectorAll('[data-delzone]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var z = zoneById(btn.dataset.delzone);
        confirmAction('Delete zone "' + (z?z.name:'this zone') + '"? This cannot be undone.', function(){
          apiDelete('/api/zones/' + btn.dataset.delzone)
            .then(function(){ toast('Zone deleted'); loadPublicData(); })
            .catch(function(err){ toast(err.error || 'Could not delete zone', true); });
        });
      });
    });
  }

  function renderStallAdmin(panel){
    if (!state.zones.length){
      panel.innerHTML = '<div class="empty">Add a zone first before adding stalls.</div>';
      return;
    }
    var rows = state.stalls.map(function(s){
      var z = zoneById(s.zone_id);
      return '<tr><td class="mono">'+categoryMeta(s.category).icon+' '+esc(s.code)+'</td><td>'+esc(z?z.name:'—')+'</td>' +
        '<td>'+fmtMoney(s.price_per_day)+'</td>' +
        '<td>'+fmtMoney(s.regular_price_per_day)+'</td>' +
        '<td><span class="badge '+(s.active?'approved':'cancelled')+'">'+(s.active?'Active':'Closed')+'</span></td>' +
        '<td><button type="button" class="btn small ghost" data-editprice="'+s.id+'">Edit prices</button> ' +
        '<button type="button" class="btn small ghost" data-toggle="'+s.id+'">'+(s.active?'Close':'Reopen')+'</button> ' +
        '<button type="button" class="btn small danger" data-delstall="'+s.id+'">Delete</button></td></tr>';
    }).join('');

    var zoneOptions = state.zones.map(function(z){ return '<option value="'+z.id+'">'+esc(z.name)+'</option>'; }).join('');
    var catOptions = CATEGORIES.map(function(c){ return '<option value="'+c.id+'">'+c.icon+' '+esc(c.label)+'</option>'; }).join('');

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="table-wrap"><table><thead><tr><th>Code</th><th>Zone</th><th>Guest price/day</th><th>Regular price/day</th><th>Status</th><th></th></tr></thead>' +
      '<tbody>'+(rows||'<tr><td colspan="6" class="empty">No stalls yet.</td></tr>')+'</tbody></table></div>' +
      '<div class="add-row" style="margin-top:14px">' +
        '<div class="field"><label for="sZone">Zone</label><select id="sZone">'+zoneOptions+'</select></div>' +
        '<div class="field"><label for="sCode">Stall code</label><input id="sCode" placeholder="F9" style="max-width:100px"></div>' +
        '<div class="field"><label for="sCat">Category</label><select id="sCat">'+catOptions+'</select></div>' +
        '<div class="field"><label for="sPrice">Guest price/day (฿)</label><input id="sPrice" type="number" min="0" step="10" value="650" style="max-width:120px"></div>' +
        '<div class="field"><label for="sRegPrice">Regular price/day (฿)</label><input id="sRegPrice" type="number" min="0" step="10" value="450" style="max-width:120px"></div>' +
        '<button type="button" class="btn primary" id="sAdd">Add stall</button>' +
      '</div></div>';

    var sAddBtn = document.getElementById('sAdd');
    sAddBtn.onclick = function(){
      var zoneId = document.getElementById('sZone').value;
      var code = document.getElementById('sCode').value.trim();
      var category = document.getElementById('sCat').value;
      var price = parseFloat(document.getElementById('sPrice').value);
      var regPrice = parseFloat(document.getElementById('sRegPrice').value);
      if (!code || !(price>=0) || !(regPrice>=0)){ toast('Stall code and both prices are required', true); return; }
      sAddBtn.disabled = true;
      apiPost('/api/stalls', { zoneId:zoneId, code:code, category:category, pricePerDay:price, regularPricePerDay:regPrice })
        .then(function(){ toast('Stall added'); document.getElementById('sCode').value=''; loadPublicData(); })
        .catch(function(err){ toast(err.error || 'Could not add stall', true); })
        .then(function(){ sAddBtn.disabled = false; });
    };
    panel.querySelectorAll('[data-toggle]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var s = state.stalls.find(function(x){ return String(x.id)===btn.dataset.toggle; });
        apiPut('/api/stalls/' + btn.dataset.toggle, { active: !s.active })
          .then(function(){ toast(s.active?'Stall closed':'Stall reopened'); loadPublicData(); });
      });
    });
    panel.querySelectorAll('[data-delstall]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var s = state.stalls.find(function(x){ return String(x.id)===btn.dataset.delstall; });
        confirmAction('Delete stall "' + (s?s.code:'this stall') + '"? This cannot be undone.', function(){
          apiDelete('/api/stalls/' + btn.dataset.delstall)
            .then(function(){ toast('Stall deleted'); loadPublicData(); })
            .catch(function(err){ toast(err.error || 'Could not delete stall', true); });
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
      '<h3>Edit prices — stall '+esc(s.code)+'</h3>' +
      '<form id="priceForm">' +
        '<div class="field"><label for="epGuest">Guest price/day (฿)</label><input id="epGuest" type="number" min="0" step="10" value="'+(Number(s.price_per_day)||0)+'" required></div>' +
        '<div class="field"><label for="epRegular">Regular price/day (฿)</label><input id="epRegular" type="number" min="0" step="10" value="'+(Number(s.regular_price_per_day)||0)+'" required></div>' +
        '<div class="form-error" id="epErr"></div>' +
        '<div class="form-actions">' +
          '<button type="button" class="btn ghost" id="epCancel">Cancel</button>' +
          '<button type="submit" class="btn primary">Save</button>' +
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
      if (!(guest>=0) || !(regular>=0)){ errEl.textContent = 'Enter valid prices.'; return; }
      apiPut('/api/stalls/' + stallId, { pricePerDay: guest, regularPricePerDay: regular })
        .then(function(){ toast('Prices updated'); closeModal(); loadPublicData(); })
        .catch(function(){ errEl.textContent = 'Could not update prices.'; });
    });
  }

  function renderVendorAdmin(panel){
    if (!state.vendors.length){
      panel.innerHTML = '<div class="empty"><div class="big">🧑‍🌾</div>No vendors yet — they appear here after their first booking.</div>';
      return;
    }
    var rows = state.vendors.map(function(v){
      var blocked = !v.active;
      var regular = !!v.is_regular;
      return '<tr><td>'+esc(v.name)+(regular?' <span class="pill on-primary small">Regular</span>':'')+'</td><td>'+esc(v.phone)+'</td>' +
        '<td>'+categoryMeta(v.category).icon+' '+esc(categoryMeta(v.category).label)+'</td>' +
        '<td>'+v.booking_total+' total · '+v.booking_approved+' approved</td>' +
        '<td>'+fmtDate((v.joined_at||todayStr()).slice(0,10))+'</td>' +
        '<td><span class="badge '+(blocked?'cancelled':'approved')+'">'+(blocked?'Blocked':'Active')+'</span></td>' +
        '<td><button type="button" class="btn small ghost" data-regulartoggle="'+esc(v.id)+'">'+(regular?'Unmark regular':'Mark regular')+'</button> ' +
        '<button type="button" class="btn small '+(blocked?'primary':'danger')+'" data-vendortoggle="'+esc(v.id)+'">'+(blocked?'Unblock':'Block')+'</button></td></tr>';
    }).join('');

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<p class="muted small" style="margin:0 0 12px">Regular customers (ขาประจำ) get the discounted per-day rate on future bookings.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Vendor</th><th>Phone</th><th>Sells</th><th>Bookings</th><th>Joined</th><th>Status</th><th></th></tr></thead>' +
      '<tbody>'+rows+'</tbody></table></div></div>';

    panel.querySelectorAll('[data-vendortoggle]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var v = state.vendors.find(function(x){ return x.id===btn.dataset.vendortoggle; });
        apiPut('/api/vendors/' + encodeURIComponent(btn.dataset.vendortoggle), { active: !v.active, isRegular: !!v.is_regular })
          .then(function(){ toast(v.active ? 'Vendor blocked' : 'Vendor unblocked'); loadVendors(); })
          .catch(function(){ toast('Could not update vendor', true); });
      });
    });
    panel.querySelectorAll('[data-regulartoggle]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var v = state.vendors.find(function(x){ return x.id===btn.dataset.regulartoggle; });
        apiPut('/api/vendors/' + encodeURIComponent(btn.dataset.regulartoggle), { active: !!v.active, isRegular: !v.is_regular })
          .then(function(){ toast(!v.is_regular ? 'Marked as regular customer' : 'Unmarked as regular'); loadVendors(); })
          .catch(function(){ toast('Could not update vendor', true); });
      });
    });
  }

  function renderAnnouncementAdmin(panel){
    var typeOptions = ANNOUNCE_TYPES.map(function(t){ return '<option value="'+t.id+'">'+esc(t.label)+'</option>'; }).join('');
    var rows = state.announcements.map(function(a){
      var cls = a.type==='rule' ? 'rejected' : a.type==='holiday' ? 'pending' : a.type==='event' ? 'approved' : 'cancelled';
      return '<tr><td><span class="badge '+cls+'">'+esc(announceTypeLabel(a.type))+'</span></td>' +
        '<td>'+esc(a.title)+(a.pinned?' <span class="pill on-accent small">Pinned</span>':'')+'<br><span class="muted small">'+esc(a.body)+'</span></td>' +
        '<td>'+fmtDate((a.created_at||todayStr()).slice(0,10))+'</td>' +
        '<td><button type="button" class="btn small ghost" data-pin="'+a.id+'">'+(a.pinned?'Unpin':'Pin')+'</button> ' +
        '<button type="button" class="btn small danger" data-delannounce="'+a.id+'">Delete</button></td></tr>';
    }).join('');

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="table-wrap"><table><thead><tr><th>Type</th><th>Announcement</th><th>Date</th><th></th></tr></thead>' +
      '<tbody>'+(rows||'<tr><td colspan="4" class="empty">No announcements yet.</td></tr>')+'</tbody></table></div>' +
      '<div class="add-row" style="margin-top:14px; flex-direction:column; align-items:stretch">' +
        '<div class="field-row">' +
          '<div class="field"><label for="anTitle">Title</label><input id="anTitle" placeholder="Market closed for Songkran"></div>' +
          '<div class="field"><label for="anType">Type</label><select id="anType">'+typeOptions+'</select></div>' +
        '</div>' +
        '<div class="field"><label for="anBody">Message</label><textarea id="anBody" rows="2" placeholder="Details for vendors"></textarea></div>' +
        '<div><button type="button" class="btn primary" id="anAdd">Post announcement</button></div>' +
      '</div></div>';

    var anAddBtn = document.getElementById('anAdd');
    anAddBtn.onclick = function(){
      var title = document.getElementById('anTitle').value.trim();
      var type = document.getElementById('anType').value;
      var body = document.getElementById('anBody').value.trim();
      if (!title || !body){ toast('Title and message are required', true); return; }
      anAddBtn.disabled = true;
      apiPost('/api/announcements', { title:title, type:type, body:body })
        .then(function(){
          toast('Announcement posted');
          document.getElementById('anTitle').value='';
          document.getElementById('anBody').value='';
          loadPublicData();
        })
        .catch(function(err){ toast(err.error || 'Could not post announcement', true); })
        .then(function(){ anAddBtn.disabled = false; });
    };
    panel.querySelectorAll('[data-pin]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var a = state.announcements.find(function(x){ return String(x.id)===btn.dataset.pin; });
        apiPut('/api/announcements/' + btn.dataset.pin, { pinned: !a.pinned })
          .then(function(){ toast(a.pinned ? 'Unpinned' : 'Pinned'); loadPublicData(); });
      });
    });
    panel.querySelectorAll('[data-delannounce]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var a = state.announcements.find(function(x){ return String(x.id)===btn.dataset.delannounce; });
        confirmAction('Delete announcement "' + (a?a.title:'this announcement') + '"? This cannot be undone.', function(){
          apiDelete('/api/announcements/' + btn.dataset.delannounce)
            .then(function(){ toast('Announcement deleted'); loadPublicData(); })
            .catch(function(err){ toast(err.error || 'Could not delete announcement', true); });
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
        '<td><select class="au-present"><option value="1" '+(present?'selected':'')+'>Present</option><option value="0" '+(!present?'selected':'')+'>No-show</option></select></td>' +
        '<td><select class="au-catmatch"><option value="1" '+(catMatch?'selected':'')+'>Matches</option><option value="0" '+(!catMatch?'selected':'')+'>Mismatch</option></select></td>' +
        '<td><input type="number" class="au-fine" min="0" step="10" value="'+fine+'" style="width:84px"></td>' +
        '<td><input type="text" class="au-reason" value="'+esc(reason)+'" placeholder="Reason" style="width:130px"></td>' +
        '<td><button type="button" class="btn small primary au-save">Save</button></td></tr>';
    }).join('');

    var fines = state.auditLogs || [];
    var finesRows = fines.map(function(l){
      return '<tr><td>'+fmtDate(l.date)+'</td><td>'+esc(l.vendor_name)+'</td><td class="mono">'+esc(l.stall_code||'—')+'</td>' +
        '<td>'+fmtMoney(l.fine_amount)+'</td><td>'+esc(l.fine_reason||'')+'</td></tr>';
    }).join('');

    panel.innerHTML =
      '<div class="card" style="padding:16px">' +
        '<div class="field" style="max-width:200px"><label for="auDate">Audit date</label><input type="date" id="auDate" value="'+date+'"></div>' +
        (covering.length ?
          '<div class="table-wrap"><table><thead><tr><th>Stall</th><th>Vendor</th><th>Registered as</th><th>Present</th><th>Category</th><th>Fine (฿)</th><th>Reason</th><th></th></tr></thead>' +
          '<tbody>'+rows+'</tbody></table></div>'
          : '<div class="empty small">No approved bookings cover this date.</div>') +
      '</div>' +
      '<div class="card" style="padding:16px; margin-top:16px">' +
        '<div class="section-head" style="margin-bottom:8px"><h2 style="font-size:1rem">Recent fines</h2></div>' +
        (fines.length ? '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Vendor</th><th>Stall</th><th>Fine</th><th>Reason</th></tr></thead><tbody>'+finesRows+'</tbody></table></div>' : '<div class="empty small">No fines recorded.</div>') +
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
          .then(function(){ toast('Audit recorded'); loadAudit(date); loadFines(); })
          .catch(function(err){ toast(err.error || 'Could not save audit', true); });
      });
    });
  }

  function renderSettingsAdmin(panel){
    var qrUrl = state.settings.promptPayQrUrl;
    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="section-head" style="margin-bottom:8px"><h2 style="font-size:1rem">PromptPay QR code</h2></div>' +
      '<p class="muted small" style="margin:0 0 12px">Shown to vendors when they pay their stall deposit. Only the head admin can change it.</p>' +
      (qrUrl
        ? '<img class="qr-preview receipt-thumb" style="width:150px;height:150px" src="'+esc(qrUrl)+'" data-full="'+esc(qrUrl)+'" data-title="PromptPay QR code" alt="Current PromptPay QR code, click to enlarge">'
        : '<div class="empty small" style="padding:16px 0">No QR code uploaded yet.</div>') +
      '<div style="margin-top:14px">' +
      (profile.isHeadAdmin
        ? '<button type="button" class="btn primary" id="qrUploadBtn">'+(qrUrl?'Replace QR code':'Upload QR code')+'</button>'
        : '<span class="muted small">🔒 Only the head admin account can upload or replace this image.</span>') +
      '</div>' +
      '</div>';

    wireReceiptThumbs(panel);
    if (profile.isHeadAdmin){
      document.getElementById('qrUploadBtn').onclick = requestQrUpload;
    }
  }

  function renderAdminAccounts(panel){
    if (!profile.isHeadAdmin){
      panel.innerHTML = '<div class="empty"><div class="big">🔒</div>Only the head admin can manage staff accounts.</div>';
      return;
    }
    var rows = state.admins.map(function(a){
      var isMe = a.username === profile.adminUsername;
      var deactivated = !a.active;
      return '<tr><td>'+esc(a.name)+(isMe?' <span class="pill on-primary small">You</span>':'')+'</td>' +
        '<td class="mono">'+esc(a.username)+'</td>' +
        '<td><span class="badge '+(a.role==='head'?'approved':'pending')+'">'+(a.role==='head'?'Head admin':'Staff')+'</span></td>' +
        '<td><span class="badge '+(deactivated?'cancelled':'approved')+'">'+(deactivated?'Deactivated':'Active')+'</span></td>' +
        '<td>'+(isMe ? '<span class="muted small">—</span>' : '<button type="button" class="btn small '+(deactivated?'primary':'danger')+'" data-admintoggle="'+esc(a.username)+'">'+(deactivated?'Reactivate':'Deactivate')+'</button>') +
        '</td></tr>';
    }).join('');

    panel.innerHTML = '<div class="card" style="padding:16px">' +
      '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>' +
      '<tbody>'+(rows||'<tr><td colspan="5" class="empty">No admin accounts yet.</td></tr>')+'</tbody></table></div>' +
      '<div class="add-row" style="margin-top:14px; flex-direction:column; align-items:stretch">' +
        '<div class="field-row">' +
          '<div class="field"><label for="adName">Full name</label><input id="adName" placeholder="Jane Doe"></div>' +
          '<div class="field"><label for="adUser">Username</label><input id="adUser" placeholder="jane"></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label for="adPass">Password</label><input id="adPass" type="password" placeholder="Choose a password"></div>' +
          '<div class="field"><label for="adRole">Role</label><select id="adRole"><option value="staff">Staff</option><option value="head">Head admin</option></select></div>' +
        '</div>' +
        '<div class="form-error" id="adErr"></div>' +
        '<div><button type="button" class="btn primary" id="adAdd">Create account</button></div>' +
      '</div></div>';

    var adAddBtn = document.getElementById('adAdd');
    adAddBtn.onclick = function(){
      var name = document.getElementById('adName').value.trim();
      var username = document.getElementById('adUser').value.trim();
      var password = document.getElementById('adPass').value;
      var role = document.getElementById('adRole').value;
      var errEl = document.getElementById('adErr');
      if (!name || !username || !password){ errEl.textContent = 'Name, username and password are all required.'; return; }
      adAddBtn.disabled = true;
      apiPost('/api/admins', { name:name, username:username, password:password, role:role })
        .then(function(){
          toast('Account created for ' + name);
          errEl.textContent = '';
          document.getElementById('adName').value='';
          document.getElementById('adUser').value='';
          document.getElementById('adPass').value='';
          loadAdmins();
        })
        .catch(function(err){ errEl.textContent = err.error || 'Could not create account.'; })
        .then(function(){ adAddBtn.disabled = false; });
    };
    panel.querySelectorAll('[data-admintoggle]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var a = state.admins.find(function(x){ return x.username===btn.dataset.admintoggle; });
        apiPut('/api/admins/' + encodeURIComponent(btn.dataset.admintoggle), { active: !a.active })
          .then(function(){ toast(a.active ? 'Account deactivated' : 'Account reactivated'); loadAdmins(); })
          .catch(function(){ toast('Could not update account', true); });
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
