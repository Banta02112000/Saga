/* CanonSync core: data model, parsers, matching, stats and network clients.
   Runs in the Android WebView (via window.Android bridge) and in Node for tests. */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ util
  const MEDIA = ["Movie", "TV Series", "Special", "Video Game"];
  const STOP = new Set(["the", "and", "of", "for", "part", "season", "with"]);
  const IMDB_TYPES = {
    movie: "Movie", featurefilm: "Movie", tvmovie: "Movie", video: "Movie",
    tvseries: "TV Series", tvminiseries: "TV Series", tvmini: "TV Series",
    short: "Special", tvshort: "Special", tvspecial: "Special", musicvideo: "Special",
    videogame: "Video Game", tvepisode: "Episode",
  };

  function norm(title) {
    if (!title) return "";
    let s = String(title).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
    s = s.replace(/&/g, " and ");
    s = s.replace(/\bepisode\s+([ivxlc]+|\d+)\b/g, " ");
    s = s.replace(/[^a-z0-9]+/g, " ").trim();
    s = s.replace(/^(the|a|an)\s+/, "");
    return s.replace(/\s+/g, " ");
  }

  function parseYear(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return v || null;
    const m = String(v).match(/(18|19|20)\d{2}/);
    return m ? parseInt(m[0], 10) : null;
  }

  function mediumFromImdb(t) {
    const key = String(t || "").toLowerCase().replace(/[^a-z]/g, "");
    return IMDB_TYPES[key] || "Movie";
  }

  function mediumFromText(t) {
    const s = String(t || "").toLowerCase();
    if (s.includes("game")) return "Video Game";
    if (["webisode", "special", "short", "minisode", "episode"].some(w => s.includes(w))) return "Special";
    if (s.includes("movie") || s.includes("film")) return "Movie";
    if (["series", "show", "anime", "tv"].some(w => s.includes(w))) return "TV Series";
    return "Movie";
  }

  // "2010-07-16", "2010-07-16T00:00:00Z", "2010-07", {year, month, day} -> "YYYY-MM-DD" / "YYYY-MM" / null
  function parseDate(v) {
    if (!v) return null;
    if (typeof v === "object") {
      if (!v.year) return null;
      const p = n => String(n).padStart(2, "0");
      return v.month ? (v.day ? `${v.year}-${p(v.month)}-${p(v.day)}` : `${v.year}-${p(v.month)}`) : null;
    }
    const m = String(v).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (!m || m[2] === "00" || +m[2] > 12) return null;
    return m[3] && m[3] !== "00" && +m[3] <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
  }

  const tmdbKey = (medium, tmdb) => (medium === "TV Series" ? "t" : "m") + String(tmdb);
  const yearOk = (a, b) => !a || !b || Math.abs(a - b) <= 1;
  const mediumOk = (a, b) => !a || !b || ((a === "Video Game") === (b === "Video Game"));
  const tokens = n => n.split(" ").filter(t => t.length >= 3 && !STOP.has(t));
  // "Saw II" and "Saw III" are 92% alike and a year apart: titles whose sequel numbers differ never fuzzy-match
  const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
  const seqNums = n => n.split(" ").map(t => (/^\d{1,2}$/.test(t) ? +t : ROMAN[t] || 0)).filter(Boolean).join(",");

  // difflib.SequenceMatcher(None, a, b) equivalents (no junk heuristics; titles are short)
  function matchingBlocksTotal(a, b) {
    const b2j = new Map();
    for (let j = 0; j < b.length; j++) {
      const c = b[j];
      if (!b2j.has(c)) b2j.set(c, []);
      b2j.get(c).push(j);
    }
    function longest(alo, ahi, blo, bhi) {
      let besti = alo, bestj = blo, bestsize = 0;
      let j2len = new Map();
      for (let i = alo; i < ahi; i++) {
        const newj2len = new Map();
        const js = b2j.get(a[i]) || [];
        for (const j of js) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
        }
        j2len = newj2len;
      }
      return [besti, bestj, bestsize];
    }
    let total = 0;
    const queue = [[0, a.length, 0, b.length]];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const [i, j, k] = longest(alo, ahi, blo, bhi);
      if (k) {
        total += k;
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    return total;
  }

  function ratio(a, b) {
    const n = a.length + b.length;
    return n ? (2 * matchingBlocksTotal(a, b)) / n : 1;
  }

  // Character-multiset overlap. Titles are normalised to ASCII, so a small counter array beats a Map.
  const QR = new Int32Array(128);
  function quickRatio(a, b) {
    const n = a.length + b.length;
    if (!n) return 1;
    let ascii = true;
    for (let i = 0; i < b.length; i++) { const c = b.charCodeAt(i); if (c > 127) { ascii = false; break; } QR[c]++; }
    let matches = 0;
    if (ascii) {
      for (let i = 0; i < a.length; i++) { const c = a.charCodeAt(i); if (c < 128 && QR[c] > 0) { matches++; QR[c]--; } }
      for (let i = 0; i < b.length; i++) QR[b.charCodeAt(i)] = 0;
      return (2 * matches) / n;
    }
    for (let i = 0; i < b.length; i++) { const c = b.charCodeAt(i); if (c < 128) QR[c] = 0; }
    const avail = new Map();
    for (const c of b) avail.set(c, (avail.get(c) || 0) + 1);
    for (const c of a) {
      const k = avail.get(c) || 0;
      if (k > 0) { matches++; avail.set(c, k - 1); }
    }
    return (2 * matches) / n;
  }

  const realQuickRatio = (a, b) => {
    const n = a.length + b.length;
    return n ? (2 * Math.min(a.length, b.length)) / n : 1;
  };

  class TitleIndex {
    constructor(rows, lazy = false) {
      this.rows = rows;
      this.exact = new Map();
      this.inv = new Map();
      if (!lazy) rows.forEach((r, i) => this._add(r, i));
    }
    // the same, a few thousand rows at a time with a pause in between (0.5.7)
    static async build(rows, pause) {
      const ix = new TitleIndex(rows, true);
      for (let i = 0; i < rows.length; i++) { ix._add(rows[i], i); if ((i & 2047) === 2047) await pause(); }
      return ix;
    }
    _add(r, i) {
      {
        if (!this.exact.has(r.norm)) this.exact.set(r.norm, []);
        this.exact.get(r.norm).push(r);
        const toks = new Set(tokens(r.norm).length ? tokens(r.norm) : [r.norm]);
        for (const t of toks) {
          if (!this.inv.has(t)) this.inv.set(t, []);
          this.inv.get(t).push(i);
        }
      }
    }

    find(n, year, medium, threshold = 0.9, fuzzy = true) {
      for (const r of this.exact.get(n) || []) {
        if (yearOk(year, r.year) && mediumOk(medium, r.medium)) return r;
      }
      if (!fuzzy || !n) return null;
      // Candidates share one of the title's two rarest words: a 90% match keeps at least one of them intact,
      // and skipping common words ("star", "wars", "man") keeps this fast on big libraries.
      const toks = [...new Set(tokens(n).length ? tokens(n) : [n])].map(t => this.inv.get(t) || []).sort((a, b) => a.length - b.length);
      const use = toks.length > 2 ? toks.slice(0, 2) : toks;
      if (!this.mark) { this.mark = new Uint32Array(this.rows.length); this.stamp = 0; }
      const stamp = ++this.stamp, la = n.length;
      let best = null, bestS = 0;
      for (const list of use) {
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          if (this.mark[i] === stamp) continue;
          this.mark[i] = stamp;
          const r = this.rows[i], lb = r.norm.length;
          if ((2 * Math.min(la, lb)) / (la + lb) < threshold) continue;
          if (!(yearOk(year, r.year) && mediumOk(medium, r.medium))) continue;
          if (quickRatio(n, r.norm) < threshold) continue;
          if (seqNums(n) !== seqNums(r.norm)) continue;
          const s = ratio(n, r.norm);
          if (s >= threshold && s > bestS) { best = r; bestS = s; }
        }
      }
      return best;
    }
  }

  const sleep = ms => new Promise(res => setTimeout(res, ms));
  // A request that never answers would leave a scan "loading" forever: give up after ms (the scan can be retried).
  const withTimeout = (p, ms, msg) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(Object.assign(new Error(msg), { timeout: true })), ms);
    p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
  });
  const CONFIG = { listBrowseMs: 360000, listTaskMs: 720000, retryDelayMs: 6000, imdbGapMs: 1500, browseTries: 3, aiGapMs: 3000, aiTimeoutMs: 180000 };

  // ------------------------------------------------------------------ store
  // API keys and sign-in tokens. When the phone offers an encrypted store (persist.secrets: Android Keystore),
  // they live there and never in canonsync.json; without one they stay in settings as before.
  const SECRET_RX = /(^|_)(key|token|refresh|secret|password)s?$|^(token|refresh_token|client_secret|gemini_key|claude_key|ai_key|steam_key|itad_key|tmdb_key)$/i;

  // Saving rewrites the whole file (several MB with a big library), which holds up the screen while it happens.
  // So automatic saves are spaced at least FLUSH_GAP apart, and the look-up cache (posters, episode lists, dates)
  // lives in its own file (persist.cache), written at most every CACHE_GAP: it changes all the time during a sync
  // and losing a few minutes of it only means asking TMDB again.
  const FLUSH_GAP = 4000, CACHE_GAP = 30000;
  // 0.5.6: the saves themselves no longer hold the screen. With persist.saveParts the text is built a few entries at
  // a time (jsonParts), giving way to taps and redraws in between, and handed to the phone in pieces. While a job
  // (a sync) runs, saves are spaced BUSY_GAP apart. The look-up cache is a journal: new entries are appended to
  // cache.log every few seconds (a few KB), and the whole cache is only rewritten when the journal has grown.
  const BUSY_GAP = 25000, LOG_GAP = 5000, LOG_MAX = 1500000;
  const CONFIG_BUSY = { on: false };
  // JSON text of a value in pieces of about 200 KB, never working longer than `budget` ms without a pause.
  // Arrays and plain objects are written entry by entry, two levels down (a store is {key: [thousands of rows]}).
  // `deep`: how many levels below the top are containers of stores rather than stores (a backup is {canon: store, …}: 1).
  async function jsonParts(value, budget = 6, deep = 0) {
    const parts = []; let buf = "", t0 = Date.now();
    // a piece never ends between the two halves of an emoji or other paired character (that would damage it on the way over)
    const cut = n => { const c = buf.charCodeAt(n - 1); return c >= 0xD800 && c <= 0xDBFF ? n - 1 : n; };
    const push = t => { buf += t; while (buf.length > 200000) { const n = cut(200000); parts.push(buf.slice(0, n)); buf = buf.slice(n); } };
    const pause = async () => { if (Date.now() - t0 >= budget) { await new Promise(r => setTimeout(r, 0)); t0 = Date.now(); } };
    const big = v => v && typeof v === "object" && !(typeof v.toJSON === "function") && (Array.isArray(v) ? v.length > 64 : Object.keys(v).length > 64);
    const put = async (v, depth) => {
      if (depth < 3 + deep && v && typeof v === "object" && !(typeof v.toJSON === "function") && (depth <= deep || big(v))) {
        if (Array.isArray(v)) {
          push("[");
          for (let i = 0; i < v.length; i++) { if (i) push(","); if (depth < 2 + deep && (depth < deep || big(v[i]))) await put(v[i], depth + 1); else { const t = JSON.stringify(v[i]); push(t === undefined ? "null" : t); } if ((i & 15) === 15) await pause(); }
          push("]");
        } else {
          push("{"); let first = true, n = 0;
          for (const k of Object.keys(v)) {
            const x = v[k];
            if (x === undefined || typeof x === "function") continue;
            if (depth < 2 + deep && x && typeof x === "object" && (depth < deep || big(x))) { push((first ? "" : ",") + JSON.stringify(k) + ":"); first = false; await put(x, depth + 1); }
            else { const t = JSON.stringify(x); if (t === undefined) continue; push((first ? "" : ",") + JSON.stringify(k) + ":" + t); first = false; }
            if ((++n & 15) === 15) await pause();
          }
          push("}");
        }
      } else { const t = JSON.stringify(v); push(t === undefined ? "null" : t); }
      await pause();
    };
    await put(value && typeof value.toJSON === "function" ? value.toJSON() : value, 0);
    if (buf) parts.push(buf);
    return parts;
  }
  class Store {
    constructor(persist) {
      this.persist = persist || null; // {load(): string, save(text), cache?: {load, save}}
      this.reset();
      this._lastFlush = 0; this._cacheDirty = false; this._cacheTimer = null; this._timer = null;
      this._gen = 0; this._flushing = false; this._again = false; this._log = []; this._logSize = 0; this._compacting = false;
      if (this.persist) {
        const raw = this.persist.load();
        if (raw) {
          try { this.fromJSON(JSON.parse(raw)); } catch (e) { /* corrupted file: start fresh */ }
        }
        this._stamp = this._fileStamp();
        const cp = this.persist.cache;
        if (cp) {
          const fromMain = this.tmdbCache.size;
          try { const t = cp.load(); if (t) for (const [k, v] of JSON.parse(t)) if (!this.tmdbCache.has(k)) this.tmdbCache.set(k, v); } catch (e) { /* a broken cache is just empty */ }
          // the journal: entries added since the cache file was last rewritten (newer, so they win)
          if (cp.loadLog) try { const t = cp.loadLog() || ""; this._logSize = t.length;
            for (const line of t.split("\n")) { if (!line) continue; try { const [k, v] = JSON.parse(line); this.tmdbCache.set(k, v); } catch (e) { /* a torn last line */ } } } catch (e) { /* no journal */ }
          if (fromMain) { this._cacheDirty = true; this._cacheFull = true; this.touch(); } // an older file kept the cache inside: move it out
        }
      }
      this._sec = this._secLoad();
      this._moveSecrets();
    }

    // null when there's no encrypted store; otherwise the stored keys as an object
    _secLoad() {
      const s = this.persist && this.persist.secrets;
      if (!s) return null;
      let t;
      try { t = s.load(); } catch (e) { return null; }
      if (t == null || t === "!") return null;
      try { return t ? JSON.parse(t) || {} : {}; } catch (e) { return {}; }
    }
    _secSave() { try { return !!this.persist.secrets.save(JSON.stringify(this._sec)); } catch (e) { return false; } }
    // keys found in settings (an older version, a restored backup) move to the encrypted store
    _moveSecrets() {
      if (!this._sec || !this.settings) return;
      const moved = Object.keys(this.settings).filter(k => SECRET_RX.test(k));
      if (!moved.length) return;
      const before = Object.assign({}, this._sec);
      for (const k of moved) this._sec[k] = this.settings[k];
      if (!this._secSave()) { this._sec = before; return; } // couldn't write it: leave everything where it was
      for (const k of moved) delete this.settings[k];
      this.touch();
    }
    secretsOn() { return !!this._sec; }
    secretsAll() { return Object.assign({}, this._sec || {}); }

    reset() {
      this.settings = {};
      this.itemsMap = new VMap();
      this.exclusionsMap = new Map();
      this.canonMap = new Map();
      this.specialsMap = new Map();
      this.franchiseMap = new Map();
      this.tmdbCache = new Map();
    }

    toJSON() {
      return {
        v: 1, settings: this.settings, items: [...this.itemsMap.values()],
        exclusions: [...this.exclusionsMap.values()], canon: [...this.canonMap.values()],
        specials: [...this.specialsMap.values()], franchiseMap: [...this.franchiseMap.values()],
        tmdbCache: this.persist && this.persist.cache ? [] : [...this.tmdbCache.entries()],
      };
    }

    fromJSON(d) {
      this.settings = d.settings || {};
      for (const it of d.items || []) this.itemsMap.set(Store.itemId(it), it);
      for (const x of d.exclusions || []) this.exclusionsMap.set(x.key, x);
      for (const c of d.canon || []) this.canonMap.set(Store.canonId(c), c);
      for (const s of d.specials || []) this.specialsMap.set(s.imdb, s);
      for (const f of d.franchiseMap || []) this.franchiseMap.set(`${f.franchise}|${f.norm}|${f.year}`, f);
      for (const [k, v] of d.tmdbCache || []) this.tmdbCache.set(k, v);
      if (this._sec) this._moveSecrets();
    }

    touch() {
      if (!this.persist) return;
      clearTimeout(this._timer);
      // 0.5.7: while a job (a sync) runs, nothing is saved: building a multi-MB text again and again is what lagged.
      // It's saved once when the job ends; leaving the app saves at once.
      if (CONFIG_BUSY.on && this.persist.saveParts) { this._dirty = true; return; }
      this._timer = setTimeout(() => this.flush(), Math.max(400, FLUSH_GAP - (Date.now() - this._lastFlush)));
    }
    _cacheTouch() {
      if (!this.persist) return;
      if (!this.persist.cache) { this.touch(); return; }
      this._cacheDirty = true;
      if (!this._cacheTimer) this._cacheTimer = setTimeout(() => this.flushCache(), this.persist.cache.append ? LOG_GAP : CACHE_GAP);
    }
    _cacheLog(k, v) { if (this.persist && this.persist.cache && this.persist.cache.append) this._log.push(JSON.stringify([k, v])); else this._cacheFull = true; }
    flushCache(sync = false) {
      clearTimeout(this._cacheTimer); this._cacheTimer = null;
      const cp = this.persist && this.persist.cache;
      if (!cp || !this._cacheDirty) return;
      if (cp.append && cp.saveParts) {
        if (this._compacting) { if (!sync) this._cacheTimer = setTimeout(() => this.flushCache(), LOG_GAP); return; } // the journal is being folded in: wait
        if (this._log.length) {
          const lines = this._log; this._log = [];
          try { let t = ""; for (const l of lines) { t += l + "\n"; if (t.length > 150000) { cp.append(t); this._logSize += t.length; t = ""; } } if (t) { cp.append(t); this._logSize += t.length; } } catch (e) { /* asked again later */ }
        }
        this._cacheDirty = false;
        if ((this._cacheFull || this._logSize > LOG_MAX) && !sync) this._compact();
        return;
      }
      this._cacheDirty = false; this._cacheFull = false;
      try { this.persist.cache.save(JSON.stringify([...this.tmdbCache.entries()])); } catch (e) { this._cacheDirty = true; }
    }
    // the whole cache rewritten in pieces, then the journal emptied; not while a job is running
    async _compact() {
      const cp = this.persist.cache;
      if (this._compacting) return;
      if (CONFIG_BUSY.on) { this._cacheDirty = true; if (!this._cacheTimer) this._cacheTimer = setTimeout(() => this.flushCache(), BUSY_GAP); return; }
      this._compacting = true;
      try {
        const parts = await jsonParts([...this.tmdbCache.entries()]);
        if (await cp.saveParts(parts)) { if (cp.clearLog) cp.clearLog(); this._logSize = 0; this._cacheFull = false; }
      } catch (e) { /* next time */ }
      this._compacting = false;
      if (this._log.length) this._cacheTouch();
    }

    // sync: wait for the disk (leaving the app); otherwise the phone writes it in the background when it can
    flush(sync = false) {
      if (!this.persist) return;
      clearTimeout(this._timer);
      this._timer = null;
      this._dirty = false;
      if (!sync && this.persist.saveParts) { this._flushParts(); return; }
      this._gen++; // a save in pieces that's still under way is now out of date
      const text = JSON.stringify(this.toJSON());
      if (!sync && this.persist.saveLater) { this.persist.saveLater(text); this._stamp = null; }
      else { this.persist.save(text); this._stamp = this._fileStamp(); }
      this._lastFlush = Date.now();
      if (this._cacheDirty) this.flushCache(sync);
    }
    // the same save without holding the screen: built and handed over in pieces. Changes made meanwhile are saved by the next one.
    async _flushParts() {
      if (this._flushing) { this._again = true; return; }
      this._flushing = true;
      try {
        do {
          this._again = false;
          if (this.persist.prepare) await this.persist.prepare();
          const gen = ++this._gen;
          const parts = await jsonParts(this.toJSON());
          if (gen !== this._gen) break;
          if (await this.persist.saveParts(parts, () => gen === this._gen)) { this._stamp = null; this._lastFlush = Date.now(); }
        } while (this._again);
      } catch (e) { /* the next change saves again */ }
      this._flushing = false;
      if (this._cacheDirty && !this._cacheTimer) this.flushCache();
    }
    // resolves when nothing is waiting to be saved (tests, and before a backup)
    async settled() { for (let i = 0; i < 400 && (this._flushing || this._compacting); i++) await new Promise(r => setTimeout(r, 25)); }
    // the stamp our own last write left; after a background write it's asked for only when needed
    _ownStamp() { if (this._stamp === null) this._stamp = this.persist && this.persist.ownStamp ? String(this.persist.ownStamp() || "") : this._fileStamp(); return this._stamp; }

    _fileStamp() { try { return this.persist && this.persist.stamp ? String(this.persist.stamp() || "") : ""; } catch (e) { return ""; } }

    static itemId(it) { return `${it.source}|${it.kind}|${it.list_name}|${it.key}`; }
    static canonId(c) { return `${c.franchise}|${c.norm}|${c.year}|${c.origin}`; }

    get(k, d = "") { if (this._sec && k in this._sec && SECRET_RX.test(k)) return this._sec[k]; return k in this.settings ? this.settings[k] : d; }
    has(k) { return (this._sec && k in this._sec) || k in this.settings; }
    set(k, v) {
      if (this._sec && SECRET_RX.test(k)) {
        const old = this._sec[k];
        if (old === String(v) && !(k in this.settings)) return; // unchanged: no Keystore write (each one costs time on the phone)
        this._sec[k] = String(v);
        if (this._secSave()) { if (k in this.settings) { delete this.settings[k]; this.touch(); } return; }
        if (old === undefined) delete this._sec[k]; else this._sec[k] = old;
      }
      this.settings[k] = String(v); this.touch();
    }

    // 0.5.9: the same, 400 rows at a time with a pause in between (a sync adds tens of thousands of rows)
    async addItemsAsync(items, source, kind, listName = "", pause = () => breathe(0)) {
      let n = 0;
      for (let i = 0; i < items.length; i += 400) { n += this.addItems(items.slice(i, i + 400), source, kind, listName); if (i + 400 < items.length) await pause(); }
      return n;
    }
    addItems(items, source, kind, listName = "") {
      let n = 0;
      for (const it of items) {
        const title = it.title || "";
        const nm = norm(title);
        const y = parseYear(it.year) || 0;
        const med = it.medium || "Movie";
        const imdb = it.imdb || null;
        const tmdb = it.tmdb ? String(it.tmdb) : null;
        if (!nm && !imdb) continue;
        const key = imdb || (tmdb ? tmdbKey(med, tmdb) : `${nm}|${y || ""}`);
        const row = {
          source, kind, list_name: listName, imdb, tmdb, trakt: it.trakt ? String(it.trakt) : null,
          title, norm: nm, year: y || null, medium: med, rating: it.rating || null, key,
          genres: it.genres || "", runtime: it.runtime || null, rated_at: it.rated_at || null, date: parseDate(it.date),
        };
        this.itemsMap.set(Store.itemId(row), row);
        n++;
      }
      this.touch();
      return n;
    }

    // 0.6.2: the same question asked again (the canon check, stats, the Home screen) is answered from the last answer,
    // until a row is added or removed. A copy is handed out, so a caller sorting it changes nothing here.
    items(source = null, kinds = null) {
      const m = this.itemsMap, key = `${source || "*"}|${(kinds || []).join(",")}`;
      if (!(m instanceof VMap)) return this.itemsScan(source, kinds);
      if (!this._itemsCache || this._itemsCache.ver !== m.ver || this._itemsCache.map !== m) this._itemsCache = { ver: m.ver, map: m, q: new Map() };
      let hit = this._itemsCache.q.get(key);
      if (!hit) { hit = this.itemsScan(source, kinds); this._itemsCache.q.set(key, hit); }
      return hit.slice();
    }
    itemsScan(source = null, kinds = null) {
      const out = [];
      for (const r of this.itemsMap.values()) {
        if (source && r.source !== source) continue;
        if (kinds && !kinds.includes(r.kind)) continue;
        out.push(r);
      }
      return out;
    }

    addExclusion(title, year, medium, imdb = null) {
      const n = norm(title);
      const key = imdb || `${n}|${year || ""}`;
      this.exclusionsMap.set(key, { key, imdb, title, norm: n, year: parseYear(year) || null, medium });
      this.touch();
    }

    removeExclusion(key) { this.exclusionsMap.delete(key); this.touch(); }

    exclusions() {
      return [...this.exclusionsMap.values()].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    }

    hiddenFranchises() {
      try { return new Set(JSON.parse(this.get("hidden_franchises", "[]"))); } catch (e) { return new Set(); }
    }

    setHidden(name, hidden) {
      const h = this.hiddenFranchises();
      if (hidden) h.add(name); else h.delete(name);
      this.set("hidden_franchises", JSON.stringify([...h].sort()));
    }

    // Shows and releases you've hidden from the Upcoming calendar (and its notifications).
    upHidden() {
      try { return JSON.parse(this.get("up_hidden", "{}")) || {}; } catch (e) { return {}; }
    }

    setUpHidden(key, label, on) {
      const m = this.upHidden();
      if (on) m[key] = { label }; else delete m[key];
      this.set("up_hidden", JSON.stringify(m));
    }

    // Entries you've ruled out of a franchise's canon (compilations, recaps, non-canon spin-offs).
    // Keyed by IMDb ID and by title/year/type so the mark survives a source adding or dropping the ID.
    notCanon() {
      try { return JSON.parse(this.get("not_canon", "{}")) || {}; } catch (e) { return {}; }
    }

    setNotCanon(c, on) {
      const m = this.notCanon();
      const keys = canonKeys(c);
      if (on) {
        const info = { title: c.title, year: c.year || null, medium: c.medium, franchise: c.franchise || "" };
        for (const k of keys) m[k] = info;
      } else {
        for (const k of keys) delete m[k];
        // also drop sibling keys pointing at the same entry
        for (const [k, v] of Object.entries(m)) if (v.title === c.title && (v.year || null) === (c.year || null)) delete m[k];
      }
      this.set("not_canon", JSON.stringify(m));
    }

    replaceCanon(origin, rows) {
      for (const [k, c] of this.canonMap) if (c.origin === origin) this.canonMap.delete(k);
      let n = 0;
      for (const r of rows) {
        const t = r.title || "";
        if (!t.trim()) continue;
        const c = {
          franchise: r.franchise || "Unsorted", title: t, norm: norm(t), year: parseYear(r.year) || null,
          medium: r.medium || "Movie", imdb: r.imdb || null, tmdb: r.tmdb ? String(r.tmdb) : null, origin,
          date: parseDate(r.date), src: r.src || null, poster: r.poster || null, sub: r.sub || null,
        };
        if (!c.year && c.date) c.year = parseInt(c.date.slice(0, 4), 10);
        const id = Store.canonId(c);
        if (!this.canonMap.has(id)) this.canonMap.set(id, c);
        n++;
      }
      this.touch();
      return n;
    }

    // Adds rows for an origin without removing earlier ones (used by the incremental Gemini scan).
    mergeCanon(origin, rows) {
      const keep = this.canon().filter(c => c.origin === origin);
      return this.replaceCanon(origin, keep.concat(rows)) - keep.length;
    }

    canon() { return [...this.canonMap.values()]; }

    // Sets release dates found by a verify pass on every stored canon row with the same title (and a compatible year).
    setCanonDates(rows) {
      let n = 0;
      for (const r of rows) {
        const d = parseDate(r.date), t = norm(r.title || "");
        if (!d || !t) continue;
        for (const c of this.canonMap.values()) {
          if (c.norm !== t) continue;
          if (r.franchise && franchiseName(c.franchise) !== franchiseName(r.franchise)) continue;
          if (r.year && c.year && Math.abs(c.year - parseYear(r.year)) > 1) continue;
          if (c.date === d) continue;
          c.date = d;
          if (!c.year) c.year = parseInt(d.slice(0, 4), 10);
          n++;
        }
      }
      if (n) this.touch();
      return n;
    }

    upsertSpecial(imdb, title, status, note) {
      this.specialsMap.set(imdb, { imdb, title, status, note, checked_at: Date.now() });
      this.touch();
    }

    specials() {
      return [...this.specialsMap.values()].sort((a, b) =>
        a.status.localeCompare(b.status) || (a.title || "").localeCompare(b.title || ""));
    }

    addFranchiseRows(rows) {
      let n = 0;
      for (const r of rows) {
        if (!r.title || !r.franchise) continue;
        const f = { franchise: r.franchise, title: r.title, norm: norm(r.title), imdb: r.imdb || null,
                    year: parseYear(r.year) || null };
        const k = `${f.franchise}|${f.norm}|${f.year}`;
        if (!this.franchiseMap.has(k)) { this.franchiseMap.set(k, f); n++; }
      }
      this.touch();
      return n;
    }

    franchiseHints() {
      const out = new Map();
      for (const f of this.franchiseMap.values()) out.set(f.norm, f.franchise);
      return out;
    }

    cacheGet(k) { return this.tmdbCache.has(k) ? this.tmdbCache.get(k) : null; }
    cacheSet(k, v) { this.tmdbCache.set(k, v); this._cacheLog(k, v); this._cacheTouch(); }

    // Re-read the saved file (the background job may have updated it while the app was paused).
    // Returns true when the file had changed and was re-read. Unsaved changes are written first.
    // 0.5.9: replaces everything in memory with d (a merged file from the website), keeping the look-up cache
    loadData(d) {
      const sec = this._secLoad ? this._secLoad() : null; if (sec) this._sec = sec;
      const keep = this.tmdbCache; this._gen++; this.reset(); this.fromJSON(d);
      for (const [k, v] of keep) if (!this.tmdbCache.has(k)) this.tmdbCache.set(k, v);
    }
    reload() {
      if (!this.persist) return false;
      if (this._timer) this.flush(true);
      const own = this._ownStamp(), st = this._fileStamp();
      if (st && st === own) return false;
      const raw = this.persist.load();
      if (!raw) return false;
      try { const d = JSON.parse(raw); const sec = this._secLoad(); if (sec) this._sec = sec; const keep = this.tmdbCache; this._gen++; this.reset(); this.fromJSON(d);
        for (const [k, v] of keep) if (!this.tmdbCache.has(k)) this.tmdbCache.set(k, v); // the cache file isn't part of the reload
        if (this.persist.cache && d.tmdbCache && d.tmdbCache.length) { this._cacheFull = true; this._cacheTouch(); }
        this._stamp = st; return true; } catch (e) { return false; }
    }
    cachePut(k, tmdbId, cid, cname) { const v = { tmdb_id: tmdbId, collection_id: cid, collection_name: cname }; this.tmdbCache.set(k, v); this._cacheLog(k, v); this._cacheTouch(); }

    counters() {
      const watched = new Set(), all = new Set(), listed = new Set(), games = new Set(), by = {};
      for (const r of this.itemsMap.values()) {
        all.add(r.key);
        if (r.medium === "Video Game") games.add(r.key);
        if (r.kind === "list" || r.kind === "watchlist" || r.kind === "collection") listed.add(r.key);
        if (r.kind === "watched" || r.kind === "rated") {
          if (!watched.has(r.key)) by[r.medium] = (by[r.medium] || 0) + 1;
          watched.add(r.key);
        }
      }
      return {
        watched: watched.size, excluded: all.size + this.exclusionsMap.size, listed: listed.size,
        movies: by["Movie"] || 0, series: by["TV Series"] || 0, games: games.size, gamesPlayed: by["Video Game"] || 0,
      };
    }

    clearCache() {
      const keep = this.settings, excl = this.exclusionsMap;
      this.reset();
      delete keep.gemini_sent;
      this.settings = keep;
      this.exclusionsMap = excl;
      this.touch();
    }
  }

  // ------------------------------------------------------------------ parsers
  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch !== "\r") field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function csvDicts(text) {
    const rows = parseCsv(text.replace(/^﻿/, ""));
    if (!rows.length) return { heads: [], dicts: [] };
    const heads = rows[0].map(h => h.trim());
    const dicts = rows.slice(1).filter(r => r.some(c => c.trim())).map(r => {
      const o = {};
      heads.forEach((h, i) => { o[h] = (r[i] || "").trim(); });
      return o;
    });
    return { heads, dicts };
  }

  function g(row, ...names) {
    for (const n of names) {
      for (const k of Object.keys(row)) if (k.toLowerCase() === n.toLowerCase()) return row[k];
    }
    return "";
  }

  const toInt = v => { const n = parseInt(parseFloat(v), 10); return Number.isFinite(n) ? n : null; };

  function parseImdbText(text, kind = "auto") {
    text = (text || "").replace(/^﻿/, "");
    if (!text.split("\n", 1)[0].includes("Const")) return {};
    const groups = {};
    for (const row of csvDicts(text).dicts) {
      const c = g(row, "Const"), title = g(row, "Title", "Original Title");
      if (!c && !title) continue;
      const rating = toInt(g(row, "Your Rating"));
      const k = kind === "auto" ? (rating ? "rated" : "watched") : kind;
      (groups[k] = groups[k] || []).push({
        imdb: c.startsWith("tt") ? c : null, title, year: parseYear(g(row, "Year")),
        medium: mediumFromImdb(g(row, "Title Type")), rating, genres: g(row, "Genres"),
        runtime: toInt(g(row, "Runtime (mins)")), rated_at: (g(row, "Date Rated") || "").slice(0, 10) || null,
        date: parseDate(g(row, "Release Date")),
      });
    }
    return groups;
  }

  const stem = name => String(name || "").replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");

  function importImdbCsv(db, name, text, kind = "auto") {
    const groups = parseImdbText(text, kind);
    if (!Object.keys(groups).length) throw new Error(`${name} is not an IMDb CSV export (no Const column)`);
    const ln = kind === "list" ? stem(name) : "";
    let total = 0;
    for (const [k, items] of Object.entries(groups)) total += db.addItems(items, "imdb", k, ln);
    return total;
  }

  function importFranchiseFile(db, name, text) {
    const rows = [];
    text = text.replace(/^﻿/, "");
    if (/\.csv$/i.test(name)) {
      const { heads, dicts } = csvDicts(text);
      const low = h => h.toLowerCase();
      const fcol = heads.find(h => low(h).includes("universe")) || heads.find(h => low(h).includes("franchise")) || heads[0];
      const tcol = heads.find(h => ["title", "name"].includes(low(h))) || heads.find(h => low(h).includes("title")) || heads[1];
      const icol = heads.find(h => ["const", "imdb", "imdb_id", "imdb id"].includes(low(h)));
      const ycol = heads.find(h => low(h).includes("year"));
      for (const r of dicts) {
        if (fcol && tcol && r[fcol] && r[tcol]) {
          rows.push({ franchise: r[fcol], title: r[tcol], imdb: icol ? r[icol] || null : null, year: ycol ? r[ycol] : null });
        }
      }
    } else {
      let current = null;
      for (const line of text.split(/\r?\n/)) {
        const s = line.trim();
        if (!s) continue;
        if (/^(#+|=+|-{3,})/.test(s) || s.endsWith(":")) {
          current = s.replace(/^[#=\-\s]+|[=\-\s:]+$/g, "");
          continue;
        }
        if (s.includes(":") && s.includes(";")) {
          const i = s.indexOf(":");
          const head = s.slice(0, i).trim();
          for (const t of s.slice(i + 1).split(";")) if (t.trim()) rows.push({ franchise: head, title: t.trim() });
          continue;
        }
        if (current) {
          const t = s.replace(/^[\-\*•\d\.\)\s]+/, "");
          const m = t.match(/\((\d{4})\)\s*$/);
          rows.push({ franchise: current, title: t.replace(/\s*\(\d{4}\)\s*$/, ""), year: m ? m[1] : null });
        }
      }
    }
    return db.addFranchiseRows(rows);
  }

  function traktEntries(data) {
    const out = [];
    const stack = [data];
    while (stack.length) {
      const n = stack.pop();
      if (Array.isArray(n)) { for (let i = n.length - 1; i >= 0; i--) stack.push(n[i]); continue; }
      if (!n || typeof n !== "object") continue;
      let found = false;
      for (const [k, medium] of [["movie", "Movie"], ["show", "TV Series"]]) {
        const v = n[k];
        if (v && typeof v === "object" && v.title) {
          const ids = v.ids || {};
          let rating = [undefined, null, "movie", "show"].includes(n.type) ? n.rating : null;
          rating = Number.isInteger(rating) ? rating : null;
          out.push({
            medium, title: v.title, year: v.year, imdb: ids.imdb, tmdb: ids.tmdb, trakt: ids.trakt,
            rating, runtime: v.runtime || null, rated_at: rating ? (n.rated_at || "").slice(0, 10) || null : null,
            date: parseDate(v.released || v.first_aired),
          });
          found = true;
        }
      }
      if (!found) for (const v of Object.values(n)) if (v && typeof v === "object") stack.push(v);
    }
    return out;
  }

  function routeTraktFile(base) {
    const b = base.toLowerCase();
    if (b.startsWith("watched")) return ["watched", ""];
    if (b.startsWith("ratings")) return ["rated", ""];
    if (b.startsWith("collection")) return ["collection", ""];
    if (b.startsWith("lists-watchlist") || b === "watchlist") return ["watchlist", ""];
    if (b.startsWith("lists-list-")) return ["list", b.slice("lists-list-".length).replace(/^\d+-/, "")];
    if (b.startsWith("lists-")) return ["list", b.slice("lists-".length)];
    return [null, ""];
  }

  // Episode ratings from Trakt (the API's /ratings and the export's ratings files): kept per show, merged with what's stored.
  function traktEpRatings(db, data) {
    if (!Array.isArray(data)) return 0;
    let m = null, n = 0;
    for (const x of data) {
      if (!x || !x.episode || !x.show || !Number.isInteger(x.rating) || (x.type && x.type !== "episode")) continue;
      const sn = x.episode.season, en = x.episode.number, ids = x.show.ids || {};
      if (!Number.isInteger(sn) || !Number.isInteger(en) || sn < 0) continue;
      if (!m) { try { m = JSON.parse(db.get("ep_ratings", "{}")) || {}; } catch (e) { m = {}; } }
      const k = ids.tmdb ? String(ids.tmdb) : ids.imdb || "t:" + norm(x.show.title);
      const e = m[k] = m[k] || { t: x.show.title, y: x.show.year || null, imdb: ids.imdb || null, tmdb: ids.tmdb || null, r: {} };
      if (e.r[`${sn}:${en}`] !== x.rating) { e.r[`${sn}:${en}`] = x.rating; n++; }
      if (x.rated_at) { e.d = e.d || {}; if (e.d[`${sn}:${en}`] !== x.rated_at.slice(0, 10)) { e.d[`${sn}:${en}`] = x.rated_at.slice(0, 10); n++; } } // 0.5.9: the day, for "watched on"
    }
    if (n) db.set("ep_ratings", JSON.stringify(m));
    return n;
  }
  async function storeTraktAsync(db, data, kind, listName = "") {
    if (kind === "rated") traktEpRatings(db, data);
    await breathe(0);
    let items = traktEntries(data);
    if (kind === "rated") items = items.filter(i => i.rating);
    await breathe(0);
    return db.addItemsAsync ? db.addItemsAsync(items, "trakt", kind, listName) : db.addItems(items, "trakt", kind, listName);
  }
  function storeTrakt(db, data, kind, listName = "") {
    if (kind === "rated") traktEpRatings(db, data);
    let items = traktEntries(data);
    if (kind === "rated") items = items.filter(i => i.rating);
    return db.addItems(items, "trakt", kind, listName);
  }

  function importTraktZip(db, files) {
    let total = 0;
    for (const [name, text] of Object.entries(files)) {
      if (!/\.json$/i.test(name)) continue;
      const [kind, ln] = routeTraktFile(stem(name));
      if (!kind) continue;
      let data;
      try { data = JSON.parse(text.replace(/^﻿/, "")); } catch (e) { continue; }
      total += storeTrakt(db, data, kind, ln);
      // the export's watched-shows file has every episode: it becomes series progress, as a live sync would
      if (/^watched[-_]shows$/i.test(stem(name)) && Array.isArray(data)) {
        let prev = {};
        try { prev = JSON.parse(db.get("trakt_progress", "{}")) || {}; } catch (e) { prev = {}; }
        db.set("trakt_progress", JSON.stringify(Object.assign(prev, watchProgress(data))));
      }
    }
    return total;
  }

  // ------------------------------------------------------------------ engine
  function dedupe(rows) {
    const seen = new Set(), out = [];
    for (const r of rows) if (!seen.has(r.key)) { seen.add(r.key); out.push(r); }
    return out;
  }

  const consumed = (db, source = null) => dedupe(db.items(source, ["watched", "rated"]));
  // Everything that tells us which franchises you care about: seen titles first, then titles on your lists.
  const seeds = db => dedupe(db.items(null, ["rated"]).concat(db.items(null, ["watched"]), db.items(null, ["watchlist", "list", "collection"])));

  class MatchSet {
    constructor(rows, lazy = false) {
      this.imdb = new Set(rows.filter(r => r.imdb).map(r => r.imdb));
      this.tmdb = new Set(rows.filter(r => r.tmdb).map(r => tmdbKey(r.medium, r.tmdb)));
      const seen = new Set(), slim = [];
      for (const r of rows) {
        const k = `${r.norm}|${r.year}|${r.medium}`;
        if (r.norm && !seen.has(k)) { seen.add(k); slim.push({ norm: r.norm, year: r.year, medium: r.medium }); }
      }
      this.slim = slim;
      if (!lazy) this.index = new TitleIndex(slim);
    }
    static async build(rows, pause) {
      const m = new MatchSet(rows, true);
      await pause();
      m.index = await TitleIndex.build(m.slim, pause);
      return m;
    }

    matches(c, threshold) {
      if (c.imdb && this.imdb.has(c.imdb)) return true;
      if (c.tmdb && this.tmdb.has(tmdbKey(c.medium, c.tmdb))) return true;
      // Entries with an IMDb ID only get an exact-title fallback; AI titles without IDs get fuzzy matching.
      return this.index.find(c.norm, c.year, c.medium, threshold, !c.imdb) !== null;
    }
  }

  const SEEN_KINDS = ["watched", "rated"];
  const LIST_KINDS = ["list", "watchlist", "collection"];

  // seen = watched, rated or marked as seen in the app; listed = on any of your IMDb/Trakt lists or watchlists.
  class Exclusion {
    constructor(db, lazy = false) {
      if (lazy) return;
      this.seen = new MatchSet(db.items(null, SEEN_KINDS).concat(db.exclusions().map(r => Object.assign({}, r, { tmdb: null }))));
      this.listed = new MatchSet(db.items(null, LIST_KINDS));
    }
    static async build(db, pause) {
      const ex = new Exclusion(db, true);
      const seenRows = db.items(null, SEEN_KINDS).concat(db.exclusions().map(r => Object.assign({}, r, { tmdb: null })));
      await pause();
      ex.seen = await MatchSet.build(seenRows, pause);
      const listRows = db.items(null, LIST_KINDS);
      await pause();
      ex.listed = await MatchSet.build(listRows, pause);
      return ex;
    }

    state(c, threshold) {
      if (this.seen.matches(c, threshold)) return "seen";
      if (this.listed.matches(c, threshold)) return "listed";
      return "missing";
    }

    matches(c, threshold) { return this.state(c, threshold) !== "missing"; }
  }

  // Release order key: exact date first, then month, then year-only entries at the end of their year.
  const releaseKey = c => c.date ? (c.date.length === 7 ? `${c.date}-32` : c.date) : (c.year ? `${c.year}-13` : "9999");

  const canonKeys = c => {
    const ks = [`n|${c.norm || norm(c.title)}|${c.year || ""}|${c.medium || ""}`];
    if (c.imdb) ks.unshift(c.imdb);
    return ks;
  };

  const franchiseName = name => (String(name || "Unsorted").trim().replace(/\s+collection$/i, "") || "Unsorted");

  // the same as canonStatus without holding the screen: the slow part (indexing everything you've seen) in slices
  async function canonStatusAsync(db, threshold = 0.9, pause = () => breathe(0)) {
    const ex = await Exclusion.build(db, pause);
    await pause();
    return canonStatus(db, threshold, ex);
  }
  function canonStatus(db, threshold = 0.9, prebuilt = null) {
    const ex = prebuilt || new Exclusion(db);
    const hidden = db.hiddenFranchises();
    const notCanon = db.notCanon();
    const alias = mvAlias(db);
    const rows = db.canon().slice().sort((a, b) => (a.imdb === null) - (b.imdb === null) || a.origin.localeCompare(b.origin));
    const kept = new Map(), out = [];
    for (const c0 of rows) {
      const list = kept.get(c0.norm) || [];
      const dup = list.find(k => yearOk(c0.year, k.year) && mediumOk(c0.medium, k.medium));
      if (dup) {
        if (!dup.origin.split("+").includes(c0.origin)) dup.origin += "+" + c0.origin;
        if (c0.date && (!dup.date || dup.date.length < c0.date.length)) dup.date = c0.date;
        if (c0.poster && !dup.poster) dup.poster = c0.poster;
        continue;
      }
      const c = Object.assign({}, c0);
      const fr0 = franchiseName(c.franchise), mv = alias[fr0];
      c.franchise = mv || fr0;
      if (mv && mv !== fr0 && !c.sub) c.sub = fr0;
      if (hidden.has(c.franchise)) continue;
      if (canonKeys(c).some(k => notCanon[k])) continue;
      if (!c.poster) { const pc = db.cacheGet(posterKey(c)); if (pc && pc.p) c.poster = pc.p; }
      c.state = ex.state(c, threshold);
      c.have = c.state !== "missing";
      list.push(c);
      kept.set(c.norm, list);
      out.push(c);
    }
    return out;
  }

  function franchiseProgress(status) {
    const fr = new Map();
    for (const c of status) {
      if (!fr.has(c.franchise)) fr.set(c.franchise, { name: c.franchise, have: 0, seen: 0, listed: 0, total: 0, missing: {} });
      const f = fr.get(c.franchise);
      f.total++;
      if (c.state === "seen") f.seen++;
      else if (c.state === "listed") f.listed++;
      if (c.have) f.have++; else f.missing[c.medium] = (f.missing[c.medium] || 0) + 1;
    }
    const out = [...fr.values()];
    for (const f of out) f.pct = f.total ? f.have / f.total : 0;
    return out;
  }

  // For each franchise you've started (seen or listed something), the earliest-released entry still missing.
  function upNextMap(status) {
    const m = new Map();
    const today = new Date().toISOString().slice(0, 10), year = +today.slice(0, 4);
    for (const c of status) {
      if (c.have) continue;
      // not out yet (a future date, a future year, or no date at all): nothing to watch, so it can't be "next"
      if (c.date ? (c.date.length === 7 ? c.date > today.slice(0, 7) : c.date > today) : (!c.year || c.year > year)) continue;
      const cur = m.get(c.franchise);
      if (!cur || releaseKey(c) < releaseKey(cur) || (releaseKey(c) === releaseKey(cur) && c.title < cur.title)) m.set(c.franchise, c);
    }
    return m;
  }

  function upNext(status, limit = 6) {
    const nexts = upNextMap(status);
    const out = [];
    for (const f of franchiseProgress(status)) {
      if (f.have === 0 || f.have === f.total) continue;
      const missing = f.total - f.have;
      if (!nexts.get(f.name)) continue; // everything still missing is unreleased
      out.push(Object.assign({}, nexts.get(f.name), { pct: f.pct, left: missing }));
    }
    out.sort((a, b) => b.pct - a.pct || a.left - b.left);
    return out.slice(0, limit);
  }

  // Missing canon in release order. Up next entries are flagged; unreleased titles go to `upcoming`.
  function releaseList(status, today = new Date().toISOString().slice(0, 10)) {
    const nexts = upNextMap(status);
    const started = new Set(franchiseProgress(status).filter(f => f.have > 0).map(f => f.name));
    const rows = status.filter(c => !c.have).map(c => Object.assign({}, c, {
      upNext: started.has(c.franchise) && nexts.get(c.franchise) === c,
    }));
    rows.sort((a, b) => releaseKey(a).localeCompare(releaseKey(b)) || a.title.localeCompare(b.title));
    const year = new Date(today).getFullYear();
    const isFuture = c => (c.date ? c.date > today : (c.year || 0) > year);
    return { released: rows.filter(c => !isFuture(c)), upcoming: rows.filter(isFuture) };
  }

  // Ratings and watch state per title on each platform, keyed by IMDb ID.
  function platformRatings(db) {
    const m = new Map();
    for (const r of db.items(null, ["watched", "rated"])) {
      if (!r.imdb || r.source === "app") continue; // the app's own library is not a platform to compare
      const e = m.get(r.imdb) || { imdb: null, trakt: null };
      const side = r.source === "imdb" ? "imdb" : "trakt";
      const cur = e[side] || { rating: null, watched: false, rated_at: null };
      if (r.kind === "rated" && r.rating) { cur.rating = r.rating; cur.rated_at = r.rated_at || cur.rated_at; }
      cur.watched = true;
      e[side] = cur;
      m.set(r.imdb, e);
    }
    return m;
  }

  function ratingDiffs(db) {
    const out = [];
    const firstRow = new Map();
    for (const r of db.items(null, ["watched", "rated"])) if (r.imdb && !firstRow.has(r.imdb)) firstRow.set(r.imdb, r);
    for (const [id, e] of platformRatings(db)) {
      if (e.imdb && e.trakt && e.imdb.rating && e.trakt.rating && e.imdb.rating !== e.trakt.rating) {
        const r = firstRow.get(id);
        out.push(Object.assign({}, r, { imdbRating: e.imdb.rating, traktRating: e.trakt.rating }));
      }
    }
    return out.sort((a, b) => Math.abs(b.imdbRating - b.traktRating) - Math.abs(a.imdbRating - a.traktRating) || a.title.localeCompare(b.title));
  }

  const missingCanon = (db, threshold = 0.9, status = null) =>
    (status || canonStatus(db, threshold)).filter(c => !c.have);

  function discrepancies(db) {
    const imdb = consumed(db, "imdb"), trakt = consumed(db, "trakt");
    const tIds = new Set(trakt.filter(i => i.imdb).map(i => i.imdb));
    const iIds = new Set(imdb.filter(i => i.imdb).map(i => i.imdb));
    const warning = imdb.length && trakt.length ? "" : "Load both IMDb and Trakt data before comparing.";
    return {
      warning,
      imdb_not_trakt: warning ? [] : imdb.filter(i => !["Video Game", "Episode"].includes(i.medium) && i.imdb && !tIds.has(i.imdb)),
      trakt_not_imdb: warning ? [] : trakt.filter(i => i.medium !== "Episode" && (!i.imdb || !iIds.has(i.imdb))),
      games: imdb.filter(i => i.medium === "Video Game"),
    };
  }

  // ------------------------------------------------------------------ stats
  function count(arr, fn) {
    const m = new Map();
    for (const x of arr) { const k = fn(x); if (k !== null && k !== undefined) m.set(k, (m.get(k) || 0) + 1); }
    return m;
  }

  function computeStats(db, status) {
    const cons = consumed(db);
    const real = cons.filter(i => i.medium !== "Episode");
    const rated = new Map();
    const ratedRows = db.items(null, ["rated"]).sort((a, b) => (a.source !== "imdb") - (b.source !== "imdb"));
    for (const r of ratedRows) if (!rated.has(r.key)) rated.set(r.key, r);
    const ratedMain = [...rated.values()].filter(r => r.rating && r.medium !== "Episode");
    const ratings = ratedMain.map(r => r.rating);
    const imdbIds = new Set(consumed(db, "imdb").filter(i => i.imdb && !["Video Game", "Episode"].includes(i.medium)).map(i => i.imdb));
    const traktIds = new Set(consumed(db, "trakt").filter(i => i.imdb && i.medium !== "Episode").map(i => i.imdb));
    const genres = new Map();
    for (const i of real) for (const gn of (i.genres || "").split(",")) {
      const t = gn.trim();
      if (t) genres.set(t, (genres.get(t) || 0) + 1);
    }
    const lists = count(db.items(null, ["list", "watchlist", "collection"]), r => `${r.source}|${r.list_name || r.kind}`);
    const runtimes = new Map();
    for (const r of db.items(null, ["watched", "rated"])) {
      if (r.runtime && (r.medium === "Movie" || r.medium === "Special") && !runtimes.has(r.key)) runtimes.set(r.key, r.runtime);
    }
    const medAvg = {};
    for (const m of MEDIA) {
      const rs = ratedMain.filter(r => r.medium === m).map(r => r.rating);
      if (rs.length) medAvg[m] = [rs.reduce((a, b) => a + b, 0) / rs.length, rs.length];
    }
    const both = [...imdbIds].filter(x => traktIds.has(x)).length;
    const sortDesc = m => [...m.entries()].sort((a, b) => b[1] - a[1]);
    return {
      total: cons.length,
      by_medium: count(cons, i => i.medium),
      avg_rating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
      rating_hist: count(ratings, r => r),
      rated_count: ratings.length,
      episodes_rated: [...rated.values()].filter(r => r.medium === "Episode").length,
      decades: count(real.filter(i => i.year), i => Math.floor(i.year / 10) * 10),
      genres: sortDesc(genres).slice(0, 8),
      overlap: { both, imdb_only: imdbIds.size - both, trakt_only: traktIds.size - both },
      lists: sortDesc(lists).slice(0, 10),
      top_rated: ratedMain.slice().sort((a, b) => b.rating - a.rating || (b.year || 0) - (a.year || 0)).slice(0, 8),
      canon_total: status.length,
      canon_have: status.filter(c => c.have).length,
      franchises: franchiseProgress(status),
      movie_hours: [...runtimes.values()].reduce((a, b) => a + b, 0) / 60,
      runtime_known: runtimes.size,
      ratings_per_year: [...count([...rated.values()].filter(r => r.rated_at), r => r.rated_at.slice(0, 4)).entries()].sort(),
      avg_by_medium: medAvg,
    };
  }

  // ------------------------------------------------------------------ network
  // http(method, url, {headers, body}) -> Promise<{status, headers, body, error}>
  // Every network call during sync goes through this: a hard time limit per request, and up to `tries` attempts on
  // dropped connections, server errors (5xx) and rate limits (429, honouring Retry-After). The in-app browser is kept.
  // a short pause so the screen can redraw and take taps between heavy steps
  const breathe = (ms = 16) => new Promise(r => setTimeout(r, ms));
  // 0.6.2: a Map that counts its changes, so Store.items() can keep its answers until a row is added or removed
  class VMap extends Map {
    constructor(it) { super(it); this.ver = 0; }
    set(k, v) { this.ver = (this.ver || 0) + 1; return super.set(k, v); }
    delete(k) { const r = super.delete(k); if (r) this.ver++; return r; }
    clear() { this.ver++; return super.clear(); }
  }
  function robust(http, opt = {}) {
    if (http && http.robust) return http;
    const timeout = opt.timeout || 45000, tries = opt.tries || 3, log = opt.log || null;
    const f = async (method, url, o = {}) => {
      let r = null;
      const n = o.once ? 1 : tries; // once: a quick try that has a fallback of its own
      for (let a = 1; a <= n; a++) {
        if (CONFIG.cancelled) return { status: 0, headers: {}, body: "", error: "cancelled" };
        const t0 = Date.now();
        try { r = await withTimeout(http(method, url, o), timeout, `no answer within ${Math.round(timeout / 1000)} s`); }
        catch (e) { r = { status: 0, headers: {}, body: "", error: e.message }; }
        r.headers = r.headers || {};
        if (log) log(`${method} ${String(url).replace(/(api_key|key)=[^&]+/g, "$1=…").slice(0, 140)} → ${r.status || r.error} (${Date.now() - t0} ms)${a > 1 ? ` try ${a}` : ""}`);
        const retry = r.status === 0 || r.status === 429 || r.status >= 500;
        if (!retry || a === n) break;
        const ra = parseFloat(r.headers["retry-after"] || "");
        const unit = CONFIG.retryDelayMs / 4; // 1.5 s normally; the tests shrink it
        await sleep(r.status === 429 ? Math.min(((isFinite(ra) ? ra : 5) + 1) * 1000, unit * 40) : unit * a * a);
      }
      return r;
    };
    if (http && http.browse) f.browse = http.browse;
    if (http && http.cancelBrowse) f.cancelBrowse = http.cancelBrowse;
    f.robust = true;
    return f;
  }
  // Runs fn over items with at most n at a time.
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let i = 0;
    const worker = async () => { while (i < items.length) { const k = i++; if (CONFIG.cancelled) return; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = e; } } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return out;
  }

  const BROWSER_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
  const qs = params => Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

  // Turns Java's raw network exceptions into a plain reason. The words "network error" stay in the text (callers test for them).
  function netHint(err) {
    const e = String(err || "");
    const host = (e.match(/host "([^"]+)"/) || e.match(/to ([a-z0-9.-]+\.[a-z]{2,})/i) || [])[1] || "the server";
    if (/UnknownHost|Unable to resolve/i.test(e)) return `your phone couldn't look up ${host}. The network's DNS is blocking it, or Private DNS / an ad-blocker / VPN app is. Not an app bug: see Sync → Test connection`;
    if (/ConnectException|ECONNREFUSED|refused|failed to connect/i.test(e)) return `the connection to ${host} was refused at once. Your network or a firewall / ad-blocker / VPN app is blocking it. Not an app bug: see Sync → Test connection`;
    if (/SSL|certificate|handshake/i.test(e)) return `secure connection to ${host} failed (something on the network is intercepting it)`;
    return e || "no connection";
  }
  function httpError(r, what) {
    if (r.status === 0) return new Error(`${what}: network error (${netHint(r.error)})`);
    return new Error(`${what}: HTTP ${r.status}`);
  }

  const TRAKT = "https://api.trakt.tv";
  const PROFILES = {
    "PKCE / Public Client (App 000001)": { client_id: "YOUR_TRAKT_CLIENT_ID_PKCE", redirect: "https://trakt.tv", pkce: true },
    "OAuth OOB (App 000002)": { client_id: "YOUR_TRAKT_CLIENT_ID_OOB", redirect: "urn:ietf:wg:oauth:2.0:oob", pkce: false },
  };

  function authorizeUrl(clientId, redirect, challenge) {
    const q = { response_type: "code", client_id: clientId, redirect_uri: redirect };
    if (challenge) Object.assign(q, { code_challenge: challenge, code_challenge_method: "S256" });
    return "https://trakt.tv/oauth/authorize?" + qs(q);
  }

  async function exchangeCode(http, clientId, redirect, code, verifier, secret) {
    const body = { code, client_id: clientId, redirect_uri: redirect, grant_type: "authorization_code" };
    if (verifier) body.code_verifier = verifier;
    if (secret) body.client_secret = secret;
    const r = await http("POST", TRAKT + "/oauth/token", { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.status !== 200) throw new Error(`Token exchange failed (${r.status}): ${String(r.body || r.error || "").slice(0, 200)}`);
    return JSON.parse(r.body);
  }

  class Trakt {
    constructor(http, clientId, token) { this.http = robust(http, { timeout: 60000, tries: 3 }); this.clientId = (clientId || "").trim(); this.token = token || null; }

    // 0.5.9: pages after the first come 4 at a time (41 pages of ratings took 16 s one by one), in order;
    // opt.stopWhen(page) ends early (used to stop at ratings already stored, when Trakt sends newest first)
    async get(path, params = {}, opt = {}) {
      const first = await this.page(path, params, 1);
      if (!Array.isArray(first.data)) return first.data;
      const out = first.data.slice();
      const count = first.count;
      if (count <= 1) return out;
      if (opt.stopWhen && opt.stopWhen(first.data)) { out.stopped = 1; return out; }
      if (opt.stopWhen) {
        for (let page = 2; page <= count; page++) { const p = await this.page(path, params, page); out.push(...p.data); if (opt.stopWhen(p.data)) { out.stopped = page; break; } }
        return out;
      }
      for (let page = 2; page <= count; page += 4) {
        const batch = [];
        for (let k = page; k < page + 4 && k <= count; k++) batch.push(this.page(path, params, k));
        for (const p of await Promise.all(batch)) out.push(...p.data);
        await breathe(0);
      }
      return out;
    }

    async page(path, params, page) {
      const headers = { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": this.clientId };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      {
        let r;
        for (let attempt = 0; attempt < 4; attempt++) {
          r = await this.http("GET", `${TRAKT}${path}?${qs(Object.assign({}, params, { page, limit: 1000 }))}`, { headers });
          if (r.status !== 429) break;
          await sleep((parseFloat(r.headers["retry-after"] || "3") + 1) * 1000);
        }
        if (r.status === 401 && this.token) throw new Error("Trakt sign-in expired: sign in to Trakt again in Settings.");
        if (r.status === 401 || r.status === 403) throw new Error("Trakt denied access: profile is private or the Client ID is wrong (authorize in Settings for private data).");
        if (r.status === 404) throw new Error(`Trakt user or list not found: ${path}`);
        if (r.status < 200 || r.status >= 300) throw httpError(r, "Trakt");
        let data;
        try { data = JSON.parse(r.body || "null"); } catch (e) { throw new Error(`Trakt sent an unreadable answer for ${path} (${String(r.body || "").length} bytes, page ${page})`); }
        return { data, count: parseInt((r.headers || {})["x-pagination-page-count"] || "1", 10) || 1 };
      }
    }
  }

  // One title on Trakt: the episodes (or viewings) you logged there and the day of each. Needs a sign-in.
  async function traktOne(http, clientId, token, it) {
    if (!token) throw new Error("Sign in to Trakt in Settings first.");
    const t = new Trakt(http, clientId, token);
    let id = it.imdb || "";
    if (!id) {
      const kind = it.type === "show" ? "show" : "movie";
      const found = await t.get(`/search/${kind}`, { query: it.title });
      const hit = (Array.isArray(found) ? found : []).map(x => x[kind]).find(x => x && norm(x.title) === norm(it.title) && (!it.year || !x.year || Math.abs(x.year - it.year) <= 1));
      if (!hit) throw new Error(`Trakt doesn't list "${it.title}"`);
      id = hit.ids.imdb || hit.ids.slug || String(hit.ids.trakt);
    }
    const out = { eps: {}, watches: [], id };
    const day = d => String(d || "").slice(0, 10);
    if (it.type === "show") {
      const p = await t.get(`/shows/${encodeURIComponent(id)}/progress/watched`, { hidden: "false", specials: "false" });
      for (const sn of (p && p.seasons) || []) for (const e of sn.episodes || []) if (e.completed) out.eps[`${sn.number}:${e.number}`] = day(e.last_watched_at);
    } else {
      const h = await t.get(`/sync/history/movies/${encodeURIComponent(id)}`);
      for (const x of Array.isArray(h) ? h : []) if (x.watched_at) out.watches.push(day(x.watched_at));
      out.watches.sort();
    }
    return out;
  }

  // 0.5.8: with a sign-in, Trakt says when each part of your account last changed (/sync/last_activities);
  // parts that haven't changed since the last sync aren't downloaded again. Nothing stored is removed by a skip.
  const LA_KEYS = {
    "Watched movies": la => [la.movies && la.movies.watched_at],
    "Watched shows": la => [la.episodes && la.episodes.watched_at, la.shows && la.shows.hidden_at],
    "Ratings": la => ["movies", "shows", "seasons", "episodes"].map(k => la[k] && la[k].rated_at),
    "Watchlist": la => ["movies", "shows", "seasons", "episodes"].map(k => la[k] && la[k].watchlisted_at).concat([la.watchlist && la.watchlist.updated_at]),
    "lists": la => [la.lists && la.lists.updated_at, la.lists && la.lists.commented_at],
  };
  function laStamp(la, label) { try { const v = LA_KEYS[label](la || {}); return v.some(Boolean) ? v.map(x => x || "").join("|") : ""; } catch (e) { return ""; } }
  async function traktSync(db, http, clientId, username, token, progress, opt = {}) {
    const t = new Trakt(http, clientId, token);
    const u = `/users/${encodeURIComponent(username)}`;
    const steps = [["Watched movies", `${u}/watched/movies`, "watched"], ["Watched shows", `${u}/watched/shows`, "watched"],
                   ["Ratings", `${u}/ratings`, "rated"], ["Watchlist", `${u}/watchlist`, "watchlist"]];
    let total = 0, la = null, seen = {};
    const skipped = [];
    if (token && !opt.full) {
      try { la = await t.get("/sync/last_activities"); } catch (e) { la = null; }
      try { seen = JSON.parse(db.get("trakt_la", "{}")) || {}; } catch (e) { seen = {}; }
    }
    const fresh = {};
    const same = label => { if (!la) return false; const st = laStamp(la, label); fresh[label] = st; return !!st && seen[label] === st; };
    const n = steps.length + 1;
    for (let i = 0; i < steps.length; i++) {
      const [label, path, kind] = steps[i];
      progress(i / n, `Trakt: ${label}`);
      if (same(label) && (label !== "Watched shows" || db.get("trakt_progress"))) { skipped.push(label.toLowerCase()); continue; }
      // ratings without a sign-in: stop at ratings already stored (with 2 days' overlap), if Trakt sends newest first
      let stopWhen = null;
      const lastRated = db.get("trakt_last_rated_at", "");
      if (label === "Ratings" && !opt.full && lastRated && db.items("trakt", ["rated"]).length >= 1000) {
        const edge = new Date(Date.parse(lastRated) - 2 * 864e5).toISOString();
        stopWhen = page => { const ds = page.map(x => x.rated_at || "").filter(Boolean); if (!ds.length) return false; for (let k = 1; k < ds.length; k++) if (ds[k] > ds[k - 1]) return false; return ds[ds.length - 1] < edge; };
      }
      const data = await t.get(path, {}, { stopWhen });
      if (label === "Ratings") {
        const newest = data.reduce((m, x) => (x.rated_at && x.rated_at > m ? x.rated_at : m), "");
        if (newest && newest > lastRated) db.set("trakt_last_rated_at", newest);
        if (data.stopped) skipped.push(`older ratings (stopped at page ${data.stopped}: already stored)`);
      }
      if (!Array.isArray(data)) throw new Error(`Trakt: ${label} came back empty`);
      total += await storeTraktAsync(db, data, kind, "");
      if (label === "Watched shows" && Array.isArray(data)) db.set("trakt_progress", JSON.stringify(watchProgress(data)));
    }
    progress(steps.length / n, "Trakt: your lists");
    if (same("lists") && db.get("trakt_lists")) skipped.push("lists");
    else total += await traktLists();
    if (la) db.set("trakt_la", JSON.stringify(Object.assign(seen, fresh)));
    traktSync.skipped = skipped;
    return total;
    async function traktLists() {
    let total = 0;
    const lists = await t.get(`${u}/lists`);
    db.set("trakt_lists", JSON.stringify(lists.map(l => l.name)));
    for (let j = 0; j < lists.length; j++) {
      const lst = lists[j];
      const lid = (lst.ids || {}).trakt;
      const name = String(lst.name || lid).toLowerCase().replace(/ /g, "-");
      progress((steps.length + j / Math.max(lists.length, 1)) / n, `Trakt list: ${lst.name}`);
      total += await storeTraktAsync(db, await t.get(`${u}/lists/${lid}/items`), "list", name);
    }
    return total;
    }
  }

  // Episodes you've watched per show (from Trakt's watched/shows), keyed by TMDB show id.
  function watchProgress(data) {
    const out = {};
    for (const w of data) {
      const sh = w && w.show, ids = (sh && sh.ids) || {};
      if (!sh || !ids.tmdb) continue;
      const eps = {}, dates = {};
      for (const se of w.seasons || []) {
        if (!se || !se.number) continue; // season 0 = specials, not part of "up next"
        const list = (se.episodes || []).filter(e => e && e.plays !== 0 && Number.isFinite(e.number));
        if (list.length) eps[se.number] = list.map(e => e.number);
        for (const e of list) if (e.last_watched_at) dates[`${se.number}:${e.number}`] = String(e.last_watched_at).slice(0, 10);
      }
      out[ids.tmdb] = { t: sh.title, y: sh.year || null, imdb: ids.imdb || null, tvdb: ids.tvdb || null, last: w.last_watched_at || null, plays: w.plays || 0, eps, d: dates };
    }
    return out;
  }

  // ---- IMDb (best effort) ----
  const TT = /^tt\d{7,9}$/;
  const IMDB_H = { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9" };
  const GQL = "https://api.graphql.imdb.com/";
  const LIST_QUERY = "query($id: ID!, $after: String){ list(id:$id){ titleListItemSearch(first:250, after:$after){ total " +
    "edges{ listItem{ ... on Title { id titleText{text} releaseYear{year} titleType{id} releaseDate{year month day} runtime{seconds} " +
    "titleGenres{genres{genre{text}}} } } } pageInfo{hasNextPage endCursor} } } }";

  async function getText(http, url) {
    const r = await http("GET", url, { headers: IMDB_H });
    if (r.status !== 200) throw httpError(r, url);
    return r.body;
  }

  // Collects IMDb title objects from page JSON. A userRating found on an object applies to the titles inside it
  // (that's how the ratings page nests "your rating" next to each title).
  function walkTitles(node, out, rating = null) {
    if (Array.isArray(node)) { for (const v of node) walkTitles(v, out, rating); return; }
    if (!node || typeof node !== "object") return;
    const ur = node.userRating;
    if (ur && typeof ur === "object" && Number.isFinite(ur.value)) rating = ur.value;
    else if (Number.isFinite(ur)) rating = ur;
    const id = node.id;
    if (typeof id === "string" && TT.test(id)) {
      const tt = node.titleText || node.originalTitleText;
      const title = tt && typeof tt === "object" ? tt.text : null;
      const prev = out.get(id) || { imdb: id, title: null, year: null, medium: "Movie" };
      if (title) {
        prev.title = title;
        if (node.releaseYear && typeof node.releaseYear === "object") prev.year = node.releaseYear.year || prev.year;
        if (node.titleType && typeof node.titleType === "object") prev.medium = mediumFromImdb(node.titleType.id);
        const gs = node.titleGenres && node.titleGenres.genres;
        if (Array.isArray(gs)) prev.genres = gs.filter(x => x && x.genre).map(x => x.genre.text).join(", ");
        if (node.runtime && Number.isFinite(node.runtime.seconds)) prev.runtime = Math.round(node.runtime.seconds / 60);
        if (node.releaseDate && typeof node.releaseDate === "object") prev.date = parseDate(node.releaseDate) || prev.date;
      }
      if (rating && !prev.rating) prev.rating = rating;
      out.set(id, prev);
    }
    for (const v of Object.values(node)) walkTitles(v, out, rating);
  }

  function findTotal(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 40) return 0;
    let best = 0;
    if (!Array.isArray(node) && Array.isArray(node.edges) && Number.isFinite(node.total)) best = node.total;
    for (const v of Object.values(node)) best = Math.max(best, findTotal(v, depth + 1));
    return best;
  }

  // ---- hidden in-app browser ----
  // Runs inside the IMDb page (so it must be self-contained): turns page JSON + captured "load more" responses
  // into a compact list. Keys: i=id t=title y=year k=titleType r=your rating g=genres m=minutes d=[y,m,d].
  function pageExtract(texts) {
    var out = {}, order = [];
    var rdate = null;
    function walk(node, rating) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) { for (var a = 0; a < node.length; a++) walk(node[a], rating); return; }
      var ur = node.userRating;
      if (ur && typeof ur === "object" && typeof ur.value === "number") { rating = ur.value; rdate = typeof ur.date === "string" ? ur.date.slice(0, 10) : null; }
      else if (typeof ur === "number") rating = ur;
      var id = node.id;
      if (typeof id === "string" && /^tt\d{7,9}$/.test(id)) {
        var p = out[id];
        if (!p) { p = out[id] = { i: id }; order.push(id); }
        var tt = node.titleText || node.originalTitleText;
        if (tt && typeof tt === "object" && tt.text) {
          p.t = tt.text;
          if (node.releaseYear && node.releaseYear.year) p.y = node.releaseYear.year;
          if (node.titleType && node.titleType.id) p.k = node.titleType.id;
          var gs = node.titleGenres && node.titleGenres.genres;
          if (gs && gs.length) p.g = gs.map(function (x) { return x && x.genre ? x.genre.text : ""; }).filter(Boolean).join(", ");
          if (node.runtime && node.runtime.seconds) p.m = Math.round(node.runtime.seconds / 60);
          var rd = node.releaseDate;
          if (rd && rd.year) p.d = [rd.year, rd.month || 0, rd.day || 0];
        }
        if (rating && !p.r) p.r = rating;
        // an episode you rated: remember its series and number, so the series' progress can be ticked
        var se = node.series;
        if (se && typeof se === "object" && se.series && typeof se.series.id === "string") {
          var en = se.episodeNumber || se.displayableEpisodeNumber || {};
          var sn = +(en.seasonNumber || (en.displayableSeason && en.displayableSeason.season) || (en.displayableSeason && en.displayableSeason.text) || 0);
          var epn = +((en.episodeNumber && typeof en.episodeNumber === "object" ? en.episodeNumber.text || en.episodeNumber.episodeNumber : en.episodeNumber) || 0);
          if (sn > 0 && epn > 0) p.s = [se.series.id, sn, epn, rating && rdate ? rdate : ""];
        }
        // what's nested inside a title (its series, its parts) is not what was rated
        rating = null;
      }
      for (var k in node) {
        if (Object.prototype.hasOwnProperty.call(node, k)) { var v = node[k]; if (v && typeof v === "object") walk(v, rating); }
      }
    }
    for (var n = 0; n < texts.length; n++) { try { walk(JSON.parse(texts[n]), null); } catch (e) { /* not JSON */ } }
    return order.map(function (id) { return out[id]; });
  }

  // Polled once a second by the native layer. Waits for the page's data to be complete, captures the page's own
  // GraphQL responses, scrolls / presses "N more" until nothing new loads, then returns the compact list.
  function pageProbe(extract, maxPolls, want) {
    // Chrome's "Web page not available" error page: say so at once instead of waiting for the timeout.
    if (/^chrome-error:/i.test(String(location.href))) return "NETERR:" + (document.title || "page not available");
    var S = window.__cs;
    if (document.readyState === "loading") return null;
    // The biggest "total" next to an "edges" array (IMDb's own count) and the next-page cursor, from one response.
    var info = function (text) {
      // Only the page's main list counts: the connection with the most entries (a page also carries small side lists,
      // and counts that belong to something else, such as how many titles you've rated in total).
      var r = { total: 0, next: undefined }, best = -1;
      var walk = function (n, d) {
        if (!n || typeof n !== "object" || d > 40) return;
        if (Array.isArray(n)) { for (var i = 0; i < n.length; i++) walk(n[i], d + 1); return; }
        if (Array.isArray(n.edges) && n.edges.length > best) {
          best = n.edges.length;
          r.total = typeof n.total === "number" ? n.total : 0;
          var pi = n.pageInfo;
          r.next = pi && typeof pi === "object" ? (pi.hasNextPage && pi.endCursor ? pi.endCursor : null) : undefined;
        }
        for (var k in n) if (Object.prototype.hasOwnProperty.call(n, k) && n[k] && typeof n[k] === "object") walk(n[k], d + 1);
      };
      try { walk(JSON.parse(text), 0); } catch (e) { /* not JSON */ }
      return r;
    };
    if (!S) {
      var title = document.title || "";
      var nd = document.getElementById("__NEXT_DATA__");
      if (!nd) {
        if (document.readyState === "complete" && /sign in|accedi|404|not found|error|private|privat/i.test(title)) return "ERR:" + title;
        // 0.5.9: a page that never brings its data: give up after about 20 s instead of waiting out the whole time limit
        window.__csWait = (window.__csWait || 0) + 1;
        if (window.__csWait > 20) return "ERR:" + (title || "page did not load its data");
        return null;
      }
      var baseText = nd.textContent || "";
      try { JSON.parse(baseText); } catch (e) { return null; }
      // inflight: "load more" requests still running; the page isn't finished while any are pending.
      // tpl: the page's own "next page" request, replayed with the next cursor so we don't depend on buttons or scrolling.
      // Each answer is read into the merged list as it arrives and then dropped: no pile of raw pages to walk at the end
      // (that last walk, on the browser engine the app shares, froze the app's own screen for seconds).
      S = window.__cs = { chunks: 0, stable: 0, last: -1, polls: 0, inflight: 0, total: 0, next: undefined, tpl: null, asked: {}, out: {}, order: [] };
      S.add = function (t) {
        S.chunks++;
        var got = extract([t]);
        for (var gi = 0; gi < got.length; gi++) {
          var x = got[gi], p = S.out[x.i];
          if (!p) { p = S.out[x.i] = { i: x.i }; S.order.push(x.i); }
          for (var f in x) if (f !== "i" && f !== "r" && x[f] !== undefined) p[f] = x[f];
          if (x.r && !p.r) p.r = x.r;
        }
      };
      S.add(baseText);
      var bi = info(baseText); S.total = bi.total; S.next = bi.next; S.gql = 0; S.ops = {};
      var isGql = function (u) { return /graphql/i.test(String(u || "")); };
      // 0.5.9: only the page's own list moves the count and the cursor; side requests (your lists, exports, recently
      // viewed titles) carry their own "edges" and used to take over, sending the next page request to the wrong list
      var mainList = function (t, req) {
        var op = req && req.url ? String(req.url) + " " + String((req.init && req.init.body) || "") : "";
        if (/YourListsSidebar|YourExports|RVI_|RecentlyViewed|AmazonAccount|Watchlist(Ribbon|Button)|Sidebar/i.test(op)) return false;
        return /titleListItemSearch|advancedTitleSearch|"items"\s*:\s*\{|userRatings|predefinedList/.test(t) && /"tt\d{7,9}"/.test(t);
      };
      var keep = function (t, req) {
        if (!t || t.length <= 50) return;
        S.add(t);
        S.gql++;
        try { var op0 = req && req.url && (String(req.url).match(/operationName=([^&]+)/) || [])[1]; if (op0) S.ops[op0] = 1; } catch (e) { /* ignore */ }
        if (!mainList(t, req)) return;
        var ii = info(t);
        if (!S.total && ii.total) S.total = ii.total;
        if (ii.next !== undefined) { S.next = ii.next; if (req && req.url) S.tpl = req; }
      };
      var of = window.fetch;
      S.fetch = of; S.keep = keep; // later polls are new calls of this function: keep the helpers on the state
      if (of) {
        window.fetch = function (input, init) {
          var u = (input && input.url) || input;
          if (!isGql(u)) return of.apply(this, arguments);
          var req = { url: String(u), init: init || {} };
          S.inflight++;
          return of.apply(this, arguments).then(function (r) {
            try {
              r.clone().text().then(function (t) { keep(t, req); S.inflight--; }, function () { S.inflight--; });
            } catch (e) { S.inflight--; }
            return r;
          }, function (e) { S.inflight--; throw e; });
        };
      }
      var xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send, xh = XMLHttpRequest.prototype.setRequestHeader;
      XMLHttpRequest.prototype.open = function (m, u) { this.__csu = u; this.__csm = m; this.__csh = {}; return xo.apply(this, arguments); };
      XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__csh) this.__csh[k] = v; return xh.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function (body) {
        var x = this;
        if (isGql(x.__csu)) {
          S.inflight++;
          var req = { url: String(x.__csu), init: { method: x.__csm || "GET", headers: x.__csh || {}, body: body } };
          x.addEventListener("loadend", function () { try { if (x.status === 200) keep(x.responseText, req); } catch (e) { /* ignore */ } S.inflight--; });
        }
        return xs.apply(this, arguments);
      };
    }
    S.polls++;
    // Ask for the next page ourselves, the way the page itself just did, with the cursor IMDb gave us.
    var replay = function () {
      if (!S.tpl || !S.next || S.asked[S.next] || !S.fetch) return false;
      var cur = S.next, t = S.tpl, url = t.url, init = {}, k;
      for (k in t.init) init[k] = t.init[k];
      var setVars = function (v) { if (!v || typeof v !== "object") return null; v.after = cur; if (typeof v.first === "number" && v.first < 250) v.first = 250; return v; };
      try {
        if (init.body && typeof init.body === "string") {
          var b = JSON.parse(init.body);
          if (!setVars(b.variables)) return false;
          init.body = JSON.stringify(b);
        } else {
          var U = new URL(url, location.href), vs = U.searchParams.get("variables");
          if (!vs) return false;
          var v = setVars(JSON.parse(vs));
          if (!v) return false;
          U.searchParams.set("variables", JSON.stringify(v));
          url = U.toString();
        }
      } catch (e) { return false; }
      S.asked[cur] = 1; S.inflight++;
      S.fetch.call(window, url, init).then(function (r) { return r.text(); }).then(function (txt) { S.inflight--; S.keep(txt, t); }, function (e) { S.inflight--; S.err = String(e); }).catch(function (e) { S.err = String(e); });
      return true;
    };
    // A list page that never asks for more by itself: ask IMDb's API for the next 250 directly, from inside the page.
    var direct = function () {
      var m = String(location.pathname).match(/\/list\/(ls\d+)/);
      if (!m || S.tpl || !S.next || S.asked[S.next] || !S.fetch || S.directErr) return false;
      var cur = S.next;
      S.asked[cur] = 1; S.inflight++;
      var q = "query($id: ID!, $after: String){ list(id:$id){ items(first:250, after:$after){ total pageInfo{hasNextPage endCursor} " +
        "edges{ node{ listItem{ ... on Title { id titleText{text} releaseYear{year} titleType{id} releaseDate{year month day} titleGenres{genres{genre{text}}} } } } } } } }";
      S.fetch.call(window, "https://api.graphql.imdb.com/", { method: "POST", headers: { "content-type": "application/json" }, credentials: "include",
        body: JSON.stringify({ query: q, variables: { id: m[1], after: cur } }) })
        .then(function (r) { return r.text().then(function (txt) { S.inflight--; if (r.status !== 200 || !/"edges"/.test(txt)) { S.directErr = "API " + r.status + " " + txt.slice(0, 120); return; } S.keep(txt, null); }); },
              function (e) { S.inflight--; S.directErr = String(e).slice(0, 120); });
      return true;
    };
    // enough: the newest `want` titles are in (the rest is already stored), so stop asking for more pages
    var enough = want > 0 && S.order.length >= want;
    var replayed = !enough && S.inflight <= 0 && (replay() || direct());
    // Once the next pages come straight from IMDb's API (replay or direct), the page itself is left alone: no
    // scrolling and no buttons, so it doesn't keep drawing thousands of new rows on the engine the app shares.
    var apiMode = !!S.tpl || (/\/list\/ls\d+/.test(String(location.pathname)) && !S.directErr && S.next !== undefined);
    // Move up a couple of screens, then back to the bottom: infinite-scroll watchers only react to a change,
    // so jumping to the same bottom position every time can leave them stuck.
    if (!apiMode) try {
      var bottom = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      window.scrollTo(0, Math.max(0, bottom - 2.5 * (window.innerHeight || 800)));
      setTimeout(function () { window.scrollTo(0, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)); }, 200);
    } catch (e) { /* ignore */ }
    // "250 more", "Altri 250", "Load more"... (English or Italian), or IMDb's own see-more button; never links elsewhere.
    if (!replayed && !apiMode && !enough) {
      var btns = document.querySelectorAll("button");
      for (var b2 = 0; b2 < btns.length; b2++) {
        var bt = btns[b2], txt = (bt.textContent || "").replace(/\s+/g, " ").trim();
        if (bt.disabled || txt.length > 30 || bt.getAttribute("onclick")) continue;
        var looks = /^(\d[\d,.]*\s+(more|altri|in più)|(load|show|see)\s+more|(altri|mostra( altri)?|carica( altri)?)\s+\d[\d,.]*|mostra altro|carica altro|vedi altro)$/i.test(txt);
        if (looks || /see-more|load-more|pagination/.test(bt.className || "")) { S.btn = txt; try { bt.click(); } catch (e) { /* ignore */ } }
      }
    }
    var nLinks = 0;
    if (!apiMode) {
      var ids = {}, links = document.querySelectorAll('a[href*="/title/tt"]');
      for (var j = 0; j < links.length; j++) {
        var m = (links[j].getAttribute("href") || "").match(/tt\d{7,9}/);
        if (m) ids[m[0]] = 1;
      }
      nLinks = Object.keys(ids).length;
    }
    var size = nLinks * 1000000 + S.order.length * 1000 + S.chunks;
    if (size === S.last && S.inflight <= 0 && !replayed) S.stable++; else { S.stable = 0; S.last = size; }
    var more = S.next && !S.asked[S.next] && (S.tpl || (/\/list\/ls\d+/.test(String(location.pathname)) && !S.directErr));
    if (enough && S.inflight <= 0) more = false;
    if (!(enough && S.inflight <= 0) && (S.stable < 4 || S.polls < 3 || more) && S.polls < maxPolls) return null;
    var items = S.order.map(function (id) { return S.out[id]; });
    var capped = !enough && (S.stable < 4 || (S.total > 0 && items.length < S.total * 0.98));
    // when it stops short, say what the page offered, so the next report shows why
    var dbg = capped ? "button " + (S.btn ? "'" + S.btn + "' pressed" : "not found") + ", " + S.gql + " data requests seen" + (Object.keys(S.ops).length ? " (" + Object.keys(S.ops).slice(0, 4).join(", ") + ")" : "") +
      ", next page " + (S.next ? "known" : S.next === null ? "none" : "unknown") + (S.directErr ? ", " + S.directErr : "") : "";
    // the page's own "next page" request, so later syncs can ask IMDb's API for these pages without opening the page
    var tplOut = null;
    try {
      if (S.tpl) {
        var h = S.tpl.init.headers, ho = {};
        if (h && typeof h.forEach === "function") h.forEach(function (v, k) { ho[k] = v; }); else if (h) for (var hk in h) ho[hk] = h[hk];
        tplOut = { url: S.tpl.url, method: S.tpl.init.method || "GET", headers: ho, body: typeof S.tpl.init.body === "string" ? S.tpl.init.body : null };
      }
    } catch (e) { tplOut = null; }
    return JSON.stringify({ items: items, loads: S.chunks - 1, polls: S.polls, total: S.total, capped: capped, dbg: dbg, newest: !!enough, tpl: tplOut });
  }

  const probeFor = (timeoutMs, want = 0) => `(${pageProbe.toString()})(${pageExtract.toString()}, ${Math.max(5, Math.floor(timeoutMs / 1000) - 8)}, ${+want || 0})`;

  function fromCompact(x) {
    return {
      imdb: x.i, title: x.t, year: x.y || null, medium: mediumFromImdb(x.k), rating: x.r || null, genres: x.g || "",
      runtime: x.m || null, date: x.d ? parseDate({ year: x.d[0], month: x.d[1], day: x.d[2] }) : null,
      ep: x.s || null,
    };
  }

  // Opens url in the hidden browser and returns [items, loads].
  const netError = msg => Object.assign(new Error(msg), { network: true });

  async function browseTitles(http, url, timeout = 180000, want = 0) {
    let r;
    for (let attempt = 1; ; attempt++) {
      r = await http.browse(url, probeFor(timeout, want), timeout);
      const failedLoad = (typeof r.value === "string" && r.value.startsWith("NETERR:")) ||
        (r.error === "timeout" && /chrome-error|not available/i.test(String(r.title || "")));
      if (!failedLoad) break;
      if (attempt >= CONFIG.browseTries) throw netError(`couldn't reach IMDb after ${attempt} tries`);
      await sleep(CONFIG.retryDelayMs * attempt);
    }
    if (r.status !== 200 || typeof r.value !== "string") {
      throw new Error(r.error === "timeout" ? `page didn't load in time${r.title ? ` (${r.title})` : ""}` : (r.error || "browser failed"));
    }
    if (r.value.startsWith("ERR:")) {
      const t = r.value.slice(4);
      throw new Error(/sign in/i.test(t) ? "IMDb asked to sign in (private). Use Sign in to IMDb in Settings" : `IMDb page: ${t}`);
    }
    const res = JSON.parse(r.value);
    const items = (res.items || []).filter(x => x.t).map(fromCompact);
    if (!items.length) throw new Error("no titles found on the page");
    items.loads = res.loads || 0;
    items.capped = !!res.capped;
    items.total = res.total || 0;
    items.dbg = res.dbg || "";
    items.newest = !!res.newest;
    items.tpl = res.tpl || null;
    return items;
  }

  // ---- IMDb pages without the page: replay the page's own API request from the phone's network code ----
  // The first sync opens the page once and keeps its "next page" request (the template). Later syncs send that same
  // request straight to IMDb's API, page after page, so no IMDb page runs on the browser engine Saga's own screen
  // shares (that was what made the screen lag during a sync). Any failure falls back to the page and a new template.
  function gqlInfo(obj) {
    const r = { total: 0, next: undefined }; let best = -1;
    const walk = (n, d) => {
      if (!n || typeof n !== "object" || d > 40) return;
      if (Array.isArray(n)) { for (const x of n) walk(x, d + 1); return; }
      if (Array.isArray(n.edges) && n.edges.length > best) {
        best = n.edges.length; r.total = typeof n.total === "number" ? n.total : 0;
        const pi = n.pageInfo; r.next = pi && typeof pi === "object" ? (pi.hasNextPage && pi.endCursor ? pi.endCursor : null) : undefined;
      }
      for (const k of Object.keys(n)) if (n[k] && typeof n[k] === "object") walk(n[k], d + 1);
    };
    walk(obj, 0);
    return r;
  }
  function tplRequest(tpl, cursor) {
    const setVars = v => { if (!v || typeof v !== "object") return false; if (cursor) v.after = cursor; else delete v.after; if (typeof v.first === "number" && v.first < 250) v.first = 250; return true; };
    const headers = Object.assign({}, IMDB_H, { Origin: "https://www.imdb.com", Referer: "https://www.imdb.com/" }, tpl.headers || {});
    if (tpl.body) {
      const b = JSON.parse(tpl.body);
      if (!setVars(b.variables)) throw new Error("template has no variables");
      return { method: tpl.method || "POST", url: tpl.url, o: { headers, body: JSON.stringify(b) } };
    }
    const U = new URL(tpl.url), vs = U.searchParams.get("variables");
    if (!vs) throw new Error("template has no variables");
    const v = JSON.parse(vs);
    if (!setVars(v)) throw new Error("template has no variables");
    U.searchParams.set("variables", JSON.stringify(v));
    return { method: tpl.method || "GET", url: U.toString(), o: { headers } };
  }
  async function apiTitles(http, tpl, want = 0) {
    const out = {}, order = [];
    let cursor = null, total = 0, pages = 0;
    for (; pages < 80; pages++) {
      const q = tplRequest(tpl, cursor);
      const r = await http(q.method, q.url, q.o);
      if (r.status !== 200 || !/"tt\d{7,9}"/.test(r.body || "")) throw new Error(`IMDb API ${r.status || r.error || "failed"}`);
      for (const x of pageExtract([r.body])) {
        let p = out[x.i];
        if (!p) { p = out[x.i] = { i: x.i }; order.push(x.i); }
        for (const f of Object.keys(x)) if (f !== "i" && f !== "r" && x[f] !== undefined) p[f] = x[f];
        if (x.r && !p.r) p.r = x.r;
      }
      const inf = gqlInfo(JSON.parse(r.body));
      if (inf.total) total = inf.total;
      if (want && order.length >= want) break;
      if (!inf.next) break;
      cursor = inf.next;
      await breathe(30);
    }
    const items = order.map(id => out[id]).filter(x => x.t).map(fromCompact);
    if (!items.length) throw new Error("IMDb API gave no titles");
    items.total = total; items.loads = pages; items.newest = !!(want && items.length >= want && total > items.length); items.capped = false;
    if (!items.newest && total && items.length < total * 0.98) throw new Error(`IMDb API stopped at ${items.length} of ${total}`);
    return items;
  }
  // titles of an IMDb page: the API with a kept template first, the page otherwise (keeping its template for next time)
  async function pageOrApi(http, url, timeout, want, store) {
    const key = "imdb_tpl " + url.replace(/^https:\/\/www\.imdb\.com/, "");
    let tpl = null;
    if (store) { try { tpl = JSON.parse(store.get(key) || "null"); } catch (e) { tpl = null; } }
    if (tpl) {
      try { const it = await apiTitles(http, tpl, want); it.route = `IMDb API (no page)${it.total ? `, IMDb counts ${it.total}` : ""}`; return it; }
      catch (e) { if (store) store.set(key, ""); }
    }
    const it = await browseTitles(http, url, timeout, want);
    if (store && it.tpl) store.set(key, JSON.stringify(it.tpl));
    return it;
  }

  // A list still loading when time ran out is kept, but reported as partial so the next sync tries again.
  const browserRoute = items => `in-app browser${items.loads ? `, ${items.loads} extra page loads` : ""}${items.total ? `, IMDb counts ${items.total}` : ""}${items.capped ? ` (stopped early${items.dbg ? ": " + items.dbg : ""})` : ""}`;

  async function pageItems(http, url) {
    const html = await getText(http, url);
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    const out = new Map();
    if (m) { try { walkTitles(JSON.parse(m[1]), out); } catch (e) { /* ignore */ } }
    if (!out.size) for (const tt of new Set(html.match(/tt\d{7,9}/g) || [])) out.set(tt, { imdb: tt, title: null, year: null, medium: "Movie" });
    if (!out.size) throw new Error("no titles found in page");
    return [...out.values()];
  }

  let gqlBlocked = false; // IMDb refused both API addresses this run: don't keep asking
  // ---- 0.5.9: IMDb's data service, the way the old GameCheck app read it (which kept working): the cached GET
  // address first (caching.graphql.imdb.com), the POST address only if that fails. No page, no hidden browser.
  const GQL_CACHE = "https://caching.graphql.imdb.com/";
  const GQL_HEAD = Object.assign({ "Content-Type": "application/json", Accept: "application/json", Origin: "https://www.imdb.com", Referer: "https://www.imdb.com/" }, IMDB_H);
  const T_FIELDS = "id titleType{id} titleText{text} originalTitleText{text} releaseYear{year} releaseDate{day month year} runtime{seconds} titleGenres{genres{genre{text}}}";
  async function imdbGql(http, query) {
    if (gqlBlocked) throw new Error("IMDb API refused earlier in this sync");
    let r = await http("GET", GQL_CACHE + "?query=" + encodeURIComponent(query), { headers: GQL_HEAD, once: true });
    if (r.status !== 200) {
      const r2 = await http("POST", GQL, { headers: GQL_HEAD, body: JSON.stringify({ query }), once: true });
      if (r2.status !== 200 && /^(403|429)$/.test(String(r.status)) && /^(403|429)$/.test(String(r2.status))) gqlBlocked = true;
      r = r2;
    }
    if (r.status !== 200) throw new Error(`IMDb API HTTP ${r.status || 0}`);
    let j;
    try { j = JSON.parse(r.body); } catch (e) { throw new Error("IMDb API: not JSON"); }
    if (j && j.data && Object.values(j.data).some(v => v != null)) return j.data;
    throw new Error("IMDb API: " + ((((j && j.errors) || [])[0] || {}).message || "empty answer").slice(0, 160));
  }
  function gqlTitle(t, extra) {
    if (!t || !TT.test(t.id || "")) return null;
    const gs = ((t.titleGenres || {}).genres) || [], rd = t.releaseDate || {};
    return Object.assign({ imdb: t.id, title: (t.titleText || {}).text || (t.originalTitleText || {}).text || null, year: (t.releaseYear || {}).year || rd.year || null,
      medium: mediumFromImdb((t.titleType || {}).id), date: rd.year ? parseDate({ year: rd.year, month: rd.month, day: rd.day }) : null,
      runtime: t.runtime && t.runtime.seconds ? Math.round(t.runtime.seconds / 60) : null, genres: gs.filter(x => x.genre).map(x => x.genre.text).join(", ") }, extra || {});
  }
  // a title from one edge, whichever shape IMDb uses (node.listItem, listItem, node.title, node itself)
  const edgeTitle = e => (e && ((e.node && (e.node.listItem || e.node.title || (e.node.id ? e.node : null))) || e.listItem || e.title)) || null;
  async function gqlList(http, listId) {
    const items = [];
    let total = 0, after = null, name = "";
    for (let i = 0; i < 60; i++) {
      const d = await imdbGql(http, `{list(id:"${listId}"){name{originalText} listClass{id} items(first:250${after ? `,after:${JSON.stringify(after)}` : ""}){total pageInfo{hasNextPage endCursor} edges{node{listItem{... on Title{${T_FIELDS}}}}}}}}`);
      const L0 = d.list;
      const L = L0 && Object.assign({}, L0, { items: L0.items || L0.titleListItemSearch });
      if (!L || !L.items) throw new Error("IMDb API: no such list, or it's private");
      name = (L.name && L.name.originalText) || name;
      if (L.items.total) total = L.items.total;
      for (const e of L.items.edges || []) { const it = gqlTitle(edgeTitle(e)); if (it) items.push(it); }
      const pi = L.items.pageInfo || {};
      if (!pi.hasNextPage || !pi.endCursor) break;
      after = pi.endCursor;
      await breathe(0);
    }
    if (!items.length && total) throw new Error("IMDb API: the list came back empty");
    items.total = total; items.name = name;
    return items;
  }
  // your IMDb user id (ur…) for a p.… profile id: read once from your public ratings page, then kept
  async function imdbUr(http, user, store) {
    const u = String(user || "");
    const ur = (u.match(/ur\d{4,}/) || [])[0];
    if (ur) return ur;
    const p2 = (u.match(/p\.[a-z0-9]+/i) || [])[0];
    if (!p2) return "";
    if (store && store.get("imdb_ur_for") === p2 && store.get("imdb_ur")) return store.get("imdb_ur");
    const r = await http("GET", `https://www.imdb.com/user/${p2}/ratings/`, { headers: Object.assign({ Accept: "text/html" }, IMDB_H), once: true });
    const m = String(r.body || "").match(/"authorId":"(ur\d{4,})"/) || String(r.body || "").match(/"(ur\d{4,})"/);
    if (!m) return "";
    if (store) { store.set("imdb_ur", m[1]); store.set("imdb_ur_for", p2); }
    return m[1];
  }
  async function gqlRatings(http, ur, want = 0) {
    const items = [];
    let total = 0, after = null, desc = null, prev = null;
    for (let i = 0; i < 200; i++) {
      const d = await imdbGql(http, `{userRatings(first:250,userId:"${ur}"${after ? `,after:${JSON.stringify(after)}` : ""}){total pageInfo{hasNextPage endCursor} edges{node{title{${T_FIELDS}} userRating{value date}}}}}`);
      const R = d.userRatings;
      if (!R) throw new Error("IMDb API: your ratings are private or unavailable");
      if (R.total) total = R.total;
      for (const e of R.edges || []) {
        const n = e.node || {}, ur2 = n.userRating || {};
        const date = ur2.date ? String(ur2.date).slice(0, 10) : null;
        const it = gqlTitle(n.title, { rating: ur2.value || null, rated_at: date, date });
        if (!it) continue;
        if (date && prev) { const dd = date <= prev; desc = desc === null ? dd : desc && dd; }
        if (date) prev = date;
        items.push(it);
      }
      // only the newest are wanted (the rest is already stored): stop once enough came, if IMDb gives newest first
      if (want && desc && items.length >= want) { items.newest = true; break; }
      const pi = R.pageInfo || {};
      if (!pi.hasNextPage || !pi.endCursor) break;
      after = pi.endCursor;
      await breathe(0);
    }
    items.total = total;
    return items;
  }
  async function gqlWatchlistId(http, ur) {
    const d = await imdbGql(http, `{predefinedList(classType:WATCH_LIST,userId:"${ur}"){id}}`);
    const id = d.predefinedList && d.predefinedList.id;
    if (!id) throw new Error("IMDb API: no watchlist found");
    return id;
  }

  function listIdFrom(url) {
    const m = String(url).match(/ls\d+/);
    if (!m) throw new Error(`No list id (lsXXXX) in ${url}`);
    return m[0];
  }

  async function imdbList(http, url) {
    const lid = listIdFrom(url);
    const errs = [];
    let netFail = false;
    // 1. IMDb's data service: no page to load, nothing running on the screen's engine, 250 titles a request.
    try {
      const it = await gqlList(http, lid);
      if (!it.total || it.length >= it.total * 0.98) return [it, `IMDb API (no page)${it.total ? `, IMDb counts ${it.total}` : ""}`];
      errs.push(`api: ${it.length} of ${it.total}`);
    } catch (e) { errs.push(`api: ${e.message}`); }
    // 2. the list's CSV export: the whole list in one request
    try {
      const groups = parseImdbText(await getText(http, `https://www.imdb.com/list/${lid}/export`), "list");
      if (groups.list && groups.list.length) return [groups.list, "CSV export"];
      errs.push("export: not a CSV");
    } catch (e) { errs.push(`export: ${e.message}`); }
    // 3. only then the hidden browser
    if (http.browse) {
      try { const it = await browseTitles(http, `https://www.imdb.com/list/${lid}/`, CONFIG.listBrowseMs); return [it, browserRoute(it)]; } catch (e) { errs.push(`browser: ${e.message}`); if (e.network) netFail = true; }
    }
    try { return [await pageItems(http, `https://www.imdb.com/list/${lid}/`), "page (may be first batch only)"]; } catch (e) { errs.push(`page: ${e.message}`); }
    if (netFail) throw netError(`couldn't reach IMDb after ${CONFIG.browseTries} tries (the connection dropped, or IMDb is limiting requests). Tap Retry failed in a few minutes.`);
    throw new Error(`IMDb list ${lid} failed (${errs.join("; ")}). Check the list is public, or sign in to IMDb in Settings.`);
  }

  // Accepts ur1234567, the newer p.xxxxxxxx profile IDs, or any IMDb profile/ratings/watchlist link.
  function imdbUserId(s) {
    const m = String(s || "").match(/(ur\d+|p\.[a-z0-9]+)/i);
    return m ? m[1] : String(s || "").trim();
  }

  async function imdbWatchlist(http, user, store = null) {
    const id = imdbUserId(user);
    const errs = [];
    let netFail = false;
    try {
      const ur = await imdbUr(http, user, store);
      if (ur) { const wid = await gqlWatchlistId(http, ur); const it = await gqlList(http, wid); return [it, `IMDb API (no page)${it.total ? `, IMDb counts ${it.total}` : ""}`]; }
    } catch (e) { errs.push(`api: ${e.message}`); }
    if (http.browse) {
      try { const it = await pageOrApi(http, `https://www.imdb.com/user/${id}/watchlist/`, CONFIG.listBrowseMs, 0, store); return [it, it.route || browserRoute(it)]; } catch (e) { errs.push(`browser: ${e.message}`); if (e.network) netFail = true; }
    }
    let html = "";
    try { html = await getText(http, `https://www.imdb.com/user/${id}/watchlist/`); } catch (e) { errs.push(`page: ${e.message}`); }
    if (html) {
      const m = html.match(/"(?:listId|watchlistId)"\s*:\s*"(ls\d+)"/) || html.match(/\/list\/(ls\d+)\/export/) || html.match(/\/list\/(ls\d+)/);
      if (m) {
        try { const [items, route] = await imdbList(http, `https://www.imdb.com/list/${m[1]}/`); return [items, `${route} (watchlist ${m[1]})`]; } catch (e) { errs.push(e.message); }
      }
      const out = new Map();
      const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nd) { try { walkTitles(JSON.parse(nd[1]), out); } catch (e) { /* ignore */ } }
      if (!out.size) for (const tt of new Set(html.match(/tt\d{7,9}/g) || [])) out.set(tt, { imdb: tt, title: null, year: null, medium: "Movie" });
      if (out.size) return [[...out.values()], "page (may be first batch only)"];
      errs.push("no titles found in page");
    }
    if (netFail) throw netError(`couldn't reach IMDb after ${CONFIG.browseTries} tries (the connection dropped, or IMDb is limiting requests). Tap Retry failed in a few minutes.`);
    throw new Error(`IMDb watchlist for ${id} failed (${errs.join("; ")}). Check your watchlist is public, or sign in to IMDb in Settings.`);
  }

  async function imdbRatings(http, ur, want = 0, store = null) {
    const user = ur;
    ur = imdbUserId(ur);
    const errs = [];
    let netFail = false;
    try {
      const uid = await imdbUr(http, user, store);
      if (uid) {
        const items = await gqlRatings(http, uid, want);
        if (items.length) {
          const groups = { rated: items };
          Object.defineProperty(groups, "total", { value: items.total || 0, enumerable: false });
          Object.defineProperty(groups, "newest", { value: !!items.newest, enumerable: false });
          return [groups, `IMDb API (no page)${items.total ? `, IMDb counts ${items.total}` : ""}`];
        }
        errs.push("api: no ratings");
      }
    } catch (e) { errs.push(`api: ${e.message}`); }
    if (http.browse) {
      try {
        const items = await pageOrApi(http, `https://www.imdb.com/user/${ur}/ratings/`, CONFIG.listBrowseMs + 120000, want, store);
        const groups = {};
        for (const it of items) (groups[it.rating ? "rated" : "watched"] = groups[it.rating ? "rated" : "watched"] || []).push(it);
        Object.defineProperty(groups, "total", { value: items.total || 0, enumerable: false });
        Object.defineProperty(groups, "newest", { value: items.newest, enumerable: false });
        return [groups, items.route || browserRoute(items)];
      } catch (e) { errs.push(`browser: ${e.message}`); if (e.network) netFail = true; }
    }
    try {
      const groups = parseImdbText(await getText(http, `https://www.imdb.com/user/${ur}/ratings/export`), "auto");
      if (Object.keys(groups).length) return [groups, "CSV export"];
      errs.push("export: login required");
    } catch (e) { errs.push(`export: ${e.message}`); }
    try { return [{ watched: await pageItems(http, `https://www.imdb.com/user/${ur}/ratings/`) }, "page (first page only, no ratings)"]; } catch (e) { errs.push(`page: ${e.message}`); }
    if (netFail) throw netError(`couldn't reach IMDb after ${CONFIG.browseTries} tries (the connection dropped, or IMDb is limiting requests). Tap Retry failed in a few minutes.`);
    throw new Error(`IMDb ratings for ${ur} failed (${errs.join("; ")}). If your ratings are private, import your ratings CSV, or use Sign in to IMDb in Settings.`);
  }

  // ---- TMDB ----
  class TMDB {
    constructor(http, key) {
      this.http = http;
      this.key = String(key || "").trim();
      if (!this.key) throw new Error("Enter a TMDB API key in Settings first.");
      this.n = 0;
    }

    async get(path, params = {}) {
      this.n++;
      if (this.n % 40 === 0) await sleep(1000);
      const headers = { accept: "application/json" };
      const p = Object.assign({}, params);
      if (this.key.startsWith("eyJ")) headers.Authorization = `Bearer ${this.key}`; else p.api_key = this.key;
      for (let i = 0; i < 4; i++) {
        const q = qs(p);
        const r = await this.http("GET", `https://api.themoviedb.org/3${path}${q ? "?" + q : ""}`, { headers });
        if (r.status === 429) { await sleep((parseFloat(r.headers["retry-after"] || "3") + 1) * 1000); continue; }
        if (r.status === 404) return {};
        if (r.status === 401) throw new Error("TMDB rejected the API key.");
        if (r.status < 200 || r.status >= 300) throw httpError(r, "TMDB");
        return JSON.parse(r.body);
      }
      throw new Error("TMDB kept returning 429 (rate limit). Try again in a minute.");
    }
  }

  async function collectionScan(db, http, key, progress) {
    const t = new TMDB(http, key);
    const movies = new Map();
    for (const it of seeds(db)) if (it.medium === "Movie" && (it.imdb || it.tmdb)) movies.set(it.imdb || "tmdb:" + it.tmdb, it);
    const keys = [...movies.keys()];
    const collections = new Map();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i], it = movies.get(k);
      let cached = db.cacheGet(k), cid, cname;
      if (cached === null) {
        let tid = it.tmdb;
        if (!tid) {
          const res = await t.get(`/find/${it.imdb}`, { external_source: "imdb_id" });
          const mr = res.movie_results || [];
          tid = mr.length ? mr[0].id : null;
        }
        cid = null; cname = null;
        if (tid) {
          const c = (await t.get(`/movie/${tid}`)).belongs_to_collection || {};
          cid = c.id || null; cname = c.name || null;
        }
        db.cachePut(k, tid ? String(tid) : null, cid ? String(cid) : null, cname);
      } else { cid = cached.collection_id; cname = cached.collection_name; }
      if (cid) collections.set(String(cid), cname);
      if (i % 5 === 0) progress(0.5 * (i + 1) / Math.max(keys.length, 1), `Finding collections ${i + 1}/${keys.length}`);
    }
    const rows = await collectionRows(t, db, collections, (j, n, name) =>
      progress(0.5 + 0.5 * j / Math.max(n, 1), `Collection ${j}/${n}: ${name}`));
    const n = db.replaceCanon("tmdb", rows);
    progress(1, `TMDB scan done: ${collections.size} collections, ${n} entries`);
    return n;
  }

  // Fetches every part of the given collections. IMDb IDs of parts are cached, so a refresh only costs one
  // request per collection plus one per newly announced film.
  async function collectionRows(t, db, collections, progress) {
    const rows = [];
    let j = 0;
    for (const [cid, cname] of collections) {
      const col = await t.get(`/collection/${cid}`);
      for (const p of col.parts || []) {
        let imdb = (db.cacheGet(`part:${p.id}`) || {}).imdb || null;
        if (!imdb) {
          const m = await t.get(`/movie/${p.id}/external_ids`);
          imdb = m.imdb_id || null;
          if (imdb) db.cacheSet(`part:${p.id}`, { imdb });
        }
        rows.push({ franchise: cname || col.name || "Collection", title: p.title, year: (p.release_date || "").slice(0, 4),
                    date: p.release_date || null, medium: "Movie", imdb, tmdb: p.id, poster: p.poster_path || null });
      }
      j++;
      if (progress) progress(j, collections.size, cname);
    }
    return rows;
  }

  // Background: re-read the collections you've already started, picking up newly announced films and date changes.
  async function refreshCollections(db, http, key) {
    const t = new TMDB(http, key);
    const collections = new Map();
    for (const v of db.tmdbCache.values()) if (v && v.collection_id) collections.set(String(v.collection_id), v.collection_name);
    if (!collections.size) return "no collections yet (run a TMDB scan in the app)";
    const rows = await collectionRows(t, db, collections);
    db.replaceCanon("tmdb", rows);
    return `${collections.size} collections, ${rows.length} films`;
  }

  // Poster lookups for canon entries that came without one (AI scans, IMDb/Trakt lists). Cached, misses included.
  const posterKey = c => `poster:${norm(c.title)}|${c.year || ""}|${c.medium === "TV Series" ? "tv" : "m"}`;
  async function fillPosters(db, http, key, status, budget = 120) {
    const t = new TMDB(http, key);
    const todo = status.filter(c => !c.poster && c.medium !== "Video Game" && db.cacheGet(posterKey(c)) === null);
    todo.sort((a, b) => (a.have - b.have) || (b.year || 0) - (a.year || 0)); // missing first, newest first
    let calls = 0, found = 0, turn = 0;
    for (const c of todo) {
      if (calls >= budget) break;
      if (++turn % 5 === 0) await breathe(0);
      let p = null;
      try {
        if (c.imdb) {
          const r = await t.get(`/find/${c.imdb}`, { external_source: "imdb_id" }); calls++;
          const hit = (r.movie_results || [])[0] || (r.tv_results || [])[0] || (r.tv_episode_results || [])[0];
          p = hit ? hit.poster_path || hit.still_path || null : null;
        } else if (c.medium === "TV Series") {
          const r = await t.get("/search/tv", { query: c.title, first_air_date_year: c.year || undefined }); calls++;
          p = ((r.results || [])[0] || {}).poster_path || null;
        } else {
          const r = await t.get("/search/movie", { query: c.title, year: c.year || undefined }); calls++;
          p = ((r.results || [])[0] || {}).poster_path || null;
        }
      } catch (e) { if (/rejected the API key/.test(e.message)) throw e; continue; }
      db.cacheSet(posterKey(c), { p });
      if (p) found++;
    }
    return `${found} posters added`;
  }

  // ---- Title details: release dates from several sources, where to watch, resolution, more info ----
  const PREFERRED = [/disney/i, /netflix/i, /amazon prime|prime video/i];
  const prefRank = name => { const i = PREFERRED.findIndex(r => r.test(name)); return i < 0 ? 9 : i; };
  const RES = { _4K: "4K", "4K": "4K", UHD: "4K", HD: "HD", SD: "SD" };
  const RES_ORDER = { "4K": 3, HD: 2, SD: 1 };
  const JW = "https://apis.justwatch.com/graphql";
  const VPN_DEFAULT = "US, GB, CA, AU, DE, FR, ES, NL, JP, KR, IN, BR, MX, SE";
  const JW_QUERY = `query S($country: Country!, $language: Language!, $first: Int!, $filter: TitleFilter, $offerFilter: OfferFilter!) {
  popularTitles(country: $country, filter: $filter, first: $first, sortBy: POPULAR, sortRandomSeed: 0) {
    edges { node { ...T } }
  }
}
fragment T on MovieOrShowOrSeasonOrEpisode {
  objectType
  content(country: $country, language: $language) {
    title originalReleaseYear originalReleaseDate
    ... on MovieOrShowOrSeasonContent { externalIds { imdbId tmdbId } scoring { imdbScore imdbVotes tmdbScore tomatoMeter } }
  }
  offers(country: $country, platform: WEB, filter: $offerFilter) {
    monetizationType presentationType standardWebURL
    package { clearName technicalName shortName }
  }
}`;

  // JustWatch (unofficial API): offers with picture quality. Returns null if nothing matches.
  // extra: other countries whose offers (with picture quality) come back in the same request, for the VPN list
  function jwQuery(extra) {
    if (!extra.length) return JW_QUERY;
    const OFFER = "monetizationType presentationType standardWebURL package { clearName technicalName shortName }";
    // abroad only streaming offers are needed (no rent/buy), which keeps the answer small
    return JW_QUERY.replace("$offerFilter: OfferFilter!)", "$offerFilter: OfferFilter!, $streamFilter: OfferFilter!" + extra.map(cc => `, $c${cc}: Country!`).join("") + ")")
      .replace("  offers(country: $country,", extra.map(cc => `  o${cc}: offers(country: $c${cc}, platform: WEB, filter: $streamFilter) { ${OFFER} }\n`).join("") + "  offers(country: $country,");
  }
  const offerList = list => {
    const by = new Map();
    for (const o of list || []) {
      const name = (o.package || {}).clearName || (o.package || {}).technicalName;
      if (!name) continue;
      const k = `${name}|${o.monetizationType}`;
      const res2 = RES[o.presentationType] || null;
      const cur = by.get(k);
      if (!cur || (RES_ORDER[res2] || 0) > (RES_ORDER[cur.res] || 0)) by.set(k, { name, type: String(o.monetizationType || "").toLowerCase(), res: res2, url: o.standardWebURL || null });
    }
    return [...by.values()];
  };

  async function justWatch(http, region, c, ids, extra = []) {
    extra = extra.filter(cc => /^[A-Z]{2}$/.test(cc) && cc !== region).slice(0, 14);
    const vars = { country: region, language: "en", first: 5, filter: { searchQuery: c.title, includeTitlesWithoutUrl: true }, offerFilter: { bestOnly: false } };
    for (const cc of extra) vars["c" + cc] = cc;
    if (extra.length) vars.streamFilter = { bestOnly: false, monetizationTypes: ["FLATRATE", "FREE", "ADS"] };
    const r = await withTimeout(http("POST", JW, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: jwQuery(extra), variables: vars }) }),
                                30000, "JustWatch didn't answer");
    if (r.status !== 200) {
      if (extra.length && r.status === 400) return justWatch(http, region, c, ids, []);
      throw new Error(`JustWatch HTTP ${r.status}`);
    }
    const res = JSON.parse(r.body);
    if (res.errors && !res.data) {
      if (extra.length) return justWatch(http, region, c, ids, []);
      throw new Error(`JustWatch: ${(res.errors[0] || {}).message || "error"}`);
    }
    const nodes = (((res.data || {}).popularTitles || {}).edges || []).map(e => e.node).filter(Boolean);
    const node = nodes.find(n => { const x = ((n.content || {}).externalIds) || {}; return (ids.imdb && x.imdbId === ids.imdb) || (ids.tmdb && String(x.tmdbId) === String(ids.tmdb)); })
      || nodes.find(n => n.content && norm(n.content.title) === norm(c.title) && (!c.year || Math.abs((n.content.originalReleaseYear || 0) - c.year) <= 1));
    if (!node) return null;
    const abroad = {};
    for (const cc of extra) if (node["o" + cc]) abroad[cc] = offerList(node["o" + cc]);
    const sc = (node.content || {}).scoring || {};
    return { offers: offerList(node.offers), abroad, date: node.content.originalReleaseDate || null, imdbScore: sc.imdbScore || null, imdbVotes: sc.imdbVotes || null, tomato: sc.tomatoMeter || null };
  }

  // 0.6.2: a person's films and series (TMDB), most known first; kept for 14 days
  async function personWorks(db, http, name, now = Date.now()) {
    const key = db.get("tmdb_key");
    if (!key) throw new Error("Add a TMDB key in Settings to see their other work.");
    const ck = `person:${norm(name)}`, hit = db.cacheGet(ck);
    if (hit && now - hit.at < 14 * 864e5) return hit;
    const t = new TMDB(http, key);
    const r = await t.get("/search/person", { query: name });
    const p = ((r && r.results) || []).sort((a, b) => (norm(b.name) === norm(name)) - (norm(a.name) === norm(name)) || (b.popularity || 0) - (a.popularity || 0))[0];
    if (!p) { const out = { at: now, id: null, name, dept: "", works: [] }; db.cacheSet(ck, out); return out; }
    const cr = await t.get(`/person/${p.id}/combined_credits`);
    const seen = new Map();
    for (const [x, role] of [].concat(((cr && cr.cast) || []).map(x => [x, x.character ? `as ${x.character}` : "Actor"]), ((cr && cr.crew) || []).map(x => [x, x.job || "Crew"]))) {
      if (x.media_type !== "movie" && x.media_type !== "tv") continue;
      if (x.media_type === "tv" && x.character && /himself|herself|themselves|self\b/i.test(x.character)) continue; // talk shows, award nights
      const k = x.media_type + x.id, old = seen.get(k);
      if (old) { if (!old.roles.includes(role)) old.roles.push(role); continue; }
      const date = x.release_date || x.first_air_date || "";
      seen.set(k, { tmdb: x.id, type: x.media_type === "tv" ? "show" : "movie", title: x.title || x.name || "", year: date ? +date.slice(0, 4) : null,
        poster: x.poster_path ? "https://image.tmdb.org/t/p/w185" + x.poster_path : "", pop: (x.vote_count || 0) + (x.popularity || 0), roles: [role] });
    }
    const works = [...seen.values()].filter(w => w.title).sort((a, b) => b.pop - a.pop).slice(0, 80);
    const out = { at: now, id: p.id, name: p.name, dept: p.known_for_department || "", works };
    db.cacheSet(ck, out);
    return out;
  }
  // 0.6.5: "because you rated X": TMDB's recommendations for your best-rated titles (most recent first), added up so
  // a title several of your favourites lead to comes first. seeds: [{ title, year, type, tmdb, imdb, rating }] (rating 1-10).
  // have(t) says whether a { type, tmdb, title, year } is already yours (library, dismissed). Kept 3 days.
  const TMDB_GENRES = { 28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History", 27: "Horror",
    10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Science fiction", 10770: "TV film", 53: "Thriller", 10752: "War", 37: "Western", 10759: "Action", 10762: "Kids", 10763: "News",
    10764: "Reality", 10765: "Science fiction", 10766: "Soap", 10767: "Talk", 10768: "War" };
  async function recommend(db, http, seeds, have = () => false, opt = {}) {
    const key = db.get("tmdb_key");
    if (!key) throw new Error("Add a TMDB key in Settings for suggestions.");
    const t = new TMDB(http, key), now = opt.now || Date.now(), max = opt.seeds || 10;
    const score = new Map();
    let used = 0;
    for (const sd of seeds) {
      if (used >= max) break;
      const ck = `recs:${sd.type}:${sd.tmdb || sd.imdb || norm(sd.title)}`;
      let list = db.cacheGet(ck);
      if (!list || now - list.at > 3 * 864e5) {
        const tid = sd.tmdb ? { id: sd.tmdb, tv: sd.type === "show" } : await tmdbIdFor(t, db, { title: sd.title, year: sd.year, imdb: sd.imdb, medium: sd.type === "show" ? "TV Series" : "Movie" }).catch(() => null);
        if (!tid) continue;
        const r = await t.get(`/${tid.tv ? "tv" : "movie"}/${tid.id}/recommendations`).catch(() => null);
        list = { at: now, items: ((r && r.results) || []).slice(0, 20).map(x => ({ tmdb: x.id, type: tid.tv ? "show" : "movie", title: x.title || x.name || "", year: +(x.release_date || x.first_air_date || "").slice(0, 4) || null,
          poster: x.poster_path ? "https://image.tmdb.org/t/p/w185" + x.poster_path : "", genres: (x.genre_ids || []).map(g => TMDB_GENRES[g]).filter(Boolean), vote: x.vote_average || 0, votes: x.vote_count || 0, overview: x.overview || "" })) };
        db.cacheSet(ck, list);
        await breathe(0);
      }
      used++;
      const w = Math.max(0.5, (sd.rating || 8) - 6); // a 10 counts four times a 7
      list.items.forEach((x, i) => {
        if (!x.title || x.votes < 30 || have(x)) return;
        const k = x.type + x.tmdb, e = score.get(k) || Object.assign({ score: 0, because: [] }, x);
        e.score += w * (1 - i / 25); if (e.because.length < 3 && !e.because.includes(sd.title)) e.because.push(sd.title);
        score.set(k, e);
      });
    }
    return [...score.values()].map(e => Object.assign(e, { score: e.score * (0.8 + e.vote / 50) })).sort((a, b) => b.score - a.score).slice(0, opt.limit || 40);
  }
  // 0.6.2: the posters TMDB has for a film or series (the "Change poster" picker)
  async function tmdbPosters(db, http, c) {
    const key = db.get("tmdb_key");
    if (!key) throw new Error("Add a TMDB key in Settings to choose a poster.");
    const t = new TMDB(http, key);
    const tid = await tmdbIdFor(t, db, c);
    if (!tid) throw new Error("TMDB doesn't know this title");
    const r = await t.get(`/${tid.tv ? "tv" : "movie"}/${tid.id}/images`, { include_image_language: "en,it,null" });
    return ((r && r.posters) || []).sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0)).slice(0, 40).map(x => "https://image.tmdb.org/t/p/w185" + x.file_path);
  }
  async function tmdbIdFor(t, db, c) {
    const tv = c.medium === "TV Series";
    if (c.tmdb) return { id: String(c.tmdb), tv };
    const ck = `tid:${c.imdb || norm(c.title) + "|" + (c.year || "")}|${tv ? "tv" : "m"}`;
    const hit = db.cacheGet(ck);
    if (hit) return hit.id ? hit : null;
    let id = null, isTv = tv;
    if (c.imdb) {
      const r = await t.get(`/find/${c.imdb}`, { external_source: "imdb_id" });
      const m = (r.movie_results || [])[0], s2 = (r.tv_results || [])[0];
      if (m) { id = m.id; isTv = false; } else if (s2) { id = s2.id; isTv = true; }
    } else {
      const r = await t.get(tv ? "/search/tv" : "/search/movie", tv ? { query: c.title, first_air_date_year: c.year || undefined } : { query: c.title, year: c.year || undefined });
      id = ((r.results || [])[0] || {}).id || null;
    }
    const v = { id: id ? String(id) : null, tv: isTv };
    db.cacheSet(ck, v);
    return id ? v : null;
  }

  // Theatrical / digital / physical dates for the region (then US, then anywhere).
  function pickDates(rd, region) {
    const res = (rd && rd.results) || [];
    const forC = cc => (res.find(x => x.iso_3166_1 === cc) || {}).release_dates || [];
    const earliest = (list, types) => list.filter(d => types.includes(d.type) && d.release_date).map(d => d.release_date.slice(0, 10)).sort()[0] || null;
    const out = { region: null, cinema: null, digital: null, physical: null };
    for (const cc of [region, "US"]) {
      const l = forC(cc);
      if (!l.length) continue;
      const cin = earliest(l, [3, 2]), dig = earliest(l, [4]), phy = earliest(l, [5]);
      if (!out.cinema && cin) { out.cinema = cin; out.region = out.region || cc; }
      if (!out.digital && dig) { out.digital = dig; out.digitalRegion = cc; }
      if (!out.physical && phy) out.physical = phy;
    }
    if (!out.digital) out.digital = res.flatMap(x => (x.release_dates || []).filter(d => d.type === 4).map(d => d.release_date.slice(0, 10))).sort()[0] || null;
    return out;
  }

  // Everything the app knows about one title, cached (3 days for unreleased/upcoming, 14 otherwise).
  async function titleInfo(db, http, c, opts = {}) {
    const key = db.get("tmdb_key");
    if (!key) throw new Error("Add a TMDB key in Settings to load details.");
    const region = (db.get("region", "IT") || "IT").toUpperCase();
    const t = new TMDB(http, key);
    const tid = await tmdbIdFor(t, db, c);
    if (!tid) return null;
    const ck = `info:${tid.tv ? "tv" : "m"}${tid.id}`;
    const cached = db.cacheGet(ck);
    const now = opts.now || Date.now();
    if (cached && cached.v === 4 && !opts.force && now - cached.at < (cached.unreleased ? 3 : 14) * 864e5) return cached;
    const vpnCountries = String(db.get("vpn_countries", VPN_DEFAULT)).toUpperCase().split(/[^A-Z]+/).filter(x => x.length === 2);
    const d = await t.get(tid.tv ? `/tv/${tid.id}` : `/movie/${tid.id}`, {
      append_to_response: tid.tv ? "watch/providers,external_ids,content_ratings,aggregate_credits" : "watch/providers,external_ids,release_dates,credits" });
    if (!d || !d.id) return null;
    const today = new Date(now).toISOString().slice(0, 10);
    const prov = ((d["watch/providers"] || {}).results || {})[region] || {};
    const offers = [];
    for (const [type, list] of [["flatrate", prov.flatrate], ["free", prov.free], ["ads", prov.ads], ["rent", prov.rent], ["buy", prov.buy]]) {
      for (const p of list || []) offers.push({ name: p.provider_name, type, res: null });
    }
    const imdb = (d.external_ids || {}).imdb_id || c.imdb || null;
    let jw = null, jwError = null;
    // JustWatch has no public API: picture quality comes from its app's internal address, which can change or be
    // blocked. It can be switched off (Settings › Streaming); after a failure it rests for 12 hours instead of
    // making every title wait 30 seconds.
    const jwOn = db.get("jw_quality", "1") === "1", jwRest = +db.get("jw_fail_at", "0") || 0;
    if (!jwOn) jwError = "switched off";
    else if (Date.now() - jwRest < 12 * 3600e3) jwError = "not answering, trying again later";
    else {
      try { jw = await justWatch(http, region, { title: d.title || d.name || c.title, year: c.year }, { imdb, tmdb: tid.id }, vpnCountries); if (jwRest) db.set("jw_fail_at", "0"); }
      catch (e) { jwError = e.message; if (!/HTTP 4\d\d/.test(e.message) || /HTTP 4(03|29)/.test(e.message)) db.set("jw_fail_at", String(Date.now())); }
    }
    if (jw) {
      // JustWatch adds picture quality; merge into TMDB's list (same names) and add anything TMDB didn't have
      for (const o of jw.offers) {
        const same = offers.find(x => x.name.replace(/\s+/g, "").toLowerCase() === o.name.replace(/\s+/g, "").toLowerCase() && (x.type === o.type || (x.type === "flatrate" && o.type === "flatrate")));
        if (same) { if ((RES_ORDER[o.res] || 0) > (RES_ORDER[same.res] || 0)) same.res = o.res; same.url = same.url || o.url; }
        else offers.push(o);
      }
    }
    const typeRank = { flatrate: 0, free: 1, ads: 2, rent: 3, buy: 4 };
    offers.sort((a, b) => (typeRank[a.type] ?? 5) - (typeRank[b.type] ?? 5) || prefRank(a.name) - prefRank(b.name) || (RES_ORDER[b.res] || 0) - (RES_ORDER[a.res] || 0));
    const dates = tid.tv ? { cinema: null, digital: null, physical: null } : pickDates(d.release_dates, region);
    const original = (tid.tv ? d.first_air_date : d.release_date) || null;
    // dates other sources give for the same title, to compare
    const src = [];
    if (original) src.push(["TMDB", original]);
    if (jw && jw.date) src.push(["JustWatch", jw.date]);
    const n0 = norm(c.title);
    for (const row of db.canon()) if (row.norm === n0 && row.date && (!c.year || !row.year || Math.abs(row.year - c.year) <= 1)) src.push([({ url: "Canon list", tmdb: "TMDB collection", gemini: "Gemini", claude: "Claude" })[row.origin] || row.origin, row.date]);
    for (const it of db.items()) if (((imdb && it.imdb === imdb) || (!imdb && it.norm === n0)) && it.date) src.push([it.source === "imdb" ? "IMDb" : "Trakt", it.date]);
    const seenSrc = new Set(), sources = [];
    for (const [n, dt] of src) { const k = n + dt; if (!seenSrc.has(k)) { seenSrc.add(k); sources.push({ name: n, date: dt }); } }
    const full = sources.filter(x => x.date.length === 10).map(x => x.date).sort();
    const conflict = full.length > 1 && (Date.parse(full[full.length - 1]) - Date.parse(full[0])) > 7 * 864e5;
    const unreleased = tid.tv ? (d.status && !/ended|canceled|returning/i.test(d.status) && (!original || original > today))
      : (!original || original > today || (dates.digital && dates.digital > today) || (!dates.digital && dates.cinema && dates.cinema > today));
    const cert = tid.tv ? (((d.content_ratings || {}).results || []).find(x => x.iso_3166_1 === region) || {}).rating
      : ((((d.release_dates || {}).results || []).find(x => x.iso_3166_1 === region) || {}).release_dates || []).map(x => x.certification).find(Boolean);
    const crew = tid.tv ? (d.created_by || []).map(x => x.name) : ((d.credits || {}).crew || []).filter(x => x.job === "Director").map(x => x.name);
    const castSrc = tid.tv ? ((d.aggregate_credits || {}).cast || []) : ((d.credits || {}).cast || []);
    const info = {
      at: now, id: tid.id, tv: tid.tv, imdb, title: d.title || d.name, original, dates, sources, conflict, unreleased: !!unreleased,
      runtime: tid.tv ? ((d.episode_run_time || [])[0] || null) : (d.runtime || null), genres: (d.genres || []).map(g => g.name),
      overview: d.overview || "", tagline: d.tagline || "", status: d.status || "", cert: cert || null,
      tmdbScore: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null, tmdbVotes: d.vote_count || 0,
      imdbScore: jw && jw.imdbScore ? jw.imdbScore : null, tomato: jw && jw.tomato ? jw.tomato : null,
      crew: crew.slice(0, 3), cast: castSrc.slice(0, 5).map(x => x.name), networks: (d.networks || []).map(n => n.name).slice(0, 3),
      seasons: tid.tv ? d.number_of_seasons || null : null, episodes: tid.tv ? d.number_of_episodes || null : null,
      poster: d.poster_path || null, offers: offers.slice(0, 12), region, jwError, v: 4,
      world: worldFrom((d["watch/providers"] || {}).results, jw ? jw.abroad : null),
    };
    db.cacheSet(ck, info);
    return info;
  }

  // Release-date line: unreleased films show cinema + digital (VOD) dates; released ones their original date.
  function dateSummary(info) {
    if (!info) return "";
    if (info.tv) return info.original ? `First aired ${fmtWhen({ date: info.original })}` : "";
    const today = new Date(info.at).toISOString().slice(0, 10);
    if (info.unreleased) {
      const parts = [];
      if (info.dates.cinema) parts.push(`Cinema ${fmtWhen({ date: info.dates.cinema })}`);
      parts.push(info.dates.digital ? `Digital/VOD ${fmtWhen({ date: info.dates.digital })}` : "Digital/VOD date not announced");
      if (!info.dates.cinema && info.original && info.original > today) parts.unshift(`Release ${fmtWhen({ date: info.original })}`);
      return parts.join(" · ");
    }
    return info.original ? `Released ${fmtWhen({ date: info.original })}` : "";
  }

  // Best place to stream (preferring Disney+, Netflix, Prime Video included with Prime), e.g. "Disney+ 4K".
  function bestOffer(info) {
    if (!info || !info.offers) return null;
    const stream = info.offers.filter(o => o.type === "flatrate" || o.type === "free" || o.type === "ads");
    stream.sort((a, b) => prefRank(a.name) - prefRank(b.name) || (RES_ORDER[b.res] || 0) - (RES_ORDER[a.res] || 0));
    return stream[0] || null;
  }

  const cachedInfo = (db, c) => {
    const tv = c.medium === "TV Series";
    const tid = c.tmdb ? { id: String(c.tmdb), tv } : db.cacheGet(`tid:${c.imdb || norm(c.title) + "|" + (c.year || "")}|${tv ? "tv" : "m"}`);
    return tid && tid.id ? db.cacheGet(`info:${tid.tv ? "tv" : "m"}${tid.id}`) : null;
  };

  // Sync step: details for what matters most (Up next, unreleased and recent canon), within a call budget.
  async function enrichInfo(db, http, status, budget = 60) {
    const today = new Date().toISOString().slice(0, 10), year = +today.slice(0, 4);
    const nexts = new Set(upNext(status, 50).map(c => c.norm + "|" + c.year));
    const pick = status.filter(c => !c.have && c.medium !== "Video Game")
      .map(c => ({ c, p: nexts.has(c.norm + "|" + c.year) ? 0 : (c.date ? c.date >= today : (c.year || 0) >= year) ? 1 : (c.year || 0) >= year - 1 ? 2 : 3 }))
      .filter(x => x.p < 3).sort((a, b) => a.p - b.p);
    let done = 0, fresh = 0, errs = 0;
    let turn = 0;
    for (const { c } of pick) {
      if (done >= budget) break;
      if (++turn % 5 === 0) await breathe(0);
      const before = cachedInfo(db, c);
      try {
        const info = await titleInfo(db, http, c);
        if (info && info !== before) { done++; fresh++; }
      } catch (e) { if (/TMDB rejected/.test(e.message)) throw e; errs++; done++; }
    }
    return `${fresh} titles updated${errs ? `, ${errs} failed` : ""}`;
  }

  // Background: next episode for shows you've watched. Ended/canceled shows are rechecked monthly, others every 10 h.
  // force: recheck running shows now (Refresh shows button) instead of waiting 10 h.
  async function tvNext(db, http, key, budget = 450, now = Date.now(), force = false) {
    const t = new TMDB(http, key);
    const shows = new Map();
    for (const it of consumed(db)) if (it.medium === "TV Series" && (it.tmdb || it.imdb)) shows.set(it.tmdb ? "t" + it.tmdb : it.imdb, it);
    const list = [...shows.values()].map(it => {
      let id = it.tmdb || ((db.cacheGet(`tvfind:${it.imdb}`) || {}).id) || null;
      const c = id ? db.cacheGet(`tv:${id}`) : null;
      return { it, id, checked: c ? c.checked : 0, c };
    }).sort((a, b) => a.checked - b.checked);
    let calls = 0, checked = 0, premieres = 0, withEpisodes = 0, turn = 0;
    for (const x of list) {
      if (calls >= budget) break;
      if (++turn % 5 === 0) await breathe(0);
      if (!x.id && x.it.imdb) {
        if (db.cacheGet(`tvfind:${x.it.imdb}`)) continue; // known to have no TMDB match
        const res = await t.get(`/find/${x.it.imdb}`, { external_source: "imdb_id" });
        calls++;
        x.id = ((res.tv_results || [])[0] || {}).id || null;
        db.cacheSet(`tvfind:${x.it.imdb}`, { id: x.id });
        if (!x.id) continue;
        x.c = db.cacheGet(`tv:${x.id}`);
      }
      const c = x.c, age = c ? now - c.checked : Infinity;
      const ended = c && /ended|cancel/i.test(c.status || "");
      if (c && age < (ended ? 30 * 864e5 : (force ? 0 : 10 * 36e5))) continue;
      const d = await t.get(`/tv/${x.id}`);
      calls++;
      checked++;
      const la = d.last_episode_to_air;
      const aired = la && la.season_number ? { s: la.season_number, e: la.episode_number, date: la.air_date || null } : null;
      const seasons = (d.seasons || []).filter(x2 => x2 && x2.season_number > 0 && x2.episode_count > 0).map(x2 => [x2.season_number, x2.episode_count]);
      const n = d.next_episode_to_air;
      const next = n && n.air_date ? { date: n.air_date, s: n.season_number, e: n.episode_number, name: n.name || "" } : null;
      if (next && next.e === 1) premieres++;
      // the rest of that season, so the Upcoming tab can list every scheduled episode
      let eps = next ? [next] : [];
      if (next && calls < budget) {
        try {
          const season = await t.get(`/tv/${x.id}/season/${next.s}`);
          calls++;
          const list = (season.episodes || []).filter(ep => ep.air_date && ep.air_date >= next.date)
            .map(ep => ({ date: ep.air_date, s: ep.season_number || next.s, e: ep.episode_number, name: ep.name || "" }));
          if (list.length) eps = list.slice(0, 40);
        } catch (e) { /* keep just the next episode */ }
      }
      if (eps.length) withEpisodes++;
      db.cacheSet(`tv:${x.id}`, { name: d.name || x.it.title, status: d.status || "", checked: now, imdb: x.it.imdb || null, next, eps,
                                  poster: d.poster_path || null, aired, seasons });
    }
    const left = list.filter(x => !x.c || now - x.c.checked > 10 * 36e5).length;
    return `${checked} shows checked${left > 0 && calls >= budget ? `, ${left} more next time` : ""}, ${withEpisodes} with new episodes, ${premieres} season premieres scheduled`;
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtWhen(e) {
    if (e.date && e.date.length === 10) { const [y, m, d] = e.date.split("-"); return `${+d} ${MONTHS[+m - 1]} ${y}`; }
    if (e.date && e.date.length === 7) { const [y, m] = e.date.split("-"); return `${MONTHS[+m - 1]} ${y}`; }
    return e.year ? String(e.year) : "date to be announced";
  }

  // Everything you haven't seen that's still to come: missing canon with a future date (or a future year), plus
  // season premieres of shows you've watched.
  function upcomingEvents(db, status, today = new Date().toISOString().slice(0, 10)) {
    const year = +today.slice(0, 4), ev = [];
    const hidden = db.upHidden();
    for (const c0 of status) {
      if (c0.have) continue;
      // a regional cinema date from TMDB beats a vaguer date from other sources
      const i0 = c0.medium === "Movie" ? cachedInfo(db, c0) : null;
      const c = i0 && i0.dates && i0.dates.cinema ? Object.assign({}, c0, { date: i0.dates.cinema }) : c0;
      const future = c.date ? c.date >= today : (c.year || 0) > year;
      if (!future) continue;
      const key = `c|${c.norm}|${c.year || ""}|${c.medium}`;
      if (hidden[key]) continue;
      const inf = c.medium === "Movie" ? cachedInfo(db, c) : null;
      if (inf && inf.dates && inf.dates.digital && inf.dates.digital >= today && !hidden[key]) {
        ev.push({ key: `v|${c.norm}|${c.year || ""}`, hideKey: key, kind: "canon", vod: true, title: c.title, franchise: c.franchise,
                  date: inf.dates.digital, year: +inf.dates.digital.slice(0, 4), medium: c.medium, imdb: c.imdb, poster: c.poster || inf.poster || null });
      }
      ev.push({ key, hideKey: key, kind: "canon", title: c.title, franchise: c.franchise,
                date: c.date || null, year: c.year, medium: c.medium, imdb: c.imdb, poster: c.poster || null });
    }
    if (db.get("bg_tv", "1") === "1") {
      for (const [k, v] of db.tmdbCache) {
        if (!k.startsWith("tv:") || !v || !v.next || v.next.e !== 1 || !(v.next.date >= today)) continue;
        if (hidden[`show|${k}`]) continue;
        ev.push({ key: `s|${k}|${v.next.s}`, hideKey: `show|${k}`, kind: "season", title: `${v.name} season ${v.next.s}`, franchise: v.name,
                  date: v.next.date, year: +v.next.date.slice(0, 4), medium: "TV Series", imdb: v.imdb, poster: v.poster || null });
      }
    }
    return ev.sort((a, b) => (a.date || `${a.year}-13`).localeCompare(b.date || `${b.year}-13`) || a.title.localeCompare(b.title));
  }

  // Scheduled episodes of shows you've watched, soonest first (from the TMDB data saved by tvNext).
  function upcomingEpisodes(db, today = new Date().toISOString().slice(0, 10)) {
    const out = [];
    const hidden = db.upHidden();
    for (const [k, v] of db.tmdbCache) {
      if (!k.startsWith("tv:") || !v || hidden[`show|${k}`]) continue;
      for (const ep of (v.eps && v.eps.length ? v.eps : (v.next ? [v.next] : []))) {
        if (!ep.date || ep.date < today) continue;
        out.push({ key: `e|${k}|${ep.s}|${ep.e}`, hideKey: `show|${k}`, poster: v.poster || null, kind: "episode", show: v.name, s: ep.s, e: ep.e, name: ep.name, date: ep.date,
                   imdb: v.imdb, medium: "TV Series", premiere: ep.e === 1, title: `${v.name} S${ep.s}E${ep.e}` });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.show.localeCompare(b.show) || a.s - b.s || a.e - b.e);
  }

  // Shows you're part-way through: aired episodes after the last one you watched (Trakt progress + TMDB air data).
  function continueWatching(db) {
    let prog;
    try { prog = JSON.parse(db.get("trakt_progress", "{}")) || {}; } catch (e) { prog = {}; }
    const hidden = db.upHidden(), out = [];
    for (const [id, p] of Object.entries(prog)) {
      const v = db.cacheGet(`tv:${id}`);
      if (!v || !v.aired || !v.seasons || hidden[`next|tv:${id}`]) continue;
      const W = new Set();
      let hs = 0, he = 0;
      for (const [sn, nums] of Object.entries(p.eps || {})) for (const e of nums) {
        W.add(`${sn}x${e}`);
        if (+sn > hs || (+sn === hs && e > he)) { hs = +sn; he = e; }
      }
      if (!W.size) continue;
      let next = null, left = 0;
      for (const [sn, count] of v.seasons.slice().sort((a, b) => a[0] - b[0])) {
        for (let e = 1; e <= count; e++) {
          if (sn > v.aired.s || (sn === v.aired.s && e > v.aired.e)) break;
          if (sn < hs || (sn === hs && e <= he)) continue;
          if (W.has(`${sn}x${e}`)) continue;
          left++;
          if (!next) next = { s: sn, e };
        }
      }
      if (!next) continue;
      const fresh = !!(v.aired.date && p.last && v.aired.date > p.last.slice(0, 10));
      out.push({ key: `next|tv:${id}`, hideKey: `next|tv:${id}`, kind: "next", show: v.name || p.t, title: v.name || p.t, imdb: p.imdb || v.imdb,
                 medium: "TV Series", poster: v.poster || null, s: next.s, e: next.e, left, fresh, last: p.last, lastAired: v.aired.date });
    }
    // shows with episodes released since you last watched first, then most recently watched
    return out.sort((a, b) => (b.fresh - a.fresh) || String(b.last || "").localeCompare(String(a.last || "")));
  }

  const hashId = s => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h % 2000000000) + 1; };

  // Compares upcoming events with what you've already been told about. The first run only records the current
  // state (no flood of notifications). Returns notifications: new announcements and release-day reminders.
  function computeAlerts(db, status, today = new Date().toISOString().slice(0, 10)) {
    let known;
    try { known = JSON.parse(db.get("alerts_known", "{}")); } catch (e) { known = {}; }
    const baseline = !db.get("alerts_baseline");
    const news = [], todays = [];
    for (const e of upcomingEvents(db, status, today)) {
      let k = known[e.key];
      if (!k) {
        k = known[e.key] = { d: e.date || String(e.year || "") };
        if (!baseline) news.push(e);
      } else if (e.date && k.d !== e.date) k.d = e.date;
      if (e.date === today && !k.t) { k.t = 1; todays.push(e); }
    }
    const epsToday = [];
    if (db.get("bg_eps", "0") === "1") {
      for (const ep of upcomingEpisodes(db, today)) {
        if (ep.date !== today || ep.premiere) continue; // premieres already get "Out today"
        const k = known[ep.key] || (known[ep.key] = { d: ep.date });
        if (!k.t) { k.t = 1; epsToday.push(ep); }
      }
    }
    const cutoff = new Date(new Date(today).getTime() - 60 * 864e5).toISOString().slice(0, 10);
    for (const [key, v] of Object.entries(known)) if (v.d && v.d.length === 10 && v.d < cutoff) delete known[key];
    db.set("alerts_known", JSON.stringify(known));
    db.set("alerts_baseline", "1");
    const epNotes = epsToday.length <= 3
      ? epsToday.map(ep => ({ id: hashId("t" + ep.key), title: `New episode today: ${ep.show}`, text: `S${ep.s}E${ep.e}${ep.name ? ` "${ep.name}"` : ""}.`, tab: "upcoming" }))
      : [{ id: hashId("eps" + today), title: `${epsToday.length} new episodes today`, text: epsToday.map(ep => `${ep.show} S${ep.s}E${ep.e}`).join(", ") + ".", tab: "upcoming" }];
    const notes = epNotes.concat(todays.map(e => ({ id: hashId("t" + e.key), title: e.vod ? `Out on digital today: ${e.title}` : `Out today: ${e.title}`,
      text: e.kind === "season" ? "New season starts today." : `${e.franchise}. Missing from your canon.`, tab: "missing" })));
    if (news.length <= 3) {
      for (const e of news) {
        notes.push(e.kind === "season"
          ? { id: hashId("n" + e.key), title: `New season of ${e.franchise}`, text: `Season ${e.key.split("|").pop()} starts ${fmtWhen(e)}.`, tab: "home" }
          : e.vod ? { id: hashId("n" + e.key), title: `${e.title} is coming to digital/VOD`, text: `${fmtWhen(e)}. ${e.franchise}.`, tab: "upcoming" }
          : { id: hashId("n" + e.key), title: `New in ${e.franchise}: ${e.title}`, text: `Coming ${fmtWhen(e)}.`, tab: "home" });
      }
    } else {
      const shown = news.slice(0, 6).map(e => `${e.title} (${fmtWhen(e)})`);
      notes.push({ id: hashId("summary" + today + news.length), title: `${news.length} new releases announced`,
                   text: shown.join(", ") + (news.length > 6 ? `, and ${news.length - 6} more.` : "."), tab: "home" });
    }
    return notes;
  }

  // The whole background check (also used by "Check now" in the app).
  async function backgroundRun(db, http, progress = () => {}, now = new Date()) {
    const report = [];
    const step = async (label, fn) => {
      progress(report.length / 4, label);
      try { report.push(`OK  ${label}: ${await fn()}`); } catch (e) { report.push(`FAIL ${label}: ${e.message}`); }
    };
    const user = db.get("username"), cid = db.get("client_id");
    if (user && cid) await step("Trakt", async () => `${await traktSync(db, http, cid, user, db.get("token") || null, () => {})} records`);
    if (db.get("tmdb_key")) {
      await step("TMDB collections", () => refreshCollections(db, http, db.get("tmdb_key")));
      if (db.get("bg_tv", "1") === "1") await step("New seasons", () => tvNext(db, http, db.get("tmdb_key"), 450, now.getTime()));
    } else report.push("SKIP TMDB: add a TMDB key in Settings to check collections and new seasons");
    const th = Math.max(0.7, Math.min(1, (parseFloat(db.get("threshold", "90")) || 90) / 100));
    const status = canonStatus(db, th);
    const notes = computeAlerts(db, status, now.toISOString().slice(0, 10));
    // "now streaming on one of your services" (extras.js): refresh a few titles' streaming info, then compare
    if (Core.streamAlerts && db.get("stream_alerts", "1") === "1") {
      if (db.get("tmdb_key")) await step("Streaming", () => enrichInfo(db, http, status, 25));
      const mine = String(db.get("my_services", "Disney+, Netflix, Prime Video")).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
      for (const n of Core.streamAlerts(db, status, mine)) notes.push(n);
    }
    report.push(`OK  Notifications: ${notes.length}`);
    db.set("bg_last", now.getTime() / 1000);
    db.set("bg_report", report.join("\n"));
    progress(1, "Background check finished");
    return { report: report.join("\n"), notes };
  }

  async function resolveSpecial(t, it, th) {
    const imdb = it.imdb;
    const res = await t.get(`/find/${imdb}`, { external_source: "imdb_id" });
    const eps = res.tv_episode_results || [];
    if (eps.length) {
      const e = eps[0];
      const sn = parseInt(e.season_number || 0, 10), en = parseInt(e.episode_number || 0, 10);
      if (sn === 0) return ["Linked Season 0 special", `TMDB show ${e.show_id} S00E${String(en).padStart(2, "0")} carries this IMDb ID, so Trakt files it under the parent series' Specials instead of as its own entry.`];
      return ["Regular episode", `Episode S${sn}E${en} of TMDB show ${e.show_id}; Trakt tracks it inside the show.`];
    }
    if ((res.movie_results || []).length) return ["On TMDB as movie", "TMDB has a movie record. If Trakt still lacks it, wait for Trakt's ~24h TMDB sync."];
    if ((res.tv_results || []).length) return ["On TMDB as series", "TMDB has a series record. If Trakt still lacks it, wait for Trakt's ~24h TMDB sync."];
    const title = it.title || "";
    if (!title.includes(":")) return ["Not on TMDB", `No TMDB record is bound to ${imdb}. Add the IMDb ID to the matching TMDB record (or create it) so Trakt can sync it within 24h.`];
    const idx = title.indexOf(":");
    const parent = title.slice(0, idx).trim(), sub = title.slice(idx + 1).trim();
    for (const show of ((await t.get("/search/tv", { query: parent })).results || []).slice(0, 3)) {
      const s0 = await t.get(`/tv/${show.id}/season/0`);
      let best = null, bs = 0;
      for (const ep of s0.episodes || []) {
        const s = ratio(norm(sub), norm(ep.name || ""));
        if (s > bs) { best = ep; bs = s; }
      }
      if (best && bs >= Math.min(th, 0.8)) {
        const en = parseInt(best.episode_number, 10);
        const ext = await t.get(`/tv/${show.id}/season/0/episode/${en}/external_ids`);
        const code = `S00E${String(en).padStart(2, "0")}`;
        if (!ext.imdb_id) return ["Nested special (TMDB lacks IMDb ID)", `Found as ${code} of TMDB show ${show.id} (${show.name}), but that episode has no imdb_id. Contribute ${imdb} on TMDB so Trakt links it in its next 24h sync.`];
        return ["Nested special (different IMDb ID)", `Found as ${code} of TMDB show ${show.id}, bound to ${ext.imdb_id} instead of ${imdb}.`];
      }
    }
    return ["Unlinked", `No Season 0 episode on a matching parent series; ${imdb} has no TMDB link. Contribute the IMDb ID on TMDB if the entry exists there.`];
  }

  async function season0Scan(db, http, key, threshold, progress, checkAll = false, limit = 250) {
    const t = new TMDB(http, key);
    const d = discrepancies(db);
    const cands = d.imdb_not_trakt.filter(i => checkAll || i.medium === "Special").slice(0, limit);
    if (!cands.length) { progress(1, d.warning || "No IMDb-only specials to check."); return 0; }
    for (let n = 0; n < cands.length; n++) {
      const it = cands[n];
      const [status, note] = await resolveSpecial(t, it, threshold);
      db.upsertSpecial(it.imdb, it.title, status, note);
      progress((n + 1) / cands.length, `Specials ${n + 1}/${cands.length}: ${it.title}`);
    }
    progress(1, `Checked ${cands.length} items`);
    return cands.length;
  }

  // ---- AI canon scans (Gemini, Claude) ----
  // ---- AI prompts. Answers come back as short plain lines instead of JSON: about half the output tokens
  // (no repeated keys, the franchise written once per group), and easier for the model to keep consistent.
  // Every parser below still reads the older JSON answers too.
  const TYPE_CODE = { "Movie": "F", "TV Series": "S", "Special": "P", "Video Game": "G" };
  const typeCode = m => TYPE_CODE[m] || (/game/i.test(m) ? "G" : /series|show/i.test(m) ? "S" : /special|short|episode/i.test(m) ? "P" : "F");
  const CODE_TYPE = { F: "Movie", S: "TV Series", P: "Special", G: "Video Game" };
  const mediumOf = t => CODE_TYPE[String(t || "").trim().toUpperCase()] || mediumFromText(t);
  const promptLine = (title, year, medium, extra) => `${title} (${year || "?"}) [${typeCode(medium)}]${extra ? ` {${extra}}` : ""}`;
  const TYPES_LEGEND = "Types: F film, S series (any TV, animated, limited, anthology, web series), P special/short/one-off, G video game.";
  const CANON_RULES = `Include: films, series, spin-offs, prequels, sequels, crossovers, TV films, specials (holiday, anniversary), shorts, webisodes, canon games, officially announced future entries.
Exclude: compilations, recaps, re-edits, re-releases, documentaries, making-ofs, fan works, non-canon material.
Accuracy over volume: list only works you are certain exist or are officially announced. Title exactly as on IMDb. Year = first release. Date only if you are sure, otherwise "-".`;
  const LINES_OUT = "OUTPUT: plain lines, no JSON, no markdown, no commentary.";
  const PROMPT = `Task: group these titles into franchises / shared universes and list the COMPLETE official canon of each one, including entries not in my list.
${CANON_RULES}
Skip titles that belong to no franchise.
${LINES_OUT}
# Franchise name
Title | type | year | date
${TYPES_LEGEND}

TITLES:
`;
  // Universe names already in use that are relevant to this batch (sharing a word with its titles): keeps names consistent
  // without sending hundreds of unrelated names every time.
  function relevantNames(names, lines, max = 60) {
    const stemOf = w => w.replace(/(es|s)$/, "");
    const words = new Set(norm(lines.join(" ")).split(" ").filter(w => w.length > 3).map(stemOf));
    return names.filter(n => norm(n).split(" ").some(w => w.length > 3 && words.has(stemOf(w)))).slice(0, max);
  }
  // "# Group" headers followed by "Title | type | year | date | extra" lines -> [{group, title, medium, year, date, extra}]
  function parseLines(text) {
    const out = [];
    let group = null;
    for (let line of String(text || "").split(/\r?\n/)) {
      line = line.replace(/^\s*[-*•]\s+/, "").replace(/`/g, "").trim();
      if (!line || /^(output|types?):/i.test(line)) continue;
      const h = line.match(/^#{1,4}\s*(.+?)\s*#*$/);
      if (h) { group = h[1].replace(/\*\*/g, "").trim(); continue; }
      if (!line.includes("|")) continue;
      const f = line.split("|").map(x => x.trim());
      if (/^title$/i.test(f[0])) continue;
      const year = (String(f[2] || "").match(/\d{4}/) || [])[0] || null;
      const date = parseDate(/^\d{4}-\d\d(-\d\d)?$/.test(f[3] || "") ? f[3] : null);
      out.push({ group, title: f[0].replace(/\*\*/g, ""), medium: mediumOf(f[1]), year, date, extra: f[4] && f[4] !== "-" ? f[4] : null, raw: f });
    }
    return out;
  }
  const looksJson = t => { t = String(t || ""); return /```json/i.test(t) || /^\s*(```\s*)?[\[{]/.test(t) || /\[\s*\{\s*"/.test(t); };

  function parseJsonArray(text) {
    text = String(text).trim().replace(/^```(?:json)?|```$/gm, "").trim();
    let data;
    try { data = JSON.parse(text); } catch (e) {
      const a = text.indexOf("["), z = text.lastIndexOf("]");
      try { data = JSON.parse(text.slice(a, z + 1)); } catch (e2) {
        const body = a >= 0 ? text.slice(a) : text;
        const cut = body.lastIndexOf("},");
        if (cut === -1) throw new Error("The AI returned unparseable JSON.");
        data = JSON.parse(body.slice(0, cut + 1) + "]");
      }
    }
    if (data && !Array.isArray(data) && typeof data === "object") data = Object.values(data).find(Array.isArray) || [];
    return (data || []).filter(d => d && typeof d === "object" && !Array.isArray(d));
  }

  const GEM = "https://generativelanguage.googleapis.com/v1beta";

  // Google error -> Error with: status, apiMessage, reason, retryMs (from RetryInfo), daily (a per-day quota), noFree
  // (this model has no free quota: "limit: 0").
  function gemError(r) {
    if (r.status === 0) return Object.assign(new Error(`Gemini: network error (${r.error || "no connection"})`), { status: 0 });
    let e = null;
    try { e = JSON.parse(r.body).error; } catch (x) { /* not JSON */ }
    if (!e || !e.message) return Object.assign(new Error(`Gemini error ${r.status}: ${String(r.body || "").slice(0, 200)}`), { status: r.status, apiMessage: "" });
    const details = e.details || [];
    const reason = (details.find(d => d.reason) || {}).reason || "";
    const retry = (details.find(d => d.retryDelay) || {}).retryDelay;
    const retryMs = retry ? Math.ceil(parseFloat(retry) * 1000) : 0;
    const quotaIds = details.flatMap(d => (d.violations || []).map(v => `${v.quotaId || ""} ${v.quotaMetric || ""}`)).join(" ");
    const daily = /PerDay/i.test(quotaIds) || /per day|daily/i.test(e.message);
    const noFree = /limit:\s*0\b/.test(e.message);
    let hint = "";
    if (reason === "ACCESS_TOKEN_TYPE_UNSUPPORTED" || /ACCESS_TOKEN_TYPE_UNSUPPORTED/.test(r.body)) {
      hint = " Google is rejecting this AQ. key for the Gemini API (a known Google issue with the new key type). Try creating a new key in AI Studio in a new project, or an API key in Google Cloud Console (APIs & Services > Credentials) with the Generative Language API enabled.";
    } else if (r.status === 400 && /API key not valid/i.test(e.message)) hint = " Check the Gemini key in Settings.";
    else if (r.status === 403 && /SERVICE_DISABLED|has not been used|disabled/i.test(r.body)) hint = " Enable the Generative Language API for this key's Google Cloud project.";
    return Object.assign(new Error(`Gemini error ${r.status}${e.status ? " " + e.status : ""}: ${e.message}${hint}`),
      { status: r.status, apiMessage: e.message, reason, retryMs, daily, noFree });
  }

  // Higher is better: newest general-purpose Flash first, stable over preview, never image/audio/embedding models.
  function rankGeminiModel(id) {
    id = String(id).replace(/^models\//, "");
    if (/^gemma-\d/.test(id)) return /-it$/.test(id) ? 1 + parseFloat((id.match(/^gemma-(\d+)/) || [])[1] || "0") / 10 : -1; // free fallback
    if (!/^gemini-/.test(id)) return -1;
    if (/(image|tts|audio|live|embedding|vision|learnlm|robotics|computer-use|native|aqa|nano|argon|ultra)/.test(id)) return -1;
    let s = parseFloat((id.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || "0") * 100;
    if (/flash-lite/.test(id)) s += 40; else if (/flash/.test(id)) s += 60; else if (/pro/.test(id)) return 0.5; else s -= 20; // pro: paid, last
    if (/preview|exp/.test(id)) s -= 5;
    if (/-\d{3}$|-\d{2}-\d{4}$/.test(id)) s -= 1; // pinned snapshots rank just below the alias
    return s;
  }

  async function geminiModels(http, key) {
    const r = await withTimeout(http("GET", `${GEM}/models?pageSize=200`, { headers: { "x-goog-api-key": key } }), 45000, "Google didn't answer within 45 s");
    if (r.status !== 200) throw gemError(r);
    return (JSON.parse(r.body).models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map(m => String(m.name).replace(/^models\//, ""));
  }

  async function geminiCandidates(http, key, wanted) {
    wanted = String(wanted || "").trim().replace(/^models\//, "");
    const models = await geminiModels(http, key);
    const best = models.filter(m => rankGeminiModel(m) >= 0).sort((a, b) => rankGeminiModel(b) - rankGeminiModel(a));
    if (wanted && wanted !== "auto" && models.includes(wanted)) best.unshift(wanted);
    if (!best.length) throw new Error("This Gemini key can't use any text models. Check the key in Google AI Studio.");
    return [...new Set(best)];
  }

  async function resolveGeminiModel(http, key, wanted) {
    return (await geminiCandidates(http, key, wanted))[0];
  }

  // Calls Gemini, moving on to the model Google suggests (or the next best) when a model is retired or blocked
  // for this account ("no longer available to new users" comes back as 404 NOT_FOUND even though it's still listed).
  async function geminiCallWithFallback(http, key, state, prompt) {
    for (let tries = 0; tries < 5; tries++) {
      try { return await geminiCall(http, key, state.model, prompt, { search: state.search }); } catch (e) {
        const switchable = e.status === 404 || e.noFree || (e.status === 429 && e.daily) ||
          /no longer available|not found|is not supported for generateContent|not available in your|free tier/i.test(e.apiMessage || "");
        if (!switchable) throw e;
        state.tried.add(state.model);
        const sugg = ((e.apiMessage || "").match(/models\/(gemini-[a-z0-9.\-]+)/gi) || [])
          .map(x => x.replace(/^models\//i, "")).filter(m => !state.tried.has(m));
        const next = sugg[0] || state.candidates.find(m => !state.tried.has(m));
        if (!next) {
          if (e.status === 429) throw Object.assign(new Error("You've used today's free Gemini quota on every available model. Progress is saved; run the scan again tomorrow (quotas reset at midnight Pacific time)."), { stopRun: true });
          throw e;
        }
        state.model = next;
        state.onSwitch(next);
      }
    }
    throw new Error("Gemini: no working model found for this key.");
  }

  async function geminiCall(http, key, model, prompt, opts = {}) {
    const search = !!opts.search;
    // JSON mode can't be combined with Google Search, and line-format prompts must not be forced into JSON
    let json = !/^gemma/.test(model) && !search && !/^OUTPUT: plain lines/m.test(prompt);
    let thinking = !/^gemma/.test(model);
    for (let attempt = 0; attempt < 4; attempt++) {
      const generationConfig = { temperature: 0.2, maxOutputTokens: 16000 };
      if (json) generationConfig.responseMimeType = "application/json";
      // keep "thinking" short: long thinking made big batches run for many minutes
      if (thinking) generationConfig.thinkingConfig = /gemini-2\./.test(model) ? { thinkingBudget: 1024 } : { thinkingLevel: "low" };
      const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig };
      if (search) body.tools = [{ google_search: {} }];
      const r = await withTimeout(http("POST", `${GEM}/models/${encodeURIComponent(model)}:generateContent`,
                           { headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) }),
                           CONFIG.aiTimeoutMs, `Gemini didn't answer within ${Math.round(CONFIG.aiTimeoutMs / 1000)} s`);
      if (r.status === 200) {
        let text = "";
        try {
          const parts = JSON.parse(r.body).candidates[0].content.parts || [];
          text = parts.filter(p => !p.thought && typeof p.text === "string").map(p => p.text).join("");
        } catch (e) { /* handled below */ }
        if (!text) throw new Error("Gemini returned no content (blocked or empty).");
        return text;
      }
      const err = gemError(r);
      if (r.status === 400 && json && /mime|json mode|response_mime_type|responseMimeType/i.test(err.apiMessage || "")) { json = false; attempt--; continue; }
      if (r.status === 400 && thinking && /thinking/i.test(err.apiMessage || "")) { thinking = false; attempt--; continue; }
      if (r.status === 429) {
        if (err.noFree || err.daily) throw err;                  // switch model / stop for today
        await sleep(Math.min(Math.max(err.retryMs || CONFIG.retryDelayMs * 2 * (attempt + 1), 1000), 90000));
        continue;
      }
      if (r.status === 503 || r.status === 500) { await sleep(CONFIG.retryDelayMs * (attempt + 1)); continue; }
      throw err;
    }
    throw Object.assign(new Error("Gemini kept returning rate-limit errors. Wait a minute and run the scan again; progress is saved."), { stopRun: true });
  }

  // Incremental: only titles not yet sent to Gemini are processed, results are merged, and a large library is
  // covered over several runs (each run handles up to maxBatches batches). resetGemini() starts over.
  function aiState(db, origin = "gemini") {
    let sent;
    try { sent = new Set(JSON.parse(db.get(`${origin}_sent`, "[]"))); } catch (e) { sent = new Set(); }
    const pool = seeds(db).filter(i => MEDIA.includes(i.medium) && i.title);
    const pending = pool.filter(i => !sent.has(i.key));
    return { sent, pool, pending };
  }
  const geminiState = db => aiState(db, "gemini");

  function resetAi(db, origin = "gemini") {
    db.replaceCanon(origin, []);
    db.set(`${origin}_sent`, "[]");
  }
  const resetGemini = db => resetAi(db, "gemini");

  // provider: { origin, label, prepare(): Promise<modelName>, call(prompt): Promise<text> }
  async function canonScan(db, provider, progress, batchSize, maxBatches, only) {
    const origin = provider.origin, label = provider.label;
    const st0 = aiState(db, origin), sent = st0.sent, pool = only && only.length ? only : st0.pool, pending = only && only.length ? only : st0.pending;
    if (!pool.length) throw new Error("No titles yet. Sync or import your IMDb/Trakt data first.");
    if (!pending.length) { progress(1, `${label} has already checked every title`); return 0; }
    progress(0, `${label}: checking which models your key can use`);
    await provider.prepare();
    const hints = db.franchiseHints();
    const batches = [];
    for (let i = 0; i < pending.length && batches.length < maxBatches; i += batchSize) batches.push(pending.slice(i, i + batchSize));
    let added = 0;
    for (let b = 0; b < batches.length; b++) {
      progress(b / batches.length, `${label} (${provider.model}) batch ${b + 1}/${batches.length}, ${pending.length - b * batchSize} titles to go`);
      // reuse universe names already found by any AI scan, so results merge into the same franchises
      const lines = batches[b].map(i => promptLine(i.title, i.year, i.medium, hints.get(i.norm)));
      const names = relevantNames([...new Set(db.canon().filter(c => c.origin === "gemini" || c.origin === "claude" || c.origin === "ai").map(c => c.franchise))], lines);
      const reuse = names.length ? `\nUse these franchise names exactly when they fit: ${names.join("; ")}\n` : "";
      const rows = [], seenK = new Set();
      if (CONFIG.cancelled) { progress(1, `${label} stopped. ${added} entries added; progress is saved.`); CONFIG.cancelled = false; return added; }
      let answer;
      try { answer = await provider.call(PROMPT.replace("TITLES:", (provider.extra || "") + reuse + "TITLES:") + lines.join("\n")); } catch (e) {
        if (e.cancelled) { progress(1, `${label} stopped. ${added} entries added; progress is saved.`); return added; }
        if (e.timeout && b > 0) { progress(1, `${e.message}. Stopped after ${b} batches; run again to continue.`); return added; }
        if (!e.stopRun || b === 0) throw e;
        progress(1, `${e.message} (${added} entries added before stopping)`);
        e.added = added;
        throw e;
      }
      for (const r of parseCanonRows(answer)) {
        const k = `${norm(r.franchise)}|${norm(r.title)}|${r.year || ""}`;
        if (seenK.has(k)) continue;
        seenK.add(k);
        rows.push(r);
      }
      added += db.mergeCanon(origin, rows);
      for (const i of batches[b]) sent.add(i.key);
      db.set(`${origin}_sent`, JSON.stringify([...sent]));
      if (b < batches.length - 1) await sleep(CONFIG.aiGapMs);
    }
    const left = pool.length - sent.size;
    progress(1, left > 0 ? `${label} checked ${sent.size} of ${pool.length} titles. Run it again to continue.` : `${label} has checked every title`);
    return added;
  }

  async function multiverseScan(db, http, key, model, progress, batchSize = 40, maxBatches = 25, opts = {}) {
    key = String(key || "").trim();
    if (!key) throw new Error("Enter a Gemini API key in Settings first.");
    const gs = { tried: new Set(), search: !!opts.search, onSwitch: m => {
      db.set("gemini_model_used", m);
      if (db.get("gemini_model", "auto") !== "auto") db.set("gemini_model", "auto");
    } };
    const provider = {
      origin: "gemini", label: "Gemini",
      prepare: async () => {
        // only pay for the model lookup when there's work to do
        gs.candidates = await geminiCandidates(http, key, model);
        gs.model = gs.candidates[0];
        db.set("gemini_model_used", gs.model);
      },
      get model() { return gs.model; },
      call: prompt => geminiCallWithFallback(http, key, gs, prompt),
    };
    return canonScan(db, provider, progress, batchSize, maxBatches, opts && opts.only);
  }

  // Quick check of a Gemini key: lists models, then asks the best free model for a one-word reply.
  async function testGemini(http, key, wanted) {
    key = String(key || "").trim();
    if (!key) throw new Error("Enter a Gemini API key first.");
    const candidates = await geminiCandidates(http, key, wanted);
    const st = { model: candidates[0], candidates, tried: new Set(), onSwitch: () => {} };
    const text = await geminiCallWithFallback(http, key, st, 'Reply with the JSON array ["ok"] and nothing else.');
    return { model: st.model, models: candidates.length, reply: String(text).trim().slice(0, 40) };
  }

  // ---- Multiverses: step 1 groups every title into a multiverse, step 2 searches each multiverse for the rest ----
  // A multiverse is the widest shared universe (Whoniverse, MCU, Star Wars); "franchise" is the series inside it.
  const jsonGet = (db, k, d) => { try { return JSON.parse(db.get(k, "")) || d; } catch (e) { return d; } };
  const mvMap = db => jsonGet(db, "mv_map", {});      // seed key -> [multiverse|null, franchise]
  const mvAlias = db => jsonGet(db, "mv_alias", {});  // franchise name -> multiverse
  const mvDone = db => jsonGet(db, "mv_done", {});    // multiverse -> last searched (ms)

  function mvGroupPrompt(lines, names, franchises) {
    return `Task: for each numbered title give its MULTIVERSE (the widest shared fictional universe: spin-offs, prequels, crossovers and connected films, series, specials and games count as one) and its franchise inside it.
Examples: Torchwood → Whoniverse / Torchwood; Loki → Marvel Cinematic Universe / Loki; The Flash (2014) → Arrowverse / The Flash.
${names.length ? `Use these multiverse names exactly when they fit: ${names.join("; ")}\n` : ""}${franchises.length ? `Also map each of these franchise names to its multiverse: ${franchises.join("; ")}\n` : ""}${LINES_OUT}
One line per number, every number once:
n | multiverse | franchise
Write "n | -" for a standalone title with no franchise.${franchises.length ? `
For the franchise mapping, one line each:
= franchise | multiverse` : ""}

TITLES (n. Title (Year) [type]; ${TYPES_LEGEND}):
${lines.join("\n")}`;
  }
  // both the line format and the older JSON
  function parseMvGroup(text) {
    if (looksJson(text)) return parseObject(text);
    const titles = [], aliases = [];
    for (let line of String(text || "").split(/\r?\n/)) {
      line = line.replace(/`/g, "").trim();
      let m = line.match(/^=\s*(.+?)\s*\|\s*(.+)$/);
      if (m) { aliases.push({ franchise: m[1], multiverse: m[2] }); continue; }
      m = line.match(/^(\d+)\s*[.|)]\s*(.*)$/);
      if (!m) continue;
      const f = m[2].split("|").map(x => x.trim());
      const mv = f[0] && f[0] !== "-" && !/^(none|null|standalone)$/i.test(f[0]) ? f[0] : null;
      titles.push({ n: +m[1], multiverse: mv, franchise: mv ? (f[1] && f[1] !== "-" ? f[1] : mv) : null });
    }
    return { titles, aliases };
  }

  function parseObject(text) {
    const t = String(text || "").trim();
    const tries = [];
    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (m) tries.push(m[1]);
    tries.push(t);
    for (const s of tries) {
      try { return JSON.parse(s.trim()); } catch (e) { /* braces */ }
      const a = s.indexOf("{"), z = s.lastIndexOf("}");
      if (a >= 0 && z > a) { try { return JSON.parse(s.slice(a, z + 1)); } catch (e) { /* next */ } }
    }
    const arr = parseJsonArray(t);
    return { titles: arr };
  }

  function mvPending(db) {
    const map = mvMap(db);
    const pool = seeds(db).filter(i => MEDIA.includes(i.medium) && i.title);
    return { pool, pending: pool.filter(i => !(i.key in map)), map };
  }

  // provider: { label, call(prompt, {step, steps, title}) -> text, prepare?() }
  async function mvGroup(db, provider, progress, batchSize = 150, maxBatches = 20) {
    const { pool, pending } = mvPending(db);
    if (!pool.length) throw new Error("No titles yet. Sync or import your IMDb/Trakt data first.");
    if (!pending.length) { progress(1, "Every title is already grouped into a multiverse"); return 0; }
    if (provider.prepare) { progress(0, `${provider.label}: getting ready`); await provider.prepare(); }
    const batches = [];
    for (let i = 0; i < pending.length && batches.length < maxBatches; i += batchSize) batches.push(pending.slice(i, i + batchSize));
    let grouped = 0;
    for (let b = 0; b < batches.length; b++) {
      if (CONFIG.cancelled) { CONFIG.cancelled = false; break; }
      const map = mvMap(db), alias = mvAlias(db);
      const names = [...new Set(Object.values(map).map(v => v && v[0]).filter(Boolean).concat(Object.values(alias)))].sort().slice(0, 300);
      const known = new Set(Object.keys(alias).concat(names));
      const listFr = [...new Set(db.canon().map(c => franchiseName(c.franchise)))].filter(f => f !== "Unsorted" && !known.has(f)).slice(0, 120);
      const rows = batches[b];
      progress(b / batches.length, `${provider.label}: grouping titles ${b * batchSize + 1}–${b * batchSize + rows.length} of ${pending.length}`);
      let text;
      try {
        const tl = rows.map((i, k) => `${k + 1}. ${promptLine(i.title, i.year, i.medium)}`);
        text = await provider.call(mvGroupPrompt(tl, relevantNames(names, tl, 80), b === 0 ? listFr : []),
                                   { step: b + 1, steps: batches.length, title: "Group into multiverses" });
      } catch (e) {
        if (e.cancelled) break;
        if (e.stopRun && b > 0) { progress(1, `${e.message} (${grouped} titles grouped before stopping)`); return grouped; }
        throw e;
      }
      const res = parseMvGroup(text);
      for (const d of (res.titles || [])) {
        const it = rows[parseInt(d.n, 10) - 1];
        if (!it) continue;
        const mv = d.multiverse ? String(d.multiverse).trim() : null, fr = d.franchise ? String(d.franchise).trim() : null;
        map[it.key] = [mv, fr];
        if (mv && fr && fr !== mv) alias[fr] = mv;
        grouped++;
      }
      for (const a of (res.aliases || [])) if (a && a.franchise && a.multiverse) alias[String(a.franchise).trim()] = String(a.multiverse).trim();
      // titles Gemini skipped are left for the next run
      db.set("mv_map", JSON.stringify(map));
      db.set("mv_alias", JSON.stringify(alias));
      if (provider.gap && b < batches.length - 1) await sleep(provider.gap);
    }
    const left = mvPending(db).pending.length;
    progress(1, left ? `Grouped ${grouped} titles; ${left} still to group, run again to continue` : `Every title is grouped into a multiverse`);
    return grouped;
  }

  // Multiverses with the titles known in each (your titles plus canon already found), most titles first.
  function multiverses(db) {
    const map = mvMap(db), alias = mvAlias(db), done = mvDone(db);
    const by = new Map();
    const add = (mv, line, k) => {
      if (!mv) return;
      if (!by.has(mv)) by.set(mv, { name: mv, lines: new Map(), seeds: 0, last: done[mv] || 0 });
      const g = by.get(mv);
      if (!g.lines.has(k)) g.lines.set(k, line);
      return g;
    };
    for (const i of seeds(db)) {
      const v = map[i.key];
      if (!v || !v[0]) continue;
      const g = add(v[0], promptLine(i.title, i.year, i.medium, v[1] && v[1] !== v[0] ? v[1] : ""), i.norm + "|" + (i.year || ""));
      if (g) g.seeds++;
    }
    for (const c of db.canon()) {
      const fr = franchiseName(c.franchise), mv = alias[fr] || (by.has(fr) ? fr : null);
      if (mv) add(mv, promptLine(c.title, c.year, c.medium, fr !== mv ? fr : ""), c.norm + "|" + (c.year || ""));
    }
    return [...by.values()].filter(g => g.seeds > 0).sort((a, b) => b.seeds - a.seeds || a.name.localeCompare(b.name));
  }

  function mvExpandPrompt(groups, today) {
    return `Today is ${today}. Below are multiverses with the entries I already know, as "Title (Year) [type] {franchise inside it}".
Task: for EACH multiverse list every official canon entry MISSING from my list, across all its franchises and spin-offs. Use Google Search for anything recent.
${CANON_RULES}
Do not repeat entries I listed. ${LINES_OUT}
# exact multiverse heading
Title | type | year | date | franchise inside it
${TYPES_LEGEND} Write a heading with nothing under it when nothing is missing.

${groups.map(g => `## ${g.name}\n` + [...g.lines.values()].slice(0, 400).join("\n")).join("\n\n")}`;
  }

  async function mvExpand(db, provider, progress, opts = {}) {
    const maxLines = opts.maxLines || 220, maxBatches = opts.maxBatches || 30, staleMs = (opts.staleDays || 30) * 864e5, now = Date.now();
    const all = multiverses(db);
    if (!all.length) throw new Error("Group your titles into multiverses first (step 1).");
    const todo = all.filter(g => opts.only ? opts.only.includes(g.name) : now - g.last > staleMs);
    if (!todo.length) { progress(1, "Every multiverse was searched in the last 30 days"); return 0; }
    const batches = [];
    let cur = [], n = 0;
    for (const g of todo) {
      if (cur.length && (n + g.lines.size > maxLines || cur.length >= 6)) { batches.push(cur); cur = []; n = 0; }
      cur.push(g); n += g.lines.size;
    }
    if (cur.length) batches.push(cur);
    batches.length = Math.min(batches.length, maxBatches);
    if (provider.prepare) { progress(0, `${provider.label}: getting ready`); await provider.prepare(); }
    let added = 0;
    for (let b = 0; b < batches.length; b++) {
      if (CONFIG.cancelled) { CONFIG.cancelled = false; break; }
      const groups = batches[b];
      progress(b / batches.length, `${provider.label}: searching ${groups.map(g => g.name).join(", ")} (${b + 1}/${batches.length})`);
      let text;
      try {
        text = await provider.call(mvExpandPrompt(groups, new Date(now).toISOString().slice(0, 10)),
                                   { step: b + 1, steps: batches.length, title: "Find entries per multiverse", note: groups.map(g => g.name).join(", ") });
      } catch (e) {
        if (e.cancelled) break;
        if (e.stopRun && b > 0) { progress(1, `${e.message} (${added} entries added before stopping)`); return added; }
        throw e;
      }
      const names = new Map(groups.map(g => [norm(g.name), g.name]));
      const rows = [], seen = new Set();
      const answers = looksJson(text) ? parseJsonArray(text) : parseLines(text).map(r => ({ multiverse: r.group, franchise: r.extra, title: r.title, year: r.year, release_date: r.date, medium: r.medium }));
      for (const d of answers) {
        const title = String(d.title || "").trim();
        if (!title) continue;
        const mv = names.get(norm(d.multiverse || "")) || (!d.multiverse && groups.length === 1 ? groups[0].name : null);
        if (!mv) continue;
        const k = `${norm(mv)}|${norm(title)}|${d.year || ""}`;
        if (seen.has(k)) continue;
        seen.add(k);
        rows.push({ franchise: mv, sub: d.franchise && norm(d.franchise) !== norm(mv) ? String(d.franchise).trim() : null, title, year: d.year,
                    date: d.release_date || null, medium: mediumFromText(String(d.medium || "")) });
      }
      added += db.mergeCanon("gemini", rows);
      const done = mvDone(db);
      for (const g of groups) done[g.name] = Date.now();
      db.set("mv_done", JSON.stringify(done));
      if (provider.gap && b < batches.length - 1) await sleep(provider.gap);
    }
    const left = multiverses(db).filter(g => Date.now() - g.last > staleMs).length;
    progress(1, `${added} entries added${left ? `; ${left} multiverses still to search, run again to continue` : ""}`);
    return added;
  }

  // The Gemini API as a provider for the multiverse steps (same model handling as the scan).
  function geminiProvider(db, http, key, model, opts = {}) {
    key = String(key || "").trim();
    if (!key) throw new Error("Enter a Gemini API key in Settings first.");
    const gs = { tried: new Set(), search: !!opts.search, onSwitch: m => { db.set("gemini_model_used", m); if (db.get("gemini_model", "auto") !== "auto") db.set("gemini_model", "auto"); } };
    return {
      label: "Gemini", gap: CONFIG.aiGapMs,
      prepare: async () => { gs.candidates = await geminiCandidates(http, key, model); gs.model = gs.candidates[0]; db.set("gemini_model_used", gs.model); },
      call: prompt => geminiCallWithFallback(http, key, gs, prompt),
    };
  }

  // ---- Streaming worldwide: which services carry a title in which countries (for watching with a VPN) ----
  const FLAGS = cc => String(cc || "").toUpperCase().replace(/[A-Z]/g, ch => String.fromCodePoint(0x1F1E6 + ch.charCodeAt(0) - 65));
  const svcKey = n => String(n || "").toLowerCase().replace(/\s+with ads$|\s+standard with ads$/i, "").replace(/amazon prime video|prime video/, "prime video").replace(/disney plus/, "disney+").replace(/[^a-z0-9+]/g, "");
  const STREAM_TYPES = ["flatrate", "free", "ads"];

  // From TMDB's watch/providers (every country) plus JustWatch picture quality for the VPN countries.
  // Stored compactly per service, since it's cached for every title: { key: { n: name, f: 1 if free/ads, c: { CC: "4K" | "" } } }.
  function worldFrom(results, jwByCountry) {
    const world = {};
    const add = (cc, name, type, res) => {
      if (!STREAM_TYPES.includes(type)) return;
      const k = svcKey(name);
      const s = world[k] || (world[k] = { n: name, c: {} });
      if (type !== "flatrate") s.f = 1;
      const cur = s.c[cc];
      if (cur === undefined || (RES_ORDER[res] || 0) > (RES_ORDER[cur] || 0)) s.c[cc] = res || "";
    };
    for (const [cc, prov] of Object.entries(results || {})) for (const type of STREAM_TYPES) for (const p of prov[type] || []) add(cc, p.provider_name, type, null);
    for (const [cc, offers] of Object.entries(jwByCountry || {})) for (const o of offers) add(cc, o.name, o.type, o.res);
    return world;
  }
  const worldCountries = world => { const s = new Set(); for (const v of Object.values(world || {})) if (v && v.c) for (const cc of Object.keys(v.c)) s.add(cc); return s; };

  // Services abroad, preferred ones first: [{name, key, pref, free, here, countries:[{cc, res, flag}]}].
  function vpnOptions(info, prefs) {
    if (!info || !info.world) return [];
    const mine = (prefs || []).map(svcKey).filter(Boolean);
    const here = new Set((info.offers || []).filter(o => STREAM_TYPES.includes(o.type)).map(o => svcKey(o.name)));
    const out = [];
    for (const [k, v] of Object.entries(info.world)) {
      if (!v || !v.c) continue; // saved by 3.2 in the older layout; refreshed next time the details open
      const countries = Object.keys(v.c).filter(cc => cc !== info.region).map(cc => ({ cc, res: v.c[cc] || null, flag: FLAGS(cc) }));
      if (!countries.length) continue;
      countries.sort((a, b) => (RES_ORDER[b.res] || 0) - (RES_ORDER[a.res] || 0) || a.cc.localeCompare(b.cc));
      out.push({ name: v.n, key: k, countries, free: !!v.f, here: here.has(k) || v.c[info.region] !== undefined,
                 pref: mine.indexOf(k) >= 0 ? mine.indexOf(k) : (prefRank(v.n) < 9 ? 10 + prefRank(v.n) : 99), best: countries[0].res });
    }
    out.sort((a, b) => a.pref - b.pref || (b.free - a.free) || b.countries.length - a.countries.length || a.name.localeCompare(b.name));
    return out;
  }

  // When it doesn't stream in your country: the best service elsewhere (one you have, else a free one), e.g. "Netflix 🇺🇸 4K".
  function bestVpn(info, prefs) {
    if (!info || !info.world || bestOffer(info)) return null;
    const v = vpnOptions(info, prefs).filter(s => !s.here);
    const pick = v.find(s => s.pref < 10) || v.find(s => s.free) || v.find(s => s.pref < 99) || v[0];
    return pick ? { name: pick.name, cc: pick.countries[0].cc, flag: pick.countries[0].flag, res: pick.best, n: pick.countries.length } : null;
  }

  // ---- Gemini app (copy and paste) ----
  // ask(prompt, {step, steps, title}) hands the prompt to the person and resolves with what they paste back.
  const MANUAL_NOTE = "\nUse Google Search to check anything announced recently. Answer with the plain lines only.\n";

  async function manualScan(db, ask, progress, batchSize = 60, maxBatches = 40) {
    let step = 0, total = 0;
    const provider = {
      origin: "gemini", label: "Gemini app", model: "your Gemini app", extra: MANUAL_NOTE,
      prepare: async () => { total = Math.min(maxBatches, Math.ceil(aiState(db, "gemini").pending.length / batchSize)); },
      call: prompt => ask(prompt, { step: ++step, steps: total, title: "Find missing canon" }),
    };
    return canonScan(db, provider, progress, batchSize, maxBatches);
  }

  // Entries grouped by franchise, in batches small enough for one chat answer.
  function franchiseBatches(entries, maxRows = 90) {
    const by = new Map();
    for (const c of entries) { if (!by.has(c.franchise)) by.set(c.franchise, []); by.get(c.franchise).push(c); }
    const out = [];
    let cur = [];
    for (const [, rows] of [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (cur.length && cur.length + rows.length > maxRows) { out.push(cur); cur = []; }
      cur = cur.concat(rows);
    }
    if (cur.length) out.push(cur);
    return out;
  }

  function verifyPrompt(rows) {
    const lines = rows.map((c, i) => `${i + 1}. ${c.franchise} | ${c.title} | ${c.year || "?"} | ${typeCode(c.medium)} | ${c.date || "-"}`);
    return `Task: check this canon checklist. Each line: n. Franchise | Title | Year | type | release date. Use Google Search when unsure.
${LINES_OUT}
Write ONLY the lines that need a change:
n | code | correct date | same as | reason (max 6 words)
Codes: X not canon (compilation, recap, re-edit, documentary, fan work, non-canon), D duplicate of line "same as", N cannot confirm it exists or was announced, K canon but year or date is wrong.
Date: the correct original release date YYYY-MM-DD, or "-". Lines you don't write count as correct.
Finish with a last line: END

LINES (${TYPES_LEGEND}):
${lines.join("\n")}`;
  }

  // Turns a verify answer into suggestions: [{c, verdict, date, why, same}]. Lines the answer leaves out are correct,
  // but only when the answer reached its END (a cut-off answer marks just what it mentions).
  function parseVerify(text, rows) {
    const out = [];
    if (looksJson(text)) {
      for (const d of parseJsonArray(text)) {
        const c = rows[parseInt(d.n, 10) - 1];
        if (!c) continue;
        out.push({ c, verdict: String(d.verdict || "ok").toLowerCase().replace(/[^a-z_]/g, ""), date: parseDate(d.release_date) || null,
                   why: String(d.why || "").slice(0, 160), same: parseInt(d.same_as, 10) || null });
      }
      return out;
    }
    const CODES = { X: "not_canon", D: "duplicate", N: "not_real", K: "ok" };
    const seen = new Set();
    for (let line of String(text || "").split(/\r?\n/)) {
      line = line.replace(/`/g, "").trim();
      const m = line.match(/^(\d+)\s*[.|)]\s*(.*)$/);
      if (!m) continue;
      const c = rows[+m[1] - 1];
      if (!c || seen.has(c)) continue;
      const f = m[2].split("|").map(x => x.trim());
      const code = String(f[0] || "").toUpperCase().slice(0, 1);
      seen.add(c);
      out.push({ c, verdict: CODES[code] || "ok", date: /^\d{4}-\d\d(-\d\d)?$/.test(f[1] || "") ? parseDate(f[1]) : null,
                 same: parseInt(f[2], 10) || null, why: String(f[3] || "").slice(0, 160) });
    }
    if (/^\s*(END|OK)\s*$/im.test(text)) for (const c of rows) if (!seen.has(c)) out.push({ c, verdict: "ok", date: null, why: "", same: null });
    return out;
  }

  // Franchises you've started, with every entry already known, so Gemini only answers with what's new.
  function newsBatches(status, maxEntries = 400) {
    const by = new Map();
    for (const c of status) { if (!by.has(c.franchise)) by.set(c.franchise, []); by.get(c.franchise).push(c); }
    const started = [...by.entries()].filter(([, rows]) => rows.some(c => c.have)).sort((a, b) => a[0].localeCompare(b[0]));
    const out = [];
    let cur = [], n = 0;
    for (const [fr, rows] of started) {
      if (cur.length && n + rows.length > maxEntries) { out.push(cur); cur = []; n = 0; }
      cur.push([fr, rows]); n += rows.length;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  function newsPrompt(batch, today) {
    const blocks = batch.map(([fr, rows]) => `## ${fr}\n` + rows.map(c => promptLine(c.title, c.year, c.medium)).join("\n"));
    return `Today is ${today}. For each franchise below I list the entries I already know.
Task: find entries of the SAME franchises missing from my lists: newly released or officially announced works, plus older canon I missed. Use Google Search for recent announcements.
${CANON_RULES}
Do not repeat titles I listed. ${LINES_OUT}
# exact franchise heading
Title | type | year | date
${TYPES_LEGEND} Write only NONE if there is nothing new.

${blocks.join("\n\n")}`;
  }

  function parseCanonRows(text) {
    const rows = [], seen = new Set();
    if (!looksJson(text)) {
      if (/^\s*NONE\s*$/im.test(text) && !/\|/.test(text)) return rows;
      for (const r of parseLines(text)) {
        const fr = String(r.group || "Unsorted").trim(), k = `${norm(fr)}|${norm(r.title)}|${r.year || ""}`;
        if (!r.title || seen.has(k)) continue;
        seen.add(k);
        rows.push({ franchise: fr, title: r.title, year: r.year, date: r.date, medium: r.medium });
      }
      return rows;
    }
    for (const d of parseJsonArray(text)) {
      const title = String(d.title || "").trim(), fr = String(d.franchise || "Unsorted").trim();
      if (!title) continue;
      const k = `${norm(fr)}|${norm(title)}|${d.year || ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rows.push({ franchise: fr, title, year: d.year, date: d.release_date || null, medium: mediumFromText(String(d.medium || "")) });
    }
    return rows;
  }

  // ---- Claude ----
  const CLAUDE = "https://api.anthropic.com/v1";
  const CLAUDE_DEFAULT = "claude-sonnet-5-5";

  function claudeError(r) {
    if (r.status === 0) return Object.assign(new Error(`Claude: network error (${r.error || "no connection"})`), { status: 0 });
    let type = "", msg = "";
    try { const e = JSON.parse(r.body).error; type = e.type || ""; msg = e.message || ""; } catch (x) { msg = String(r.body || "").slice(0, 200); }
    const hint = r.status === 401 ? " Check the Claude API key in Settings." :
      r.status === 400 && /credit|billing/i.test(msg) ? " Add credit in the Claude Console (Plans & Billing)." : "";
    const sep = hint && !/[.!?]$/.test(msg.trim()) ? "." : "";
    return Object.assign(new Error(`Claude error ${r.status}${type ? " " + type : ""}: ${msg.trim()}${sep}${hint}`), { status: r.status, type });
  }

  // Higher is better: Sonnet first (best quality for the price), then Haiku, then Opus; newer versions first.
  function rankClaudeModel(id) {
    const m = String(id).match(/^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/);
    if (!m) return -1;
    const v = parseInt(m[2], 10) + (m[3] && m[3].length <= 2 ? parseInt(m[3], 10) / 10 : 0);
    return v * 10 + ({ sonnet: 3, haiku: 2, opus: 1 })[m[1]] - (/\d{8}$/.test(id) ? 0.5 : 0);
  }

  async function claudeModels(http, key) {
    const r = await http("GET", `${CLAUDE}/models?limit=100`, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
    if (r.status !== 200) throw claudeError(r);
    return (JSON.parse(r.body).data || []).map(m => m.id).filter(id => rankClaudeModel(id) >= 0)
      .sort((a, b) => rankClaudeModel(b) - rankClaudeModel(a));
  }

  // One Messages API call; with web search on, keeps resuming while the API pauses a long search turn.
  async function claudeCall(http, key, model, prompt, webSearch, maxTokens = 16000) {
    const headers = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
    const messages = [{ role: "user", content: prompt }];
    const body = { model, max_tokens: maxTokens, messages };
    if (webSearch) body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
    let searches = 0;
    for (let turn = 0, attempt = 0; turn < 6;) {
      const r = await http("POST", `${CLAUDE}/messages`, { headers, body: JSON.stringify(body) });
      if (r.status === 429 || r.status === 529 || r.status >= 500) {
        if (++attempt > 4) throw claudeError(r);
        await sleep(CONFIG.retryDelayMs * attempt * 2);
        continue;
      }
      if (r.status !== 200) throw claudeError(r);
      const res = JSON.parse(r.body);
      const blocks = res.content || [];
      searches += blocks.filter(b => b.type === "server_tool_use").length;
      if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: blocks }); turn++; continue; }
      // the answer is the text after the last search result
      let lastResult = -1;
      blocks.forEach((b, i) => { if (b.type === "web_search_tool_result") lastResult = i; });
      const text = blocks.slice(lastResult + 1).filter(b => b.type === "text").map(b => b.text).join("");
      if (!text.trim()) throw new Error(`Claude returned no answer (${res.stop_reason || "empty"}).`);
      return { text, searches, truncated: res.stop_reason === "max_tokens" };
    }
    throw new Error("Claude: the search took too many steps. Try again.");
  }

  // ---- other AI services: anything that speaks the OpenAI chat format (ChatGPT, Mistral, Groq, OpenRouter, DeepSeek, or your own)
  const AI_PRESETS = {
    openai: { label: "ChatGPT (OpenAI)", base: "https://api.openai.com/v1", model: "gpt-4.1-mini", keys: "platform.openai.com › API keys (paid)" },
    mistral: { label: "Mistral", base: "https://api.mistral.ai/v1", model: "mistral-small-latest", keys: "console.mistral.ai › API keys (free tier)" },
    groq: { label: "Groq", base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keys: "console.groq.com › API keys (free tier)" },
    openrouter: { label: "OpenRouter", base: "https://openrouter.ai/api/v1", model: "openrouter/auto", keys: "openrouter.ai › Keys. The default lets OpenRouter pick, which can be a paid model: type a model ending in :free to stay free" },
    deepseek: { label: "DeepSeek", base: "https://api.deepseek.com/v1", model: "deepseek-chat", keys: "platform.deepseek.com › API keys (paid, cheap)" },
    // your own server (on your network or through Tailscale): no key for Ollama, an API key from Open WebUI
    ollama: { label: "Ollama (your own server)", base: "", model: "", keys: "", local: true, noKey: true, api: "ollama", hintBase: "http://your-pi.your-tailnet.ts.net:11434" },
    openwebui: { label: "Open WebUI (your own server)", base: "", model: "", keys: "Open WebUI › Settings › Account › API keys", local: true, api: "openwebui", hintBase: "https://your-pi.your-tailnet.ts.net" },
    custom: { label: "Other (OpenAI-compatible)", base: "", model: "", keys: "the service's own site" },
  };
  // the address as typed (with or without a trailing /v1 or /api), reduced to the server's own address
  const serverBase = b => String(b || "").trim().replace(/\/+$/, "").replace(/\/(v1|api|ollama)$/i, "");
  // which models the server has; also the connection test in Settings
  async function localModels(http, cfg) {
    const p = AI_PRESETS[cfg.preset] || {}, base = serverBase(cfg.base), key = String(cfg.key || "").trim();
    if (!base) throw new Error("Type your server's address first");
    const url = p.api === "ollama" ? `${base}/api/tags` : `${base}/api/models`;
    const r = await http("GET", url, { timeout: 20000, headers: key ? { Authorization: `Bearer ${key}` } : {} });
    if (r.status === 0) throw new Error(localNetHint(r.error, base));
    if (r.status === 401 || r.status === 403) throw new Error(p.api === "openwebui" ? "Open WebUI refused the API key (create one in Open WebUI › Settings › Account › API keys)" : "the server refused the request");
    if (r.status !== 200) throw new Error(`the server answered HTTP ${r.status} at ${url}`);
    const j = JSON.parse(r.body || "{}");
    const list = p.api === "ollama" ? (j.models || []).map(m => m.name || m.model) : (j.data || j.models || []).map(m => m.id || m.name);
    return list.filter(Boolean);
  }
  function localNetHint(err, base) {
    const e = String(err || "");
    if (/cleartext|not permitted/i.test(e)) return `plain http:// is only allowed to Tailscale names (….ts.net) and this phone. Use your server's MagicDNS name, e.g. http://pi.your-tailnet.ts.net:11434, or turn on HTTPS with "tailscale serve" and use https://`;
    return `can't reach ${base} (${e || "no connection"}). Is Tailscale on, on this phone and on the server? Is the server running?`;
  }
  function compatProvider(db, http, cfg) {
    const p = AI_PRESETS[cfg.preset] || AI_PRESETS.openai;
    const base = String(cfg.base || p.base || "").replace(/\/+$/, ""), key = String(cfg.key || "").trim(), model = String(cfg.model || p.model || "").trim();
    if (p.local) return localProvider(db, http, p, serverBase(base), key, model);
    if (!key) throw new Error(`Enter an API key for ${p.label} in Settings first.`);
    if (!base || !model) throw new Error("Enter the service's address and model in Settings first.");
    return {
      origin: "ai", label: p.label, model,
      prepare: async () => { db.set("ai_model_used", `${p.label} · ${model}`); },
      call: async prompt => {
        const r = await http("POST", `${base}/chat/completions`, { timeout: 180000, headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "HTTP-Referer": "https://saga.app", "X-Title": "Saga" },
          body: JSON.stringify({ model, temperature: 0.2, max_tokens: 8000, messages: [{ role: "system", content: "You are a precise transmedia canon expert. Follow the output format exactly." }, { role: "user", content: prompt }] }) });
        if (r.status === 0) throw new Error(`${p.label}: network error (${r.error || "no connection"})`);
        let j = null; try { j = JSON.parse(r.body || "{}"); } catch (e) { /* not JSON */ }
        if (r.status === 401 || r.status === 403) throw new Error(`${p.label} refused the API key`);
        if (r.status === 429) throw new Error(`${p.label}: rate limit or quota reached, try again later`);
        if (r.status === 404) throw new Error(`${p.label}: model “${model}” not found. Check the model name in Settings`);
        if (r.status !== 200) throw new Error(`${p.label}: HTTP ${r.status}${j && j.error ? ` (${String(j.error.message || j.error).slice(0, 160)})` : ""}`);
        const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!text) throw new Error(`${p.label} sent an empty answer`);
        return text;
      },
    };
  }
  // A model on your own server: Ollama's own chat API (so the context window can be set: its default is too small for
  // the canon prompts and would cut them off silently), or Open WebUI's OpenAI-style one. Local models are slower,
  // so each call may take up to 10 minutes and batches are smaller.
  function localProvider(db, http, p, base, key, model) {
    if (!base) throw new Error(`Type your ${p.label.replace(/ \(.*/, "")} server's address in Settings › AI first.`);
    if (!model) throw new Error(`Pick a model in Settings › AI (Find models lists what ${p.label.replace(/ \(.*/, "")} has).`);
    if (p.api === "openwebui" && !key) throw new Error("Open WebUI needs an API key: Open WebUI › Settings › Account › API keys.");
    const SYS = "You are a precise transmedia canon expert. Follow the output format exactly.";
    return {
      origin: "ai", label: p.label.replace(/ \(.*/, ""), model, local: true,
      prepare: async () => { db.set("ai_model_used", `${p.label.replace(/ \(.*/, "")} · ${model}`); },
      call: async prompt => {
        const ollama = p.api === "ollama";
        const url = ollama ? `${base}/api/chat` : `${base}/api/chat/completions`;
        const body = ollama
          ? { model, stream: false, options: { temperature: 0.2, num_ctx: 16384, num_predict: 6000 }, messages: [{ role: "system", content: SYS }, { role: "user", content: prompt }] }
          : { model, stream: false, temperature: 0.2, max_tokens: 6000, messages: [{ role: "system", content: SYS }, { role: "user", content: prompt }] };
        const h = { "Content-Type": "application/json" };
        if (key) h.Authorization = `Bearer ${key}`;
        const r = await http("POST", url, { timeout: 600000, headers: h, body: JSON.stringify(body) });
        if (r.status === 0) throw new Error(`${p.label}: ${localNetHint(r.error, base)}`);
        let j = null; try { j = JSON.parse(r.body || "{}"); } catch (e) { /* not JSON */ }
        if (r.status === 401 || r.status === 403) throw new Error(`${p.label} refused the API key`);
        if (r.status === 404) throw new Error(`${p.label}: model “${model}” not found${ollama ? ` (pull it first: ollama pull ${model})` : ""}`);
        if (r.status !== 200) throw new Error(`${p.label}: HTTP ${r.status}${j && j.error ? ` (${String(j.error.message || j.error).slice(0, 160)})` : ""}`);
        const text = ollama ? j && j.message && j.message.content : j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (!text) throw new Error(`${p.label} sent an empty answer`);
        return String(text).replace(/<think>[\s\S]*?<\/think>/g, "").trim(); // reasoning models: keep only the answer
      },
    };
  }
  async function compatScan(db, http, cfg, progress, only) {
    const pr = compatProvider(db, http, cfg);
    return canonScan(db, pr, progress, pr.local ? 15 : 40, pr.local ? 40 : 25, only);
  }
  async function claudeScan(db, http, key, model, progress, opts = {}) {
    key = String(key || "").trim();
    if (!key) throw new Error("Enter a Claude API key in Settings first.");
    const webSearch = !!opts.webSearch;
    const st = { model: null, candidates: [] };
    let searches = 0;
    const provider = {
      origin: "claude", label: "Claude",
      extra: webSearch ? "\nUse web search sparingly, only for entries announced recently. Your final answer must still be only the plain lines.\n" : "",
      prepare: async () => {
        const wanted = String(model || "").trim();
        st.model = wanted && wanted !== "auto" ? wanted : CLAUDE_DEFAULT;
        try { st.candidates = await claudeModels(http, key); } catch (e) { if (e.status === 401 || e.status === 403) throw e; st.candidates = []; }
        if (st.candidates.length && !st.candidates.includes(st.model)) st.model = st.candidates[0];
        db.set("claude_model_used", st.model);
      },
      get model() { return st.model; },
      call: async prompt => {
        const tried = new Set();
        for (;;) {
          try {
            const r = await claudeCall(http, key, st.model, prompt, webSearch);
            searches += r.searches;
            db.set("claude_searches", String((parseInt(db.get("claude_searches", "0"), 10) || 0) + r.searches));
            return r.text;
          } catch (e) {
            if (e.type !== "not_found_error") throw e;
            tried.add(st.model);
            const next = st.candidates.find(m => !tried.has(m)) || (!tried.has(CLAUDE_DEFAULT) ? CLAUDE_DEFAULT : null);
            if (!next) throw e;
            st.model = next;
            db.set("claude_model_used", next);
          }
        }
      },
    };
    const added = await canonScan(db, provider, progress, opts.batchSize || 80, opts.maxBatches || 10, opts.only);
    if (searches) progress(1, `Claude added ${added} entries using ${searches} web searches`);
    return added;
  }

  // ---- sync everything ----
  const lines = s => String(s || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);

  async function traktListItems(db, http, url) {
    const m = String(url).match(/trakt\.tv\/users\/([^/]+)\/lists\/([^/?#]+)/);
    if (!m) throw new Error(`Unsupported Trakt list URL: ${url}`);
    const t = new Trakt(http, db.get("client_id"), db.get("token") || null);
    return traktEntries(await t.get(`/users/${m[1]}/lists/${m[2]}/items`, { extended: "full" }));
  }

  function describe(items) {
    const g = items.filter(i => i.medium === "Video Game").length, sr = items.filter(i => i.medium === "TV Series").length;
    const parts = [];
    if (g) parts.push(`${g} game${g === 1 ? "" : "s"}`);
    if (sr) parts.push(`${sr} series`);
    return `${items.length} titles${parts.length ? ` (${parts.join(", ")})` : ""}`;
  }

  // only: optional set of task labels to run (Retry failed).
  // Trakt and IMDb run side by side (each source in order within its lane, IMDb spaced out); every task has a deadline,
  // so one slow source never holds the rest. A route that only got the first page of a list is reported as PART, not OK,
  // and keeps whatever was there before. Release dates, posters and episode lookups are not part of this: see details().
  // 0.6.5: sources that keep failing: two syncs in a row or more. { label, streak, okAt (0 = never), msg, days }
  function sourceHealth(db, now = Date.now()) {
    let st = {}; try { st = JSON.parse(db.get("sync_state", "{}")); } catch (e) { /* none */ }
    return Object.entries(st).filter(([, v]) => v && !v.ok && (v.streak || 1) >= 2)
      .map(([label, v]) => ({ label, streak: v.streak || 2, okAt: v.okAt || 0, msg: v.msg || "", days: v.okAt ? Math.floor((now - v.okAt) / 864e5) : null }))
      .sort((a, b) => b.streak - a.streak);
  }
  async function syncAll(db, http, progress, only = null, opt = {}) {
    gqlBlocked = false;
    const tplStore = { get: k => db.get(k, ""), set: (k, v) => db.set(k, v) };
    const log = [];
    const L = m => { log.push(`${new Date().toISOString().slice(11, 19)} ${m}`); if (log.length > 400) log.shift(); };
    http = robust(http, { timeout: 45000, tries: 3, log: L });
    const lanes = { trakt: [], imdb: [] };
    const add = (lane, label, fn, limitMs) => lanes[lane].push([label, fn, limitMs || 240000]);
    const user = db.get("username"), cid = db.get("client_id");
    if (user && cid) {
      add("trakt", "Trakt account", async () => {
        const n = await traktSync(db, http, cid, user, db.get("token") || null, (f, t) => L(t), { full: !!opt.fullTrakt });
        let names = [];
        try { names = JSON.parse(db.get("trakt_lists", "[]")); } catch (e) { /* ignore */ }
        const sk = traktSync.skipped || [];
        return `${n} records, ${names.length} list${names.length === 1 ? "" : "s"}${names.length ? ` (${names.join(", ")})` : ""}${sk.length ? `; unchanged since the last sync, not downloaded again: ${sk.join(", ")}` : ""}`;
      }, 300000);
    }
    const partial = route => /first (page|batch) only/.test(route);
    const imdbRes = (items, route) => {
      const got = items.filter(x => x.medium !== "TV Episode" || x.rating).length;
      const short = items.total && items.length < items.total * 0.98;
      // the ratings page lists the newest first: once the full history is in from a CSV import, the newest batch is all a sync needs
      const stored = items.isRatings ? db.items("imdb", ["rated"]).length : 0;
      if (short && stored >= items.total * 0.97) return { msg: `${describe(items)} newest checked via in-app browser; your full history (${stored} of ${items.total}) is already stored from the CSV import`, part: false, got };
      return { msg: `${describe(items)} via ${route}${short ? ` (${items.length} of ${items.total} came through${items.isRatings ? "; import your IMDb ratings CSV once for the full history, after that a sync only needs the newest" : ""})` : ""}`, part: partial(route) || !!short, got };
    };
    // Episodes you rated on IMDb: kept by series, so the library can tick them (IMDb has no other episode progress).
    const keepEps = items => {
      let m = {};
      try { m = JSON.parse(db.get("imdb_eps", "{}")) || {}; } catch (e) { m = {}; }
      const names = {};
      for (const it of items) names[it.imdb] = it;
      let n = 0;
      for (const it of items) {
        if (!it.ep) continue;
        const [sid, sn, en, when] = it.ep;
        const e = m[sid] = m[sid] || { t: (names[sid] || {}).title || "", y: (names[sid] || {}).year || null, eps: {} };
        if (!e.t && names[sid]) e.t = names[sid].title;
        if (!e.eps[`${sn}:${en}`]) { e.eps[`${sn}:${en}`] = /^\d{4}-\d\d-\d\d$/.test(when || "") ? when : 1; n++; }
        if (it.rating) { e.r = e.r || {}; if (e.r[`${sn}:${en}`] !== it.rating) { e.r[`${sn}:${en}`] = it.rating; n++; } }
      }
      if (n) db.set("imdb_eps", JSON.stringify(m));
      return n;
    };
    if (db.get("imdb_user")) {
      add("imdb", "IMDb ratings", async () => {
        // With thousands of ratings already stored, a sync reads only the newest 500 (IMDb lists them newest first,
        // and a changed rating moves to the top). Reading every page each time kept IMDb's page busy on the engine
        // the app shares, freezing the screen. The whole list is read only when asked (Settings › IMDb).
        const have = db.items("imdb", ["rated"]).length;
        const want = have >= 1000 && !opt.fullImdb ? 500 : 0;
        const [groups, route] = await imdbRatings(http, db.get("imdb_user"), want, tplStore);
        for (const [k, items] of Object.entries(groups)) await db.addItemsAsync(items, "imdb", k, "");
        const all = Object.assign(Object.values(groups).flat(), { total: groups.total || 0, isRatings: true });
        if (groups.newest) return { msg: `newest ${all.length} ratings checked; the other ${Math.max(0, have - all.length)} are already stored (to catch ratings you removed on IMDb, use Settings › IMDb › Read all my ratings again)`, part: false, got: all.length };
        if (!want && groups.total && all.length >= groups.total * 0.98) db.set("imdb_full_at", String(Date.now()));
        keepEps(all);
        return imdbRes(all, route);
      }, CONFIG.listTaskMs);
    }
    const ratingsUser = db.get("imdb_user") ? imdbUserId(db.get("imdb_user")) : "";
    for (const url of lines(db.get("imdb_lists"))) {
      if (/\/ratings/i.test(url)) {
        const u = imdbUserId(url);
        if (u && u !== ratingsUser) add("imdb", `IMDb ratings ${u}`, async () => {
          const [groups, route] = await imdbRatings(http, u);
          for (const [k, items] of Object.entries(groups)) await db.addItemsAsync(items, "imdb", k, "");
          return imdbRes(Object.values(groups).flat(), route);
        }, CONFIG.listTaskMs);
        continue;
      }
      if (/\/watchlist/i.test(url)) {
        add("imdb", "IMDb watchlist", async () => {
          const [items, route] = await imdbWatchlist(http, url, tplStore);
          await db.addItemsAsync(items, "imdb", "watchlist", "watchlist");
          return imdbRes(items, route);
        }, CONFIG.listTaskMs);
        continue;
      }
      add("imdb", `IMDb list ${listIdSafe(url)}`, async () => {
        const [items, route] = await imdbList(http, url);
        await db.addItemsAsync(items, "imdb", "list", listIdFrom(url));
        return imdbRes(items, route);
      }, CONFIG.listTaskMs);
    }
    const canonRows = [], canonDone = new Set();
    for (const ln of lines(db.get("canon_urls"))) {
      let franchise, url;
      const i = ln.indexOf("|");
      if (i === -1) { franchise = "Unsorted"; url = ln; } else { franchise = ln.slice(0, i).trim(); url = ln.slice(i + 1).trim(); }
      add(url.includes("imdb.com") ? "imdb" : "trakt", `Canon: ${franchise}`, async () => {
        let items, route;
        if (url.includes("imdb.com")) [items, route] = await imdbList(http, url);
        else if (url.includes("trakt.tv")) { items = await traktListItems(db, http, url); route = "Trakt API"; }
        else throw new Error("canon URL must be an IMDb or Trakt list");
        for (const it of items) canonRows.push(Object.assign({}, it, { franchise, src: url }));
        if (!partial(route)) canonDone.add(url);
        return { msg: `${items.length} canon entries via ${route}`, part: partial(route) };
      }, CONFIG.listTaskMs);
    }
    const all = [...lanes.trakt, ...lanes.imdb];
    const want = t => !only || only.has(t[0]);
    const total = all.filter(want).length;
    const report = [], failed = [], state = {};
    try { Object.assign(state, JSON.parse(db.get("sync_state", "{}"))); } catch (e) { /* fresh */ }
    let ok = 0, doneN = 0;
    const runLane = async (tasks, gap) => {
      let first = true;
      for (const [label, fn, limit] of tasks.filter(want)) {
        if (CONFIG.cancelled) { report.push(`SKIP ${label}: stopped`); continue; }
        if (!first && gap) await sleep(gap);
        first = false;
        progress(doneN / Math.max(total, 1), `Syncing ${label}`);
        await breathe();
        const t0 = Date.now();
        L(`start ${label}`);
        try {
          let r;
          try { r = await withTimeout(fn(), limit, `took longer than ${Math.round(limit / 60000)} min`); }
          catch (e) { if (http.cancelBrowse && /took longer/.test(e.message)) http.cancelBrowse(); throw e; } // don't leave its page running
          const msg = typeof r === "string" ? r : r.msg, part = r && r.part;
          report.push(`${part ? "PART " : "OK  "}${label}: ${msg}${part ? " (not all of it came through; what arrived is kept. Tap Retry failed, or sign in to IMDb)" : ""}`);
          const was = state[label] || {};
          state[label] = { ok: !part, at: Date.now(), ms: Date.now() - t0, msg, okAt: part ? (was.okAt || (was.ok ? was.at : 0)) : Date.now(), streak: part ? (was.streak || 0) + 1 : 0 };
          if (part) failed.push(label); else ok++;
        } catch (e) {
          report.push(`FAIL ${label}: ${e.message}`);
          const was = state[label] || {};
          state[label] = { ok: false, at: Date.now(), ms: Date.now() - t0, msg: e.message, okAt: was.okAt || (was.ok ? was.at : 0), streak: (was.streak || 0) + 1 };
          failed.push(label);
        }
        L(`end ${label} (${Date.now() - t0} ms)`);
        doneN++;
        progress(doneN / Math.max(total, 1), `${doneN} of ${total} sources done`);
      }
    };
    await Promise.all([runLane(lanes.trakt, 0), runLane(lanes.imdb, CONFIG.imdbGapMs)]);
    // report in a stable order: Trakt first, then IMDb, then canon lists
    const order = all.map(t => t[0]);
    const pos = line => { const body = line.replace(/^\S+\s+/, ""); const k = order.findIndex(l => body.startsWith(l + ":")); return k < 0 ? 999 : k; };
    report.sort((a, b) => pos(a) - pos(b));
    if (canonRows.length || canonDone.size) {
      // canon from lists that weren't fully re-read this time keeps its previous entries
      const kept = db.canon().filter(c => c.origin === "url" && !canonDone.has(c.src) && !canonRows.some(r => r.src === c.src));
      db.replaceCanon("url", kept.concat(canonRows));
    }
    const prevFailed = (() => { try { return JSON.parse(db.get("last_failed", "[]")); } catch (e) { return []; } })();
    db.set("last_failed", JSON.stringify(only ? prevFailed.filter(l => !only.has(l) || failed.includes(l)).concat(failed.filter(l => !prevFailed.includes(l))) : failed));
    db.set("sync_state", JSON.stringify(state));
    db.set("sync_log", log.join("\n"));
    if (ok) db.set("last_sync", Date.now() / 1000);
    if (!all.length) report.push("Nothing to sync. Set a Trakt username, IMDb user/list URLs or canon lists in Settings.");
    progress(1, `Sync finished: ${ok}/${total} sources OK`);
    return { ok, total, failed, report: report.join("\n"), log };
  }

  // After a sync: posters, release dates and where-to-watch, and next episodes from TMDB. Three lanes at once, each with
  // its own deadline; whatever doesn't fit is picked up next time. Never blocks the sync result.
  async function details(db, http, progress = () => {}, opt = {}) {
    const key = db.get("tmdb_key");
    if (!key) return "No TMDB key: posters, dates and episodes skipped";
    http = robust(http, { timeout: 25000, tries: 2 });
    const status = canonStatus(db);
    const jobs = [["Next episodes", () => tvNext(db, http, key, opt.tvBudget || 300)], ["Posters", () => fillPosters(db, http, key, status, opt.posterBudget || 150)],
                  ["Dates & streaming", () => enrichInfo(db, http, status, opt.infoBudget || 60)]];
    let n = 0;
    const res = await Promise.all(jobs.map(async ([label, fn]) => {
      try { const m = await withTimeout(fn(), opt.limitMs || 150000, "stopped after its time limit, continues next time"); return `OK   ${label}: ${m}`; }
      catch (e) { return `FAIL ${label}: ${e.message}`; }
      finally { progress(++n / jobs.length, `${label} done`); }
    }));
    return res.join("\n");
  }

  function listIdSafe(url) { try { return listIdFrom(url); } catch (e) { return String(url).slice(-14); } }

  const Core = {
    MEDIA, PROFILES, SECRET_RX, norm, parseYear, mediumFromImdb, mediumFromText, ratio, TitleIndex, Store,
    parseCsv, parseImdbText, importImdbCsv, importFranchiseFile, traktEntries, routeTraktFile, storeTrakt, importTraktZip,
    breathe, jsonParts, BUSY: CONFIG_BUSY, consumed, Exclusion, canonStatus, canonStatusAsync, franchiseProgress, upNext, missingCanon, discrepancies, computeStats,
    recommend, sourceHealth, personWorks, tmdbPosters, VMap, apiTitles, pageOrApi, gqlInfo, imdbReset: () => { gqlBlocked = false; }, imdbGql, gqlList, gqlRatings, imdbUr, authorizeUrl, exchangeCode, Trakt, traktSync, imdbList, imdbRatings, imdbWatchlist, imdbUserId, listIdFrom, walkTitles, browseTitles, pageExtract, pageProbe, probeFor, TMDB, collectionScan, season0Scan,
    CONFIG, AI_PRESETS, compatProvider, compatScan, localModels, serverBase, traktOne, traktEpRatings, parseLines, parseMvGroup, relevantNames, promptLine, netHint, robust, pool, details, titleInfo, justWatch, pickDates, dateSummary, bestOffer, cachedInfo, enrichInfo, platformRatings, ratingDiffs, withTimeout, watchProgress, continueWatching, testGemini, gemError, fillPosters, posterKey, aiState, resetAi, canonScan, claudeScan, claudeCall, claudeModels, rankClaudeModel, CLAUDE_DEFAULT, upcomingEpisodes, canonKeys, parseJsonArray, multiverseScan, collectionRows, refreshCollections, tvNext, upcomingEvents, computeAlerts, backgroundRun, fmtWhen, hashId, geminiState, resetGemini, mvGroup, mvExpand, multiverses, mvMap, mvAlias, mvPending, mvDone, geminiProvider, vpnOptions, bestVpn, worldFrom, worldCountries, jwQuery, flag: FLAGS, VPN_DEFAULT, manualScan, franchiseBatches, verifyPrompt, parseVerify, newsBatches, newsPrompt, parseCanonRows, franchiseName, releaseList, releaseKey, parseDate, seeds, rankGeminiModel, resolveGeminiModel, syncAll, sleep,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof window !== "undefined" ? window : globalThis);
