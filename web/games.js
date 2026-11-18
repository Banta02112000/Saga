/* Games, rebuilt on the same base as the rest of Saga. Your list lives in games.json (a real file, in the backup).
   GamesCore: the model, the one-time move from the old Games tab (its browser storage and its saved snapshot), Steam
   (search, linking for covers, prices and release dates, library import) and games from your IMDb ratings.
   The UI part registers itself in Kit.mods.games. GamesCore also runs in Node for the tests. */
(function (root) {
  "use strict";
  const STATUSES = ["playing", "paused", "backlog", "done", "wishlist", "dropped"];
  const LABEL = { playing: "Playing", paused: "Paused", backlog: "Backlog", done: "Finished", wishlist: "Wishlist", dropped: "Dropped" };
  const today = () => new Date().toISOString().slice(0, 10);
  const norm = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[™®©]/g, "").replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "");
  const NA = v => v == null || v === "" || /^(n\/?a|tba|tbd|-)$/i.test(String(v).trim());
  const num = v => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : null; };
  function isoOf(v) {
    if (NA(v)) return "";
    if (typeof v === "number") return new Date(v).toISOString().slice(0, 10);
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    if (/^\d{4}$/.test(s)) return s + "-12-31";
    const t = Date.parse(s.replace(/(\d+)(st|nd|rd|th)/, "$1"));
    return isNaN(t) ? "" : new Date(t + 12 * 36e5).toISOString().slice(0, 10);
  }
  const yearOf = g => (g.date ? +g.date.slice(0, 4) : (String(g.dateText || "").match(/(19|20)\d\d/) || [])[0] | 0 || null);
  let seq = 0;
  const newId = () => "g" + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

  function blank(o) {
    return Object.assign({ id: newId(), title: "", date: "", dateText: "", platform: "", franchise: "", multiverse: "", owned: "", remake: null,
      imdbR: null, hours: null, hoursRemake: null, status: "backlog", next: false, plays: [], rating: 0, notes: "", steam: null, imdb: null,
      hidden: false, added: Date.now(), src: "", price: null, target: null, cover: "", oldId: "", sessions: [] }, o || {});
  }
  // 0.5.8: play sessions ({ d: "YYYY-MM-DD", mins, note }); starting one moves a backlog game to Playing
  function logSession(g, mins, d, note = "") {
    mins = Math.round(+mins || 0);
    if (mins <= 0) return g;
    g.sessions = (g.sessions || []).concat([{ d: String(d || new Date().toISOString()).slice(0, 10), mins, note: String(note || "") }]).slice(-1000);
    if (g.status === "backlog" || g.status === "wishlist") g.status = "playing";
    return g;
  }
  const playedMins = g => (g.sessions || []).reduce((a, x) => a + (x.mins || 0), 0);
  // 0.5.9: everything the Stats view shows, from the games list
  function stats(lib, year = new Date().getFullYear()) {
    const gs = lib.visible(), by = st => gs.filter(g => g.status === st).length;
    const done = by("done"), playing = by("playing"), paused = by("paused"), backlog = by("backlog");
    const rated = gs.filter(g => g.rating > 0), avgOf = a => (a.length ? Math.round((a.reduce((x, g) => x + g.rating, 0) / a.length) * 10) / 10 : null);
    const hist = Array(10).fill(0); for (const g of rated) hist[Math.min(10, Math.max(1, Math.round(g.rating))) - 1]++;
    const group = key => { const m = new Map(); for (const g of gs) { const k = key(g); if (!k) continue; const o = m.get(k) || { k, n: 0, done: 0, rated: [], hours: 0 }; o.n++; if (g.status === "done") o.done++; if (g.rating > 0) o.rated.push(g); m.set(k, o); } return [...m.values()].map(o => Object.assign(o, { avg: avgOf(o.rated) })); };
    const sessMins = gs.reduce((a, g) => a + playedMins(g), 0), plays = gs.reduce((a, g) => a + (g.plays || []).length, 0);
    const beaten = gs.filter(g => g.status === "done" && g.hours);
    const months = Array(12).fill(0);
    for (const g of gs) for (const x of g.sessions || []) if (String(x.d).startsWith(String(year))) months[+String(x.d).slice(5, 7) - 1] += x.mins || 0;
    const ownedBacklog = gs.filter(g => g.owned && !NA(g.owned) && g.status === "backlog");
    const vsImdb = rated.filter(g => g.imdbR).map(g => g.rating - g.imdbR);
    return { total: gs.length, done, playing, paused, backlog, wishlist: by("wishlist"), dropped: by("dropped"),
      backlogDone: done + playing + paused + backlog ? Math.round((100 * done) / (done + playing + paused + backlog)) : 0,
      ownedUnplayed: ownedBacklog.length, backlogHours: Math.round(ownedBacklog.reduce((a, g) => a + (g.hours || 0), 0)),
      playedHours: Math.round(sessMins / 60), plays, avgBeat: beaten.length ? Math.round(beaten.reduce((a, g) => a + g.hours, 0) / beaten.length) : null,
      avg: avgOf(rated), rated: rated.length, hist, months,
      platforms: group(g => g.platform).sort((a, b) => b.n - a.n), franchises: group(g => g.franchise || g.multiverse).filter(o => o.n >= 2).sort((a, b) => b.done / b.n - a.done / a.n || b.n - a.n),
      decades: group(g => (/^\d{4}/.test(g.date || "") ? Math.floor(+g.date.slice(0, 4) / 10) * 10 + "s" : "")).sort((a, b) => a.k.localeCompare(b.k)),
      vsImdb: vsImdb.length ? Math.round((vsImdb.reduce((a, b) => a + b, 0) / vsImdb.length) * 10) / 10 : null,
      sale: gs.filter(g => g.status === "wishlist" && g.price && g.price.cut > 0).length,
      wishValue: Math.round(gs.filter(g => g.status === "wishlist" && g.price && g.price.now).reduce((a, g) => a + g.price.now, 0)) };
  }

  class Games {
    constructor(persist) {
      this.persist = persist || null;
      this.games = []; this.removed = {}; this.settings = { region: "IT", dropPct: 20 }; this.meta = {}; this.ver = 0;
      if (persist) { try { const t = persist.load(); if (t) this.fromJSON(JSON.parse(t)); } catch (e) { /* unreadable: start empty */ } }
    }
    fromJSON(j) { this.games = (j.games || []).map(blank); this.removed = j.removed || {}; this.settings = Object.assign(this.settings, j.settings || {}); this.meta = j.meta || {}; }
    toJSON() { return { app: "games", v: 1, games: this.games, removed: this.removed, settings: this.settings, meta: this.meta }; }
    save() { this.ver++; this._idx = null; this._fi = null; if (this.persist) { if (this.persist.saveLazy) this.persist.saveLazy(); else this.persist.save(JSON.stringify(this.toJSON())); } }
    get(id) { return this.games.find(g => g.id === id) || null; }
    // Look-ups go through maps (steam id, IMDb id, title), rebuilt whenever the list changed: a 1,000-game list
    // checked against a 10,000-title sync no longer scans every game for every row.
    _ix() {
      const gs = this.games;
      if (this._fi && this._fi.arr === gs && this._fi.len === gs.length) return this._fi;
      const s = new Map(), i = new Map(), t = new Map(), pos = new Map();
      const put = (m, k, g) => { if (!k) return; const a = m.get(k); if (a) a.push(g); else m.set(k, [g]); };
      gs.forEach((g, j) => { pos.set(g, j); put(s, g.steam, g); put(i, g.imdb, g); put(t, norm(g.title), g); });
      return (this._fi = { arr: gs, len: gs.length, s, i, t, pos });
    }
    find(o) {
      const n = norm(o.title), y = o.year || (o.date ? +o.date.slice(0, 4) : null);
      const ok = g => (o.steam && g.steam === o.steam) || (o.imdb && g.imdb === o.imdb) ||
        (norm(g.title) === n && n && (!y || !yearOf(g) || Math.abs(yearOf(g) - y) <= 1));
      const ix = this._ix();
      const cand = [...(o.steam ? ix.s.get(o.steam) || [] : []), ...(o.imdb ? ix.i.get(o.imdb) || [] : []), ...(n ? ix.t.get(n) || [] : [])];
      let best = null, bp = Infinity;
      for (const g of cand) { const p = ix.pos.get(g); if (p < bp && ok(g)) { best = g; bp = p; } }
      return best;
    }
    add(o, status) {
      const have = this.find(o);
      if (have) {
        for (const k of ["steam", "imdb", "date", "platform", "franchise", "multiverse", "cover", "hours", "imdbR"]) if (!have[k] && o[k]) {
          have[k] = o[k];
          if ((k === "steam" || k === "imdb") && this._fi) { const m = this._fi[k === "steam" ? "s" : "i"], a = m.get(o[k]); if (a) a.push(have); else m.set(o[k], [have]); }
        }
        if (status && rank(status) > rank(have.status)) setStatus(have, status);
        return { game: have, existed: true };
      }
      const g = blank(Object.assign({}, o, { id: newId(), added: Date.now() }));
      if (!g.franchise) g.franchise = franchiseGuess(g.title);
      if (!g.multiverse) g.multiverse = g.franchise;
      setStatus(g, status || o.status || "backlog");
      this.games.unshift(g);
      return { game: g, existed: false };
    }
    remove(id) { const g = this.get(id); if (g) this.removed[norm(g.title)] = 1; this.games = this.games.filter(x => x.id !== id); }
    visible() { return this.games.filter(g => !g.hidden); }
    counts() {
      const c = { all: 0, playing: 0, paused: 0, backlog: 0, done: 0, wishlist: 0, dropped: 0, next: 0, upcoming: 0, plays: 0 };
      const t = today();
      for (const g of this.visible()) { c.all++; c[g.status]++; if (g.next) c.next++; if (g.date && g.date > t) c.upcoming++; c.plays += g.plays.length; }
      return c;
    }
    // Multiverse → franchise → games, release order, with progress.
    // 0.6.9.6: order "date" (default): series by the original release date of their first game; "size": biggest first
    multiverses(order = "date") {
      const m = new Map();
      for (const g of this.visible()) {
        const mv = g.multiverse || g.franchise || "Other", fr = g.franchise || mv;
        if (!m.has(mv)) m.set(mv, { name: mv, franchises: new Map(), total: 0, done: 0 });
        const x = m.get(mv);
        if (!x.franchises.has(fr)) x.franchises.set(fr, []);
        x.franchises.get(fr).push(g); x.total++; if (g.status === "done") x.done++;
      }
      const first = gs => gs.reduce((d, g) => (g.date && g.date < d ? g.date : d), "9999");
      const out = [...m.values()].map(x => {
        const franchises = [...x.franchises.entries()].map(([name, gs]) => ({ name, games: gs.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")) }))
          .sort((a, b) => first(a.games).localeCompare(first(b.games)) || a.name.localeCompare(b.name));
        return { name: x.name, total: x.total, done: x.done, first: franchises.length ? first(franchises.flatMap(f => f.games)) : "9999", franchises };
      });
      return out.sort((a, b) => order === "size" ? b.total - a.total || a.name.localeCompare(b.name) : a.first.localeCompare(b.first) || a.name.localeCompare(b.name));
    }
    // 0.6.6: what you're playing, then the next game of each franchise you're going through (the first one, by release
    // date, after the last you finished or are playing: released, not finished or dropped), the franchises you played
    // most recently first, then games you marked Next, then a few short games you own.
    nextUp(limit = 10) {
      const t = today(), vis = this.visible(), why = this._why = new Map();
      const playing = vis.filter(g => g.status === "playing");
      const byF = new Map();
      for (const g of vis) { const f = norm(g.franchise); if (!f) continue; if (!byF.has(f)) byF.set(f, []); byF.get(f).push(g); }
      const fnext = [];
      for (const list of byF.values()) {
        if (list.length < 2) continue;
        list.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.title.localeCompare(b.title));
        let last = -1;
        list.forEach((g, i) => { if (g.status === "done" || g.status === "playing") last = i; });
        if (last < 0) continue;
        const nx = list.slice(last + 1).find(g => g.status !== "done" && g.status !== "dropped" && g.status !== "playing" && g.date && g.date <= t);
        if (!nx) continue;
        const prev = list[last], act = Math.max(...list.map(g => +new Date(g.plays[g.plays.length - 1] || 0) || 0), ...list.filter(g => g.status === "playing").map(() => Date.now()));
        why.set(nx.id, `After ${prev.title}`);
        fnext.push([act, nx]);
      }
      fnext.sort((a, b) => b[0] - a[0]);
      return playing
        .concat(fnext.map(x => x[1]))
        .concat(vis.filter(g => g.next && g.status !== "done" && g.status !== "playing"))
        .concat(vis.filter(g => g.status === "backlog" && g.owned && !NA(g.owned) && (!g.date || g.date <= t) && !g.next).sort((a, b) => (a.hours || 99) - (b.hours || 99)).slice(0, 4))
        .filter((g, i, a) => a.indexOf(g) === i).slice(0, limit);
    }
    // why a game is in nextUp() ("After Mega Man IV"), or ""
    whyNext(g) { return (this._why && this._why.get(g.id)) || ""; }
    upcoming(t = today()) { return this.visible().filter(g => g.date && g.date > t && g.status !== "done").sort((a, b) => a.date.localeCompare(b.date)); }
    recent(limit = 20) {
      const out = [];
      for (const g of this.visible()) g.plays.forEach((d, i) => d && out.push({ id: g.id, t: g.title, f: g.franchise, date: d, n: i + 1 }));
      return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
    }
  }
  const rank = s => ({ wishlist: 0, backlog: 1, dropped: 2, paused: 2, playing: 3, done: 4 }[s] || 0);
  function setStatus(g, st, date) {
    if (!STATUSES.includes(st)) return g;
    const prev = g.status;
    g.status = st;
    if (st === "done" && !g.plays.length) g.plays.push(isoOf(date) || today());
    if (st === "done") g.next = false;
    if ((st === "backlog" || st === "wishlist") && prev === "done") g.plays = [];
    return g;
  }
  function logPlay(g, date) { g.plays.push(isoOf(date) || today()); g.plays.sort(); if (g.status !== "done") { g.status = "done"; g.next = false; } return g.plays.length; }
  function removePlay(g, i) { g.plays.splice(i, 1); if (!g.plays.length && g.status === "done") g.status = "backlog"; }
  function franchiseGuess(t) {
    let s = String(t || "").split(/\s*[:–—]\s+|\s+-\s+/)[0];
    s = s.replace(/\s+(Remastered|Remake|HD|Deluxe|Edition|Definitive Edition|GOTY|Reloaded)$/i, "").replace(/\s+(\d+|[IVX]{1,4})$/i, "").trim();
    return s || String(t || "");
  }

  // ------------------------------------------------------------------ moving over from the old Games tab
  // ls: an object with the old tab's storage (gc_base, gc_done, gc_ov, gc_ex, gc_live, gc_acm), or a snapshot from
  // snap_games.json ({base, state:{…}} or the same keys). mine: the built-in list (own edition) when there's no base.
  function fromOld(ls, mine) {
    const P = k => { const v = ls["gc_" + k] != null ? ls["gc_" + k] : ls[k]; if (v == null) return null; if (typeof v !== "string") return v; try { return JSON.parse(v); } catch (e) { return null; } };
    const D = P("base") || mine || [];
    const done = P("done") || {}, ov = P("ov") || {}, ex = P("ex") || [], live = P("live") || {}, acm = P("acm") || {};
    // the old tab's ids: "title|date", with the platform added for duplicates
    const seen = new Set();
    const rows = [];
    for (const b of D) {
      let id = b.t + "|" + b.od;
      if (seen.has(id)) id += "#" + b.op;
      let k = 2; while (seen.has(id)) id = b.t + "|" + b.od + "#" + (k++);
      seen.add(id);
      rows.push([id, b, false]);
    }
    for (const b of ex) rows.push([b.id, b, true]);
    const out = [];
    for (const [id, b, custom] of rows) {
      const o = ov[id] || {}, lv = live[id] || {}, a = acm[id] || {};
      const v = k => (o[k] !== undefined ? o[k] : b[k]);
      const remake = !NA(v("rn")) ? { title: v("rn"), date: isoOf(lv.relRm || v("rd")), platform: NA(v("rp")) ? "" : v("rp") } : null;
      const g = blank({
        oldId: id, title: v("t"), date: isoOf(lv.rel || v("od")), dateText: NA(v("od")) ? "" : String(v("od")), platform: NA(v("op")) ? "" : v("op"),
        franchise: v("f") || "", multiverse: v("m") || v("f") || "", owned: NA(v("ow")) ? "" : v("ow"), remake: remake && (remake.title !== v("t") || remake.date !== isoOf(v("od"))) ? remake : null,
        imdbR: num(o.r) != null ? num(o.r) : lv.imdbR != null ? lv.imdbR : num(b.r), hours: num(o.h) != null ? num(o.h) : lv.hm != null ? lv.hm : num(b.h),
        hoursRemake: num(o.hb) != null ? num(o.hb) : lv.hb != null ? lv.hb : num(b.hb), notes: v("no") || "", hidden: !!(o.hid || v("hid")),
        next: !!(+v("n") > 0), steam: +lv.steam || null, imdb: lv.imdb || null, src: custom ? (b.src || "added") : "list",
        rating: a.ir != null ? Math.round(a.ir) : (o.myR != null ? Math.round(+o.myR) : (a.hs ? Math.round(a.hs / 10) : 0)),
        target: o.target != null ? +o.target : (o.tp != null ? +o.tp : null), added: b.addedTs || 0,
        price: lv.eur != null ? { eur: lv.eur, disc: lv.disc || 0, at: lv.priceTs || 0 } : null,
      });
      const plays = (o.plays || []).map(isoOf).filter(Boolean);
      if (done[id]) { g.status = "done"; g.plays = plays.length ? plays : [isoOf(done[id]) || today()]; g.next = false; }
      else if (plays.length) { g.status = "done"; g.plays = plays; }
      out.push(g);
    }
    return out;
  }
  // own edition, new phone: true when the old tab has data in this browser storage
  const hasOld = ls => !!(ls.gc_base || ls.gc_done || ls.gc_ex || ls.gc_ov);

  // ------------------------------------------------------------------ Steam
  const COVER = id => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`;
  const HEADER = id => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`;
  async function getJson(http, url) {
    const r = await http("GET", url, { headers: { Accept: "application/json" } });
    if (r.status !== 200) throw new Error(`Steam: HTTP ${r.status || r.error || "error"}`);
    try { return JSON.parse(r.body); } catch (e) { throw new Error("Steam sent something unreadable"); }
  }
  async function steamSearch(http, q, cc = "IT", lang = "english") {
    const j = await getJson(http, `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&cc=${cc}&l=${lang}`);
    return ((j && j.items) || []).map(x => ({ steam: x.id, title: x.name, platform: "PC", price: x.price && x.price.final != null ? { eur: x.price.final / 100, retail: (x.price.initial || x.price.final) / 100, disc: x.price.initial ? Math.round((1 - x.price.final / x.price.initial) * 100) : 0, at: Date.now() } : null }));
  }
  // 0.6.1: a game's DLC and developer from Steam (names of up to 12 DLC, one request each)
  async function steamExtras(http, appid, cc = "IT") {
    const j = await getJson(http, `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${cc}&l=english`);
    const d = j && j[appid] && j[appid].data;
    if (!d) throw new Error("Steam has no details for this game");
    const out = { dev: (d.developers || [])[0] || "", pub: (d.publishers || [])[0] || "", dlc: [] };
    for (const id of (d.dlc || []).slice(0, 12)) {
      try { const x = await getJson(http, `https://store.steampowered.com/api/appdetails?appids=${id}&cc=${cc}&l=english&filters=basic,release_date,price_overview`); const dd = x && x[id] && x[id].data;
        if (dd) out.dlc.push({ steam: id, title: dd.name, date: dd.release_date ? isoOf(dd.release_date.date) || "" : "", price: dd.price_overview ? { eur: dd.price_overview.final / 100, retail: dd.price_overview.initial / 100, disc: dd.price_overview.discount_percent || 0 } : null }); } catch (e) { /* skip one */ }
    }
    return out;
  }
  // games on any platform, from IMDb's search (Steam only has PC games): title, year, IMDb id, cover
  async function imdbGameSearch(http, q) {
    const r = await http("GET", `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(String(q).trim().toLowerCase())}.json?includeVideos=0`, { headers: { Accept: "application/json" } });
    if (r.status !== 200) throw new Error(`IMDb search: HTTP ${r.status || r.error || "error"}`);
    let j; try { j = JSON.parse(r.body); } catch (e) { throw new Error("IMDb search sent something unreadable"); }
    return ((j && j.d) || []).filter(x => x.qid === "videoGame" && /^tt\d+$/.test(x.id)).map(x => ({ imdb: x.id, title: x.l, date: x.y ? x.y + "-12-31" : "", dateText: x.y ? String(x.y) : "", cover: x.i && x.i.imageUrl ? x.i.imageUrl.replace(/\._V1_.*\.jpg$/, "._V1_UX300.jpg") : "", platform: "", src: "imdb" }));
  }
  // Finds the Steam app for games that have none yet (one search each, spaced out). Returns how many were linked.
  async function linkSteam(lib, http, budget = 12, gap = 1100, sleep = ms => new Promise(r => setTimeout(r, ms))) {
    const todo = lib.visible().filter(g => !g.steam && !(lib.meta.noSteam || {})[g.id] && (!g.platform || /pc|windows|steam|multi/i.test(g.platform + " " + g.owned) || g.status !== "done")).slice(0, budget);
    let linked = 0;
    lib.meta.noSteam = lib.meta.noSteam || {};
    for (const g of todo) {
      let hits = [];
      try { hits = await steamSearch(http, g.title, lib.settings.region || "IT"); } catch (e) { if (/HTTP 429|HTTP 403/.test(e.message)) break; continue; }
      const n = norm(g.title);
      const hit = hits.find(h => norm(h.title) === n) || hits.find(h => norm(h.title).startsWith(n) && norm(h.title).length - n.length <= 4);
      if (hit) { g.steam = hit.steam; if (hit.price) g.price = hit.price; linked++; } else lib.meta.noSteam[g.id] = Date.now();
      if (gap) await sleep(gap);
    }
    return linked;
  }
  // Prices for linked games you don't own yet, 50 per request. Returns games whose price dropped to an alert.
  async function steamPrices(lib, http, cc = "IT") {
    const ids = lib.visible().filter(g => g.steam && g.status !== "done" && (!g.owned || g.status === "wishlist")).map(g => g.steam);
    const alerts = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      let j;
      try { j = await getJson(http, `https://store.steampowered.com/api/appdetails?appids=${chunk.join(",")}&cc=${cc}&filters=price_overview`); } catch (e) { continue; }
      for (const id of chunk) {
        const po = j && j[id] && j[id].success && j[id].data && j[id].data.price_overview;
        if (!po) continue;
        for (const g of lib.games.filter(x => x.steam === id)) {
          const before = g.price ? g.price.eur : null;
          g.price = { eur: po.final / 100, retail: po.initial / 100, disc: po.discount_percent || 0, at: Date.now(), low: Math.min(po.final / 100, (g.price && g.price.low) || Infinity) };
          const hitTarget = g.target != null && g.price.eur <= g.target && (before == null || before > g.target);
          const bigSale = g.price.disc >= (lib.settings.dropPct || 20) && (before == null || g.price.eur < before - 0.009);
          if (hitTarget || bigSale) alerts.push({ g, why: hitTarget ? "target" : "sale" });
        }
      }
    }
    return alerts;
  }
  // ---- 0.6.6: more of IsThereAnyDeal (api.isthereanydeal.com): the ITAD id of each game, its best price in any store
  // with the all-time low (overview), subscriptions (Game Pass, PS Plus…), bundles, and your ITAD waitlist and collection.
  const ITAD = "https://api.isthereanydeal.com";
  const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
  async function itadCall(http, method, pth, { key, token, body } = {}) {
    const url = ITAD + pth + (key ? (pth.includes("?") ? "&" : "?") + "key=" + encodeURIComponent(key) : "");
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = "Bearer " + token;
    const r = await http(method, url, { headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (r.status === 401 || r.status === 403) throw new Error(token ? "IsThereAnyDeal sign-in expired: sign in again" : "IsThereAnyDeal refused the API key");
    if (r.status === 429) throw new Error("IsThereAnyDeal: too many requests, try again in a few minutes");
    if (r.status < 200 || r.status > 299) throw new Error(`IsThereAnyDeal: HTTP ${r.status || r.error || "network error"}`);
    if (!r.body) return null;
    try { return JSON.parse(r.body); } catch (e) { return null; }
  }
  // the games worth watching prices for: not finished or dropped
  const priceWatch = lib => lib.visible().filter(g => g.status !== "done" && g.status !== "dropped");
  // ITAD ids: Steam games by app id, the rest by title. Not found is remembered for 30 days.
  async function itadIds(lib, http, key, games = lib.visible(), now = Date.now()) {
    const todo = games.filter(g => !g.itad && !(g.itadMiss && now - g.itadMiss < 30 * 864e5));
    let found = 0;
    for (const part of chunks(todo.filter(g => g.steam), 200)) {
      const r = (await itadCall(http, "POST", "/lookup/id/shop/61/v1", { key, body: part.map(g => "app/" + g.steam) })) || {};
      for (const g of part) { const id = r["app/" + g.steam]; if (id) { g.itad = id; found++; } }
    }
    for (const part of chunks(todo.filter(g => !g.itad), 200)) {
      const r = (await itadCall(http, "POST", "/lookup/id/title/v1", { key, body: part.map(g => g.title) })) || {};
      for (const g of part) { const id = r[g.title]; if (id) { g.itad = id; found++; } else g.itadMiss = now; }
    }
    return found;
  }
  // best price now in any store and the all-time low, for the games you'd still buy or play; active bundles too
  async function itadOverview(lib, http, key, cc = "IT", now = Date.now()) {
    const games = priceWatch(lib).filter(g => g.itad), byId = new Map(games.map(g => [g.itad, g]));
    const bundles = new Map();
    for (const part of chunks(games.map(g => g.itad), 200)) {
      const r = (await itadCall(http, "POST", `/games/overview/v2?country=${cc}&vouchers=false`, { key, body: part })) || {};
      for (const p of r.prices || []) {
        const g = byId.get(p.id); if (!g) continue;
        const c = p.current, lo = p.lowest;
        g.deal = c ? { shop: (c.shop || {}).name || "?", price: (c.price || {}).amount, regular: (c.regular || {}).amount, cut: c.cut || 0, cur: (c.price || {}).currency || "EUR", url: c.url || "",
          low: lo ? { price: (lo.price || {}).amount, shop: (lo.shop || {}).name || "", at: String(lo.timestamp || "").slice(0, 10) } : null, bundled: p.bundled || 0, at: now } : null;
        if (g.deal) g.deal.atLow = !!(g.deal.low && g.deal.price != null && g.deal.price <= g.deal.low.price + 0.005);
      }
      for (const b of r.bundles || []) if (!bundles.has(b.id)) bundles.set(b.id, { id: b.id, title: b.title, url: b.url, expiry: b.expiry || null, shop: (b.page || {}).name || "",
        games: [].concat(...(b.tiers || []).map(t => (t.games || []).map(x => x.id))).filter(id => byId.has(id)) });
    }
    lib.meta.bundles = [...bundles.values()].filter(b => b.games.length);
    lib.meta.dealsAt = now;
    return games.filter(g => g.deal && g.deal.cut > 0).length;
  }
  // which subscriptions have the game (Game Pass, PS Plus, EA Play, Ubisoft+…), and if it's leaving
  async function itadSubs(lib, http, key, cc = "IT") {
    const games = priceWatch(lib).filter(g => g.itad), byId = new Map(games.map(g => [g.itad, g]));
    let n = 0;
    for (const g of games) g.subs = [];
    for (const part of chunks(games.map(g => g.itad), 200)) {
      const r = (await itadCall(http, "POST", `/games/subs/v1?country=${cc}`, { key, body: part })) || [];
      for (const x of r) { const g = byId.get(x.id); if (g && (x.subs || []).length) { g.subs = x.subs.map(s => ({ name: s.name, leaving: s.leaving ? String(s.leaving).slice(0, 10) : "" })); n++; } }
    }
    return n;
  }
  // every bundle (current, and past ones if asked) that had this game
  async function itadBundles(http, key, id, cc = "IT", expired = false) {
    const r = (await itadCall(http, "GET", `/games/bundles/v2?id=${encodeURIComponent(id)}&country=${cc}${expired ? "&expired=true" : ""}`, { key })) || [];
    return r.map(b => { const tier = (b.tiers || []).find(t => (t.games || []).some(x => x.id === id)) || {};
      return { title: b.title, shop: (b.page || {}).name || "", url: b.url, expiry: b.expiry ? String(b.expiry).slice(0, 10) : "", price: tier.price ? tier.price.amount : null, cur: tier.price ? tier.price.currency : "" }; });
  }
  // 0.6.6: your ITAD waitlist ↔ your Saga wishlist, and what you own → your ITAD collection. What was on both lists
  // at the last sync (lib.meta.itadWait) tells a removal on one side from an addition on the other.
  async function itadWaitSync(lib, http, token, opt = {}) {
    const wait = (await itadCall(http, "GET", "/waitlist/games/v1", { token })) || [];
    const there = new Map(wait.map(w => [w.id, w])), was = new Set(lib.meta.itadWait || []);
    const out = { added: 0, pushed: 0, removedHere: 0, removedThere: 0, owned: 0 };
    const byItad = new Map(lib.games.filter(g => g.itad).map(g => [g.itad, g]));
    const wishHere = lib.visible().filter(g => g.status === "wishlist" && g.itad);
    // removed on ITAD since last time: off the Saga wishlist (kept if you rated, played or wrote about it)
    for (const g of wishHere) if (was.has(g.itad) && !there.has(g.itad)) {
      if (!g.rating && !g.plays.length && !g.notes) { lib.remove(g.id); out.removedHere++; } else { g.status = "backlog"; }
    }
    // removed in Saga since last time (deleted or no longer on the wishlist): off the ITAD waitlist
    const gone = [...was].filter(id => there.has(id) && (!byItad.has(id) || byItad.get(id).status !== "wishlist" || byItad.get(id).hidden));
    if (gone.length) { await itadCall(http, "DELETE", "/waitlist/games/v1", { token, body: gone }); out.removedThere = gone.length; for (const id of gone) there.delete(id); }
    // new on ITAD: onto the Saga wishlist
    for (const [id, w] of there) if (!byItad.has(id) && !was.has(id)) {
      if (lib.removed[norm(w.title)]) continue;
      const r = lib.add({ title: w.title, src: "itad", itad: id }, "wishlist"); if (!r.existed) { r.game.itad = id; out.added++; } else if (!r.game.itad) r.game.itad = id;
    }
    // new on the Saga wishlist: onto the ITAD waitlist
    const push = lib.visible().filter(g => g.status === "wishlist" && g.itad && !there.has(g.itad)).map(g => g.itad);
    for (const part of chunks(push, 200)) await itadCall(http, "PUT", "/waitlist/games/v1", { token, body: part });
    out.pushed = push.length;
    // what you own or finished: into the ITAD collection (once each)
    const sent = new Set(lib.meta.itadColl || []);
    const own = lib.visible().filter(g => g.itad && !sent.has(g.itad) && (g.status === "done" || g.status === "playing" || (g.owned && !/^(no|n\/a)$/i.test(g.owned)))).map(g => g.itad);
    for (const part of chunks(own, 200)) await itadCall(http, "PUT", "/collection/games/v1", { token, body: part });
    out.owned = own.length;
    lib.meta.itadColl = [...sent, ...own];
    lib.meta.itadWait = lib.visible().filter(g => g.status === "wishlist" && g.itad).map(g => g.itad);
    lib.meta.itadWaitAt = Date.now(); lib._fi = null;
    return out;
  }
  // PKCE sign-in to IsThereAnyDeal (authorization code flow)
  const ITAD_AUTH = "https://isthereanydeal.com/oauth/authorize/", ITAD_TOKEN = "https://isthereanydeal.com/oauth/token/";
  const ITAD_SCOPES = "wait_read wait_write coll_read coll_write";
  const itadAuthUrl = (clientId, redirect, challenge, state) => `${ITAD_AUTH}?${["response_type=code", "client_id=" + encodeURIComponent(clientId), "redirect_uri=" + encodeURIComponent(redirect),
    "scope=" + encodeURIComponent(ITAD_SCOPES), "code_challenge=" + encodeURIComponent(challenge), "code_challenge_method=S256", "state=" + encodeURIComponent(state)].join("&")}`;
  async function itadToken(http, form) {
    const r = await http("POST", ITAD_TOKEN, { headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: Object.entries(form).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") });
    let j = null; try { j = JSON.parse(r.body || ""); } catch (e) { /* below */ }
    if (r.status !== 200 || !j || !j.access_token) throw new Error(`IsThereAnyDeal sign-in failed: ${(j && (j.error_description || j.error)) || "HTTP " + (r.status || r.error)}`);
    return { access: j.access_token, refresh: j.refresh_token || "", until: Date.now() + (j.expires_in || 3600) * 1000 };
  }
  // Prices across stores. IsThereAnyDeal (free key from isthereanydeal.com › Settings › API) gives euro prices from
  // Steam, GOG, Epic, Humble, Fanatical, GamesPlanet, GMG and many more, plus the all-time low. Without a key, CheapShark
  // (no key, US dollar prices, PC stores only). Saved on the game as g.stores, cheapest first.
  async function storePrices(g, http, opt = {}) {
    if (opt.itadKey) {
      const key = encodeURIComponent(opt.itadKey), cc = opt.country || "IT";
      const look = await getJson(http, `https://api.isthereanydeal.com/games/lookup/v1?key=${key}&${g.steam ? `appid=${g.steam}` : `title=${encodeURIComponent(g.title)}`}`);
      const id = look && look.found && look.game && look.game.id;
      if (!id) { g.stores = []; g.storesAt = Date.now(); g.storesSrc = "IsThereAnyDeal: not found"; return g.stores; }
      const r = await http("POST", `https://api.isthereanydeal.com/games/prices/v3?key=${key}&country=${cc}&nondeals=true&vouchers=false`, { headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify([id]) });
      if (r.status === 401 || r.status === 403) throw new Error("IsThereAnyDeal refused the API key");
      if (r.status !== 200) throw new Error(`IsThereAnyDeal: HTTP ${r.status || "network error"}`);
      const j = JSON.parse(r.body || "[]")[0] || {};
      g.stores = (j.deals || []).map(d => ({ shop: (d.shop || {}).name || "?", price: (d.price || {}).amount, regular: (d.regular || {}).amount, cut: d.cut || 0, cur: (d.price || {}).currency || "EUR", url: d.url || "" }))
        .filter(x => x.price != null).sort((a, b) => a.price - b.price);
      const low = j.historyLow && (j.historyLow.all || j.historyLow.y1);
      g.storesLow = low ? { price: low.amount, cur: low.currency } : null;
      g.storesSrc = "IsThereAnyDeal"; g.storesAt = Date.now();
      return g.stores;
    }
    const list = await getJson(http, g.steam ? `https://www.cheapshark.com/api/1.0/games?steamAppID=${g.steam}` : `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(g.title)}&limit=5&exact=0`);
    const hit = Array.isArray(list) ? (list.find(x => norm(x.external) === norm(g.title)) || list[0]) : null;
    if (!hit) { g.stores = []; g.storesAt = Date.now(); g.storesSrc = "CheapShark: not found"; return g.stores; }
    const [d, shops] = await Promise.all([getJson(http, `https://www.cheapshark.com/api/1.0/games?id=${hit.gameID}`), storeNames(http)]);
    g.stores = ((d && d.deals) || []).map(x => ({ shop: shops[x.storeID] || `Store ${x.storeID}`, price: +x.price, regular: +x.retailPrice, cut: Math.round(+x.savings || 0), cur: "USD", url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(x.dealID)}` }))
      .sort((a, b) => a.price - b.price);
    g.storesLow = d && d.cheapestPriceEver ? { price: +d.cheapestPriceEver.price, cur: "USD" } : null;
    g.storesSrc = "CheapShark (US prices)"; g.storesAt = Date.now();
    return g.stores;
  }
  let shopCache = null;
  async function storeNames(http) {
    if (shopCache) return shopCache;
    try { const a = await getJson(http, "https://www.cheapshark.com/api/1.0/stores"); shopCache = {}; for (const x of a || []) shopCache[x.storeID] = x.storeName; } catch (e) { shopCache = {}; }
    return shopCache;
  }
  // Release dates for upcoming or undated linked games (one request each, a few per run).
  async function steamDates(lib, http, budget = 8) {
    const t = today();
    const todo = lib.visible().filter(g => g.steam && (!g.date || g.date > t)).slice(0, budget);
    let n = 0;
    for (const g of todo) {
      try {
        const j = await getJson(http, `https://store.steampowered.com/api/appdetails?appids=${g.steam}&cc=${lib.settings.region || "IT"}&l=english`);
        const d = j && j[g.steam] && j[g.steam].data;
        if (!d || !d.release_date) continue;
        const iso = isoOf(d.release_date.date);
        if (iso && iso !== g.date) { g.date = iso; g.dateText = d.release_date.date; n++; }
        else if (!iso && d.release_date.coming_soon && d.release_date.date) g.dateText = d.release_date.date;
      } catch (e) { /* next run */ }
    }
    return n;
  }
  // Rows from imports (Steam library, HowLongToBeat, Grouvee, Backloggd, CSV): {title, platform, status, date, rating, hours, steam, owned}
  function importRows(lib, rows, kind) {
    let added = 0, updated = 0;
    for (const r of rows) {
      if (!r || !r.title || lib.removed[norm(r.title)]) continue;
      const st = { done: "done", playing: "playing", paused: "paused", backlog: "backlog", wishlist: "wishlist", dropped: "dropped" }[r.status] || "backlog";
      const { game, existed } = lib.add({ title: r.title, platform: r.platform || "", steam: r.steam || null, owned: r.owned || (st !== "wishlist" ? r.platform || "" : ""), src: kind }, st);
      if (existed) updated++; else added++;
      if (r.date && st === "done" && !game.plays.includes(r.date)) { game.plays = game.plays.filter(d => d !== today() || r.date === today()); game.plays.push(r.date); game.plays.sort(); }
      if (r.rating && !game.rating) game.rating = Math.round(r.rating);
      if (r.hours && !game.hours && !/steam/i.test(kind || "") && !/steam/i.test(r.src || "")) game.hours = r.hours; // time to beat (Steam gives time played: below)
      // 0.6.9.8: time played: Steam's minutes, your own times from HowLongToBeat
      if (r.mins > 0 && (/steam/i.test(kind || "") || /steam/i.test(r.src || ""))) game.steamMins = Math.max(game.steamMins || 0, r.mins);
      if (r.played > 0) { game.playedMins = Math.max(game.playedMins || 0, r.played); game.playedSrc = r.src || kind || ""; }
      if (r.owned && !game.owned) game.owned = r.owned;
    }
    return { added, updated };
  }
  // ---- 0.6.9: Steam's own numbers: minutes played, last played, achievements. A game you played in the last two
  // weeks that was on your backlog, wishlist or paused moves to Playing (never one you finished or dropped).
  function steamPlay(lib, rows, recent = [], now = Date.now()) {
    const bySteam = new Map(lib.games.filter(g => g.steam).map(g => [+g.steam, g]));
    let updated = 0; const moved = [];
    for (const r of rows || []) { const g = bySteam.get(+r.steam); if (!g) continue;
      if (r.mins != null && g.steamMins !== r.mins) { g.steamMins = r.mins; updated++; }
      if (r.last) g.steamLast = r.last; }
    for (const r of recent || []) { const g = bySteam.get(+r.steam); if (!g) continue;
      g.steam2w = r.mins2w; if (r.mins) g.steamMins = r.mins;
      if (r.mins2w >= 20 && (g.status === "backlog" || g.status === "wishlist" || g.status === "paused")) { setStatus(g, "playing"); moved.push(g.title); }
    }
    lib.meta.steamAt = now;
    return { updated, moved };
  }
  // ---- 0.6.9: your backlog in hours (How Long To Beat), the pace you finish games at, and what to finish next
  function backlogHours(lib, now = Date.now()) {
    const vis = lib.visible(), t = new Date(now).toISOString().slice(0, 10), yearAgo = new Date(now - 365 * 864e5).toISOString().slice(0, 10);
    const left = vis.filter(g => g.status === "backlog" || g.status === "playing" || g.status === "paused");
    const withH = left.filter(g => g.hours > 0), hours = Math.round(withH.reduce((a, g) => a + g.hours, 0));
    const doneYear = vis.filter(g => g.status === "done" && g.plays.some(d => d >= yearAgo));
    const paceH = Math.round(doneYear.reduce((a, g) => a + (g.hours || 0), 0)); // hours of games finished in the last 12 months
    const years = paceH > 0 ? hours / paceH : null;
    // finish next: owned, released, short, preferring franchises you've started
    const started = new Set(vis.filter(g => (g.status === "done" || g.status === "playing") && g.franchise).map(g => norm(g.franchise)));
    const owned = g => g.owned && !NA(g.owned) && !/^no$/i.test(g.owned);
    const quick = left.filter(g => g.status !== "playing" && owned(g) && g.hours > 0 && (!g.date || g.date <= t))
      .sort((a, b) => (started.has(norm(b.franchise)) - started.has(norm(a.franchise))) || a.hours - b.hours).slice(0, 8);
    return { games: left.length, known: withH.length, hours, paceH, doneYear: doneYear.length, years, quick, started };
  }
  // ---- 0.6.9: the same game twice. Same Steam app or ITAD id, or the same title (ignoring "The", punctuation and
  // accents) on the same platform (or one without a platform) within a year: the same game on two consoles is not a
  // duplicate. `skip` holds pairs you said aren't the same.
  const GRANK = { wishlist: 0, backlog: 1, paused: 2, dropped: 2, playing: 3, done: 4 };
  function findDuplicates(lib, skip = {}) {
    const vis = lib.visible(), seen = new Set(), out = [];
    const pair = (a, b, why) => { const k = [a.id, b.id].sort().join("|"); if (seen.has(k) || skip[k]) return; seen.add(k); out.push({ a, b, why }); };
    const by = new Map(), put = (k, g) => { if (!k) return; const x = by.get(k); if (x) x.push(g); else by.set(k, [g]); };
    const tkey = t => norm(t).replace(/^the\s+/, "").replace(/\s+/g, "");
    for (const g of vis) { put(g.steam && "s:" + g.steam, g); put(g.itad && "d:" + g.itad, g); put("n:" + tkey(g.title), g); }
    for (const [k, list] of by) {
      if (list.length < 2) continue;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (k[0] === "n") {
          if (a.platform && b.platform && norm(a.platform) !== norm(b.platform)) continue;
          const ya = yearOf(a), yb = yearOf(b); if (ya && yb && Math.abs(ya - yb) > 1) continue;
          if (a.steam && b.steam && a.steam !== b.steam) continue;
          pair(a, b, "same title");
        } else pair(a, b, k[0] === "s" ? "same Steam game" : "same IsThereAnyDeal game");
      }
    }
    return out;
  }
  const gweight = g => (g.rating ? 4 : 0) + g.plays.length * 2 + (g.notes ? 2 : 0) + (GRANK[g.status] || 0) + (g.steam ? 1 : 0) + (g.owned ? 1 : 0) + (g.hours ? 1 : 0);
  // ---- 0.6.9.8: time played, from every source that has it (the biggest one counts, as they cover the same hours)
  function timePlayed(g) {
    const sess = (g.sessions || []).reduce((a, s) => a + (+s.mins || +s.m || 0), 0);
    const parts = [["Steam", g.steamMins || 0], [g.playedSrc || "HowLongToBeat", g.playedMins || 0], ["your sessions", sess]].filter(p => p[1] > 0);
    return { mins: parts.reduce((a, p) => Math.max(a, p[1]), 0), parts };
  }
  const hrs = m => (m >= 120 ? `${Math.round(m / 60)} h` : m >= 60 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m)} min`);
  // where a game came from, and what it's linked to
  const SRC = { list: "your games list (spreadsheet)", imdb: "IMDb", canon: "canon (Games › Missing)", itad: "IsThereAnyDeal waitlist", added: "added by you", steam: "Steam", "steam library": "Steam", howlongtobeat: "HowLongToBeat", grouvee: "Grouvee", backloggd: "Backloggd", gamecheck: "GameCheck", "": "" };
  function sourceOf(g) {
    const from = SRC[String(g.src || "").toLowerCase()] != null ? SRC[String(g.src || "").toLowerCase()] : String(g.src || "");
    const linked = [g.imdb ? "IMDb" : "", g.steam ? "Steam" : "", g.itad ? "IsThereAnyDeal" : "", g.aiAt ? "details from AI" : "", g.steamMins ? "Steam playtime" : "", g.playedMins ? `${g.playedSrc || "HowLongToBeat"} playtime` : ""].filter(Boolean);
    return { from: from || "added before Saga kept track", linked: [...new Set(linked)].filter(x => x !== from) };
  }
  // ---- 0.6.9.7: game details from an AI, with your rules (the same questions your games list answers)
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  // "January 1, 1900" (also "Jan 1 1900", "1 January 1900", "January 1900", "1900", ISO) → "1900-01-01" / "1900-01" / "1900"
  function wordDate(v) {
    const t = String(v == null ? "" : v).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1");
    if (!t || /^(n\/?a|none|no|-|—|unknown|tba|tbd)$/.test(t)) return "";
    let m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(t); if (m) return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
    const mon = w => MONTHS.findIndex(x => x.startsWith(w.slice(0, 3))) + 1, p = n => String(n).padStart(2, "0");
    m = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t); if (m && mon(m[1])) return `${m[3]}-${p(mon(m[1]))}-${p(m[2])}`;
    m = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/.exec(t); if (m && mon(m[2])) return `${m[3]}-${p(mon(m[2]))}-${p(m[1])}`;
    m = /^([a-z]+)\.?,?\s+(\d{4})$/.exec(t); if (m && mon(m[1])) return `${m[2]}-${p(mon(m[1]))}`;
    m = /^(\d{4})$/.exec(t); if (m) return m[1];
    return "";
  }
  // "1900-01-01" → "January 1, 1900"
  const longDate = d => { const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(d || "")); if (!m) return String(d || ""); const mo = m[2] ? MONTHS[+m[2] - 1] : ""; const M = mo ? mo[0].toUpperCase() + mo.slice(1) : ""; return m[3] ? `${M} ${+m[3]}, ${m[1]}` : M ? `${M} ${m[1]}` : m[1]; };
  function infoPrompt(titles) {
    return `Tell me, for each game below: game Title, OG Release Date, OG best Platform, Remake Name (a remake, re-release or remaster), Remake Release Date, Remake best Platform, HLTB (How Long To Beat, main story, hours).
Rules:
- Dates: month in letters, day in number and year (January 1, 1900). The first release anywhere.
- A remake, re-release or remaster counts only if it covers the same story. If there is none, leave the three Remake fields empty.
- "Best platform": where the game plays best (for the original, among the platforms it first came out on).
- If you don't know a value, leave it empty. Don't guess.
Answer only with a JSON array, one object per game, in this order, with exactly these keys:
[{"title":"","og_date":"","og_platform":"","remake_name":"","remake_date":"","remake_platform":"","hltb":0}]
Games:
${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
  }
  function parseInfo(text) {
    const s = String(text || ""), a = s.indexOf("["), b = s.lastIndexOf("]");
    if (a < 0 || b < a) throw new Error("the answer has no list of games in it");
    let arr; try { arr = JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error("the answer isn't readable (not JSON)"); }
    const str = v => (v == null ? "" : String(v).trim()).replace(/^(n\/?a|none|-|—)$/i, "");
    return (Array.isArray(arr) ? arr : []).filter(x => x && x.title).map(x => ({ title: str(x.title), date: wordDate(x.og_date), platform: str(x.og_platform),
      remake: str(x.remake_name) ? { title: str(x.remake_name), date: wordDate(x.remake_date), platform: str(x.remake_platform) } : null,
      hours: parseFloat(String(x.hltb || "").replace(",", ".")) > 0 ? Math.round(parseFloat(String(x.hltb).replace(",", ".")) * 10) / 10 : null }));
  }
  // the answers into your games: only what's empty is filled (your list and your own edits win); a remake that's
  // already there is kept. Returns what changed.
  function applyInfo(lib, games, rows) {
    let filled = 0, same = 0;
    const touched = [];
    games.forEach((g, i) => {
      const r = rows.find(x => norm(x.title) === norm(g.title)) || rows[i];
      if (!r) return;
      let ch = false;
      if (!g.date && r.date) { g.date = r.date.length === 4 ? r.date : r.date; g.dateText = ""; ch = true; }
      if (!g.platform && r.platform) { g.platform = r.platform; ch = true; }
      if (!(g.remake && g.remake.title) && r.remake && norm(r.remake.title) !== norm(g.title)) { g.remake = r.remake; ch = true; }
      else if (g.remake && r.remake && norm(g.remake.title) === norm(r.remake.title)) { if (!g.remake.date && r.remake.date) { g.remake.date = r.remake.date; ch = true; } if (!g.remake.platform && r.remake.platform) { g.remake.platform = r.remake.platform; ch = true; } }
      if (g.hours == null && r.hours) { g.hours = r.hours; ch = true; }
      g.aiAt = Date.now();
      if (ch) { filled++; touched.push(g.title); } else same++;
    });
    lib._fi = null;
    return { filled, same, touched };
  }
  // 0.6.9.6: you say `rem` is a remake of `base`: one game with its remake (title, date, platform, its hours as the
  // remake's), your status, rating, plays, sessions and notes from both. The original's title and date stay.
  function linkRemake(lib, base, rem) {
    if (!base || !rem || base === rem) return base;
    base.remake = { title: rem.title, date: rem.date || "", platform: rem.platform || "" };
    if (rem.hours != null && base.hoursRemake == null) base.hoursRemake = rem.hours;
    if ((GRANK[rem.status] || 0) > (GRANK[base.status] || 0)) base.status = rem.status;
    if (!base.rating && rem.rating) base.rating = rem.rating;
    base.plays = [...new Set((base.plays || []).concat(rem.plays || []))].sort();
    base.sessions = (base.sessions || []).concat(rem.sessions || []);
    if (rem.notes && !String(base.notes || "").includes(rem.notes)) base.notes = base.notes ? `${base.notes}\n${rem.notes}` : rem.notes;
    for (const f of ["steam", "itad", "owned", "franchise", "multiverse", "dev", "price", "deal", "subs", "cover"]) if ((base[f] === null || base[f] === undefined || base[f] === "") && rem[f] != null && rem[f] !== "") base[f] = rem[f];
    base.next = base.next || rem.next;
    lib.games = lib.games.filter(g => g !== rem); lib._fi = null;
    return base;
  }
  // the same game entered twice, by your say-so: this one stays, the other's progress comes in
  function mergeInto(lib, keep, drop) {
    if (!keep || !drop || keep === drop) return keep;
    const t = keep.title, d = keep.date, p = keep.platform;
    const out = mergeGames(lib, keep, drop);
    if (out !== keep) { // mergeGames keeps the busier one: put this one's identity back and move the rest over
      Object.assign(keep, Object.assign({}, out, { id: keep.id, title: t, date: d || out.date, platform: p || out.platform }));
      lib.games = lib.games.filter(g => g !== out); if (!lib.games.includes(keep)) lib.games.push(keep); lib._fi = null;
    }
    return keep;
  }
  function mergeGames(lib, a, b) {
    const [keep, drop] = gweight(a) > gweight(b) || (gweight(a) === gweight(b) && (a.added || 0) <= (b.added || 0)) ? [a, b] : [b, a];
    if ((GRANK[drop.status] || 0) > (GRANK[keep.status] || 0)) keep.status = drop.status;
    if (!keep.rating && drop.rating) keep.rating = drop.rating;
    keep.plays = [...new Set(keep.plays.concat(drop.plays))].sort();
    if (drop.notes && !String(keep.notes || "").includes(drop.notes)) keep.notes = keep.notes ? `${keep.notes}\n${drop.notes}` : drop.notes;
    for (const f of ["steam", "itad", "imdb", "date", "platform", "owned", "hours", "hoursRemake", "imdbR", "franchise", "multiverse", "remake", "dev", "price", "deal", "subs"]) if ((keep[f] === null || keep[f] === undefined || keep[f] === "") && drop[f] != null && drop[f] !== "") keep[f] = drop[f];
    keep.next = keep.next || drop.next;
    keep.sessions = (keep.sessions || []).concat(drop.sessions || []);
    lib.games = lib.games.filter(g => g !== drop); lib._fi = null;
    return keep;
  }
  // ---- 0.6.4: a games spreadsheet (.xlsx, or the same columns as .csv), like the All_Games list:
  // Title, OG Release Date, OG Platform, Remake Name, Remake Release Date, Remake Platform, Owned Platform, HLTB,
  // HLTB Bundle, Rating (IMDb), Franchise, Multiverse, Next. Optional: Status, My rating, Notes.
  const XML_ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const unxml = t => String(t || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : XML_ENT[e.toLowerCase()]);
  const colIdx = ref => { const m = /^([A-Z]+)/.exec(ref || ""); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  // zip: { "xl/worksheets/sheet1.xml": text, "xl/sharedStrings.xml": text, ... } (what the file picker gives for an .xlsx)
  function readXlsx(zip) {
    const names = Object.keys(zip || {});
    const sheetName = names.filter(n => /(^|\/)xl\/worksheets\/sheet\d+\.xml$/i.test(n)).sort((a, b) => (+a.match(/(\d+)\.xml$/i)[1]) - (+b.match(/(\d+)\.xml$/i)[1]))[0];
    if (!sheetName) throw new Error("not an Excel file (no sheet inside)");
    const ssName = names.find(n => /(^|\/)xl\/sharedStrings\.xml$/i.test(n));
    const shared = [];
    if (ssName) for (const m of zip[ssName].matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unxml([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => x[1]).join("")));
    const rows = [];
    for (const rm of zip[sheetName].matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = cm[1], body = cm[2] || "", ref = (at.match(/\br="([A-Z]+\d+)"/) || [])[1], t = (at.match(/\bt="(\w+)"/) || [])[1] || "n";
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = null;
        if (t === "s") val = v != null ? shared[+v] : null;
        else if (t === "inlineStr") val = unxml([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(""));
        else if (t === "str" || t === "e") val = v != null ? unxml(v) : null;
        else if (t === "b") val = v === "1";
        else val = v != null && v !== "" ? +v : null;
        const i = ref ? colIdx(ref) : row.length;
        if (i >= 0) row[i] = val;
      }
      rows.push(Array.from(row, x => (x === undefined ? null : x)));
    }
    return rows;
  }
  // a spreadsheet day number (days since 1899-12-30) or a text date → "YYYY-MM-DD"
  const sheetDate = v => {
    if (v == null || v === "") return "";
    if (typeof v === "number" && v > 59 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
    return isoOf(v);
  };
  const HEAD = { title: /^(title|name|game)$/, date: /^(og )?release( date)?$|^(og )?date$|^released$/, platform: /^(og )?platform$/, rn: /^remake( name)?$/, rd: /^remake( release)? date$/,
    rp: /^remake platform$/, owned: /^owned( platform)?$|^owned on$/, hours: /^(hltb|hours|how long to beat|time to beat)$/, hb: /^hltb (bundle|remake)$|^remake hours$/,
    imdbR: /^(rating|imdb( rating)?|imdb score|score)$/, franchise: /^franchise$|^series$/, multiverse: /^multiverse|universe$/, next: /^next$/, status: /^status$/,
    my: /^my rating$|^your rating$/, notes: /^notes?$/, plays: /^finished( dates?)?$|^completion dates?$/ };
  // rows (arrays, first row with "Title" is the header) → your games. A row matches a game you have by title,
  // release date and platform (two releases of the same game on different consoles stay apart); the list's own
  // columns are updated, your status, rating, plays and notes are kept. Returns counts.
  function fromSheet(lib, rows) {
    const hi = rows.findIndex(r => (r || []).some(c => /^(title|name|game)$/i.test(String(c == null ? "" : c).trim())));
    if (hi < 0) throw new Error("no Title column");
    const col = {};
    (rows[hi] || []).forEach((h, i) => { const k = String(h == null ? "" : h).trim().toLowerCase().replace(/\s+/g, " "); for (const [f, re] of Object.entries(HEAD)) if (col[f] === undefined && re.test(k)) col[f] = i; });
    const get = (r, f) => (col[f] === undefined ? null : r[col[f]]);
    const txt = (r, f) => { const v = get(r, f); return NA(v) ? "" : String(v).trim(); };
    const key = (t, d, p) => `${norm(t)}|${d}|${norm(p)}`;
    const exact = new Map(), byTd = new Map(), byT = new Map(), claimed = new Set();
    const put = (m, k, g) => { const a = m.get(k); if (a) a.push(g); else m.set(k, [g]); };
    for (const g of lib.games) { exact.set(key(g.title, g.date, g.platform), g); put(byTd, `${norm(g.title)}|${g.date}`, g); put(byT, norm(g.title), g); }
    const ST = { done: "done", finished: "done", completed: "done", beaten: "done", playing: "playing", paused: "paused", "on hold": "paused", backlog: "backlog", wishlist: "wishlist", dropped: "dropped", abandoned: "dropped" };
    let added = 0, updated = 0, skipped = 0, same = 0;
    for (const r of rows.slice(hi + 1)) {
      const title = txt(r || [], "title");
      if (!title) continue;
      if (lib.removed[norm(title)]) { skipped++; continue; }
      const od = get(r, "date"), date = sheetDate(od), platform = txt(r, "platform");
      const rn = txt(r, "rn"), rd = sheetDate(get(r, "rd")), rp = txt(r, "rp");
      const fields = {
        title, date, dateText: date ? "" : (NA(od) ? "" : String(od)), platform,
        remake: rn && (rn !== title || (rd && rd !== date)) ? { title: rn, date: rd, platform: rp } : null,
        owned: txt(r, "owned"), hours: NA(get(r, "hours")) ? null : num(get(r, "hours")), hoursRemake: NA(get(r, "hb")) ? null : num(get(r, "hb")),
        imdbR: NA(get(r, "imdbR")) ? null : num(get(r, "imdbR")), franchise: txt(r, "franchise"), multiverse: txt(r, "multiverse") || txt(r, "franchise"),
        next: col.next !== undefined ? /^(x|y|yes|true|1|✓|✔)$/i.test(txt(r, "next")) : undefined,
      };
      let g = exact.get(key(title, date, platform));
      if (g && claimed.has(g)) g = null;
      if (!g) g = (byTd.get(`${norm(title)}|${date}`) || []).find(x => !claimed.has(x) && (!x.platform || !platform || norm(x.platform) === norm(platform))) || null;
      if (!g) { const y = date ? +date.slice(0, 4) : null; // the same title a year either side (a date fixed in the list)
        g = (byT.get(norm(title)) || []).find(x => !claimed.has(x) && (!y || !yearOf(x) || Math.abs(yearOf(x) - y) <= 1) && (!x.platform || !platform || norm(x.platform) === norm(platform))) || null; }
      if (g) {
        let changed = false;
        for (const [k, v] of Object.entries(fields)) {
          if (v === undefined || k === "title") continue;
          if (k === "franchise" || k === "multiverse") { if (!v) continue; }
          if (JSON.stringify(g[k]) !== JSON.stringify(v)) { g[k] = v; changed = true; }
        }
        const my = num(get(r, "my")); if (my && !g.rating) { g.rating = Math.round(my); changed = true; }
        if (txt(r, "notes") && !g.notes) { g.notes = txt(r, "notes"); changed = true; }
        if (changed) updated++; else same++;
      } else {
        g = blank(Object.assign({}, fields, { next: !!fields.next, src: "list", added: Date.now() }));
        if (!g.franchise) g.franchise = franchiseGuess(g.title);
        if (!g.multiverse) g.multiverse = g.franchise;
        setStatus(g, ST[txt(r, "status").toLowerCase()] || "backlog");
        if (g.status === "done") g.plays = []; // finished, but the list doesn't say when: no made-up play date
        const pd = txt(r, "plays").split(/[\s,;]+/).map(isoOf).filter(Boolean);
        if (pd.length) { g.plays = pd.sort(); if (g.status !== "done") g.status = "done"; }
        const my = num(get(r, "my")); if (my) g.rating = Math.round(my);
        if (txt(r, "notes")) g.notes = txt(r, "notes");
        lib.games.push(g);
        added++;
      }
      claimed.add(g);
    }
    lib._fi = null;
    return { added, updated, same, skipped, rows: added + updated + same + skipped };
  }
  // Video games from your IMDb ratings and lists (the Watch sync reads them): rated = finished, listed = wishlist.
  function fromImdb(lib, rows) {
    let added = 0, rated = 0, matched = 0, promoted = 0;
    for (const r of rows) {
      if (r.medium !== "Video Game" || !r.title) continue;
      if (lib.removed[norm(r.title)]) continue;
      const isRated = +r.rating > 0; // 0.6.9.1: only a rating means played; a listed game goes to the wishlist
      const before = lib.find({ title: r.title, imdb: r.imdb, year: r.year });
      if (before) before._st = before.status;
      if (!before && !isRated && lib.settings.imdbLists === "0") continue;
      const { game, existed } = lib.add({ title: r.title, imdb: r.imdb || null, date: r.date || (r.year ? r.year + "-12-31" : ""), dateText: r.year ? String(r.year) : "", src: "imdb" }, isRated ? "done" : "wishlist");
      if (!game.imdb && r.imdb) game.imdb = r.imdb;
      if (r.rating && !game.rating) { game.rating = +r.rating; rated++; }
      // 0.5.9: rated or watched on IMDb means played: a game still on the backlog or wishlist moves to Finished
      if (existed && isRated && before && (before._st === "backlog" || before._st === "wishlist")) { if (game.status !== "done") setStatus(game, "done", String(r.rated_at || r.date || "").slice(0, 10) || undefined); promoted++; }
      if (before) delete before._st;
      if (!existed) added++; else matched++;
    }
    return { added, rated, matched, promoted };
  }
  function storeLinks(g) {
    const q = encodeURIComponent(g.title);
    return [g.steam ? ["Steam", `https://store.steampowered.com/app/${g.steam}/`] : ["Steam", `https://store.steampowered.com/search/?term=${q}`],
      ["GOG", `https://www.gog.com/en/games?query=${q}`], ["Epic Games Store", `https://store.epicgames.com/it/browse?q=${q}`],
      ["Compare prices (GG.deals)", `https://gg.deals/search/?title=${q}`], ["PlayStation Store", `https://store.playstation.com/it-it/search/${q}`],
      ["Nintendo eShop", `https://www.nintendo.com/it-it/Cerca/Cerca-299117.html?q=${q}`], ["Xbox / Game Pass", `https://www.xbox.com/it-IT/search/results/games?q=${q}`],
      ["HowLongToBeat", `https://howlongtobeat.com/?q=${q}`], ["IMDb", g.imdb ? `https://www.imdb.com/title/${g.imdb}/` : `https://www.imdb.com/find/?q=${q}&s=tt&ttype=vg`]];
  }
  function indexFor(lib) {
    const t = today();
    return { ts: Date.now(), next: lib.nextUp(8).map(g => ({ id: g.id, t: g.title, f: g.franchise, date: g.date })), recent: lib.recent(20),
      upcoming: lib.upcoming(t).slice(0, 60).map(g => ({ id: g.id, t: g.title, date: g.date, f: g.franchise })),
      games: lib.visible().map(g => ({ id: g.id, t: g.title, f: g.franchise, m: g.multiverse, done: g.status === "done", date: g.date })) };
  }

  const API = { timePlayed, hrs, sourceOf, wordDate, longDate, infoPrompt, parseInfo, applyInfo, steamPlay, backlogHours, findDuplicates, mergeGames, linkRemake, mergeInto, itadCall, itadIds, itadOverview, itadSubs, itadBundles, itadWaitSync, itadAuthUrl, itadToken, priceWatch, readXlsx, fromSheet, sheetDate, steamExtras, imdbGameSearch, STATUSES, LABEL, norm, isoOf, blank, Games, setStatus, logPlay, removePlay, logSession, playedMins, stats, franchiseGuess, fromOld, hasOld, COVER, HEADER,
    steamSearch, linkSteam, steamPrices, storePrices, steamDates, importRows, fromImdb, storeLinks, indexFor, yearOf, NA };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }
  root.GamesCore = API;
})(typeof window !== "undefined" ? window : globalThis);
