(function(){
  "use strict";

  var TW = 56, TH = 28, SLAB = 10;
  var FLAT = { entrance: 1, toilet: 1, tree: 1, parking: 1, text: 1 };
  var TINTS = { entrance: 'var(--accent)', toilet: 'var(--zone-2)', tree: 'var(--success)', parking: 'var(--primary)', text: 'var(--muted)', stage: 'var(--zone-3)', object: 'var(--zone-1)' };

  // Line icons on a 24×24 grid, shared by the map badges and the editor toolbar.
  var ICONS = {
    select: '<path d="M6 3l12 9-5.5 1.5L10 19z"/>',
    erase: '<path d="M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    stall: '<path d="M3 10l9-6 9 6"/><path d="M3 10h18M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
    entrance: '<path d="M13 4h6v16h-6"/><path d="M3 12h11M10 8l4 4-4 4"/>',
    toilet: '<rect x="3" y="5" width="18" height="14" rx="4"/><text x="12" y="15" class="ico-txt">WC</text>',
    parking: '<rect x="4" y="3" width="16" height="18" rx="4"/><path d="M10 17V8h3a2.5 2.5 0 0 1 0 5h-3"/>',
    tree: '<path d="M12 21v-6"/><circle cx="12" cy="10" r="6"/>',
    text: '<path d="M4 5h16v9H4z"/><path d="M12 14v7M8 9.5h8"/>',
    stage: '<path d="M3 15h18v4H3z"/><path d="M7 15v-2a5 5 0 0 1 10 0v2"/>',
    object: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>'
  };

  function P(x, y){ return { x: (x - y) * TW / 2, y: (x + y) * TH / 2 }; }
  function up(p, h){ return { x: p.x, y: p.y - h }; }
  function lerp(p, q, t){ return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }; }
  function pts(arr){ return arr.map(function(p){ return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' '); }
  function poly(cls, arr){ return '<polygon class="' + cls + '" points="' + pts(arr) + '"/>'; }
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isFlat(it){ return !!FLAT[it.kind]; }
  // Everything upright is depth-sorted together; text signs float on top so they stay readable.
  function layer(it){ return it.kind === 'text' ? 2 : 1; }
  function corners(it){ return [P(it.x, it.y), P(it.x + it.w, it.y), P(it.x + it.w, it.y + it.h), P(it.x, it.y + it.h)]; }
  function shrink(arr, c, f){ return arr.map(function(p){ return { x: c.x + (p.x - c.x) * f, y: c.y + (p.y - c.y) * f }; }); }
  function iconSvg(kind){ return '<svg class="ico-svg" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[kind] || '') + '</svg>'; }

  // A market tent: low canvas walls, a gable roof whose ridge runs along the row, and awning stripes on the front.
  function tent(it, label){
    var x = it.x, y = it.y, w = it.w, h = it.h, H = 6, R = 13;
    var a = P(x, y), b = P(x + w, y), c = P(x + w, y + h), d = P(x, y + h);
    var r0 = up(P(x, y + h / 2), H + R), r1 = up(P(x + w, y + h / 2), H + R);
    var e0 = up(P(x - 0.04, y + h + 0.12), H - 1), e1 = up(P(x + w + 0.04, y + h + 0.12), H - 1);
    var s = poly('tent-wall tent-wall-r', [b, c, up(c, H), up(b, H)]) +
      poly('tent-wall tent-wall-f', [d, c, up(c, H), up(d, H)]) +
      poly('tent-roof tent-roof-back', [up(a, H), up(b, H), r1, r0]) +
      poly('tent-roof tent-gable', [up(b, H), up(c, H), r1]) +
      poly('tent-roof tent-roof-front', [e0, e1, r1, r0]);
    var n = Math.max(4, Math.round(4 * w));
    for (var k = 0; k < n; k += 2){
      s += poly('tent-stripe', [lerp(e0, e1, k / n), lerp(e0, e1, (k + 1) / n), lerp(r0, r1, (k + 1) / n), lerp(r0, r1, k / n)]);
    }
    if (label){
      var cx = (e0.x + e1.x + r0.x + r1.x) / 4, cy = (e0.y + e1.y + r0.y + r1.y) / 4;
      s += '<text class="tent-label" x="' + cx.toFixed(1) + '" y="' + cy.toFixed(1) + '">' + esc(label) + '</text>';
    }
    return s;
  }

  function box(it, height, label){
    var c4 = corners(it), a = c4[0], b = c4[1], c = c4[2], d = c4[3];
    var center = P(it.x + it.w / 2, it.y + it.h / 2);
    var s = poly('box-face box-right', [b, c, up(c, height), up(b, height)]) +
      poly('box-face box-left', [d, c, up(c, height), up(d, height)]) +
      poly('box-face box-top', [up(a, height), up(b, height), up(c, height), up(d, height)]);
    if (label) s += '<text class="box-label" x="' + center.x.toFixed(1) + '" y="' + (center.y - height).toFixed(1) + '">' + esc(label) + '</text>';
    return s;
  }

  // Upright round sign on a short post, so facilities read clearly from any zoom level.
  function badge(it, kind){
    var center = P(it.x + it.w / 2, it.y + it.h / 2);
    var r = 8 + 2 * Math.min(it.w, it.h), cy = center.y - 10 - r;
    var sc = (r * 1.25) / 24;
    return '<ellipse class="iso-shadow" cx="' + center.x.toFixed(1) + '" cy="' + center.y.toFixed(1) + '" rx="' + (r * 0.9).toFixed(1) + '" ry="' + (r * 0.35).toFixed(1) + '"/>' +
      '<line class="iso-pole" x1="' + center.x.toFixed(1) + '" y1="' + center.y.toFixed(1) + '" x2="' + center.x.toFixed(1) + '" y2="' + (cy + r).toFixed(1) + '"/>' +
      '<circle class="iso-badge-bg" cx="' + center.x.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r + '"/>' +
      '<g class="iso-badge-ico" transform="translate(' + (center.x - 12 * sc).toFixed(1) + ',' + (cy - 12 * sc).toFixed(1) + ') scale(' + sc.toFixed(3) + ')">' + ICONS[kind] + '</g>';
  }

  function tree(it){
    var center = P(it.x + it.w / 2, it.y + it.h / 2);
    var k = Math.min(it.w, it.h), cx = center.x, cy = center.y;
    return '<ellipse class="iso-shadow" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" rx="' + (11 * k) + '" ry="' + (4 * k) + '"/>' +
      '<line class="tree-trunk" x1="' + cx.toFixed(1) + '" y1="' + cy.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y2="' + (cy - 10 * k).toFixed(1) + '"/>' +
      '<circle class="tree-canopy-back" cx="' + (cx + 4 * k).toFixed(1) + '" cy="' + (cy - 18 * k).toFixed(1) + '" r="' + (6.5 * k) + '"/>' +
      '<circle class="tree-canopy" cx="' + (cx - 2 * k).toFixed(1) + '" cy="' + (cy - 15 * k).toFixed(1) + '" r="' + (8 * k) + '"/>';
  }

  function signboard(it){
    var center = P(it.x + it.w / 2, it.y + it.h / 2);
    var text = it.label || 'ป้าย';
    var wpx = Math.max(36, text.length * 6.4 + 18);
    return '<rect class="sign-board" x="' + (center.x - wpx / 2).toFixed(1) + '" y="' + (center.y - 10).toFixed(1) + '" width="' + wpx.toFixed(1) + '" height="20" rx="10"/>' +
      '<text class="sign-text" x="' + center.x.toFixed(1) + '" y="' + center.y.toFixed(1) + '">' + esc(text) + '</text>';
  }

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
      var color = st.color || TINTS[it.kind] || 'var(--zone-2)';
      var center = P(it.x + it.w / 2, it.y + it.h / 2);
      var s = '<g class="' + cls + '"' + attrs + ' style="--c:' + color + '">' + (st.title ? '<title>' + esc(st.title) + '</title>' : '');
      if (isFlat(it)) s += poly('iso-pad', shrink(corners(it), center, 0.86));
      if (it.kind === 'stall') s += tent(it, st.label != null ? st.label : '');
      else if (it.kind === 'stage') s += box(it, 5, it.label || 'เวที');
      else if (it.kind === 'object') s += box(it, 12, it.label || '');
      else if (it.kind === 'tree') s += tree(it);
      else if (it.kind === 'text') s += signboard(it);
      else s += badge(it, it.kind);
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
      // Paving joints: faint in the public view, a working grid in the editor.
      var gridCls = opts.editable ? 'iso-grid' : 'iso-paving';
      var i, a, b;
      for (i = 1; i < cols; i++){ a = P(i, 0); b = P(i, rows); out.push('<line class="' + gridCls + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>'); }
      for (i = 1; i < rows; i++){ a = P(0, i); b = P(cols, i); out.push('<line class="' + gridCls + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>'); }
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

  window.IsoMap = { create: create, icon: iconSvg };
})();
