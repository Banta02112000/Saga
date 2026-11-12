/* Your own film and series library: search (TMDB with a key, otherwise TVmaze for series and iTunes for films,
   both keyless), watch status, a dated watch log (rewatches count), per-episode tracking and the next episode to
   watch. Stored in library.json, separate from the IMDb/Trakt sync data; watched and wanted titles are mirrored
   into the sync store (source "app") so the franchise canon counts them too. Works in Node for the tests. */
(function (root) {
  "use strict";
  const STATUSES = ["watchlist", "watching", "watched", "dropped"];
  const LABEL = { watchlist: "Watchlist", watching: "Watching", watched: "Watched", dropped: "Dropped" };
  const today = () => new Date().toISOString().slice(0, 10);
  const norm = t => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/^(the|a|an|il|lo|la|i|gli|le)\s+/, "").replace(/[^a-z0-9]/g, "");
  const yearOf = d => { const m = String(d || "").match(/(18|19|20)\d\d/); return m ? +m[0] : null; };
  const day = d => { if (!d) return ""; if (typeof d === "number") return new Date(d).toISOString().slice(0, 10); const s = String(d).trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const t = Date.parse(s); return isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10); };
  // Episodes ticked in bulk without a real day (catching up, "mark the whole series watched", an import that only
