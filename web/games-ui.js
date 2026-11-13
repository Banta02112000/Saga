/* Games screens: poster grid with filters, franchises and multiverses, the game page (status, rating, playthroughs
   with dates, price and stores, details), add from Steam or by hand. Uses Saga (set by app.js) and Kit. */
(function () {
  "use strict";
  const G = window.GamesCore, K = window.Kit, esc = K.esc;
  const ui = { f: "all", sort: "release", q: "", view: "grid", lim: 120, res: null, busy: false, open: null };
  const today = () => new Date().toISOString().slice(0, 10);
  const lib = () => Saga.games;
  const save = () => { lib().save(); Saga.changed("games"); };
  const cover = g => (g.cover || (g.steam ? G.COVER(g.steam) : ""));
  const eur = n => (n == null ? "" : n === 0 ? "Free" : `€${(+n).toFixed(2).replace(".", Saga.lang() === "it" ? "," : ".")}`);
  function posterOf(g, opt = {}) {
    const t = today();
    const badge = g.status === "playing" ? "Playing" : g.next && g.status !== "done" ? "Next" : g.date && g.date > t ? K.when(g.date, Saga.lang()).replace(/^\d+ /, "") : "";
    const badgeR = g.price && g.price.disc >= 10 && g.status !== "done" ? `−${g.price.disc}%` : g.plays.length > 1 ? `${g.plays.length}×` : "";
    return K.poster({ key: "game:" + g.id, title: g.title, img: cover(g), kind: "game", badge, badgeAcc: g.status === "playing", badgeR, done: g.status === "done", attrs: `data-action="gopen" data-id="${esc(g.id)}"` });
  }
  const tileOf = g => `<div class="tile">${posterOf(g)}<div class="cap">${esc(g.title)}</div><div class="cap2">${esc(ui.sort === "remake" && g.remake ? `Remake ${g.remake.date ? g.remake.date.slice(0, 4) : ""} · ${g.remake.platform || ""}` : [G.yearOf(g), g.platform].filter(Boolean).join(" · "))}</div></div>`;

  function listFor() {
    const t = today(), q = G.norm(ui.q);
    let list = lib().visible().filter(g => {
      if (q && !G.norm(g.title + " " + g.franchise + " " + g.multiverse).includes(q)) return false;
      if (ui.f === "all") return true;
      if (ui.f === "next") return g.next && g.status !== "done";
      if (ui.f === "upcoming") return g.date && g.date > t && g.status !== "done";
      if (ui.f === "owned") return g.owned && g.status !== "done";
      if (ui.f === "sale") return g.price && g.price.disc > 0 && g.status !== "done";
      if (ui.f === "remakes") return !!g.remake;
      return g.status === ui.f;
    });
    const by = {
      release: (a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.title.localeCompare(b.title),
      recent: (a, b) => (b.plays[b.plays.length - 1] || "").localeCompare(a.plays[a.plays.length - 1] || "") || (b.added || 0) - (a.added || 0),
      title: (a, b) => a.title.localeCompare(b.title), rating: (a, b) => (b.rating || 0) - (a.rating || 0) || (b.imdbR || 0) - (a.imdbR || 0),
      remake: (a, b) => ((a.remake && a.remake.date) || a.date || "9999").localeCompare((b.remake && b.remake.date) || b.date || "9999") || a.title.localeCompare(b.title),
      newest: (a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title),
      short: (a, b) => (a.hours || 999) - (b.hours || 999), price: (a, b) => ((a.price || {}).eur ?? 999) - ((b.price || {}).eur ?? 999) };
    return list.sort(by[ui.sort] || by.release);
  }

  function render(S) {
    const L = lib(), c = L.counts();
    if (ui.res || ui.busy) return renderSearch();
    if (!L.games.length) {
      return `<div class="empty2"><div class="kicker">Games</div><h2>Your games, all in one place</h2>
        <p>Search Steam to add a game, import your Steam library, HowLongToBeat, Grouvee or Backloggd, or let your IMDb ratings bring the games you've rated.</p>
        <div class="row wrap" style="justify-content:center"><button class="btn primary" data-action="gadd">${K.icon("plus")}Add a game</button>
        <button class="btn" data-action="go" data-sec="settings" data-scroll="importhub">${K.icon("upload")}Import</button></div></div>`;
    }
    const playing = L.nextUp(12);
    const f = [["all", "All", c.all], ["playing", "Playing", c.playing], ["paused", "Paused", c.paused], ["next", "Next", c.next], ["backlog", "Backlog", c.backlog], ["done", "Finished", c.done],
      ["wishlist", "Wishlist", c.wishlist], ["upcoming", "Upcoming", c.upcoming], ["owned", "Owned, to play", null], ["sale", "On sale", null], ["remakes", "Has a remake", null], ["dropped", "Dropped", c.dropped]];
    const list = ui.view === "grid" ? listFor() : [];
    return `${playing.length && ui.f === "all" && !ui.q ? `<section>${K.head("Playing and up next", "", playing.length)}${K.rail(playing.map(tileOf))}</section>` : ""}
      <div class="subnav">${[["grid", "Library"], ["mv", "Franchises"]].map(([k, l]) => `<button data-action="gview" data-v="${k}" ${ui.view === k ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</div>
      <div class="toolbar"><input type="search" data-gq="1" data-input="gq" value="${esc(ui.q)}" placeholder="Filter your games" autocomplete="off">
        ${ui.view === "grid" ? `<select data-gsort="1" aria-label="Sort">${[["release", "Release (oldest)"], ["newest", "Release (newest)"], ["remake", "Remake release"], ["recent", "Recently played"], ["title", "Title"], ["rating", "Rating"], ["short", "Shortest"], ["price", "Price"]].map(([k, l]) => `<option value="${k}" ${ui.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>` : ""}
        <button class="iconbtn" data-action="gadd" aria-label="Add a game">${K.icon("plus")}</button></div>
      ${ui.view === "grid" ? `<div class="chips" style="margin-bottom:14px">${f.map(([k, l, n]) => `<button class="chip" data-action="gfilter" data-v="${k}" aria-pressed="${ui.f === k}">${l}${n != null ? ` <span class="muted">${n}</span>` : ""}</button>`).join("")}</div>
        ${list.length ? K.grid(list.slice(0, ui.lim).map(tileOf)) : `<p class="muted">Nothing here.</p>`}
        ${list.length > ui.lim ? `<button class="btn block" style="margin-top:16px" data-action="gmore">Show more (${list.length - ui.lim})</button>` : ""}
        <p class="small muted" style="margin-top:16px">${c.all} games · ${c.done} finished · ${c.plays} playthroughs</p>` : renderMv()}`;
  }
  function renderMv() {
    const q = G.norm(ui.q);
    const mvs = lib().multiverses().filter(m => !q || G.norm(m.name).includes(q) || m.franchises.some(f => G.norm(f.name).includes(q)));
    return mvs.slice(0, 80).map(m => `<section>
      <div class="sechead"><h2>${esc(m.name)}</h2><span class="count">${m.done}/${m.total}</span></div>
      ${m.franchises.map(fr => `${m.franchises.length > 1 || fr.name !== m.name ? `<div class="small muted" style="margin:0 0 8px">${esc(fr.name)}</div>` : ""}${K.rail(fr.games.map(tileOf))}`).join('<div style="height:12px"></div>')}</section>`).join("") || `<p class="muted">Nothing matches.</p>`;
  }
  function renderSearch() {
    const lim = ui.res || [];
    return `<div class="toolbar"><input type="search" data-gsq="1" data-input="gsq" value="${esc(ui.sq || "")}" placeholder="Search Steam" autocomplete="off" enterkeyhint="search">
      <button class="btn primary" data-action="gsearch">${K.icon("missing")}</button></div>
      <div class="sechead"><h2>${ui.busy ? "Searching…" : `${lim.length} on Steam`}</h2><button class="btn quiet small" data-action="gsearchclose">Back</button></div>
      ${ui.busy ? "" : K.grid(lim.map((r, i) => { const have = lib().find(r); return `<div class="tile">${K.poster({ title: r.title, img: G.COVER(r.steam), kind: "game", badge: have ? "In your games" : "", attrs: `data-action="gpeek" data-i="${i}"` })}<div class="cap">${esc(r.title)}</div><div class="cap2">${r.price ? esc(eur(r.price.eur)) : ""}</div></div>`; }))}
      <button class="btn block" style="margin-top:16px" data-action="gmanual">${K.icon("plus")}Not on Steam? Add it by hand</button>`;
  }

  const hm = m => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
  function sheetHtml(g) {
    const t = today(), L = Saga.lang();
    const plays = g.plays.map((d, i) => `<div class="logrow"><span class="grow">${i + 1}. ${esc(K.when(d, L))}</span><button class="btn quiet small" data-action="gunplay" data-i="${i}" aria-label="Remove this playthrough">✕</button></div>`).join("");
    const facts = [["Release", g.date ? K.when(g.date, L) + (g.date > t ? " (upcoming)" : "") : g.dateText || "Not announced"], ["Platform", g.platform], ["Owned on", g.owned],
      ["Remake", g.remake ? [g.remake.title, g.remake.platform, g.remake.date ? K.when(g.remake.date, L) : ""].filter(Boolean).join(" · ") : ""],
      ["IMDb rating", g.imdbR ? `★ ${g.imdbR}` : ""], ["Time to beat", g.hours ? `${g.hours} h${g.hoursRemake ? ` (remake ${g.hoursRemake} h)` : ""}` : ""],
      ["Franchise", g.franchise], ["Multiverse", g.multiverse !== g.franchise ? g.multiverse : ""]].filter(x => x[1]);
    const pr = g.price;
    return `${K.sheetHero({ title: g.title, img: cover(g), kind: "game" }, `<div class="small muted">${esc([G.yearOf(g), g.platform, g.franchise].filter(Boolean).join(" · "))}</div>`)}
      <div class="seg2" style="grid-template-columns:repeat(3,1fr);margin:6px 0 12px">${G.STATUSES.map(s => `<button data-action="gst" data-v="${s}" aria-pressed="${g.status === s}">${G.LABEL[s]}</button>`).join("")}</div>
      <div class="row" style="margin-bottom:6px"><span class="small muted grow">Your rating</span>${K.stars(g.rating, "grate")}</div>
      <label class="switch"><input type="checkbox" data-gnext="1" ${g.next ? "checked" : ""}><span>Next up<small class="muted" style="display:block">Shows on Home and at the top of Games</small></span></label>
      <h4>Play sessions <span class="muted small">${(g.sessions || []).length ? `· ${hm(G.playedMins(g))} in ${g.sessions.length}` : ""}</span></h4>
      ${(g.sessions || []).slice(-4).reverse().map((x, j) => `<div class="logrow"><span class="grow">${esc(K.when(x.d, L))} · ${hm(x.mins)}${x.note ? ` · ${esc(x.note)}` : ""}</span><button class="btn quiet small" data-action="gunsess" data-i="${g.sessions.length - 1 - j}" aria-label="Remove this session">✕</button></div>`).join("")}
      <div class="row" style="margin:6px 0 4px;flex-wrap:wrap;gap:6px">${[[30, "+30 min"], [60, "+1 h"], [120, "+2 h"]].map(([m, l]) => `<button class="btn small" data-action="gsess" data-m="${m}">${l}</button>`).join("")}
        <input type="number" inputmode="decimal" step="0.25" min="0" id="gSessH" placeholder="hours" style="width:84px" aria-label="Hours played"><button class="btn small" data-action="gsess">Log</button></div>
      <p class="small muted" style="margin:0 0 12px">Sessions count as played today (or the date above) and show in the Diary.</p>
      <h4>Playthroughs <span class="muted small">${g.plays.length ? `· ${g.plays.length}×` : ""}</span></h4>
      ${plays || `<p class="small muted">Not finished yet.</p>`}
      <div class="row" style="margin:6px 0 12px"><input type="date" id="gDate" value="${t}" max="${t}" aria-label="Date"><button class="btn" data-action="gplay">${K.icon("plus")}${g.plays.length ? "Finished again" : "Finished"}</button></div>
      ${pr || g.steam ? `<h4>Price</h4><div class="nextbox"><div class="grow">${pr ? `<b>${esc(eur(pr.eur))}</b>${pr.disc ? ` <span class="pbadge">−${pr.disc}%</span> <s class="small muted">${esc(eur(pr.retail))}</s>` : ""}<div class="small muted">Steam Italy${pr.low != null && pr.low < pr.eur ? ` · lowest seen ${esc(eur(pr.low))}` : ""}</div>` : `<span class="small muted">No price yet: it's checked on the next sync.</span>`}</div></div>
        <label class="field"><span>Alert me at or below (€)</span><input type="number" inputmode="decimal" step="0.01" data-gtarget="1" value="${g.target != null ? g.target : ""}" placeholder="any big discount"></label>` : ""}
      <h4>Prices in other stores</h4>${storesHtml(g)}
      <h4>Details</h4><div class="listcard">${facts.map(([k, v]) => `<div class="row small" style="min-height:38px;border-bottom:1px solid var(--line)"><span class="muted" style="width:42%">${esc(k)}</span><span class="grow">${esc(v)}</span></div>`).join("")}</div>
      <label class="field" style="margin-top:12px"><span>Notes</span><textarea rows="2" data-gnotes="1" placeholder="Difficulty, mods, who you played with…">${esc(g.notes)}</textarea></label>
      <h4>Where to get it</h4>${G.storeLinks(g).map(([n, u]) => `<button class="sheetbtn" data-action="open" data-url="${esc(u)}">${K.icon("open")}${esc(n)}</button>`).join("")}
      <div style="margin-top:8px"><button class="sheetbtn" data-action="mlistadd" data-k="game:${esc(g.id)}">${K.icon("plus")}Add to a list</button><button class="sheetbtn" data-action="gsync1">${K.icon("sync")}Sync this game (Steam details, date, store prices)</button>
      <button class="sheetbtn" data-action="gedit">${K.icon("edit")}Edit details</button>
      ${g.steam ? "" : `<button class="sheetbtn" data-action="glink">${K.icon("sync")}Find on Steam (cover, price, date)</button>`}
      <button class="sheetbtn" data-action="gremove">${K.icon("notcanon")}Remove from your games</button></div>`;
  }
  function open(id) { const g = lib().get(id); if (!g) return; ui.open = id; Saga.sheet(sheetHtml(g), "gsheet", id); }
  function editHtml(g, isNew) {
    const f = (k, l, v, type) => `<label class="field"><span>${l}</span><input ${type ? `type="${type}"` : ""} id="ge_${k}" value="${esc(v == null ? "" : v)}"></label>`;
    return `<h3>${isNew ? "Add a game" : "Edit details"}</h3>${f("title", "Title", g.title)}${f("date", "Release date", g.date, "date")}${f("platform", "Platform", g.platform)}
      ${f("owned", "Owned on (leave empty if not)", g.owned)}${f("franchise", "Franchise", g.franchise)}${f("multiverse", "Multiverse", g.multiverse)}${f("hours", "Hours to beat", g.hours, "number")}
      ${f("cover", "Cover image link (optional)", g.cover)}<div class="row" style="margin-top:12px"><button class="btn quiet grow" data-action="close">Cancel</button><button class="btn primary grow" data-action="gsave" data-id="${esc(isNew ? "" : g.id)}">Save</button></div>`;
  }
  async function search() {
    const q = String(ui.sq || "").trim();
    if (q.length < 2) return K.toast("Type at least two letters");
    ui.busy = true; ui.res = []; Saga.render();
    try { ui.res = await G.steamSearch(Saga.http, q, lib().settings.region || "IT", Saga.lang() === "it" ? "italian" : "english"); }
    catch (e) { ui.res = []; K.toast(`Steam search failed: ${e.message}`); }
    ui.busy = false; Saga.render();
  }

  function act(a, el) {
    const L = lib(), g = ui.open ? L.get(ui.open) : null;
    const reopen = () => { save(); if (g) open(g.id); Saga.render(); };
    switch (a) {
      case "gopen": open(el.dataset.id); return true;
      case "gfilter": ui.f = el.dataset.v; ui.lim = 120; Saga.render(); return true;
      case "gview": ui.view = el.dataset.v; Saga.render(); return true;
      case "gmore": ui.lim += 120; Saga.render(); return true;
      case "gadd": ui.res = []; ui.sq = ""; Saga.render(); setTimeout(() => { const i = document.querySelector("[data-gsq]"); if (i) i.focus(); }, 30); return true;
      case "gsearch": { const i = document.querySelector("[data-gsq]"); ui.sq = i ? i.value : ui.sq; search(); return true; }
      case "gsearchclose": ui.res = null; ui.busy = false; Saga.render(); return true;
      case "gmanual": Saga.sheet(editHtml(G.blank({ title: ui.sq || "" }), true)); return true;
      case "gpeek": { const r = ui.res[+el.dataset.i]; if (!r) return true; const have = L.find(r); if (have) { open(have.id); return true; }
        Saga.sheet(`${K.sheetHero({ title: r.title, img: G.COVER(r.steam), kind: "game" }, `<div class="small muted">Steam${r.price ? " · " + esc(eur(r.price.eur)) : ""}</div>`)}
          <p class="small muted">Add to your games as</p>${["backlog", "playing", "done", "wishlist"].map(s => `<button class="sheetbtn" data-action="gaddas" data-i="${el.dataset.i}" data-v="${s}">${K.icon("plus")}${G.LABEL[s]}</button>`).join("")}`);
        return true; }
      case "gaddas": { const r = ui.res[+el.dataset.i]; if (!r) return true; const { game } = L.add(Object.assign({}, r, { owned: el.dataset.v === "wishlist" ? "" : "PC (Steam)", src: "steam" }), el.dataset.v); save(); K.toast(`Added ${game.title}`); Saga.close(); open(game.id); Saga.render(); refreshDate(game); return true; }
      case "gsave": {
        const v = k => (document.getElementById("ge_" + k) || {}).value || "";
        if (!v("title").trim()) { K.toast("The title is needed"); return true; }
        const data = { title: v("title").trim(), date: v("date"), platform: v("platform").trim(), owned: v("owned").trim(), franchise: v("franchise").trim(), multiverse: v("multiverse").trim() || v("franchise").trim(), hours: parseFloat(v("hours")) || null, cover: v("cover").trim() };
        let x;
        if (el.dataset.id) { x = L.get(el.dataset.id); Object.assign(x, data); } else x = L.add(Object.assign(data, { src: "added" }), "backlog").game;
        save(); Saga.close(); ui.res = null; open(x.id); Saga.render(); return true; }
    }
    if (!g) return false;
    switch (a) {
      case "gst": G.setStatus(g, el.dataset.v, (document.getElementById("gDate") || {}).value); reopen(); return true;
      case "gsess": { const h = document.getElementById("gSessH"), mins = el.dataset.m ? +el.dataset.m : Math.round((parseFloat(String(h && h.value || "").replace(",", ".")) || 0) * 60);
        if (!mins) { K.toast("Type the hours played"); return true; }
        G.logSession(g, mins, (document.getElementById("gDate") || {}).value || today()); reopen(); K.toast(`Logged ${hm(mins)}`); return true; }
      case "gunsess": { g.sessions.splice(+el.dataset.i, 1); reopen(); return true; }
      case "grate": { const v = +el.dataset.v * 2; g.rating = g.rating === v ? v - 1 : g.rating === v - 1 ? 0 : v; reopen(); return true; }
      case "gsync1": (async () => {
        K.toast(`Syncing ${g.title}…`); const said = [];
        try { if (!g.steam) { delete (L.meta.noSteam || {})[g.id]; const n = await G.linkSteam({ visible: () => [g], meta: L.meta, settings: L.settings }, Saga.http, 1, 0); said.push(n ? "linked to Steam" : "not found on Steam"); } } catch (e) { said.push("Steam: " + e.message); }
        await refreshDate(g);
        try { await G.storePrices(g, Saga.http, { itadKey: Saga.db.get("itad_key"), country: lib().settings.region || "IT" }); said.push(g.stores && g.stores.length ? `${g.stores.length} store prices` : "no store prices"); } catch (e) { said.push("Prices: " + e.message); }
        save(); if (ui.open === g.id) open(g.id); K.toast(`${g.title}: ${said.join("; ")}`);
      })(); return true;
      case "gstores": (async () => { K.toast("Checking stores…"); try { await G.storePrices(g, Saga.http, { itadKey: Saga.db.get("itad_key"), country: lib().settings.region || "IT" }); save(); if (ui.open === g.id) open(g.id); K.toast(g.stores.length ? `${g.stores.length} store prices` : "No store prices found"); } catch (e) { K.toast(e.message); } })(); return true;
      case "gplay": { const n = G.logPlay(g, (document.getElementById("gDate") || {}).value); K.toast(n > 1 ? `Finished ${n} times` : "Marked as finished"); reopen(); return true; }
      case "gunplay": G.removePlay(g, +el.dataset.i); reopen(); return true;
      case "gedit": Saga.sheet(editHtml(g)); return true;
      case "glink": (async () => { K.toast("Looking on Steam…"); delete (L.meta.noSteam || {})[g.id]; const n = await G.linkSteam({ visible: () => [g], meta: L.meta, settings: L.settings }, Saga.http, 1, 0); if (n) { await refreshDate(g); K.toast("Linked to Steam"); } else K.toast("Not found on Steam"); reopen(); })(); return true;
      case "gremove": if (el.dataset.sure) { const key = Object.keys(L.removed).length; L.remove(g.id); save(); Saga.close(); ui.open = null;
        K.toast(`Removed ${g.title}`, () => { if (!L.get(g.id)) L.games.push(g); for (const k of Object.keys(L.removed).slice(key)) delete L.removed[k]; save(); Saga.render(); K.toast("Undone"); }); Saga.render(); } else { el.dataset.sure = "1"; el.lastChild.textContent = "Tap again to remove"; } return true;
    }
    return false;
  }
  const money = (n, cur) => (n == null ? "" : n === 0 ? "Free" : cur === "USD" ? `$${(+n).toFixed(2)}` : eur(n));
  function storesHtml(g) {
    const when = g.storesAt ? new Date(g.storesAt).toLocaleDateString(Saga.lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short" }) : "";
    const rows = (g.stores || []).slice(0, 8).map(x => `<button class="sheetbtn" data-action="open" data-url="${esc(x.url)}"><span class="grow">${esc(x.shop)}</span><b>${esc(money(x.price, x.cur))}</b>${x.cut ? ` <span class="pbadge">−${x.cut}%</span>` : ""}</button>`).join("");
    return `${rows || (g.storesAt ? `<p class="small muted">${esc(g.storesSrc || "No store prices found")}.</p>` : "")}
      ${g.storesLow ? `<p class="small muted">Lowest ever: ${esc(money(g.storesLow.price, g.storesLow.cur))}</p>` : ""}
      <div class="row wrap"><button class="btn small" data-action="gstores">${K.icon("sync")}${g.storesAt ? "Check again" : "Compare stores"}</button>
      ${when ? `<span class="small muted">${esc(g.storesSrc || "")} · ${esc(when)}</span>` : `<span class="small muted">${Saga.db.get("itad_key") ? "IsThereAnyDeal, euro prices" : "CheapShark, US prices. Add an IsThereAnyDeal key in Settings for euro prices from more stores."}</span>`}</div>`;
  }
  async function refreshDate(g) { try { if (g.steam && await G.steamDates({ visible: () => [g], settings: lib().settings }, Saga.http, 1)) save(); } catch (e) { /* later */ } }
  function change(el) {
    const g = ui.open ? lib().get(ui.open) : null;
    if (el.dataset.gsort) { ui.sort = el.value; Saga.render(); return true; }
    if (el.dataset.gnotes && g) { g.notes = el.value.trim(); save(); return true; }
    if (el.dataset.gnext && g) { g.next = el.checked; save(); Saga.render(); return true; }
    if (el.dataset.gtarget && g) { const v = parseFloat(String(el.value).replace(",", ".")); g.target = isFinite(v) ? v : null; save(); return true; }
    return false;
  }
  function input(el) { if (el.dataset.gq) { ui.q = el.value; ui.lim = 120; return "grid"; } if (el.dataset.gsq) { ui.sq = el.value; } return false; }
  function enter(el) { if (el.dataset.gsq) { ui.sq = el.value; search(); return true; } return false; }
  K.mods.games = { title: "Games", render, act, change, input, enter, open, ui, posterOf, tileOf };
})();
