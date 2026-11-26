/* Doctor Who as a fixed timeline: groups (Doctor Who, Companions, UNIT…) → eras → stories in reading/watching order,
   with done, a 1–10 rating and notes per story. The built-in order never changes; your marks, the entries you add and your
   edits are saved on top of it (dw.json).
   Marks move over once from the old Doctor Who tab's snapshot, or from the built-in copy in your own edition. */
(function () {
  "use strict";
  const K = window.Kit, esc = K.esc;
  const ui = { g: 0, t: 0, type: "all", state: "all", q: "", open: null };
  let st = null;
  const D = () => window.DW_DATA || { groups: [], types: [], works: {} };
  const load = () => { if (st) return st; try { st = JSON.parse(Saga.Native.load("dw.json") || "null"); } catch (e) { st = null; } st = st || { works: {} }; st.works = st.works || {}; return st; };
  let ver = 0; // 0.6.7: bumped on every change, so the "waits for" index is rebuilt after an edit or a move
  const save = () => { ver++; Saga.Native.save("dw.json", JSON.stringify(st)); Saga.changed("timeline"); };
  // one-time move: snap_dw.json (old tab) or DW_MINE (own edition), only into an empty timeline
  function migrate(snapText, mine) {
    const s = load();
    if (Object.keys(s.works).length || s.migrated) return 0;
    let works = null;
    try { const j = snapText ? JSON.parse(snapText) : null; if (j && j.state && j.state.works) works = j.state.works; } catch (e) { /* ignore */ }
    if (!works && mine && mine.works) works = mine.works;
    s.migrated = 1;
    if (!works) { save(); return 0; }
    for (const [k, v] of Object.entries(works)) if (v && (v.done || v.rating || v.notes)) s.works[k] = { done: !!v.done, rating: v.rating || null, notes: v.notes || "" };
    save();
    return Object.keys(s.works).length;
  }
  const typeOf = id => (D().types || []).find(t => t.id === id) || { label: id, color: "#999" };
  // Your own changes to the fixed order, kept in dw.json with your marks: entries you added (s.custom, placed after
  // another entry) and edits to existing ones (s.edits: title, type, note, hidden). The built-in order is never rewritten.
  const customOf = k => (load().custom || []).find(c => c.k === k);
  const workOf = it => {
    const c = customOf(it.k), w = c || (D().works || {})[it.k] || {}, e = (load().edits || {})[it.k] || {};
    return { title: e.title || w.title || it.raw || it.k, type: e.type || w.type || (it.k.split("|")[1] || ""), sub: e.sub != null ? e.sub : (c ? c.sub : it.sub) || "", hidden: !!e.hidden, mine: !!c, me: load().works[it.k] || {} };
  };
  // a tab's entries with yours put in place, hidden ones left out unless asked for
  function itemsOf(g, tab, withHidden) {
    const out = tab.items.filter(it => !it.ref).slice();
    for (const c of (load().custom || []).filter(c => c.g === g.name && c.t === tab.name)) {
      const i = c.after ? out.findIndex(x => x.k === c.after) : -1;
      const it = { k: c.k, raw: c.title, sub: c.sub };
      if (i >= 0) out.splice(i + 1, 0, it); else out.push(it);
    }
    // 0.6.1: your own order for this section (dragged by hand); entries not in it keep their place after their neighbour
    const ord = (load().order || {})[tab.id];
    let res = out;
    if (ord && ord.length) {
      const pos = new Map(ord.map((k, i) => [k, i])), placed = out.filter(x => pos.has(x.k)).sort((a, b) => pos.get(a.k) - pos.get(b.k));
      res = placed.slice();
      out.forEach((x, i) => { if (pos.has(x.k)) return; let j = -1; for (let p = i - 1; p >= 0 && j < 0; p--) j = res.indexOf(out[p]); res.splice(j + 1, 0, x); });
    }
    return withHidden ? res : res.filter(it => !((load().edits || {})[it.k] || {}).hidden);
  }
  // ---- 0.6.7: a story told "after" in another timeline (or later in its own) waits for it. Some stories sit in one
  // timeline but are framed after another: The Forbidden Time and Falling are in season 4 and in Ben & Polly's
  // "During", but their last place, in Ben & Polly's "After" section, comes after The Faceless Ones and what follows.
  // Such a story isn't "next" until everything before that last place is done. Only "After" sections count: a story
  // appearing in two timelines' main runs follows each timeline's own order, as before.
  let blockIx = null, blockVer = -1, blockSt = null, lastRaw = null;
  function blockIndex() {
    if (blockIx && blockVer === ver && blockSt === load()) return blockIx;
    const ix = new Map(), hid = load().edits || {};
    lastRaw = new Map(); // tab id → (k → its last place in the tab's built-in list)
    for (const g of D().groups) {
      if (/skipped|not canon/i.test(g.name)) continue;
      for (const t of g.tabs) {
        // the full built-in order, cross-references included (Falling's place in Ben & Polly's "After" is one),
        // without the entries you hid
        const last = new Map();
        t.items.forEach((it, i) => { if (!(hid[it.k] || {}).hidden) last.set(it.k, i); });
        lastRaw.set(t.id, last);
        for (const [k, i] of last) {
          if (!/^after/i.test(t.items[i].sub || "") || i === 0) continue;
          if (!ix.has(k)) ix.set(k, []);
          ix.get(k).push({ tabId: t.id, tab: t.name, group: g.name, before: t.items.slice(0, i).filter(x => x.k !== k && !(hid[x.k] || {}).hidden).map(x => x.k) });
        }
      }
    }
    blockIx = ix; blockVer = ver; blockSt = load();
    return ix;
  }
  // what k still waits for in another timeline (the one being looked at follows its own order): { tab, open } or null
  function waitsFor(k, tabId) {
    const r = blockIndex().get(k); if (!r) return null;
    const works = load().works;
    for (const b of r) { if (b.tabId === tabId) continue; const open = b.before.filter(x => !(works[x] || {}).done); if (open.length) return { tab: b.tab, tabId: b.tabId, open }; }
    return null;
  }
  // an entry of a tab is "next" when it isn't done, isn't listed again later in the same tab (its later place
  // counts: The Forbidden Time in Ben & Polly's "During" and "After"), and waits for nothing in another timeline
  function nextable(it, tab, done) {
    if (done) return false;
    blockIndex();
    const raw = tab.items.indexOf(it), last = (lastRaw.get(tab.id) || new Map()).get(it.k);
    if (raw >= 0 && last != null && raw < last) return false;
    return !waitsFor(it.k, tab.id);
  }
  // the entry to offer as Next up in a tab: the first nextable one; when everything left waits for another timeline,
  // the first story it waits for there
  function nextIn(entries, tab) {
    const e = entries.find(x => nextable(x.it, tab, x.w.me.done));
    if (e) return e;
    for (const x of entries) {
      if (x.w.me.done) continue;
      const wf = waitsFor(x.it.k, tab.id); if (!wf) continue;
      // what that timeline can play next (its own first story that waits for nothing); else the first one it's missing
      let g2 = null, t2 = null;
      for (const g of D().groups) { const t = g.tabs.find(t => t.id === wf.tabId); if (t) { g2 = g; t2 = t; break; } }
      const own = t2 ? itemsOf(g2, t2).find(it => wf.open.includes(it.k) && nextable(it, t2, (load().works[it.k] || {}).done)) : null;
      const k = own ? own.k : wf.open[0];
      return { it: { k }, w: workOf({ k }), via: wf.tab };
    }
    return null;
  }
  // ---- 0.6.1: hold the grip and drag to reorder; hold an entry to delete it (hide it, or remove one you added). Undo for 10 s.
  const snapshot = () => JSON.stringify(load());
  const restoreFrom = text => { st = JSON.parse(text); save(); Saga.render(); };
  function deleteEntry(k) {
    const s = load(), before = snapshot(), w = workOf({ k });
    const ci = (s.custom || []).findIndex(c => c.k === k);
    if (ci >= 0) s.custom.splice(ci, 1); else { s.edits = s.edits || {}; (s.edits[k] = s.edits[k] || {}).hidden = true; }
    save(); Saga.render();
    K.toast(`Deleted ${w.title || "entry"}`, () => restoreFrom(before));
  }
  function moveEntry(g, tab, k, toIndex) {
    const s = load(), before = snapshot();
    const keys = itemsOf(g, tab, true).map(x => x.k), vis = itemsOf(g, tab).map(x => x.k);
    const from = keys.indexOf(k);
    if (from < 0) return;
    // the visible position maps to a place among all entries (hidden ones included)
    const target = vis.filter(x => x !== k)[toIndex];
    keys.splice(from, 1);
    const at = target ? keys.indexOf(target) : keys.length;
    keys.splice(at < 0 ? keys.length : at, 0, k);
    s.order = s.order || {}; s.order[tab.id] = keys;
    save(); Saga.render();
    K.toast("Moved", () => restoreFrom(before));
  }
  let drag = null, hold = null, swallowClick = false;
  function gestures() {
    if (gestures.on) return;
    gestures.on = true;
    const view = () => document.querySelector("#view");
    document.addEventListener("pointerdown", e => {
      const row = e.target.closest && e.target.closest(".tl .tli[data-k]");
      if (!row || !view().contains(row)) return;
      const d = D(), g = d.groups[ui.g] || d.groups[0], tab = g.tabs[ui.t] || g.tabs[0];
      if (e.target.closest(".tlgrip")) {
        // hold the grip: the entry lifts and follows the finger
        e.preventDefault();
        const rows = [...row.parentNode.querySelectorAll(".tli[data-k]")], r0 = row.getBoundingClientRect();
        drag = { row, g, tab, k: row.dataset.k, y0: e.clientY, rows, mids: rows.map(x => { const b = x.getBoundingClientRect(); return b.top + b.height / 2; }), from: rows.indexOf(row), to: rows.indexOf(row), h: r0.height };
        row.classList.add("dragging"); row.setPointerCapture && row.setPointerCapture(e.pointerId);
        return;
      }
      const x0 = e.clientX, y0 = e.clientY;
      hold = { row, k: row.dataset.k, x0, y0, t: setTimeout(() => { hold = null; swallowClick = true; if (navigator.vibrate) navigator.vibrate(20); deleteEntry(row.dataset.k); }, 650) };
      row.classList.add("holding");
    }, { passive: false });
    document.addEventListener("pointermove", e => {
      if (hold && (Math.abs(e.clientX - hold.x0) > 8 || Math.abs(e.clientY - hold.y0) > 8)) { clearTimeout(hold.t); hold.row.classList.remove("holding"); hold = null; }
      if (!drag) return;
      e.preventDefault();
      const dy = e.clientY - drag.y0, y = drag.mids[drag.from] + dy;
      let to = drag.mids.findIndex(m => y < m); if (to < 0) to = drag.rows.length - 1; else if (to > drag.from) to -= 1;
      drag.to = Math.max(0, to);
      drag.row.style.transform = `translateY(${dy}px)`;
      drag.rows.forEach((r, i) => { if (r === drag.row) return; const sh = drag.from < drag.to ? (i > drag.from && i <= drag.to ? -drag.h : 0) : (i >= drag.to && i < drag.from ? drag.h : 0); r.style.transform = sh ? `translateY(${sh}px)` : ""; });
      // near the screen's edges, the page scrolls
      if (e.clientY < 80) window.scrollBy(0, -12); else if (e.clientY > window.innerHeight - 100) window.scrollBy(0, 12);
    }, { passive: false });
    const end = () => {
      if (hold) { clearTimeout(hold.t); hold.row.classList.remove("holding"); hold = null; }
      if (!drag) return;
      const d0 = drag; drag = null; swallowClick = true;
      d0.rows.forEach(r => { r.style.transform = ""; }); d0.row.classList.remove("dragging");
      if (d0.to !== d0.from) moveEntry(d0.g, d0.tab, d0.k, d0.to);
      setTimeout(() => { swallowClick = false; }, 300);
    };
    document.addEventListener("pointerup", end); document.addEventListener("pointercancel", end);
    // the tap that ends a hold or a drag doesn't also open the entry
    document.addEventListener("click", e => { if (swallowClick && e.target.closest && e.target.closest(".tl .tli")) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);
    document.addEventListener("contextmenu", e => { if (e.target.closest && e.target.closest(".tl .tli")) e.preventDefault(); });
  }
  function tabStats(tab, g) { let n = 0, d = 0; for (const it of g ? itemsOf(g, tab) : tab.items.filter(x => !x.ref)) { n++; if ((load().works[it.k] || {}).done) d++; } return { n, d }; }
  // ---- 0.5.9: statistics. A set of entries → done/total, ratings overall and per media type (each with its colour).
  function statsOf(entries) {
    const out = { n: 0, d: 0, rated: 0, sum: 0, types: {}, hist: Array(10).fill(0), best: null, worst: null };
    for (const { it, w } of entries) {
      const t = out.types[w.type] = out.types[w.type] || { n: 0, d: 0, rated: 0, sum: 0 };
      out.n++; t.n++;
      if (w.me.done) { out.d++; t.d++; }
      const r = +w.me.rating;
      if (r >= 1 && r <= 10) {
        out.rated++; out.sum += r; t.rated++; t.sum += r; out.hist[Math.round(r) - 1]++;
        if (!out.best || r > out.best.r) out.best = { k: it.k, t: w.title, r };
        if (!out.worst || r < out.worst.r) out.worst = { k: it.k, t: w.title, r };
      }
    }
    return out;
  }
  const avg = x => (x.rated ? (x.sum / x.rated).toFixed(1) : "–");
  const pct = x => (x.n ? Math.round((100 * x.d) / x.n) : 0);
  const entriesOf = (g, t) => itemsOf(g, t).map(it => ({ it, w: workOf(it) }));
  // every canon story once (a story listed in several sections counts once), skipped groups left out
  function canonEntries(onlyGroup) {
    const seen = new Set(), out = [];
    for (const g of D().groups) {
      if (onlyGroup ? g !== onlyGroup : /skipped|not canon/i.test(g.name)) continue;
      for (const t of g.tabs) for (const e of entriesOf(g, t)) if (!seen.has(e.it.k)) { seen.add(e.it.k); out.push(e); }
    }
    return out;
  }
  // chips: overall average, then one per media type present (tap one to show only that type in the section)
  function avgChips(x, filterable) {
    const chips = [`<span class="tchip"><b>All</b> ★ ${avg(x)} <span class="muted">(${x.rated} rated)</span></span>`];
    for (const ty of D().types || []) {
      const t = x.types[ty.id];
      if (!t) continue;
      const attrs = filterable ? `data-action="tltypechip" data-v="${esc(ty.id)}" aria-pressed="${ui.type === ty.id}"` : "";
      chips.push(`<${filterable ? "button" : "span"} class="tchip" style="--tc:${esc(ty.color)}" ${attrs}><i></i>${esc(ty.label)} ★ ${avg(t)} <span class="muted">(${t.d}/${t.n})</span></${filterable ? "button" : "span"}>`);
    }
    return `<div class="chips" style="margin:8px 0">${chips.join("")}</div>`;
  }
  const histHtml = x => `<div class="hist">${x.hist.map(n => `<i style="height:${Math.round((100 * n) / Math.max(1, ...x.hist))}%" title="${n}"></i>`).join("")}</div><div class="histl">${x.hist.map((_, i) => `<span>${i + 1}</span>`).join("")}</div>`;
  function sectionHero(g, tab) {
    const x = statsOf(entriesOf(g, tab));
    const nxt = nextIn(entriesOf(g, tab), tab);
    return `<div class="card" style="padding:14px;margin-bottom:12px">
      <div class="row" style="gap:10px"><b class="grow" style="font:800 20px/1.1 var(--display)">${esc(tab.name)}</b><span class="muted">${x.d}/${x.n} · ${pct(x)}%</span></div>
      <div class="minibar" style="margin:8px 0"><i style="width:${pct(x)}%"></i></div>
      ${avgChips(x, true)}
      <div class="small muted">${x.rated} rated${tab.avgLine ? ` · reference: ${esc(tab.avgLine)}` : ""}${x.best ? ` · best: ${esc(x.best.t)} (★ ${x.best.r})` : ""}${x.worst && x.worst.k !== (x.best || {}).k ? ` · lowest: ${esc(x.worst.t)} (★ ${x.worst.r})` : ""}</div>
      ${x.rated >= 3 ? `<details style="margin-top:8px"><summary class="small">Rating spread</summary>${histHtml(x)}</details>` : ""}
      ${nxt ? `<button class="btn small" style="margin-top:10px" data-action="tlnext" data-k="${esc(nxt.it.k)}">Next up: ${esc(nxt.w.title)}${nxt.via ? ` <span class="muted">(${esc(nxt.via)} first)</span>` : ""}</button>` : ""}</div>`;
  }
  function overview() {
    const d = D(), all = canonEntries(null), x = statsOf(all);
    const going = [];
    for (const g of d.groups) { if (/skipped|not canon/i.test(g.name)) continue; d.groups.indexOf(g);
      g.tabs.forEach((t, ti) => { const e = entriesOf(g, t), y = statsOf(e); if (y.d > 0 && y.d < y.n) going.push({ g, gi: d.groups.indexOf(g), ti, t, y, nx: nextIn(e, t) }); }); }
    going.sort((a, b) => pct(b.y) - pct(a.y));
    const top = all.filter(e => +e.w.me.rating >= 1).sort((a, b) => b.w.me.rating - a.w.me.rating).slice(0, 15);
    return `<section><div class="kicker">Doctor Who · overview</div>
      <div class="card" style="padding:16px;margin:10px 0">
        <div class="row"><span class="bigstat" style="font-size:52px">${pct(x)}%</span><div class="grow" style="margin-left:14px"><b>${x.d.toLocaleString()} of ${x.n.toLocaleString()} canon stories</b><div class="muted small">${x.rated.toLocaleString()} rated · average ★ ${avg(x)}</div></div></div>
        <div class="minibar" style="margin:10px 0"><i style="width:${pct(x)}%"></i></div>
        ${avgChips(x, false)}
        ${x.rated >= 3 ? histHtml(x) : ""}
      </div>
      ${going.length ? `<h3>In progress</h3><div class="listcard">${going.slice(0, 12).map(o => `<div class="item" data-action="tlgo" data-g="${o.gi}" data-t="${o.ti}"><div class="grow" style="min-width:0"><b>${esc(o.g.name)} › ${esc(o.t.name)}</b><div class="small muted ell">${o.y.d}/${o.y.n} · ★ ${avg(o.y)}${o.nx ? ` · next: ${esc(o.nx.w.title)}` : ""}</div><div class="minibar" style="margin-top:6px"><i style="width:${pct(o.y)}%"></i></div></div></div>`).join("")}</div>` : ""}
      <div class="row" style="gap:8px;margin:4px 0 12px"><button class="btn small" data-action="dwimport">${K.icon("box")}Import my list from a note</button></div>
      <h3>Groups</h3><div class="ustats">${d.groups.map((g, gi) => { const y = statsOf(canonEntries(g));
        return `<div class="card" style="padding:14px;margin-bottom:10px"><div class="row"><b class="grow">${esc(g.name)}</b><span class="muted">${y.d}/${y.n} · ${pct(y)}% · ★ ${avg(y)}</span></div>
          <div class="minibar" style="margin:8px 0"><i style="width:${pct(y)}%"></i></div>${avgChips(y, false)}
          <details><summary class="small">Sections</summary>${g.tabs.map((t, ti) => { const z = statsOf(entriesOf(g, t)); return `<div class="item" data-action="tlgo" data-g="${gi}" data-t="${ti}"><span class="grow">${esc(t.name)}</span><span class="small muted">${z.d}/${z.n} · ★ ${avg(z)}</span></div>`; }).join("")}</details></div>`; }).join("")}</div>
      ${top.length ? `<details><summary><b>Top rated</b></summary><div class="listcard">${top.map(e => `<div class="item" data-action="tlopen" data-k="${esc(e.it.k)}"><b class="grow ell">${esc(e.w.title)}</b><span class="small" style="color:${esc(typeOf(e.w.type).color)}">${esc(typeOf(e.w.type).label)}</span><span class="small">★ ${e.w.me.rating}</span></div>`).join("")}</div></details>` : ""}
    </section>`;
  }
  const where = k => { for (const g of D().groups) for (const t of g.tabs) if (itemsOf(g, t, true).some(x => x.k === k)) return { g, t }; return null; };
  function render() {
    gestures();
    const d = D();
    if (!d.groups.length) return `<p class="muted">The timeline data isn't in this build.</p>`;
    if (ui.g === -1) return `<div class="chips" style="margin:12px 0"><button class="chip" data-action="tlg" data-v="-1" aria-pressed="true">Overview</button>${d.groups.map((gg, i) => `<button class="chip" data-action="tlg" data-v="${i}">${esc(gg.name)}</button>`).join("")}</div>` + overview();
    const g = d.groups[ui.g] || d.groups[0], tab = g.tabs[ui.t] || g.tabs[0];
    const q = ui.q.toLowerCase();
    let all = 0, done = 0;
    for (const gg of d.groups) for (const t of gg.tabs) { const s = tabStats(t, gg); all += s.n; done += s.d; }
    let nextSeen = false;
    const items = itemsOf(g, tab, ui.hidden).map(it => ({ it, w: workOf(it) })).filter(({ w }) => (ui.type === "all" || w.type === ui.type) &&
      (ui.state === "all" || (ui.state === "done") === !!w.me.done) && (!q || w.title.toLowerCase().includes(q)));
    const s = tabStats(tab, g);
    return `<section><div class="kicker">${done.toLocaleString()} of ${all.toLocaleString()} stories</div>
        <div class="chips" style="margin:12px 0"><button class="chip" data-action="tlg" data-v="-1">Overview</button>${d.groups.map((gg, i) => `<button class="chip" data-action="tlg" data-v="${i}" aria-pressed="${i === ui.g}">${esc(gg.name)}</button>`).join("")}</div>
        <div class="subnav">${g.tabs.map((t, i) => { const x = tabStats(t, g); return `<button data-action="tlt" data-v="${i}" ${i === ui.t ? 'aria-current="page"' : ""}>${esc(t.name)}${x.n && x.d === x.n ? " ✓" : ""}</button>`; }).join("")}</div>
        ${sectionHero(g, tab)}
        <div class="toolbar"><input type="search" data-input="tlq" data-tlq="1" value="${esc(ui.q)}" placeholder="Find a story" autocomplete="off">
          <select data-tltype="1" aria-label="Type"><option value="all">All types</option>${(d.types || []).map(t => `<option value="${t.id}" ${ui.type === t.id ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select></div>
        <div class="chips" style="margin-bottom:12px">${[["all", "All"], ["todo", "To do"], ["done", "Done"]].map(([k, l]) => `<button class="chip" data-action="tlstate" data-v="${k}" aria-pressed="${ui.state === k}">${l}</button>`).join("")}<span class="small muted" style="align-self:center">${s.d}/${s.n} in ${esc(tab.name)}</span></div>
        <div class="row wrap" style="margin-bottom:10px"><button class="btn small" data-action="tladd" data-after="">${K.icon("plus")}Add an entry to ${esc(tab.name)}</button>
          ${Object.values(load().edits || {}).some(e => e.hidden) ? `<button class="btn quiet small" data-action="tlhidden">${ui.hidden ? "Leave hidden entries out" : "Show hidden entries"}</button>` : ""}</div>
        <div class="tl">${items.map(({ it, w }) => { const wf = w.me.done ? null : waitsFor(it.k, tab.id), isNext = !nextSeen && nextable(it, tab, w.me.done) && (nextSeen = true); const ty = typeOf(w.type);
          return `<div class="tli${w.me.done ? " on" : ""}" style="--tc:${esc(ty.color)}" data-action="tlopen" data-k="${esc(it.k)}">
            <div class="grow"><div class="tc">${esc(ty.label)}${isNext ? ' · <span style="color:var(--accent)">next</span>' : ""}${wf ? ` · <span class="muted">after ${esc(wf.tab)}: ${wf.open.length} to go</span>` : ""}</div><b>${esc(w.title)}</b>${w.mine ? ' <span class="small muted">· added by you</span>' : ""}${w.hidden ? ' <span class="small muted">· hidden</span>' : ""}${w.sub ? `<div class="small muted">${esc(w.sub)}</div>` : ""}</div>
            ${w.me.rating ? `<span class="pct">★ ${w.me.rating}</span>` : ""}<span class="tlgrip" aria-label="Hold and drag to move" role="button">⋮⋮</span></div>`; }).join("") || `<p class="muted">Nothing here.</p>`}</div></section>`;
  }
  const typeSelect = (id, cur) => `<select id="${id}">${(D().types || []).map(t => `<option value="${t.id}" ${t.id === cur ? "selected" : ""}>${esc(t.label)}</option>`).join("")}</select>`;
  // a form to add an entry (after another one, or at the end of the open tab)
  function openAdd(after) {
    const at = after ? where(after) : null, d = D(), g = at ? at.g : d.groups[ui.g] || d.groups[0], t = at ? at.t : g.tabs[ui.t] || g.tabs[0];
    ui.addAt = { g: g.name, t: t.name, after: after || (itemsOf(g, t, true).slice(-1)[0] || {}).k || "" };
    Saga.sheet(`<div class="kicker">${esc(g.name)} › ${esc(t.name)}</div><h3 style="font:800 24px/1.1 var(--display);margin:6px 0 14px">Add an entry</h3>
      <p class="small muted">${after ? `It goes right after “${esc(workOf({ k: after }).title)}”.` : "It goes at the end of this part of the timeline."} Use this when the TARDIS wiki sync misses something.</p>
      <label class="field"><span>Title</span><input type="text" id="tlNewTitle" autocomplete="off"></label>
      <label class="field"><span>Type</span>${typeSelect("tlNewType", "audio")}</label>
      <label class="field"><span>Note (range, series, release), optional</span><input type="text" id="tlNewSub" autocomplete="off"></label>
      <button class="btn primary block" data-action="tladdsave">${K.icon("plus")}Add to the timeline</button>`, "tlsheet", "add");
  }
  function openStory(k) {
    const w = workOf({ k }), me = load().works[k] || {}, ty = typeOf(w.type);
    ui.open = k;
    Saga.sheet(`<div class="kicker" style="color:${esc(ty.color)}">${esc(ty.label)}</div><h3 style="font:800 26px/1.1 var(--display);margin:6px 0 14px">${esc(w.title)}</h3>
      ${(() => { const d0 = D(), g0 = d0.groups[ui.g] || d0.groups[0], t0 = ui.g === -1 ? null : g0.tabs[ui.t] || g0.tabs[0], wf = me.done ? null : waitsFor(k, t0 && t0.id); return wf ? `<p class="small" style="margin:0 0 10px">Told after the ${esc(wf.tab)} timeline: it comes after ${wf.open.length} stor${wf.open.length === 1 ? "y" : "ies"} you haven't done there, next ${wf.open.slice(0, 3).map(x => `<a href="#" data-action="tlnext" data-k="${esc(x)}">${esc(workOf({ k: x }).title)}</a>`).join(", ")}${wf.open.length > 3 ? "…" : ""}. You can still mark it done.</p>` : ""; })()}
      <button class="btn ${me.done ? "" : "primary"} block" data-action="tldone">${K.icon("check")}${me.done ? "Done: tap to undo" : "Mark as done"}</button>
      <h4>Your rating</h4><div class="chips">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button class="chip" data-action="tlrate" data-v="${n}" aria-pressed="${me.rating === n}">${n}</button>`).join("")}</div>
      <label class="field" style="margin-top:12px"><span>Notes</span><textarea rows="3" data-tlnotes="1">${esc(me.notes || "")}</textarea></label>
      <button class="sheetbtn" data-action="open" data-url="https://tardis.fandom.com/wiki/Special:Search?query=${encodeURIComponent(w.title)}">${K.icon("open")}Look it up on the TARDIS wiki</button>
      <button class="sheetbtn" data-action="tladd" data-after="${esc(k)}">${K.icon("plus")}Add an entry right after this one</button>
      <details class="report" style="margin-top:12px"><summary>Edit this entry</summary>
        <label class="field"><span>Title</span><input type="text" id="tlEdTitle" value="${esc(w.title)}" autocomplete="off"></label>
        <label class="field"><span>Type</span>${typeSelect("tlEdType", w.type)}</label>
        <label class="field"><span>Note</span><input type="text" id="tlEdSub" value="${esc(w.sub)}" autocomplete="off"></label>
        <div class="row wrap"><button class="btn primary small" data-action="tledsave">Save changes</button>
          ${w.mine ? `<button class="btn small" data-action="tldel">Delete this entry</button>` : `<button class="btn small" data-action="tlhide">${w.hidden ? "Show it again" : "Hide it from the timeline"}</button>
          ${(load().edits || {})[k] ? `<button class="btn quiet small" data-action="tlreset">Undo my edits</button>` : ""}`}</div></details>`, "tlsheet", k);
  }
  function act(a, el) {
    const s = load();
    switch (a) {
      case "tlg": ui.g = +el.dataset.v; ui.t = 0; Saga.render(); return true;
      case "tlt": ui.t = +el.dataset.v; Saga.render(); window.scrollTo(0, 0); return true;
      case "tlgo": ui.g = +el.dataset.g; ui.t = +el.dataset.t; Saga.render(); window.scrollTo(0, 0); return true;
      case "tlnext": openStory(el.dataset.k); return true;
      case "tltypechip": ui.type = ui.type === el.dataset.v ? "all" : el.dataset.v; Saga.render(); return true;
      case "tlstate": ui.state = el.dataset.v === "todo" ? "todo" : el.dataset.v; Saga.render(); return true;
      case "tlopen": openStory(el.dataset.k); return true;
      case "tldone": { const m = s.works[ui.open] = s.works[ui.open] || {}; m.done = !m.done; if (m.done) m.at = new Date().toISOString().slice(0, 10); save(); Saga.close(); Saga.render(); return true; }
      case "tladd": openAdd(el.dataset.after || ""); return true;
      case "tlhidden": ui.hidden = !ui.hidden; Saga.render(); return true;
      case "tladdsave": {
        const title = ((document.getElementById("tlNewTitle") || {}).value || "").trim();
        if (!title) { K.toast("Type a title first"); return true; }
        s.custom = s.custom || [];
        const k = "u|" + Date.now().toString(36);
        s.custom.push({ k, g: ui.addAt.g, t: ui.addAt.t, after: ui.addAt.after, title, type: document.getElementById("tlNewType").value, sub: (document.getElementById("tlNewSub").value || "").trim() });
        save(); Saga.close(); Saga.render(); K.toast(`Added ${title}`); return true;
      }
      case "tledsave": {
        const k = ui.open, w = workOf({ k }), c = customOf(k);
        const title = document.getElementById("tlEdTitle").value.trim() || w.title, type = document.getElementById("tlEdType").value, sub = document.getElementById("tlEdSub").value.trim();
        if (c) Object.assign(c, { title, type, sub });
        else { s.edits = s.edits || {}; s.edits[k] = Object.assign(s.edits[k] || {}, { title, type, sub }); }
        save(); openStory(k); Saga.render(); K.toast("Saved"); return true;
      }
      case "tlhide": { const k = ui.open; s.edits = s.edits || {}; const e = s.edits[k] = s.edits[k] || {}; e.hidden = !e.hidden; save(); Saga.close(); Saga.render(); K.toast(e.hidden ? "Hidden. Show hidden entries brings it back." : "Shown again"); return true; }
      case "tlreset": { delete (s.edits || {})[ui.open]; save(); openStory(ui.open); Saga.render(); return true; }
      case "tldel": { const k = ui.open, c = customOf(k); s.custom = (s.custom || []).filter(x => x.k !== k);
        for (const x of s.custom) if (x.after === k) x.after = c.after; // what came after it moves up
        save(); Saga.close(); Saga.render(); K.toast(`Deleted ${c.title}`, () => { s.custom.push(c); save(); Saga.render(); }); return true; }
      case "tlrate": { const m = s.works[ui.open] = s.works[ui.open] || {}; m.rating = m.rating === +el.dataset.v ? null : +el.dataset.v; save(); openStory(ui.open); Saga.render(); return true; }
    }
    return false;
  }
  function change(el) {
    if (el.dataset.tltype) { ui.type = el.value; Saga.render(); return true; }
    if (el.dataset.tlnotes && ui.open) { const s = load(); const m = s.works[ui.open] = s.works[ui.open] || {}; m.notes = el.value.trim(); save(); return true; }
    return false;
  }
  function input(el) { if (el.dataset.tlq) { ui.q = el.value; return true; } return false; }
  // the next story to read or watch, for Home
  function next() {
    for (const g of D().groups) { if (/skipped|not canon/i.test(g.name)) continue; for (const t of g.tabs) for (const it of itemsOf(g, t)) if (nextable(it, t, (load().works[it.k] || {}).done)) return { k: it.k, title: workOf(it).title, era: t.name, group: g.name, type: workOf(it).type }; }
    return null;
  }
  // 0.8.5: the next n stories in timeline order, of the kinds asked (audio, comic…): Home's Doctor Who queue
  function queue(n = 10, types) {
    const out = [], want = types && types.length ? new Set(types) : null, works = load().works;
    for (const g of D().groups) { if (/skipped|not canon/i.test(g.name)) continue; for (const t of g.tabs) for (const it of itemsOf(g, t)) {
      const w = workOf(it); if (w.hidden || (want && !want.has(w.type))) continue;
      if (!nextable(it, t, (works[it.k] || {}).done)) continue;
      if (out.some(x => x.k === it.k)) continue;
      out.push({ k: it.k, title: w.title, type: w.type, era: t.name }); if (out.length >= n) return out;
    } }
    return out;
  }
  function recent(limit = 10) { return Object.entries(load().works).filter(([, v]) => v.done && v.at).map(([k, v]) => ({ k, t: workOf({ k }).title, date: v.at })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit); }
  // ---- 0.6.9.3: your list as you keep it in a note (Samsung Notes and the like), pasted or as a .txt:
  //   -------S1-------            a section (the era tab of the same name in Doctor Who)
  //   12. The Aztecs (8)          a story with your rating: done, rated 8
  //   13. Tlotoxl ()              not rated yet: left as it is in Saga
  //   14. Men of War (4) -[Mark Steadman]   who's in it, ignored; ⤵️ and "Avg." lines ignored; a title can wrap onto the next line
  const nkey = t => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  function parseNote(text) {
    const out = [], lines = String(text || "").replace(/\r/g, "").split("\n");
    let tab = null, cur = null;
    const flush = () => { if (cur) { out.push(cur); cur = null; } };
    for (let raw of lines) {
      const line = raw.replace(/[\u2934\u2935\u2B07\uFE0F\u21B5\u21A9\u2193]/g, "").replace(/\s+$/, "");
      const h = /^\s*-{3,}\s*(.+?)\s*-{3,}\s*$/.exec(line);
      if (h) { flush(); tab = h[1].trim(); continue; }
      if (!line.trim() || /^\s*avg\b/i.test(line)) { flush(); continue; }
      const m = /^\s*(\d+)[.)]\s*(.*)$/.exec(line);
      if (m) { flush(); cur = { tab, n: +m[1], text: m[2].trim() }; continue; }
      if (cur) cur.text += " " + line.trim(); // a wrapped title
    }
    flush();
    for (const e of out) {
      let t = e.text.replace(/\s*-\s*\[[^\]]*\]\s*$/, ""); // -[Polly]
      const pAfter = /\s*\[(\d+(?:\s*-\s*\d+)?)\]\s*$/.exec(t); // The War Games (8) [10]
      if (pAfter) t = t.slice(0, pAfter.index);
      const r = /\(\s*(\d+(?:[.,]\d+)?)?\s*\)\s*$/.exec(t);
      e.rating = r && r[1] ? Math.max(1, Math.min(10, parseFloat(r[1].replace(",", ".")))) : null;
      if (r) t = t.slice(0, r.index);
      const pm = /\s*\[(\d+(?:\s*-\s*\d+)?)\]\s*$/.exec(t); // The Chase [1-4]
      e.part = (pm ? pm[1] : pAfter ? pAfter[1] : "").replace(/\s+/g, "");
      if (pm) t = t.slice(0, pm.index);
      e.title = t.replace(/\.{3}$/, "").trim();
      delete e.text;
    }
    return out.filter(e => e.title);
  }
  // which timeline entry a note line is: same section and position, else the same title in that section, else the
  // only entry anywhere with that title
  function matchNote(entries) {
    const d = D(), main = d.groups.find(g => /^doctor who$/i.test(g.name)) || d.groups[0];
    const byTitle = new Map();
    for (const g of d.groups) for (const t of g.tabs) for (const it of itemsOf(g, t, true)) { const n = nkey(workOf(it).title); if (!byTitle.has(n)) byTitle.set(n, new Set()); byTitle.get(n).add(it.k); }
    return entries.map(e => {
      const tab = main && main.tabs.find(t => t.name.toLowerCase() === String(e.tab || "").toLowerCase());
      const want = nkey(e.title), same = it => { const w = nkey(workOf(it).title); return (w === want || w.startsWith(want) && want.length >= 12) && (!e.part || it.part === e.part || it.k.endsWith("|" + e.part)); };
      let k = null;
      if (tab) {
        const raw = tab.items[e.n - 1];
        if (raw && same(raw)) k = raw.k;
        if (!k) { const all = itemsOf(main, tab, true).concat(tab.items.filter(x => x.ref)); const hit = all.find(same); if (hit) k = hit.k; }
      }
      if (!k) { const ks = byTitle.get(want); if (ks && ks.size === 1) k = [...ks][0]; }
      return Object.assign({}, e, { k });
    });
  }
  // what importing would do (dry) or does: a rating in the note wins; an empty () leaves Saga's mark alone
  function importNote(text, dry) {
    const rows = matchNote(parseNote(text));
    if (!rows.length) throw new Error("no numbered stories found (lines like “12. The Aztecs (8)” under a “----S1----” heading)");
    const s = dry ? JSON.parse(JSON.stringify(load())) : load();
    const out = { lines: rows.length, rated: 0, added: 0, changed: 0, same: 0, empty: 0, keptHere: 0, unmatched: [] };
    for (const r of rows) {
      if (!r.k) { out.unmatched.push(`${r.tab ? r.tab + " " : ""}${r.n}. ${r.title}${r.part ? ` [${r.part}]` : ""}`); continue; }
      const me = s.works[r.k] || {};
      if (r.rating == null) { out.empty++; if (me.done || me.rating) out.keptHere++; continue; }
      out.rated++;
      if (me.done && +me.rating === r.rating) { out.same++; continue; }
      if (me.done || me.rating) out.changed++; else out.added++;
      s.works[r.k] = Object.assign({}, me, { done: true, rating: r.rating });
    }
    if (!dry && (out.added || out.changed)) save();
    return out;
  }
  function restoreMine(mine, dry) {
    const s = dry ? JSON.parse(JSON.stringify(load())) : load(); let n = 0;
    for (const [k, v] of Object.entries((mine && mine.works) || {})) { const me = s.works[k] || {}; if (!v || !(v.done || v.rating) || me.done || me.rating) continue; s.works[k] = Object.assign({}, me, { done: !!v.done, rating: v.rating || null }, me.notes || !v.notes ? {} : { notes: v.notes }); n++; }
    if (!dry && n) save();
    return n;
  }
  const statesFor = () => load();
  // 0.7.8: every story on the timeline (not hidden, not in "skipped / not canon"), with its type and your marks, for the
  // other tabs (novels to Books, films to Watch, games to Games)
  function allWorks() {
    const out = [], seen = new Set();
    for (const g of D().groups) { if (/skipped|not canon/i.test(g.name)) continue; for (const t of g.tabs) for (const it of itemsOf(g, t)) {
      if (seen.has(it.k)) continue; seen.add(it.k);
      const w = workOf(it); if (w.hidden) continue;
      const m = load().works[it.k] || {};
      out.push({ k: it.k, title: w.title, type: w.type, done: !!m.done, rating: m.rating || null, at: m.at || null, era: t.name });
    } }
    return out;
  }
  K.mods.timeline = { queue, started: () => Object.values(load().works).some(w => w && w.done), allWorks, title: "Doctor Who", restoreMine, parseNote, matchNote, importNote, statsOf, canonEntries, render, act, change, input, migrate, next, recent, openStory, state: statesFor, reset: () => { st = null; ver++; }, waitsFor, deleteEntry, moveEntry, itemsOf, data: () => D(), mine: () => load(), saveMine: () => save() };
})();
