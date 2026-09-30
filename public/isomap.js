(function(){
  "use strict";

  var TW = 56, TH = 28, SLAB = 10;
  var HEIGHTS = { stall: 12, stage: 8, object: 16 };
  var FLAT = { entrance: 1, toilet: 1, tree: 1, parking: 1, text: 1 };
  var ICONS = { entrance: '🚪', toilet: '🚻', tree: '🌳', parking: '🅿️', stage: '🎤', object: '📦' };
  var FLAT_COLORS = { entrance: 'var(--accent)', toilet: 'var(--zone-2)', tree: 'var(--success)', parking: 'var(--muted)', text: 'var(--muted)' };

  function P(x, y){ return { x: (x - y) * TW / 2, y: (x + y) * TH / 2 }; }
  function up(p, h){ return { x: p.x, y: p.y - h }; }
  function pts(arr){ return arr.map(function(p){ return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' '); }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isFlat(it){ return !!FLAT[it.kind]; }
  function layer(it){ return it.kind === 'text' ? 2 : isFlat(it) ? 0 : 1; }
  function corners(it){ return [P(it.x, it.y), P(it.x + it.w, it.y), P(it.x + it.w, it.y + it.h), P(it.x, it.y + it.h)]; }
  function shrink(arr, c, f){ return arr.map(function(p){ return { x: c.x + (p.x - c.x) * f, y: c.y + (p.y - c.y) * f }; }); }

  function create(container, opts){
    var layout = opts.layout;
    var view = opts.view;
    container.innerHTML = '<svg class="iso-svg' + (opts.editable ? ' is-edit' : '') + '" role="group" aria-label="' + esc(opts.ariaLabel || 'แผนผังตลาด') + '"><g class="iso-view"></g></svg>';
    var svg = container.firstChild;
    var g = svg.firstChild;

    function selected(){ return opts.selected ? opts.selected() : -1; }

    function drawItem(it, i){
      var st = opts.itemStyle ? (opts.itemStyle(it) || {}) : {};
      var cls = 'iso-item iso-' + it.kind + (st.cls ? ' ' + st.cls : '') +
        (i === selected() ? ' is-selected' : '') + (st.highlight ? ' is-highlight' : '');
      var attrs = ' data-idx="' + i + '"' + (st.clickable ? ' tabindex="0" role="button"' : '') +
        (st.title ? ' aria-label="' + esc(st.title) + '"' : '');
      var c4 = corners(it);
      var center = P(it.x + it.w / 2, it.y + it.h / 2);
      var s = '<g class="' + cls + '"' + attrs + '>' + (st.title ? '<title>' + esc(st.title) + '</title>' : '');
      var color = st.color || FLAT_COLORS[it.kind] || 'var(--zone-2)';
      if (isFlat(it)){
        var inset = shrink(c4, center, 0.86);
        if (it.kind === 'text'){
          s += '<polygon class="iso-flat iso-text-bg" points="' + pts(inset) + '" style="--c:' + color + '"/>';
          s += '<text class="iso-text" x="' + center.x.toFixed(1) + '" y="' + center.y.toFixed(1) + '">' + esc(it.label || 'ป้าย') + '</text>';
        } else {
          var fs = 13 + 5 * Math.min(it.w, it.h);
          s += '<polygon class="iso-flat" points="' + pts(inset) + '" style="--c:' + color + '"/>';
          s += '<text class="iso-icon" x="' + center.x.toFixed(1) + '" y="' + center.y.toFixed(1) + '" style="font-size:' + fs + 'px">' + ICONS[it.kind] + '</text>';
        }
      } else {
        var H = HEIGHTS[it.kind] || 10;
        var a = c4[0], b = c4[1], c = c4[2], d = c4[3];
        s += '<g style="--c:' + color + '">' +
          '<polygon class="iso-face iso-right" points="' + pts([b, c, up(c, H), up(b, H)]) + '"/>' +
          '<polygon class="iso-face iso-left" points="' + pts([d, c, up(c, H), up(d, H)]) + '"/>' +
          '<polygon class="iso-face iso-top" points="' + pts([up(a, H), up(b, H), up(c, H), up(d, H)]) + '"/>' +
          '</g>';
        var label = st.label != null ? st.label : (it.label || ICONS[it.kind] || '');
        if (label) s += '<text class="iso-label" x="' + center.x.toFixed(1) + '" y="' + (center.y - H).toFixed(1) + '">' + esc(label) + '</text>';
      }
      return s + '</g>';
    }

    function draw(){
      var cols = layout.cols, rows = layout.rows;
      var c00 = P(0, 0), c10 = P(cols, 0), c11 = P(cols, rows), c01 = P(0, rows);
      var out = [
        '<polygon class="iso-slab" points="' + pts([c10, c11, up(c11, -SLAB), up(c10, -SLAB)]) + '"/>',
        '<polygon class="iso-slab iso-slab-front" points="' + pts([c01, c11, up(c11, -SLAB), up(c01, -SLAB)]) + '"/>',
        '<polygon class="iso-floor" points="' + pts([c00, c10, c11, c01]) + '"/>'
      ];
      if (opts.editable){
        var i, a, b;
        for (i = 1; i < cols; i++){ a = P(i, 0); b = P(i, rows); out.push('<line class="iso-grid" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>'); }
        for (i = 1; i < rows; i++){ a = P(0, i); b = P(cols, i); out.push('<line class="iso-grid" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>'); }
      }
      var order = layout.items.map(function(_, idx){ return idx; });
      order.sort(function(ia, ib){
        var A = layout.items[ia], B = layout.items[ib];
        var la = layer(A), lb = layer(B);
        if (la !== lb) return la - lb;
        return (A.x + A.y + A.w + A.h) - (B.x + B.y + B.w + B.h) || A.x - B.x;
      });
      order.forEach(function(idx){ out.push(drawItem(layout.items[idx], idx)); });
      g.innerHTML = out.join('');
    }

    function apply(){ g.setAttribute('transform', 'translate(' + view.tx.toFixed(1) + ',' + view.ty.toFixed(1) + ') scale(' + view.s.toFixed(4) + ')'); }
    function size(){ var r = svg.getBoundingClientRect(); return { w: r.width || 600, h: r.height || 400 }; }

    function fitBox(minX, maxX, minY, maxY, pad, maxScale){
      var sz = size();
      var s = Math.min(sz.w / (maxX - minX + pad), sz.h / (maxY - minY + pad));
      view.s = clamp(s, 0.2, maxScale || 4);
      view.tx = sz.w / 2 - view.s * (minX + maxX) / 2;
      view.ty = sz.h / 2 - view.s * (minY + maxY) / 2;
      apply();
    }
    function itemsBox(idxs){
      var b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      idxs.forEach(function(i){
        corners(layout.items[i]).forEach(function(p){
          b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
          b.minY = Math.min(b.minY, p.y - 20); b.maxY = Math.max(b.maxY, p.y);
        });
      });
      return b;
    }
    function fit(){
      var all = layout.items.map(function(_, i){ return i; });
      var stalls = all.filter(function(i){ return layout.items[i].kind === 'stall'; });
      var target = stalls.length ? stalls : all;
      if (opts.fitToItems && target.length){
        var b = itemsBox(target);
        fitBox(b.minX, b.maxX, b.minY, b.maxY, 40, 3);
      } else {
        var cols = layout.cols, rows = layout.rows;
        fitBox(-rows * TW / 2, cols * TW / 2, -24, (cols + rows) * TH / 2 + SLAB, 40, 3);
      }
      view.fitted = true;
    }
    function focusItems(idxs){
      if (!idxs.length) return;
      var b = itemsBox(idxs);
      fitBox(b.minX, b.maxX, b.minY, b.maxY, 120, 1.8);
    }
    function zoomAt(f, px, py){
      var ns = clamp(view.s * f, 0.2, 5);
      var k = ns / view.s;
      view.tx = px - (px - view.tx) * k;
      view.ty = py - (py - view.ty) * k;
      view.s = ns;
      apply();
    }
    function zoom(f){ var sz = size(); zoomAt(f, sz.w / 2, sz.h / 2); }
    function local(e){ var r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function toCell(pt){
      var cx = (pt.x - view.tx) / view.s, cy = (pt.y - view.ty) / view.s;
      var gx = (cx / (TW / 2) + cy / (TH / 2)) / 2, gy = (cy / (TH / 2) - cx / (TW / 2)) / 2;
      return { x: Math.floor(gx), y: Math.floor(gy) };
    }

    var pointers = {};
    var gesture = null;
    function dist(a, b){ return Math.hypot(a.x - b.x, a.y - b.y); }
    function interact(on){ if (opts.onInteract) opts.onInteract(on); }

    svg.addEventListener('pointerdown', function(e){
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { svg.setPointerCapture(e.pointerId); } catch(err){}
      pointers[e.pointerId] = local(e);
      var ids = Object.keys(pointers);
      if (ids.length === 2){
        if (gesture && gesture.drag){
          var it0 = layout.items[gesture.drag.idx];
          it0.x = gesture.drag.ox; it0.y = gesture.drag.oy; draw();
        }
        gesture = { type: 'pinch', dist: dist(pointers[ids[0]], pointers[ids[1]]) || 1, s: view.s };
        return;
      }
      var el = e.target.closest ? e.target.closest('[data-idx]') : null;
      var idx = el ? +el.getAttribute('data-idx') : -1;
      var p = local(e);
      gesture = { type: 'single', start: p, last: p, idx: idx, moved: false };
      if (idx >= 0 && opts.canDrag && opts.canDrag(idx)){
        var it = layout.items[idx];
        gesture.drag = { idx: idx, ox: it.x, oy: it.y, cell: toCell(p) };
      }
      interact(true);
    });

    svg.addEventListener('pointermove', function(e){
      if (!pointers[e.pointerId] || !gesture) return;
      pointers[e.pointerId] = local(e);
      var ids = Object.keys(pointers);
      if (gesture.type === 'pinch'){
        if (ids.length < 2) return;
        var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
        zoomAt(gesture.s * (dist(p1, p2) / gesture.dist) / view.s, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
        return;
      }
      var p = local(e);
      if (!gesture.moved && dist(p, gesture.start) > 5) gesture.moved = true;
      if (!gesture.moved) return;
      if (gesture.drag){
        var it = layout.items[gesture.drag.idx];
        var c = toCell(p);
        var nx = clamp(gesture.drag.ox + c.x - gesture.drag.cell.x, 0, layout.cols - it.w);
        var ny = clamp(gesture.drag.oy + c.y - gesture.drag.cell.y, 0, layout.rows - it.h);
        if (nx !== it.x || ny !== it.y){ it.x = nx; it.y = ny; draw(); }
      } else {
        view.tx += p.x - gesture.last.x;
        view.ty += p.y - gesture.last.y;
        apply();
      }
      gesture.last = p;
    });

    function end(e){
      if (!pointers[e.pointerId]) return;
      delete pointers[e.pointerId];
      var g0 = gesture;
      if (Object.keys(pointers).length) return;
      gesture = null;
      interact(false);
      if (!g0 || g0.type === 'pinch') return;
      if (g0.drag && g0.moved){
        var it = layout.items[g0.drag.idx];
        var changed = it.x !== g0.drag.ox || it.y !== g0.drag.oy;
        if (changed && (e.type === 'pointercancel' || !opts.onItemMoved || opts.onItemMoved(g0.drag.idx) === false)){
          it.x = g0.drag.ox; it.y = g0.drag.oy; draw();
        }
        return;
      }
      if (g0.moved || e.type === 'pointercancel') return;
      if (g0.idx >= 0){
        if (opts.onItemClick) opts.onItemClick(g0.idx);
      } else if (opts.onCellClick){
        var c = toCell(local(e));
        if (c.x >= 0 && c.y >= 0 && c.x < layout.cols && c.y < layout.rows) opts.onCellClick(c.x, c.y);
      }
    }
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    svg.addEventListener('wheel', function(e){
      if (opts.wheelNeedsCtrl && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      var p = local(e);
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, p.x, p.y);
    }, { passive: false });

    svg.addEventListener('keydown', function(e){
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var el = e.target.closest ? e.target.closest('[data-idx]') : null;
      if (el && opts.onItemClick){ e.preventDefault(); opts.onItemClick(+el.getAttribute('data-idx')); }
    });

    draw();
    if (view.fitted) apply(); else fit();

    return { draw: draw, fit: fit, zoom: zoom, focusItems: focusItems };
  }

  window.IsoMap = { create: create };
})();
