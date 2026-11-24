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
    save() { this._nm = null; this.ver++; this._idx = null; this._fi = null; if (this.persist) { if (this.persist.saveLazy) this.persist.saveLazy(); else this.persist.save(JSON.stringify(this.toJSON())); } }
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
    multiverses(order = "remake") {
      const m = new Map();
      for (const g of this.visible()) verDate(g); // 0.7.6: each game remembers its newest version's date
      const mk = t => String(t || "").split(/\s+\/\s+/).map(p => words(p).replace(/^the /, "")).sort().join("/");
      for (const g of this.visible()) {
        const mv = g.multiverse || g.franchise || "Other", fr = g.franchise || mv, key = mk(mv) || mv;
        if (!m.has(key)) m.set(key, { name: mv, franchises: new Map(), total: 0, done: 0 });
        const x = m.get(key);
        if (!x.franchises.has(fr)) x.franchises.set(fr, []);
        x.franchises.get(fr).push(g); x.total++; if (g.status === "done") x.done++;
      }
      // 0.7.6: "remake" (the default): by the date of each game's newest remake, remaster or re-release (its original
      // when it has none); "date": by original release; "size": biggest first
      const dOf = g => (order === "remake" ? g.verDate || g.date : g.date) || "9999";
      const first = gs => gs.reduce((d, g) => { const x = dOf(g); return x !== "9999" && x < d ? x : d; }, "9999");
      const out = [...m.values()].map(x => {
        const franchises = [...x.franchises.entries()].map(([name, gs]) => ({ name, games: gs.sort((a, b) => dOf(a).localeCompare(dOf(b)) || (a.date || "9999").localeCompare(b.date || "9999")) }))
          .sort((a, b) => first(a.games).localeCompare(first(b.games)) || a.name.localeCompare(b.name));
        // 0.7.9: one list for the whole multiverse (collapsed view) and its sub-series (expanded): a game whose series is
        // just the multiverse's name goes by the series in its title (Dawn of War, Total War…); a series of one game joins "Other"
        const all = franchises.flatMap(f => f.games).sort((a, b) => dOf(a).localeCompare(dOf(b)) || (a.date || "9999").localeCompare(b.date || "9999"));
        const subs = new Map();
        const sk = t => words(t).replace(/^the /, ""); // "The Witcher" and "Witcher" are one series
        // 0.8.2: a series named after the multiverse ("Warhammer 40,000", "Lego Batman") splits by its titles (Dawn of War,
        // Space Marine…); a series whose name holds another series' name folds into it ("The Amazing Spider-Man",
        // "Spider-Man (2000)", "Marvel's Spider-Man" → Spider-Man)
        const mwx = sk(x.name);
        const keyOf = g => { const f = sk(g.franchise); return f && f !== mwx && !has(f, mwx) ? g.franchise : seriesStem(g.title, x.name); };
        const raw = new Map(); for (const g of all) { const k = keyOf(g); raw.set(sk(k), (raw.get(sk(k)) || 0) + 1); }
        const fold = new Map(), keys = [...raw.keys()].filter(k => k.length >= 4 && k !== mwx).sort((a, b) => a.length - b.length);
        for (const k of raw.keys()) { const into = keys.find(o => o !== k && o.length < k.length && has(k, o) && raw.get(o) >= 1 && (raw.get(o) + raw.get(k)) >= 2); if (into) fold.set(k, into); }
        const root = k => { let r = k, n = 0; while (fold.has(r) && n++ < 5) r = fold.get(r); return r; };
        for (const g of all) { const k0 = keyOf(g), k = root(sk(k0)); if (!subs.has(k)) subs.set(k, { name: k === sk(k0) ? k0 : null, games: [] }); const sb = subs.get(k); sb.games.push(g); if (!sb.name || (k === sk(k0) && k0.length < sb.name.length)) sb.name = k === sk(k0) ? k0 : sb.name; }
        for (const sb of subs.values()) if (!sb.name) sb.name = sb.games.map(keyOf).sort((a, b) => a.length - b.length)[0];
        // 0.8.1: one-game "series" are mostly main games with a subtitle (Tomb Raider: Legend): they join the main series
        // named after the multiverse when its titles carry that name; otherwise "Other … games"
        let series = [...subs.values()], other = series.filter(s => s.games.length < 2);
        series = series.filter(s => s.games.length >= 2);
        if (other.length) {
          const mw = sk(x.name), main = series.find(s => sk(s.name) === mw);
          const named = other.flatMap(s => s.games).filter(g => has(words(g.title), mw)).length >= other.length / 2;
          if (main) { main.games.push(...other.flatMap(s => s.games)); main.games.sort((a, b) => dOf(a).localeCompare(dOf(b))); }
          else series.push({ name: named || !series.length ? x.name : `Other ${x.name} games`, games: other.flatMap(s => s.games), other: !named });
        }
        series.sort((a, b) => (a.other ? 1 : 0) - (b.other ? 1 : 0) || first(a.games).localeCompare(first(b.games)) || a.name.localeCompare(b.name));
        return { name: x.name, total: x.total, done: x.done, first: franchises.length ? first(all) : "9999", franchises, all, series };
      });
      const sorted = out.sort((a, b) => order === "size" ? b.total - a.total || a.name.localeCompare(b.name) : a.first.localeCompare(b.first) || a.name.localeCompare(b.name));
      // 0.8.2: games that are the only one of their kind go together at the end (one row) instead of a banner each
      const solo = sorted.filter(x => x.total === 1), groups = sorted.filter(x => x.total > 1);
      if (solo.length < 2) return sorted;
      const all = solo.flatMap(x => x.all).sort((a, b) => dOf(a).localeCompare(dOf(b)) || a.title.localeCompare(b.title));
      return groups.concat([{ name: "Standalone games", standalone: true, total: all.length, done: all.filter(g => g.status === "done").length, first: "9999", franchises: solo.flatMap(x => x.franchises), all, series: [{ name: "Standalone games", games: all }] }]);
    }
    // 0.6.6: what you're playing, then the next game of each franchise you're going through (the first one, by release
    // date, after the last you finished or are playing: released, not finished or dropped), the franchises you played
    // most recently first, then games you marked Next, then a few short games you own.
    nextUp(limit = 10) {
      const t = today(), vis = this.visible(), why = this._why = new Map();
      const playing = vis.filter(g => g.status === "playing");
      const byF = new Map();
      for (const g of vis) { const f = norm(g.franchise); if (!f || g.story === false) continue; if (!byF.has(f)) byF.set(f, []); byF.get(f).push(g); }
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
    // 0.7.6: finishing a game sets the next one of its series (by original release date: released, not finished, dropped
    // or being played) as Up next; changing the finished one back takes that away again (unless you've started it).
    // Returns the game set as next, or null.
    statusChanged(g, prev) {
      if (!g || prev === g.status) return null;
      const f = norm(g.franchise || g.multiverse);
      if (g.status === "done" && prev !== "done" && f && g.story !== false) {
        const t = today();
        // 0.8.1: within the series' own line when it has one (Dawn of War after Dawn of War, not the next Warhammer game)
        const stemOf = x => { const mv = x.multiverse || x.franchise || ""; return words(x.franchise) && words(x.franchise) !== words(mv) ? words(x.franchise) : words(seriesStem(x.title, mv)).replace(/^the /, ""); };
        let pool = this.visible().filter(x => norm(x.franchise || x.multiverse) === f && x.story !== false);
        const sg = stemOf(g), same = pool.filter(x => x !== g && stemOf(x) === sg);
        if (same.length) pool = same.concat([g]);
        const list = pool.filter(x => x.date || x === g)
          .sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.title.localeCompare(b.title));
        const i = list.indexOf(g);
        const nx = list.slice(i + 1).find(x => x.status !== "done" && x.status !== "dropped" && x.status !== "playing" && x.date && x.date <= t);
        if (nx && !nx.next) { nx.next = true; nx.nextBy = g.id; this.save(); return nx; }
        return null;
      }
      if (prev === "done" && g.status !== "done") {
        let ch = false;
        for (const x of this.games) if (x.nextBy === g.id) { if (x.status !== "playing" && x.status !== "done") x.next = false; delete x.nextBy; ch = true; }
        if (ch) this.save();
      }
      return null;
    }
    // 0.7.6: remakes, remasters and re-releases bundled with their original (one entry, the versions listed in it):
    // when the title is the same story with an edition word (Remastered, HD, Definitive Edition…), or when the
    // original's details name it as its remake (from your prompt). Returns the bundled titles.
    bundleVersions(dry = false) {
      const out = [], vis = this.visible(), seen = new Set();
      const byKey = new Map();
      for (const g of vis) { const k = `${norm(g.multiverse || g.franchise || "")}|${storyKey(g.title)}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(g); }
      const join = (base, rem) => { if (!this.games.includes(base) || !this.games.includes(rem) || base === rem || seen.has(rem)) return; seen.add(rem); if (!dry) linkRemake(this, base, rem); out.push(`${rem.title} → ${base.title}`); };
      for (const list of byKey.values()) {
        if (list.length < 2) continue;
        list.sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
        const base = list.find(g => !hasEdition(g.title)) || list[0];
        for (const g of list) if (g !== base && hasEdition(g.title)) join(base, g);
      }
      for (const base of this.visible()) {
        const r = base.remake; if (!r || !r.title) continue;
        const ry = +String(r.date || "").slice(0, 4) || 0;
        const other = this.visible().find(x => x !== base && norm(x.title) === norm(r.title) && (!ry || !x.date || Math.abs(+x.date.slice(0, 4) - ry) <= 1) && (x.date || "") >= (base.date || ""));
        if (other) join(base, other);
      }
      if (out.length && !dry) { this._fi = null; this.save(); }
      return out;
    }
    // 0.7.6: games whose series was only guessed from their title join the series and multiverse of your list (the
    // one you imported) when their title starts with it, or when a game of yours tells the same story. Returns changes.
    // 0.7.6b: the canon scans decide the series of your games: every game a scan placed in a franchise joins it. Where
    // games of yours in that franchise already have a multiverse from your list, that name is used (so "Zelda" stays
    // yours, not the scan's "The Legend of Zelda"); a game's sub-series comes from the scan when it has one. Games from
    // your own list keep what your list says. `rows` are C.gameCanon()'s rows (with .game, .franchise, .sub).
    followCanon(rows) {
      const byF = new Map();
      for (const c of rows || []) { if (!c.game) continue; const g = this.get(c.game); if (!g || !c.franchise) continue; if (!byF.has(c.franchise)) byF.set(c.franchise, []); byF.get(c.franchise).push({ g, c }); }
      const most = list => { const n = new Map(); for (const x of list) if (x) n.set(x, (n.get(x) || 0) + 1); return [...n.entries()].sort((a, b) => b[1] - a[1])[0]; };
      const out = [];
      for (const [F, list] of byF) {
        const mine = list.filter(x => trustedGame(x.g));
        const m = most(mine.map(x => x.g.multiverse || x.g.franchise));
        const mv = m ? m[0] : F;
        const named = mine.length ? null : this.placeOf(F);
        for (const { g, c } of list) {
          if (trustedGame(g)) continue;
          if (named || this.placeOf(g.title)) continue; // 0.7.9: one of your series by name: consolidate() puts it there
          const fr = c.sub || (mine.length ? (most(mine.map(x => x.g.franchise)) || [mv])[0] : F);
          if (g.multiverse !== mv || g.franchise !== fr) { out.push(`${g.title}: ${mv}${fr !== mv ? " › " + fr : ""}`); g.multiverse = mv; g.franchise = fr; g.fCanon = true; }
        }
      }
      if (out.length) this.save();
      return out;
    }
    // 0.7.9: the names of your series and multiverses (from your list), longest first, each with where it goes
    names() {
      if (this._nm && this._nmVer === this.games.length + ":" + (this._ver || 0)) return this._nm;
      const by = new Map(), trusted = this.visible().filter(trustedGame);
      for (const g of trusted) {
        const m = g.multiverse || g.franchise; if (!m) continue;
        // and the series a title starts with when it doesn't name the multiverse (Mordheim, Space Hulk, Kid Dracula…)
        const st = words(String(g.title || "").split(/\s*[:–—]\s+|\s+-\s+/)[0]).replace(/ \d+$/, ""), stOk = st && st.length >= 8 && !has(st, words(m)) && !has(st, words(g.franchise));
        for (const [n, f] of [[words(g.franchise), g.franchise], [words(m), null]].concat(stOk ? [[st, g.franchise]] : [])) {
          if (!n || n.length < 3) continue;
          const x = by.get(n) || { n, m: new Map(), f };
          x.m.set(m, (x.m.get(m) || 0) + 1); if (f && !x.f) x.f = f;
          by.set(n, x);
        }
      }
      const list = [...by.values()].map(x => ({ n: x.n, f: x.f, m: [...x.m.entries()].sort((a, b) => b[1] - a[1])[0][0] })).sort((a, b) => b.n.length - a.n.length);
      this._nm = { list, trustedTitles: trusted.map(g => ({ w: words(g.title), m: g.multiverse || g.franchise, f: g.franchise })) };
      this._nmVer = this.games.length + ":" + (this._ver || 0);
      return this._nm;
    }
    // where a title (or a series name) goes by the names in it: { f, m } or null. With two of your names in it
    // ("Total War: Warhammer"), your own games with both names decide; otherwise the longer name.
    placeOf(text) {
      const w = words(text); if (!w) return null;
      const { list, trustedTitles } = this.names();
      const hits = list.filter(x => has(w, x.n));
      if (!hits.length) return null;
      const ms = [...new Set(hits.map(h => h.m))];
      if (ms.length > 1) {
        const votes = new Map();
        for (const t of trustedTitles) if (hits.every(h => has(t.w, h.n))) votes.set(t.m, (votes.get(t.m) || 0) + 1);
        const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
        if (best) { const h = hits.find(h => h.m === best[0] && h.f) || hits.find(h => h.m === best[0]); return { f: h.f, m: best[0] }; }
      }
      const h = hits[0]; return { f: h.f, m: h.m };
    }
    // Every game that isn't from your list goes where its name says (one of your series or multiverses), keeping the
    // canon scan's series as its sub-series; the rest keep what the canon scans said. Then exact copies of a game
    // (same name, same year: "Marvel's Spider-Man 2" twice) are merged. Returns what moved.
    resolveFranchises() {
      const vis = this.visible(), out = [];
      const byStory = new Map(); for (const g of vis) if (trustedGame(g)) byStory.set(storyKey(g.title), g);
      for (const g of vis) {
        if (trustedGame(g)) continue;
        const twin = byStory.get(storyKey(g.title));
        let hit = twin && twin !== g ? { f: twin.franchise, m: twin.multiverse || twin.franchise } : null;
        if (!hit) hit = this.placeOf(g.title) || this.placeOf(g.franchise) || (g.multiverse !== g.franchise ? this.placeOf(g.multiverse) : null);
        if (!hit) continue;
        // the series inside: yours when the name was one of your series, else the canon scan's (when it isn't just the multiverse)
        const own = g.franchise && words(g.franchise) !== words(hit.m) && !has(words(g.franchise), words(hit.m)) ? g.franchise : null;
        const f = hit.f && words(hit.f) !== words(hit.m) ? hit.f : own || hit.f || hit.m;
        if (f !== g.franchise || hit.m !== g.multiverse) { out.push(`${g.title}: ${hit.m}${f !== hit.m ? " › " + f : ""}`); g.franchise = f; g.multiverse = hit.m; g.fGuess = true; delete g.fCanon; }
      }
      out.push(...this.tidyNames());
      out.push(...this.familyMerge());
      out.push(...this.joinBigger());
      out.push(...this.mergeCopies());
      if (out.length) { this._ver = (this._ver || 0) + 1; this.save(); }
      return out;
    }
    // 0.8.2: when your games came from IMDb, the canon scans or Steam (no list of yours to go by), every multiverse's own
    // name decides: a game in a small group whose title names a bigger multiverse moves there, its old series kept as
    // a sub-series ("Star Wars Outlaws", "Star Wars Jedi", "Vader Immortal: A Star Wars VR Series" → Star Wars;
    // "Total War: Warhammer III" → Warhammer › Total War). A title naming its own group too ("Lego Star Wars" in Lego)
    // only moves to a group at least three times bigger. Your list's games (an import with series) never move.
    // 0.8.2: series names left by imports as placeholders ("Unsorted", "-", "\\") or with a stray "\\", and titles whose
    // accents were read in the wrong encoding ("PokÃ©mon") put right
    tidyNames() {
      const out = [], PH = /^\s*(unsorted|other|none|n\/?a|-|\?|\\|-\\|—)?\s*$/i;
      const fix = t => { let x = String(t || ""); if (/Ã.|Â./.test(x)) { try { x = decodeURIComponent(escape(x)); } catch (e) { /* not that */ } } return x.replace(/\\+$/, "").trim(); };
      for (const g of this.games) {
        const t = fix(g.title), f0 = fix(g.franchise), m0 = fix(g.multiverse);
        const f = PH.test(f0) ? "" : f0, m = PH.test(m0) ? "" : m0;
        if (t !== g.title || f !== (g.franchise || "") || m !== (g.multiverse || "")) {
          out.push(`${g.title}: tidied`); g.title = t || g.title; g.franchise = f; g.multiverse = m;
          if (!f && !m) { const gs = franchiseGuess(g.title); g.franchise = gs; g.multiverse = gs; g.fGuess = true; }
        }
      }
      return out;
    }
    // 0.8.2: a family of multiverses goes under its head: "Dragon Ball Z", "Dragon Ball GT", "Dragon Ball FighterZ" under
    // Dragon Ball; "Kirby's Dream Land", "Kirby Star Allies" under Kirby; "Sonic Advance" under Sonic the Hedgehog;
    // "Doom Eternal" under Doom. Only when a multiverse is named just that (no "Dead" family from Dead Space + Dead
    // Rising). The old multiverse stays as a sub-series when it had 2+ games.
    familyMerge() {
      const out = [], vis = this.visible(), listed = g => !!(g.fImported || g.src === "list");
      const fw = t => words(String(t || "").replace(/['’]s\b/g, "")); // Kirby's → kirby
      const groups = new Map();
      for (const g of vis) { const m = g.multiverse || g.franchise; if (!m) continue; const k = fw(m); if (!groups.has(k)) groups.set(k, { k, names: new Map(), games: [] }); const x = groups.get(k); x.games.push(g); x.names.set(m, (x.names.get(m) || 0) + 1); }
      const heads = new Map();
      for (const x of groups.values()) {
        if (x.k.length < 4) continue;
        if (!heads.has(x.k) || heads.get(x.k).games.length < x.games.length) heads.set(x.k, x);
        const mm = x.k.match(/^(\S{4,}) the \S+$/); if (mm && (!heads.has(mm[1]) || heads.get(mm[1]).games.length < x.games.length)) heads.set(mm[1], x); // Sonic the Hedgehog → "sonic"
      }
      for (const x of groups.values()) {
        const toks = x.k.split(" ");
        let head = null;
        for (let n = toks.length - 1; n >= 1 && !head; n--) { const h = heads.get(toks.slice(0, n).join(" ")); if (h && h !== x) head = h; }
        if (!head || head.games.length < 3 || head.games.length * 3 < x.games.length) continue; // a real head, not a one-off "Kingdom"
        const name = [...head.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
        for (const g of x.games) {
          if (listed(g)) continue;
          const old = g.multiverse || g.franchise;
          g.franchise = x.games.length >= 2 ? old : (g.franchise && fw(g.franchise) !== x.k ? g.franchise : name);
          g.multiverse = name; g.fGuess = true; delete g.fCanon;
          out.push(`${g.title}: ${name}${g.franchise !== name ? " › " + g.franchise : ""}`);
        }
      }
      return out;
    }
    joinBigger() {
      const vis = this.visible(), size = new Map(), out = [];
      const mvOf = g => g.multiverse || g.franchise || "";
      for (const g of vis) { const m = mvOf(g); if (m) size.set(m, (size.get(m) || 0) + 1); }
      const big = [...size.entries()].filter(([m, n]) => n >= 3 && words(m).length >= 4).map(([m, n]) => ({ m, n, w: words(m) })).sort((a, b) => b.w.length - a.w.length);
      if (!big.length) return out;
      const segs = t => String(t || "").split(/\s*[:–—]\s+|\s+-\s+/).map(words).filter(Boolean);
      // a one-word name counts at the start of a title or after ":"; a big one (20+ games: Mario, Sonic, Kirby) anywhere
      const names = (title, w, n) => w.includes(" ") || n >= 20 ? has(words(title), w) : segs(title).some(x => x === w || x.startsWith(w + " "));
      const listed = g => !!(g.fImported || g.src === "list");
      for (const g of vis) {
        if (listed(g)) continue;
        const own = mvOf(g), n0 = size.get(own) || 0;
        const ownNamed = own && names(g.title, words(own), n0);
        const hits = big.filter(b => b.m !== own && b.n > n0 && (!ownNamed || b.n >= 3 * n0) && names(g.title, b.w, b.n));
        if (!hits.length) continue;
        hits.sort((a, b) => b.n - a.n || b.w.length - a.w.length);
        const to = hits[0].m;
        // its old series stays as a sub-series only when it was a real one (2+ games); a one-game "series" was just its title
        const f = g.franchise && words(g.franchise) !== words(to) && n0 >= 2 ? g.franchise : to;
        out.push(`${g.title}: ${to}${f !== to ? " › " + f : ""}`);
        size.set(own, n0 - 1); size.set(to, (size.get(to) || 0) + 1);
        g.multiverse = to; g.franchise = f; g.fGuess = true; delete g.fCanon;
      }
      return out;
    }
    // the same game twice (not two games of your list: those are different platforms on purpose)
    mergeCopies() {
      const by = new Map(), out = [];
      for (const g of this.visible()) { const k = looseKey(g.title); if (!k) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(g); }
      for (const list of by.values()) {
        if (list.length < 2) continue;
        const listed = g => !!(g.fImported || g.src === "list");
        list.sort((p, q) => (listed(q) ? 1 : 0) - (listed(p) ? 1 : 0) || (p.added || 0) - (q.added || 0));
        for (const extra of list.filter(g => !listed(g))) {
          if (!this.games.includes(extra)) continue;
          const y = +String(extra.date || "").slice(0, 4) || 0;
          const keep = list.find(g => g !== extra && this.games.includes(g) && !(g.imdb && extra.imdb && g.imdb !== extra.imdb) && (!y || !g.date || Math.abs((+String(g.date).slice(0, 4)) - y) <= 1) && (!extra.platform || !g.platform || listed(g) || norm(g.platform) === norm(extra.platform)));
          if (!keep) continue;
          mergeGames(this, keep, extra, listed(keep)); // your list's entry stays the one shown
          out.push(`${extra.title}: merged with ${keep.title}`);
        }
      }
      return out;
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
  // 0.7.6: the edition words a remaster or re-release adds to its original's title (not "Collection": that's several games)
  const EDITION_RX = /\s*[-:–(]*\s*\b(remastered|remaster|remake|hd remaster|hd|definitive edition|director'?s cut|complete edition|enhanced edition|game of the year edition|goty edition|goty|anniversary edition|deluxe edition|special edition|redux)\b\)?\s*$/i;
  const hasEdition = t => EDITION_RX.test(String(t || ""));
  function storyKey(t) { let x = String(t || ""); for (let i = 0; i < 3; i++) { const y = x.replace(EDITION_RX, "").trim(); if (y === x) break; x = y; } return norm(x); }
  const versionKind = t => (/remake/i.test(t) ? "remake" : /remaster|\bhd\b|definitive|enhanced|redux|director/i.test(t) ? "remaster" : "re-release");
  // the date of a game's newest version (its own when it has none), remembered on the game for ordering
  function verDate(g) {
    let d = g.date || "";
    for (const v of [g.remake].concat(g.versions || [])) if (v && v.date && v.date > d) d = v.date;
    if (d !== (g.verDate || "")) g.verDate = d;
    return d;
  }
  // a game whose series came from your list (not guessed from its title, not given by a canon scan)
  const trustedGame = g => !!(g.fImported || g.src === "list" || (g.franchise && !g.fCanon && !g.fGuess && !(g.franchise === franchiseGuess(g.title) && (g.multiverse || g.franchise) === g.franchise)));
  // ---- 0.7.9: one place per series. Words of a name ("Marvel's Spider-Man 2" → "marvel spider man 2"), so a series
  // name can be found inside any title, at word boundaries ("Total War: Warhammer III" contains "warhammer").
  const ROMAN = { ii: "2", iii: "3", iv: "4", vi: "6", vii: "7", viii: "8", ix: "9", xi: "11", xii: "12", xiii: "13" };
  const words = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[™®©]/g, "").replace(/&/g, " and ")
    .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).map(w => ROMAN[w] || w).join(" ");
  // a title as a loose key for spotting the same game added twice (brand prefixes and "The" dropped, numerals alike)
  const looseKey = t => words(t).replace(/^(the|marvels?|tom clancys?|sid meiers?|disneys?|sega|nintendo|capcom|bandai namco)\s+/, "").replace(/\s+/g, "");
  const has = (text, name) => (" " + text + " ").includes(" " + name + " ");
  // franchise cells from a spreadsheet whose columns slid ("Red Dead Redemption Red Dead Redemption X" → "Red Dead Redemption")
  function cleanSeries(f) {
    let x = String(f || "").trim().replace(/\s+X$/, "");
    const w = x.split(/\s+/); if (w.length % 2 === 0) { const h = w.length / 2; if (w.slice(0, h).join(" ") === w.slice(h).join(" ")) x = w.slice(0, h).join(" "); }
    return x;
  }
  // the series inside a multiverse a title belongs to, when the game's own franchise is just the multiverse:
  // "Warhammer 40,000: Dawn of War II – Retribution" in Warhammer → "Dawn of War"; "Total War: Warhammer III" → "Total War"
  const SUBVERSE = /^(40 000|40000|age of sigmar|the end times|fantasy battle|epic 40 000)$/;
  function seriesStem(title, mv) {
    const m = words(mv), parts = String(title || "").split(/\s*[:–—]\s+|\s+-\s+/).map(p => p.trim()).filter(Boolean);
    const esc = String(mv || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const noNum = t => String(t).replace(/\s+(\d+|[IVX]{1,4})$/i, "").replace(/\s+(Remastered|Remake|HD)$/i, "").trim();
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], c = p.replace(new RegExp("^" + esc + "\\s*", "i"), "").trim(), w = words(c);
      if (!w || SUBVERSE.test(w) || w === m || /^\d[\d ]*$/.test(w)) continue;
      let pick = noNum(c);
      // one word left ("Episode", "Origins", "Isolation"): keep what it belongs to ("Star Wars Episode", "Alien: Isolation")
      if (words(pick).split(" ").length < 2 || /^[&+]|^and\s/i.test(pick)) pick = c !== p ? noNum(p) : i > 0 ? `${parts[i - 1]}: ${pick}` : pick; // "& Luigi" is "Mario & Luigi"
      return pick || String(mv || "");
    }
    return noNum(parts[0] || String(title || "")) || String(mv || "");
  }


  // 0.7.8: a version's progress; finishing any version counts the whole game (the bundle) as finished
  function setVersionStatus(lib, g, i, st, date) {
    const v = (g.versions || [])[i]; if (!v) return null;
    v.status = st === "done" || st === "playing" ? st : "";
    if (st === "done") { v.plays = (v.plays || []).concat([date || today()]); }
    let nx = null;
    if (st === "done" && g.status !== "done") { const was = g.status; setStatus(g, "done", date); nx = lib.statusChanged(g, was); }
    else if (st === "playing" && g.status !== "playing" && g.status !== "done") setStatus(g, "playing");
    lib.save();
    return nx;
  }
  const versionDone = g => g.status === "done" || (g.versions || []).some(v => v.status === "done");
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
      // 0.8.2: the same name, or the same story with an edition word (Remastered, GOTY…); never a numbered sequel, and
      // never an app another of your games already has (two games named Doom, 1993 and 2016, got the same Steam app)
      const sk = storyKey(g.title);
      const hit = hits.find(h => norm(h.title) === n) || hits.find(h => storyKey(h.title) === sk);
      const taken = hit && lib.games.some(x => x !== g && x.steam === hit.steam && storyKey(x.title) !== sk && !(x.versions || []).some(v => storyKey(v.title) === sk));
      const twin = hit && lib.games.some(x => x !== g && x.steam === hit.steam);
      if (hit && !taken && !twin) { g.steam = hit.steam; if (hit.price) g.price = hit.price; linked++; } else lib.meta.noSteam[g.id] = Date.now();
      if (gap) await sleep(gap);
    }
    return linked;
  }
  // 0.8.2: games that ended up with the same Steam app (Doom 1993 and Doom 2016; Mega Man and Mega Man 11): Steam's own
  // name and release date say which one it is; the others lose the link, its price and its cover, and get a new link
  // later only when one matches exactly. → [{ steam, kept, cleared: [titles] }]
  async function fixSharedSteam(lib, http, sleep = ms => new Promise(r => setTimeout(r, ms))) {
    const by = new Map(), out = [];
    for (const g of lib.games) if (g.steam) { if (!by.has(g.steam)) by.set(g.steam, []); by.get(g.steam).push(g); }
    const groups = [...by.entries()].filter(([, l]) => l.length > 1);
    let reached = 0;
    for (const [id, list] of groups) {
      let name = "", year = 0;
      try { const j = await getJson(http, `https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic,release_date`); reached++; const d = j && j[id] && j[id].data; if (d) { name = d.name || ""; year = +String(isoOf(d.release_date && d.release_date.date) || "").slice(0, 4) || 0; } }
      catch (e) { if (/HTTP 429|HTTP 403/.test(e.message)) break; continue; }
      if (!name) continue;
      const score = g => (norm(g.title) === norm(name) ? 3 : storyKey(g.title) === storyKey(name) ? 2 : 0) + (year && g.date && Math.abs(+g.date.slice(0, 4) - year) <= 1 ? 2 : 0) + (g.src === "Steam library" || g.steamMins ? 1 : 0);
      const ranked = list.slice().sort((a, b) => score(b) - score(a) || String(b.date || "").localeCompare(String(a.date || "")));
      const keep = score(ranked[0]) >= 2 ? ranked[0] : null; // none of them is Steam's game: all lose it
      const cleared = [];
      for (const g of list) {
        if (g === keep) continue;
        // a remaster of the kept game keeps it (Dark Souls Remastered and Dark Souls are one app)
        if (keep && storyKey(g.title) === storyKey(keep.title) && norm(g.title) !== norm(keep.title)) continue;
        delete g.steam; delete g.price; delete g.steamMins; delete g.steam2w;
        if (g.cover && g.cover.includes(`/apps/${id}/`)) delete g.cover;
        (lib.meta.noSteam = lib.meta.noSteam || {})[g.id] = Date.now();
        cleared.push(g.title);
      }
      if (cleared.length) out.push({ steam: id, name, kept: keep ? keep.title : null, cleared });
      if (sleep) await sleep(700);
    }
    if (groups.length && !reached) throw new Error("Steam couldn't be reached"); // tried again next start
    if (out.length) lib.save();
    return out;
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
  const SRC = { list: "your games list (spreadsheet)", imdb: "IMDb", canon: "canon (Games › Missing)", itad: "IsThereAnyDeal waitlist", added: "added by you", steam: "Steam", "steam library": "Steam", howlongtobeat: "HowLongToBeat", grouvee: "Grouvee", backloggd: "Backloggd", gamecheck: "GameCheck", dw: "the Doctor Who timeline", "": "" };
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
  // 0.7.1: your own prompt, word for word, one game at a time (Settings never rewrites it)
  const MY_INFO_PROMPT = "Tell me: game Title, OG Release Date, OG best Platform, Remake Name,re-released, remastered, Remake Release Date, re-released, remastered, Remake best Platform, HLTB\ndates month in letters day in number and year (january 1, 1900)\nremakes count only if they cover the same story\nfor this game\n";
  const infoPromptOne = title => MY_INFO_PROMPT + String(title || "").trim();
  // reads the answer to your prompt, however it's laid out: "Label: value" lines, a list, or a table
  function parseInfoText(text, title) {
    const s = String(text || "");
    if (/^\s*\[/.test(s.trim()) || /```json/.test(s)) { try { const r = parseInfo(s); if (r.length) return Object.assign(r[0], { title }); } catch (e) { /* not JSON after all */ } }
    const kv = [];
    for (let l of s.replace(/\r/g, "").split("\n")) {
      l = l.replace(/\*\*|__|`/g, "").trim();
      if (!l) continue;
      if (/^\|/.test(l)) { const cells = l.split("|").map(x => x.trim()).filter(Boolean); if (cells.length >= 2 && !/^:?-{2,}/.test(cells[0])) kv.push([cells[0], cells.slice(1).join(" ")]); continue; }
      l = l.replace(/^([-*•]|\d+[.)])\s+/, "");
      const m = /^([^:]{2,90}?):\s*(.*)$/.exec(l); if (m) kv.push([m[1].trim(), m[2].trim()]);
    }
    const get = test => { const e = kv.find(([k]) => test(k.toLowerCase())); return e ? e[1] : ""; };
    const none = v => (/^(none|n\/?a|no\b|not applicable|unknown|—|-|nessun)/i.test(String(v).trim()) ? "" : String(v).trim());
    const plain = v => none(v).replace(/\s*[([].*$/, "").replace(/[.;]+$/, "").trim();
    const dateIn = v => { v = none(v).replace(/(\d)(st|nd|rd|th)\b/gi, "$1"); const m = /([A-Za-z]+\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/.exec(v) || /(\d{1,2}\s+[A-Za-z]+\.?,?\s+\d{4})/.exec(v) || /\b(\d{4})\b/.exec(v); return m ? wordDate(m[1]) : ""; };
    const og = k => /\bog\b|original/.test(k), rm = k => /remake|re-?releas|remaster/.test(k);
    const rName = plain(get(k => rm(k) && /name|title/.test(k)) || get(k => rm(k) && !/date|platform/.test(k)));
    const hl = none(get(k => /hltb|how ?long/.test(k)));
    const hm = /(\d+(?:[.,]\d+)?)/.exec(hl);
    const hours = hm ? Math.round(parseFloat(hm[1].replace(",", ".")) * 10) / 10 : null;
    return { title, date: dateIn(get(k => og(k) && /date|releas/.test(k) && !/platform/.test(k))), platform: plain(get(k => og(k) && /platform/.test(k))),
      remake: rName && norm(rName) !== norm(title) ? { title: rName, date: dateIn(get(k => rm(k) && /date/.test(k))), platform: plain(get(k => rm(k) && /platform/.test(k))) } : null,
      hours: hours > 0 && hours < 1000 ? hours : null };
  }
  // 0.7.1: Games › Missing checked against IMDb: the canon games you rated there (finished, with your rating) or
  // listed (wishlist) come into your Games; for the rest, IMDb's id and rating are found and shown. `mine` are your
  // synced IMDb rows; `rows` the missing canon games.
  async function imdbCheckMissing(lib, rows, mine, http, gql, opt = {}) {
    const sleep = opt.sleep || (ms => new Promise(r => setTimeout(r, ms))), p = opt.progress || (() => {});
    const byId = new Map(), byN = new Map();
    for (const r of mine) { if (r.medium !== "Video Game") continue; if (r.imdb) byId.set(r.imdb, r); const a = byN.get(norm(r.title)) || []; a.push(r); byN.set(norm(r.title), a); }
    const near = (list, y) => (list || []).find(r => !y || !r.year || Math.abs(r.year - y) <= 1) || null;
    lib.meta.canonImdb = lib.meta.canonImdb || {};
    const out = { finished: 0, wishlist: 0, found: 0, notFound: 0, rated: [] };
    const ids = [];
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i]; p(i / rows.length, `IMDb: ${c.title}`);
      const key = `${norm(c.title)}|${c.year || ""}`, known = lib.meta.canonImdb[key] || {};
      let id = c.imdb || known.imdb || null;
      let r = (id && byId.get(id)) || near(byN.get(norm(c.title)), c.year);
      if (!r && !id && !known.none) {
        try {
          const hits = await imdbGameSearch(http, c.title);
          const h = hits.find(x => norm(x.title) === norm(c.title) && (!c.year || !x.dateText || Math.abs(+x.dateText - c.year) <= 1)) || hits.find(x => norm(x.title) === norm(c.title));
          if (h) { id = h.imdb; r = byId.get(id) || null; } else known.none = Date.now();
        } catch (e) { if (/HTTP (403|429|202)/.test(e.message)) { out.blocked = true; break; } }
        if (opt.gap !== 0) await sleep(opt.gap || 400);
      }
      if (id) { known.imdb = id; ids.push(id); }
      lib.meta.canonImdb[key] = known;
      if (r) {
        const res = fromImdb(lib, [Object.assign({}, r, { imdb: r.imdb || id })]);
        const g = lib.find({ title: r.title, imdb: r.imdb || id, year: r.year });
        if (g) { g.aka = [...new Set((g.aka || []).concat(norm(c.title) !== norm(g.title) ? [c.title] : []))]; if (!g.franchise && c.franchise) g.franchise = c.franchise; }
        if (+r.rating > 0) { out.finished++; out.rated.push(c.title); } else out.wishlist++;
        void res;
      } else if (id) out.found++; else out.notFound++;
    }
    // IMDb's own rating for the ones it knows, 50 at a time
    for (let i = 0; gql && i < ids.length; i += 50) {
      try {
        const d = await gql(`{titles(ids:${JSON.stringify(ids.slice(i, i + 50))}){id ratingsSummary{aggregateRating voteCount}}}`);
        for (const t of (d && d.titles) || []) { if (!t || !t.ratingsSummary) continue; for (const k of Object.keys(lib.meta.canonImdb)) if (lib.meta.canonImdb[k].imdb === t.id) { lib.meta.canonImdb[k].r = t.ratingsSummary.aggregateRating || null; lib.meta.canonImdb[k].votes = t.ratingsSummary.voteCount || 0; } }
      } catch (e) { out.ratingsFailed = e.message; break; }
    }
    lib.save();
    return out;
  }
  // 0.7.6: Games › Missing, as it should be: no tie-ins to film or TV series (a franchise with films or series in your
  // canon, except Doctor Who), nothing the AI canon check found non-canon, without a story, or a version of another
  // game (that one is bundled with its original's row). Returns { rows, hidden: [{c, why}] }.
  const checkKey = c => `${norm(c.title)}|${c.year || ""}`;
  function missingRows(C, db, lib, today) {
    const all = C.gameCanon(db, lib.visible(), today);
    const screen = new Set();
    for (const c of db.canon()) if (c.medium !== "Video Game" && !/doctor who/i.test(c.franchise || "")) screen.add(norm(c.franchise));
    const chk = (lib.meta && lib.meta.canonCheck) || {}, rows = [], hidden = [];
    for (const c of all) {
      const k = chk[checkKey(c)];
      const why = screen.has(norm(c.franchise)) ? "a tie-in to a film or TV series" : k && k.tiein ? "a tie-in" : k && k.canon === false ? "not canon" : k && k.story === false ? "no campaign or story" : "";
      if (why) { hidden.push({ c, why }); continue; }
      rows.push(c);
    }
    // versions: under their original's row (or gone, when you have the original)
    const byN = new Map(rows.map(c => [norm(c.title), c]));
    for (const c of rows.slice()) {
      const k = chk[checkKey(c)], of = k && k.versionOf ? norm(k.versionOf) : "";
      if (!of || of === norm(c.title)) continue;
      const orig = byN.get(of), mine = lib.visible().find(g => norm(g.title) === of || storyKey(g.title) === storyKey(k.versionOf));
      if (orig || mine) {
        rows.splice(rows.indexOf(c), 1);
        if (orig) (orig.versions = orig.versions || []).push({ title: c.title, year: c.year });
        hidden.push({ c, why: `a version of ${k.versionOf}` });
      }
    }
    return { rows, hidden };
  }
  function canonCheckPrompt(rows, multiverses) {
    return `These are video games from franchises I play. For each one tell me:
- canon: is it part of the main canon of its franchise (true or false)
- story: does it have a campaign or story mode (false for multiplayer-only, party, puzzle, sports, racing-only or mobile spin-offs without a story)
- tiein: is it a tie-in to a film, TV series, book or comic franchise (true or false)
- versionOf: if it is a remake, remaster or re-release that covers the same story as another game, that game's title, otherwise ""
- multiverse: which of my multiverses it belongs to, written exactly as in my list, or "" if none
Answer with JSON only, one object per game, in this order: [{"title":"…","canon":true,"story":true,"tiein":false,"versionOf":"","multiverse":""}]
My multiverses: ${multiverses.slice(0, 120).join(", ") || "-"}
GAMES:
${rows.map(c => `${c.title} (${c.year || "?"}) — ${c.franchise || ""}`).join("\n")}`;
  }
  // reads the answer and keeps it per game (lib.meta.canonCheck), so Missing follows it from now on
  function applyCanonCheck(lib, rows, text) {
    let arr = null;
    const s = String(text || ""), a = s.indexOf("["), b = s.lastIndexOf("]");
    if (a >= 0 && b > a) { try { arr = JSON.parse(s.slice(a, b + 1)); } catch (e) { arr = null; } }
    if (!Array.isArray(arr)) throw new Error("the answer has no JSON list in it");
    lib.meta.canonCheck = lib.meta.canonCheck || {};
    const byN = new Map(rows.map(c => [norm(c.title), c]));
    let n = 0, out = { notCanon: 0, noStory: 0, tiein: 0, versions: 0 };
    arr.forEach((x, i) => {
      if (!x || typeof x !== "object") return;
      const c = byN.get(norm(x.title)) || rows[i]; if (!c) return;
      const k = { canon: x.canon !== false, story: x.story !== false, tiein: !!x.tiein, versionOf: String(x.versionOf || "").trim(), multiverse: String(x.multiverse || "").trim(), at: Date.now() };
      lib.meta.canonCheck[checkKey(c)] = k; n++;
      if (!k.canon) out.notCanon++; else if (!k.story) out.noStory++; else if (k.tiein) out.tiein++; else if (k.versionOf) out.versions++;
    });
    lib.save();
    return Object.assign(out, { checked: n });
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
    // 0.7.6: every version is kept (base.versions); base.remake stays the newest, as before
    // 0.7.8: a version keeps its own progress (finished or not, when, your rating) and its links
    const v = { title: rem.title, date: rem.date || "", platform: rem.platform || "", kind: versionKind(rem.title), status: rem.status === "done" || rem.status === "playing" ? rem.status : "",
      plays: (rem.plays || []).slice(), rating: rem.rating || 0, steam: rem.steam || null, imdb: rem.imdb || null, cover: rem.cover || "" };
    if (base.remake && base.remake.title && !(base.versions || []).some(y => norm(y.title) === norm(base.remake.title))) base.versions = (base.versions || []).concat([Object.assign({ kind: "remake" }, base.remake)]);
    base.versions = (base.versions || []).filter(x => norm(x.title) !== norm(v.title) || x.date !== v.date).concat([v]);
    for (const x of rem.versions || []) if (!base.versions.some(y => norm(y.title) === norm(x.title))) base.versions.push(x);
    if (rem.remake && rem.remake.title && !base.versions.some(y => norm(y.title) === norm(rem.remake.title))) base.versions.push(Object.assign({ kind: versionKind(rem.remake.title) }, rem.remake));
    base.versions.sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));
    base.remake = Object.assign({}, base.versions[base.versions.length - 1]); delete base.remake.kind;
    verDate(base);
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
  function mergeGames(lib, a, b, keepA) {
    const [keep, drop] = keepA ? [a, b] : gweight(a) > gweight(b) || (gweight(a) === gweight(b) && (a.added || 0) <= (b.added || 0)) ? [a, b] : [b, a];
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
        fImported: txt(r, "franchise") || txt(r, "multiverse") ? true : undefined, // 0.7.6: your list's series, kept as the reference
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
      if (existed && isRated && before && (before._st === "backlog" || before._st === "wishlist")) { if (game.status !== "done") { const was = game.status; setStatus(game, "done", String(r.rated_at || r.date || "").slice(0, 10) || undefined); if (lib.statusChanged) lib.statusChanged(game, was); } promoted++; }
      if (before) delete before._st;
      if (!existed) added++; else matched++;
    }
    return { added, rated, matched, promoted };
  }
  // 0.7.8: only links to the game's own page where Saga knows it (no searches); the shops with prices come from
  // IsThereAnyDeal (their own links)
  function storeLinks(g) {
    const out = [];
    if (g.steam) out.push(["Steam", `https://store.steampowered.com/app/${g.steam}/`]);
    if (g.gog) out.push(["GOG", String(g.gog).startsWith("http") ? g.gog : `https://www.gog.com/en/game/${g.gog}`]);
    if (g.hltbId) out.push(["HowLongToBeat", `https://howlongtobeat.com/game/${g.hltbId}`]);
    if (g.imdb) out.push(["IMDb", `https://www.imdb.com/title/${g.imdb}/`]);
    for (const x of g.stores || []) if (x.url && x.shop && !out.some(o => o[0] === x.shop)) out.push([x.shop, x.url]);
    return out;
  }
  function indexFor(lib) {
    const t = today();
    return { ts: Date.now(), next: lib.nextUp(8).map(g => ({ id: g.id, t: g.title, f: g.franchise, date: g.date })), recent: lib.recent(20),
      upcoming: lib.upcoming(t).slice(0, 60).map(g => ({ id: g.id, t: g.title, date: g.date, f: g.franchise })),
      games: lib.visible().map(g => ({ id: g.id, t: g.title, f: g.franchise, m: g.multiverse, done: g.status === "done", date: g.date })) };
  }

  // 0.7.9: puts the series and multiverse of your list back on its games (earlier versions could move them by a canon
  // scan), with slid spreadsheet columns read right; → how many changed
  function repairFromList(lib, mine) {
    const by = new Map();
    for (const b of mine || []) { const k = norm(b.t) + "|" + isoOf(b.od); if (!by.has(k)) by.set(k, b); }
    let n = 0;
    for (const g of lib.games) {
      if (g.src !== "list") continue;
      const b = by.get(norm(g.title) + "|" + (g.date || "")) || by.get(norm(g.title) + "|" + isoOf(g.dateText));
      if (!b) continue;
      let f = b.f, m = b.m;
      if (!m) { if (b.r && isNaN(+b.r) && !NA(b.r)) { m = f; f = b.r; } else { f = cleanSeries(f); m = f; } }
      f = cleanSeries(f); m = cleanSeries(m) || f;
      if (g.franchise !== f || g.multiverse !== m || g.fCanon || g.fGuess || !g.fImported) { g.franchise = f; g.multiverse = m; delete g.fCanon; delete g.fGuess; g.fImported = true; n++; }
    }
    if (n) { lib._ver = (lib._ver || 0) + 1; lib.save(); }
    return n;
  }
  const API = { repairFromList, cleanSeries, seriesStem, looseKey, words, setVersionStatus, versionDone, missingRows, canonCheckPrompt, applyCanonCheck, checkKey, storyKey, hasEdition, verDate, versionKind, MY_INFO_PROMPT, infoPromptOne, parseInfoText, imdbCheckMissing, timePlayed, hrs, sourceOf, wordDate, longDate, infoPrompt, parseInfo, applyInfo, steamPlay, backlogHours, findDuplicates, mergeGames, linkRemake, mergeInto, itadCall, itadIds, itadOverview, itadSubs, itadBundles, itadWaitSync, itadAuthUrl, itadToken, priceWatch, readXlsx, fromSheet, sheetDate, steamExtras, imdbGameSearch, STATUSES, LABEL, norm, isoOf, blank, Games, setStatus, logPlay, removePlay, logSession, playedMins, stats, franchiseGuess, fromOld, hasOld, COVER, HEADER,
    steamSearch, linkSteam, fixSharedSteam, steamPrices, storePrices, steamDates, importRows, fromImdb, storeLinks, indexFor, yearOf, NA };
  if (typeof module !== "undefined" && module.exports) { module.exports = API; return; }
  root.GamesCore = API;
})(typeof window !== "undefined" ? window : globalThis);