// knows the last day): their date is the day of the click, not the day they were watched, so stats leave them out.
const markBulk = (it, k) => { (it.bulk || (it.bulk = {}))[k] = 1; };
const epKey = (s, e) => `${s}:${e}`;
  const stripTags = s => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

  function blank(o) {
    return Object.assign({ id: "", type: "movie", title: "", orig: "", year: null, poster: "", overview: "", genres: [], runtime: null, network: "",
      tmdb: null, tvmaze: null, imdb: null, itunes: null, status: "watchlist", rating: 0, added: Date.now(), updated: Date.now(),
      watches: [], eps: {}, bulk: {}, epl: null, epChecked: 0, ended: false, notes: "", src: "", anime: false, mal: null }, o || {});
  }
  const idFor = o => (o.mal && !o.tmdb ? `mal:${o.type}:${o.mal}` : o.tmdb ? `tm:${o.type}:${o.tmdb}` : o.tvmaze ? `tvm:${o.tvmaze}` : o.imdb ? `im:${o.imdb}` : o.itunes ? `it:${o.itunes}` : `x:${o.type}:${norm(o.title)}|${o.year || ""}`);

  class Library {
    constructor(persist) {
      this.persist = persist || null;
      this.items = {}; this.adopted = {}; this.outbox = [];
      if (persist) { try { const j = JSON.parse(persist.load() || "{}"); this.items = j.items || {}; this.adopted = j.adopted || {}; this.outbox = j.outbox || []; } catch (e) { /* corrupt: start empty */ } }
      for (const k in this.items) { this.items[k] = blank(this.items[k]); settleShow(this.items[k]); }
    }
    // every finished, ended series out of Watching; returns how many moved
    settleAll() { let n = 0; for (const it of this.all()) if (settleShow(it)) n++; return n; }
    toJSON() { return { v: 1, app: "library", items: this.items, adopted: this.adopted, outbox: this.outbox.slice(-2000) }; }
    // changes to send to Trakt (two-way sync); only titles with an IMDb or TMDB id can be sent
    q(it, ev) { if (it && (it.imdb || it.tmdb)) this.outbox.push(Object.assign({ id: it.id, type: it.type, ts: Date.now() }, ev)); }
    rate(it, v) { it.rating = Math.max(0, Math.min(10, v | 0)); it.ratedHere = 1; it.updated = Date.now(); this.q(it, { op: "rate", v: it.rating }); }
    save() { if (this.persist) this.persist.save(JSON.stringify(this.toJSON())); }
    all() { return Object.values(this.items); }
    get(id) { return this.items[id] || null; }
    // For big imports (10,000+ ratings): look-ups by id and title through maps instead of scanning the whole library each time.
    withIndex(fn) {
      if (this._ix) return fn();
      this._ix = { m: new Map(), ord: new Map() };
      let i = 0;
      for (const it of this.all()) { this._ix.ord.set(it, i++); this._index(it); }
      try { return fn(); } finally { this._ix = null; }
    }
    _keys(o) {
      const k = [];
      if (o.mal) k.push(`mal|${o.type}|${o.mal}`);
      if (o.imdb) k.push(`imdb|${o.imdb}`);
      if (o.tmdb) k.push(`tmdb|${o.type}|${o.tmdb}`);
      if (o.tvmaze) k.push(`tvm|${o.tvmaze}`);
      const n = norm(o.title);
      if (n) k.push(`t|${o.type}|${n}`);
      return k;
    }
    _index(it) {
      if (!this._ix) return;
      if (!this._ix.ord.has(it)) this._ix.ord.set(it, this._ix.ord.size);
      for (const k of this._keys(it)) { const a = this._ix.m.get(k); if (!a) this._ix.m.set(k, [it]); else if (!a.includes(it)) a.push(it); }
    }
    find(o) {
      const n = norm(o.title), y = o.year || null;
      // two titles with different IMDb (or TMDB, MAL) ids are never the same title, however alike their names
      const clash = x => (o.imdb && x.imdb && x.imdb !== o.imdb) || (o.tmdb && x.tmdb && x.type === o.type && +x.tmdb !== +o.tmdb) || (o.mal && x.mal && x.type === o.type && +x.mal !== +o.mal);
      const test = x => (o.mal && x.mal === o.mal && x.type === o.type) || (o.imdb && x.imdb === o.imdb) || (o.tmdb && x.tmdb === o.tmdb && x.type === o.type) || (o.tvmaze && x.tvmaze === o.tvmaze) ||
        (x.type === o.type && norm(x.title) === n && n && (!y || !x.year || Math.abs(x.year - y) <= 1) && !clash(x));
      if (this._ix) {
        let best = null, bo = Infinity;
        const tmdbTyped = o.tmdb ? [`tmdb|movie|${o.tmdb}`, `tmdb|show|${o.tmdb}`] : [];
        for (const k of this._keys(o).concat(tmdbTyped)) for (const x of this._ix.m.get(k) || []) {
          const ord = this._ix.ord.get(x);
          if (ord < bo && this.items[x.id] === x && test(x)) { best = x; bo = ord; }
        }
        return best;
      }
      return this.all().find(test);
    }
    add(o, status) {
      const ex = this.find(o);
      if (ex) {
        for (const k of ["tmdb", "tvmaze", "imdb", "itunes", "mal", "poster", "overview", "runtime", "network", "orig", "year"]) if (!ex[k] && o[k]) ex[k] = o[k];
        if (o.anime) ex.anime = true;
        if (!ex.genres.length && o.genres && o.genres.length) ex.genres = o.genres;
        if (status && STATUSES.includes(status) && rank(status) > rank(ex.status)) ex.status = status;
        ex.updated = Date.now();
        this._index(ex);
        return { item: ex, existed: true };
      }
      const it = blank(Object.assign({}, o, { status: STATUSES.includes(status) ? status : (o.status || "watchlist") }));
      it.id = idFor(it);
      while (this.items[it.id]) it.id += "_";
      this.items[it.id] = it;
      this._index(it);
      return { item: it, existed: false };
    }
    remove(id) { const it = this.items[id]; delete this.items[id]; if (it) this.adopted[adoptKey(it)] = 1; }
    setStatus(it, st, date) {
      if (!STATUSES.includes(st)) return it;
      const prev = it.status;
      it.status = st; it.updated = Date.now();
      if (st === "watched" && it.type === "movie" && !it.watches.length) { it.watches.push(day(date) || today()); this.q(it, { op: "watch", d: it.watches[0] }); }
      if (st === "watched" && it.type === "show" && prev !== "watched" && !it.watches.length) {
        if (it.epl) for (const [s, e, d] of it.epl) if (!d || d <= today()) { const k = epKey(s, e); if (!it.eps[k]) { it.eps[k] = day(date) || today(); if (!day(date)) markBulk(it, k); } }
        it.watches.push(day(date) || today());
      }
      if (st === "watchlist" && it.type === "movie") it.watches = [];
      return it;
    }
    // Films: another viewing on that day. Series: a full run finished on that day.
    logWatch(it, date) {
      it.watches.push(day(date) || today());
      if (it.type === "movie") this.q(it, { op: "watch", d: it.watches[it.watches.length - 1] });
      it.watches.sort();
      if (it.status !== "watched" && (it.type === "movie" || this.caughtUp(it))) it.status = "watched";
      it.updated = Date.now();
      return it.watches.length;
    }
    removeWatch(it, i) { it.watches.splice(i, 1); if (!it.watches.length && it.type === "movie" && it.status === "watched") it.status = "watchlist"; it.updated = Date.now(); }
    // A rewatch of a series: the current run is kept in the log, episode ticks start over.
    rewatch(it, date) {
      if (it.type !== "show") return this.logWatch(it, date);
      if (Object.keys(it.eps).length && this.caughtUp(it) && !it.watches.includes(lastEpDay(it))) it.watches.push(lastEpDay(it) || day(date) || today());
      it.eps = {}; it.bulk = {}; it.status = "watching"; it.updated = Date.now();
      return it.watches.length;
    }
    toggleEp(it, s, e, date) {
      const k = epKey(s, e);
      if (it.eps[k]) { delete it.eps[k]; if (it.bulk) delete it.bulk[k]; this.q(it, { op: "unep", s, e }); } else { it.eps[k] = day(date) || today(); this.q(it, { op: "ep", s, e, d: it.eps[k] }); }
      this.afterEps(it);
      return !!it.eps[k];
    }
    // Ticks every aired episode up to and including s:e (catching up after starting mid-way).
    markUpTo(it, s, e, date) {
      for (const [ss, ee, d] of it.epl || []) {
        if (ss === 0) continue;
        if (ss < s || (ss === s && ee <= e)) { if (!it.eps[epKey(ss, ee)] && (!d || d <= today())) { it.eps[epKey(ss, ee)] = day(date) || today(); if (!day(date) && !(ss === s && ee === e)) markBulk(it, epKey(ss, ee)); this.q(it, { op: "ep", s: ss, e: ee, d: it.eps[epKey(ss, ee)] }); } }
      }
      this.afterEps(it);
    }
    markSeason(it, s, on, date) {
      for (const [ss, ee, d] of it.epl || []) if (ss === s && (!d || d <= today())) {
        const k = epKey(ss, ee);
        if (on && !it.eps[k]) { it.eps[k] = day(date) || today(); this.q(it, { op: "ep", s: ss, e: ee, d: it.eps[k] }); }
        else if (!on && it.eps[k]) { delete it.eps[k]; if (it.bulk) delete it.bulk[k]; this.q(it, { op: "unep", s: ss, e: ee }); }
      }
      this.afterEps(it);
    }
    afterEps(it) {
      const n = Object.keys(it.eps).length;
      if (n && (it.status === "watchlist")) it.status = "watching";
      settleShow(it);
      it.updated = Date.now();
    }
    aired(it, t = today()) { return (it.epl || []).filter(x => x[0] > 0 && (!x[2] || x[2] <= t)); }
    caughtUp(it, t = today()) { const a = this.aired(it, t); return !!a.length && a.every(x => it.eps[epKey(x[0], x[1])]); }
    // The first aired episode after the furthest one you've watched (skips gaps you left on purpose).
    nextEp(it, t = today()) {
      if (it.type !== "show" || !it.epl) return null;
      const list = (it.epl || []).filter(x => x[0] > 0).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let hi = -1;
      list.forEach((x, i) => { if (it.eps[epKey(x[0], x[1])]) hi = i; });
      let next = null, left = 0;
      for (let i = hi + 1; i < list.length; i++) {
        const x = list[i];
        // not out yet: a date in the future, or no date at all on a series still running with nothing dated after it that has aired
        const out = x[2] ? x[2] <= t : (it.ended || list.slice(i + 1).some(y => y[2] && y[2] <= t));
        if (!out) { if (!next) return { s: x[0], e: x[1], name: x[3] || "", date: x[2] || "", left: 0, upcoming: true }; break; }
        left++;
        if (!next) next = { s: x[0], e: x[1], name: x[3] || "", date: x[2] || "" };
      }
      return next ? Object.assign(next, { left }) : null;
    }
    // Shows in progress with an episode waiting, the most recently watched first.
    upNext(t = today()) {
      const out = [];
      for (const it of this.all()) {
        if (it.type !== "show" || it.status === "dropped" || !Object.keys(it.eps).length) continue;
        const n = this.nextEp(it, t);
        if (!n || n.upcoming) continue;
        out.push(Object.assign({ item: it, last: lastEpDay(it) }, n));
      }
      return out.sort((a, b) => String(b.last).localeCompare(String(a.last)));
    }
    // Everything watched with a date: films (each viewing), episodes, finished series runs.
    recent(limit = 20) {
      const out = [];
      for (const it of this.all()) {
        if (it.type === "movie") it.watches.forEach((d, i) => out.push({ id: it.id, title: it.title, date: d, what: i ? `Watch ${i + 1}` : "", type: "movie", item: it }));
        else {
          const byDay = {};
          for (const [k, d] of Object.entries(it.eps)) (byDay[d] = byDay[d] || []).push(k.split(":").map(Number));
          for (const [d, eps] of Object.entries(byDay)) {
            eps.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
            const a = eps[0], z = eps[eps.length - 1];
            out.push({ id: it.id, title: it.title, date: d, type: "show", item: it, what: eps.length === 1 ? `S${a[0]} E${a[1]}` : `S${a[0]} E${a[1]} – S${z[0]} E${z[1]} (${eps.length})` });
          }
        }
      }
      return out.filter(x => x.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
    }
    counts() {
      const c = { all: 0, watchlist: 0, watching: 0, watched: 0, dropped: 0, movie: 0, show: 0, eps: 0, rewatches: 0 };
      for (const it of this.all()) { c.all++; c[it.status]++; c[it.type]++; c.eps += Object.keys(it.eps).length; if (it.watches.length > 1) c.rewatches += it.watches.length - 1; }
      return c;
    }
    // Brings titles from the IMDb/Trakt sync in, once each (removing one later doesn't bring it back).
    adopt(rows) {
      return this.withIndex(() => this._adopt(rows));
    }
    _adopt(rows) {
      let n = 0;
      for (const r of rows) {
        if (!r || !r.title || r.medium === "Video Game" || r.medium === "Episode") continue;
        const type = r.medium === "TV Series" ? "show" : "movie";
        const o = { type, title: r.title, year: r.year || null, imdb: r.imdb || null, tmdb: r.tmdb ? +r.tmdb : null, src: r.source || "sync" };
        const k = adoptKey(o);
        const want = ["watchlist", "list", "collection"].includes(r.kind);
        if (this.adopted[k]) {
          // Already brought in once. Later changes on IMDb or Trakt still count: a new or changed rating (unless you
          // rated it in Saga), a watchlist title now watched, and ids it was missing. A title you removed stays removed.
          const ex = this.find(o);
          if (!ex) continue;
          let ch = false;
          const rd = day(r.rated_at || "") || "";
          // a rating changes when: none yet, the same service changed it, or it's newer than the one we have
          const src = r.source || "";
          if (r.rating && +r.rating !== ex.rating && !ex.ratedHere && (!ex.rating || (src && src === ex.ratingSrc && !(rd && ex.ratedAt && rd < ex.ratedAt)) || (rd && rd > (ex.ratedAt || "")))) { ex.rating = +r.rating; ex.ratedAt = rd || ex.ratedAt || ""; ex.ratingSrc = src; ch = true; }
          else if (r.rating && +r.rating === ex.rating && rd > (ex.ratedAt || "")) ex.ratedAt = rd;
          if (!want && ex.status === "watchlist") {
            ex.status = "watched"; ch = true;
            if (type === "movie" && !ex.watches.length) ex.watches.push(day(r.date) || "");
          }
          for (const f of ["imdb", "tmdb"]) if (o[f] && !ex[f]) { ex[f] = o[f]; ch = true; }
          if (ch) { ex.updated = Date.now(); this._index(ex); this.touched = (this.touched || 0) + 1; }
          continue;
        }
        this.adopted[k] = 1;
        const ex = this.find(o);
        const { item } = this.add(o, want ? "watchlist" : "watched");
        if (!want && type === "movie" && r.date && !item.watches.includes(day(r.date))) { item.watches.push(day(r.date)); item.watches.sort(); }
        if (!want && type === "movie" && !item.watches.length) item.watches.push(day(r.date) || "");
        if (r.rating && !item.rating) { item.rating = +r.rating; item.ratedAt = day(r.rated_at || "") || ""; item.ratingSrc = r.source || ""; }
        if (!ex) n++;
      }
      return n;
    }
    // Rows for the sync store (source "app"), so the canon matching sees what you track here.
    dbRows() {
      const out = { watched: [], watchlist: [] };
      for (const it of this.all()) {
        const row = { title: it.title, year: it.year, medium: it.type === "show" ? "TV Series" : "Movie", imdb: it.imdb || null, tmdb: it.tmdb || null, rating: it.rating || null, date: it.watches[it.watches.length - 1] || null };
        if (it.status === "watched" || (it.type === "show" && Object.keys(it.eps).length)) out.watched.push(row);
        else if (it.status === "watchlist" || it.status === "watching") out.watchlist.push(row);
      }
      return out;
    }
    // Merge of a parsed import (Letterboxd, MyAnimeList, Simkl, TV Time, a CSV): titles plus dated watches.
    // live: from a service synced every time (AniList, MAL, Letterboxd): its newer rating and progress win,
    // unless you rated the title in Saga
    merge(rows, live) {
      return this.withIndex(() => this._merge(rows, live));
    }
    _merge(rows, live) {
      let added = 0, updated = 0;
      for (const r of rows) {
        const before = this.find(r);
        if (live && !before && this.adopted["live|" + adoptKey(r)]) continue; // removed by you: stays removed
        const { item } = this.add(r, r.status);
        if (live) this.adopted["live|" + adoptKey(r)] = 1;
        if (before) updated++; else added++;
        for (const d of r.watches || []) if (d && !item.watches.includes(d)) item.watches.push(d);
        item.watches.sort();
        if (r.rating && (!item.rating || (live && !item.ratedHere))) item.rating = r.rating;
        if (live && r.epsWatched && r.epsWatched > Object.keys(item.eps).length) item.epsPending = r.epsWatched;
        if (r.orig && !item.orig) item.orig = r.orig;
        if (r.eps) for (const [k, d] of Object.entries(r.eps)) if (!item.eps[k]) item.eps[k] = d;
        if (r.epsWatched && !Object.keys(item.eps).length) item.epsPending = r.epsWatched; // ticked once the episode list loads
        if (r.lastEp && !Object.keys(item.eps).length) item.upToPending = r.lastEp;
        if (r.notes && !item.notes) item.notes = r.notes;
      }
      return { added, updated };
    }
  }
  const rank = s => ({ watchlist: 0, dropped: 1, watching: 2, watched: 3 }[s] || 0);
  const adoptKey = o => o.imdb || `${o.type}|${norm(o.title)}|${o.year || ""}`;
  const lastEpDay = it => Object.values(it.eps).sort().pop() || "";
  const airedOf = (it, t = today()) => (it.epl || []).filter(x => x[0] > 0 && (!x[2] || x[2] <= t));
  // A series that has ended and that you finished (every aired episode ticked) is Watched, not Watching.
  // Also a series rated or marked watched elsewhere that was only moved to Watching for lack of episodes, once it's known to have ended.
  function settleShow(it) {
    if (!it || it.type !== "show" || it.status !== "watching" || !it.ended) return false;
    const a = airedOf(it);
    const n = Object.keys(it.eps).length;
    const done = a.length ? a.every(x => it.eps[epKey(x[0], x[1])]) : false;
    if (!done && !(it.autoWatching && !n)) return false;
    it.status = "watched"; delete it.autoWatching;
    const d = lastEpDay(it);
    if (d && !it.watches.includes(d)) { it.watches.push(d); it.watches.sort(); }
    it.updated = Date.now();
    return true;
  }

  // ------------------------------------------------------------------ lookups
  const TMDB_IMG = "https://image.tmdb.org/t/p/w185";
  function fromTmdb(r, type) {
    const t = type || (r.media_type === "tv" ? "show" : "movie");
    return { type: t, tmdb: r.id, title: r.title || r.name || "", orig: r.original_title || r.original_name || "", year: yearOf(r.release_date || r.first_air_date),
      poster: r.poster_path ? TMDB_IMG + r.poster_path : "", overview: r.overview || "", src: "tmdb", anime: r.original_language === "ja" && (r.genre_ids || []).includes(16) };
  }
  function fromTvmaze(s) {
    return { type: "show", tvmaze: s.id, title: s.name || "", year: yearOf(s.premiered), poster: (s.image && (s.image.medium || s.image.original)) || "",
      overview: stripTags(s.summary), genres: s.genres || [], network: (s.network && s.network.name) || (s.webChannel && s.webChannel.name) || "",
      imdb: (s.externals && s.externals.imdb) || null, ended: /ended/i.test(s.status || ""), runtime: s.runtime || s.averageRuntime || null, src: "tvmaze", anime: (s.genres || []).includes("Anime") };
  }
  function fromItunes(r) {
    return { type: "movie", itunes: r.trackId, title: r.trackName || "", year: yearOf(r.releaseDate), poster: String(r.artworkUrl100 || "").replace("100x100", "300x300"),
      overview: r.longDescription || r.shortDescription || "", genres: r.primaryGenreName ? [r.primaryGenreName] : [], runtime: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 60000) : null, src: "itunes" };
  }
  // MyAnimeList (through Jikan, keyless) for anime: search, details, episodes with air dates
  function fromJikan(d) {
    const t = d.title_english || d.title || "";
    return { type: d.type === "Movie" ? "movie" : "show", title: t, orig: d.title && d.title !== t ? d.title : (d.title_japanese || ""), year: d.year || yearOf((d.aired || {}).from),
      poster: ((d.images || {}).jpg || {}).large_image_url || ((d.images || {}).jpg || {}).image_url || "", overview: d.synopsis || "", genres: (d.genres || []).map(g => g.name),
      mal: d.mal_id, anime: true, ended: /finished/i.test(d.status || ""), episodes: d.episodes || null, runtime: parseInt(d.duration, 10) || null, network: (d.studios || []).map(x => x.name).slice(0, 2).join(", "), src: "myanimelist" };
  }
  async function searchAnime(http, q) {
    const j = await getJson(http, `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(String(q).trim())}&limit=24&sfw=true`);
    return ((j && j.data) || []).map(fromJikan);
  }
  async function animeDetails(http, it, sleep = ms => new Promise(r => setTimeout(r, ms))) {
    let changed = false;
    const d = await getJson(http, `https://api.jikan.moe/v4/anime/${it.mal}`);
    if (d && d.data) { const f = fromJikan(d.data); for (const k of ["poster", "overview", "runtime", "network"]) if (!it[k] && f[k]) { it[k] = f[k]; changed = true; } if (it.ended !== f.ended) { it.ended = f.ended; changed = true; } it.episodes = f.episodes; }
    if (it.type !== "show") return changed;
    const eps = [];
    for (let page = 1; page <= 30; page++) {
      if (page > 1) await sleep(400); // MyAnimeList allows about three requests a second
      const j = await getJson(http, `https://api.jikan.moe/v4/anime/${it.mal}/episodes?page=${page}`);
      for (const e of (j && j.data) || []) eps.push([1, e.mal_id, e.aired ? String(e.aired).slice(0, 10) : "", e.title || ""]);
      if (!j || !j.pagination || !j.pagination.has_next_page) break;
    }
    // MyAnimeList sometimes lists no episodes for a running show: number them from the count
    if (!eps.length && it.episodes) for (let e = 1; e <= it.episodes; e++) eps.push([1, e, "", ""]);
    if (eps.length) { it.epl = eps; changed = true; }
    return changed;
  }
  async function getJson(http, url, headers) {
    const r = await http("GET", url, { headers: Object.assign({ accept: "application/json" }, headers || {}) });
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error(`${url.split("/")[2]}: HTTP ${r.status || "error"}${r.error ? " (" + r.error + ")" : ""}`);
    try { return JSON.parse(r.body); } catch (e) { throw new Error(`${url.split("/")[2]} sent something unexpected`); }
  }
  const tmdbUrl = (key, path, params) => {
    const p = Object.assign({}, params);
    const h = {};
    if (String(key).startsWith("eyJ")) h.Authorization = `Bearer ${key}`; else p.api_key = key;
    const q = Object.entries(p).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    return [`https://api.themoviedb.org/3${path}?${q}`, h];
  };
  const tmdbGet = (http, key, path, params) => { const [u, h] = tmdbUrl(key, path, params); return getJson(http, u, h); };

  // When TMDB can't be reached (blocked network), skip it for a while and use the other sources at once.
  let tmdbDownUntil = 0;
  const tmdbUp = () => Date.now() > tmdbDownUntil;
  function tmdbFailed(e) {
    if (/HTTP (error|0)\b|network|resolve|refused|timed? ?out|no answer/i.test(String(e && e.message))) { tmdbDownUntil = Date.now() + 15 * 60000; return true; }
    return false;
  }
  // IMDb's own search box (keyless, and reachable where TMDB is blocked): films and series with IMDb ids and posters
  async function searchImdb(http, q, type) {
    const k = norm(q).replace(/\s+/g, "_").slice(0, 40) || "x";
    const j = await getJson(http, `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(k)}.json?includeVideos=0`);
    const out = [];
    for (const d of (j && j.d) || []) {
      if (!/^tt\d+$/.test(d.id || "")) continue;
      const q2 = String(d.qid || d.q || "").toLowerCase();
      const t = /tvseries|tvminiseries|tv series|tv mini/.test(q2) ? "show" : /movie|feature|tvmovie|tv movie|short|video$/.test(q2) && !/game/.test(q2) ? "movie" : null;
      if (!t || (type !== "all" && type !== t)) continue;
      out.push({ type: t, imdb: d.id, title: d.l || "", year: d.y || null, poster: d.i && d.i.imageUrl ? String(d.i.imageUrl).replace(/\._V1_.*\.jpg$/, "._V1_UX300_.jpg") : "", overview: d.s ? `With ${d.s}` : "", src: "imdb" });
    }
    return out;
  }
  // opt: {tmdbKey, lang: "it"|"en", country: "IT", type: "all"|"movie"|"show"}
  async function search(http, q, opt = {}) {
    q = String(q || "").trim();
    if (!q) return [];
    const lang = opt.lang === "it" ? "it-IT" : "en-US", type = opt.type || "all", out = [], errors = [];
    if (opt.tmdbKey && tmdbUp()) {
      try {
        const path = type === "movie" ? "/search/movie" : type === "show" ? "/search/tv" : "/search/multi";
        const j = await tmdbGet(http, opt.tmdbKey, path, { query: q, language: lang, include_adult: "false" });
        for (const r of (j && j.results) || []) {
          if (type === "all" && r.media_type !== "movie" && r.media_type !== "tv") continue;
          out.push(fromTmdb(r, type === "all" ? null : type));
        }
        return out.slice(0, 30);
      } catch (e) { tmdbFailed(e); errors.push("TMDB: " + e.message); }
    }
    try { out.push(...await searchImdb(http, q, type)); } catch (e) { errors.push("IMDb: " + e.message); }
    if (type !== "movie") {
      try { const j = await getJson(http, `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`); for (const x of j || []) if (x.show) out.push(fromTvmaze(x.show)); }
      catch (e) { errors.push("TVmaze: " + e.message); }
    }
    if (type !== "show") {
      try {
        const c = String(opt.country || "IT").toUpperCase();
        const j = await getJson(http, `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=movie&entity=movie&limit=25&country=${c}${opt.lang === "it" ? "&lang=it_it" : ""}`);
        for (const r of (j && j.results) || []) out.push(fromItunes(r));
      } catch (e) { errors.push("iTunes: " + e.message); }
    }
    if (!out.length && errors.length) throw new Error(errors.join(" · "));
    // the same title from several sources becomes one result, keeping every id (TVmaze's gives the episodes)
    const merged = [];
    for (const x of out) {
      const twin = merged.find(m => m.type === x.type && ((x.imdb && m.imdb === x.imdb) ||
        (norm(m.title) === norm(x.title) && m.year && x.year && Math.abs(m.year - x.year) <= 1)));
      if (!twin) { merged.push(Object.assign({}, x)); continue; }
      for (const k of ["imdb", "tvmaze", "itunes", "tmdb", "poster", "overview", "network", "runtime"]) if (!twin[k] && x[k]) twin[k] = x[k];
      if ((!twin.genres || !twin.genres.length) && x.genres) twin.genres = x.genres;
      if (x.anime) twin.anime = true;
    }
    out.length = 0; out.push(...merged);
    // films and series interleaved by how well the title matches
    const n = norm(q);
    const score = x => (norm(x.title) === n ? 0 : norm(x.title).startsWith(n) ? 1 : 2);
    return out.map((x, i) => [x, i]).sort((a, b) => score(a[0]) - score(b[0]) || a[1] - b[1]).map(a => a[0]).slice(0, 40);
  }

  // Fills in details and, for series, the episode list. Returns true when something changed.
  async function details(http, it, opt = {}) {
    const lang = opt.lang === "it" ? "it-IT" : "en-US";
    let changed = false;
    if (it.mal && !it.tmdb) {
      changed = await animeDetails(http, it);
      if (it.type === "show") it.epChecked = Date.now();
      return pendingEps(it) || changed;
    }
    const set = (k, v) => { if (v != null && v !== "" && !(Array.isArray(v) && !v.length) && JSON.stringify(it[k]) !== JSON.stringify(v)) { it[k] = v; changed = true; } };
    let viaTmdb = false;
    if (it.tmdb && opt.tmdbKey && tmdbUp()) { try {
      if (it.type === "movie") {
        const d = await tmdbGet(http, opt.tmdbKey, `/movie/${it.tmdb}`, { language: lang });
        if (d) { set("imdb", d.imdb_id || null); set("runtime", d.runtime || null); set("genres", (d.genres || []).map(g => g.name)); if (!it.overview) set("overview", d.overview); if (!it.poster && d.poster_path) set("poster", TMDB_IMG + d.poster_path); }
      } else {
        const d = await tmdbGet(http, opt.tmdbKey, `/tv/${it.tmdb}`, { language: lang, append_to_response: "external_ids" });
        if (d) {
          set("imdb", (d.external_ids && d.external_ids.imdb_id) || null); set("genres", (d.genres || []).map(g => g.name)); set("ended", /ended|cancel/i.test(d.status || ""));
          set("network", ((d.networks || [])[0] || {}).name || ""); if (!it.overview) set("overview", d.overview);
          if ((d.original_language === "ja" || (d.origin_country || []).includes("JP")) && (d.genres || []).some(g => g.id === 16)) set("anime", true);
          const eps = [];
          const seasons = (d.seasons || []).filter(s => s.season_number > 0 && s.episode_count > 0).slice(0, 40);
          for (const s of seasons) {
            const sd = await tmdbGet(http, opt.tmdbKey, `/tv/${it.tmdb}/season/${s.season_number}`, { language: lang });
            for (const e of (sd && sd.episodes) || []) eps.push([e.season_number || s.season_number, e.episode_number, e.air_date || "", e.name || ""]);
          }
          if (eps.length) { it.epl = eps; it.epChecked = Date.now(); changed = true; }
        }
      }
      viaTmdb = true;
    } catch (e) { if (!tmdbFailed(e)) throw e; } }
    // TMDB unreachable (or no key): series come from TVmaze, which also has the full episode list
    if (!viaTmdb && it.type === "show") {
      let tvm = it.tvmaze;
      if (!tvm && it.imdb) { const s = await getJson(http, `https://api.tvmaze.com/lookup/shows?imdb=${it.imdb}`); if (s) { tvm = s.id; set("tvmaze", tvm); } }
      if (!tvm) { const j = await getJson(http, `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(it.title)}`); if (j && (!it.year || !yearOf(j.premiered) || Math.abs(yearOf(j.premiered) - it.year) <= 1)) { tvm = j.id; set("tvmaze", tvm); } }
      if (tvm) {
        const s = await getJson(http, `https://api.tvmaze.com/shows/${tvm}?embed=episodes`);
        if (s) {
          const f = fromTvmaze(s);
          for (const k of ["imdb", "network", "runtime", "genres", "poster"]) if (!it[k] || (Array.isArray(it[k]) && !it[k].length)) set(k, f[k]);
          set("ended", f.ended);
          if (f.anime) set("anime", true);
          if (!it.overview) set("overview", f.overview);
          const eps = ((s._embedded && s._embedded.episodes) || []).filter(e => e.season > 0 && e.number != null).map(e => [e.season, e.number, e.airdate || "", e.name || ""]);
          if (eps.length) { it.epl = eps; it.epChecked = Date.now(); changed = true; }
        }
      }
    }
    changed = pendingEps(it) || changed;
    changed = settleShow(it) || changed;
    if (it.type === "show") it.epChecked = Date.now();
    return changed;
  }
  function pendingEps(it) {
    let changed = false;
    // an import said "N episodes watched": tick them now that the list is known
    if (it.epsPending && it.epl) {
      const list = it.epl.filter(x => x[0] > 0).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, it.epsPending);
      for (const x of list) if (!it.eps[epKey(x[0], x[1])]) it.eps[epKey(x[0], x[1])] = it.watches[it.watches.length - 1] || today();
      delete it.epsPending; changed = true;
    }
    if (it.upToPending && it.epl) {
      const [ps, pe] = it.upToPending;
      for (const x of it.epl) if (x[0] > 0 && (x[0] < ps || (x[0] === ps && x[1] <= pe)) && !it.eps[epKey(x[0], x[1])]) it.eps[epKey(x[0], x[1])] = it.watches[it.watches.length - 1] || today();
      delete it.upToPending; changed = true;
    }
    return changed;
  }

  // Series to refresh in the background: the ones you're watching, the oldest check first.
  function stale(lib, now = Date.now()) {
    return lib.all().filter(it => it.type === "show" && (it.status === "watching" || it.status === "watchlist" || it.epsPending || it.upToPending || !it.epl) &&
      now - (it.epChecked || 0) > (it.ended ? 14 : 1) * 864e5).sort((a, b) => (a.epChecked || 0) - (b.epChecked || 0));
  }

  // Sends the outbox to Trakt: watches and episodes to /sync/history, unticked episodes to /sync/history/remove,
  // ratings to /sync/ratings. Needs a signed-in token. Returns a one-line summary; what was sent leaves the outbox.
  async function traktPush(lib, http, clientId, token) {
    if (!token) return "not signed in to Trakt: your changes stay here until you sign in";
    const evs = lib.outbox.slice();
    if (!evs.length) return "nothing new to send";
    const ids = it => { const o = {}; if (it.imdb) o.imdb = it.imdb; if (it.tmdb) o.tmdb = +it.tmdb; return o; };
    const at = d => (d ? `${d}T20:00:00.000Z` : undefined);
    const body = () => ({ movies: [], shows: [] });
    const add = body(), rem = body(), rate = body(), unrate = body();
    const showIn = (b, it) => { let x = b.shows.find(z => z._id === it.id); if (!x) { x = { _id: it.id, ids: ids(it), seasons: [] }; b.shows.push(x); } return x; };
    const epIn = (b, it, s, e, d) => { const sh = showIn(b, it); let se = sh.seasons.find(z => z.number === s); if (!se) { se = { number: s, episodes: [] }; sh.seasons.push(se); } se.episodes.push(d ? { number: e, watched_at: at(d) } : { number: e }); };
    const last = {};
    for (const ev of evs) {
      const it = lib.get(ev.id);
      if (!it) continue;
      if (ev.op === "rate") last["r" + ev.id] = ev;
      else if (ev.op === "ep" || ev.op === "unep") last[`e${ev.id}:${ev.s}:${ev.e}`] = ev;
      else if (ev.op === "watch") add.movies.push({ ids: ids(it), watched_at: at(ev.d) });
    }
    for (const ev of Object.values(last)) {
      const it = lib.get(ev.id);
      if (ev.op === "ep") epIn(add, it, ev.s, ev.e, ev.d);
      else if (ev.op === "unep") epIn(rem, it, ev.s, ev.e);
      else if (ev.op === "rate") { const b = ev.v ? rate : unrate; const row = { ids: ids(it) }; if (ev.v) row.rating = ev.v; (it.type === "show" ? b.shows : b.movies).push(row); }
    }
    const clean = b => ({ movies: b.movies, shows: b.shows.map(({ _id, ...x }) => x) });
    const headers = { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": clientId, Authorization: `Bearer ${token}` };
    const out = [];
    const send = async (path, b, label) => {
      if (!b.movies.length && !b.shows.length) return;
      const r = await http("POST", `https://api.trakt.tv${path}`, { headers, body: JSON.stringify(clean(b)) });
      if (r.status === 401) throw new Error("Trakt sign-in expired: sign in again in Settings");
      if (r.status < 200 || r.status >= 300) throw new Error(`Trakt ${label}: HTTP ${r.status || r.error}`);
      let j = {}; try { j = JSON.parse(r.body || "{}"); } catch (e) { /* counts unknown */ }
      const c = j.added || j.deleted || {};
      out.push(`${label} ${(c.movies || 0) + (c.episodes || 0) + (c.shows || 0)}`);
    };
    await send("/sync/history", add, "added");
    await send("/sync/history/remove", rem, "removed");
    await send("/sync/ratings", rate, "rated");
    await send("/sync/ratings/remove", unrate, "unrated");
    lib.outbox = lib.outbox.slice(evs.length);
    return out.length ? out.join(", ") : "nothing Trakt needed";
  }

  const API = { markBulk, adoptKey, settleShow, searchImdb, searchAnime, fromJikan, animeDetails, traktPush, Library, STATUSES, LABEL, search, details, stale, fromTmdb, fromTvmaze, fromItunes, norm, day, yearOf, epKey, blank, idFor };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Lib = API;
})(typeof window !== "undefined" ? window : globalThis);
