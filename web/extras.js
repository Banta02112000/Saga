/* CanonSync 4.0 additions on top of core.js (added onto the same Core object so the app, the background job
   and the node tests all see one API): Refract import, writing back to Trakt, streaming alerts, search and
   counts across the Games and Doctor Who tabs, watch order, the home-screen widget text and whole-app backups. */
(function (root) {
  "use strict";
  const C = typeof module !== "undefined" && module.exports ? require("./core.js") : root.Core;
  const { norm, parseYear, parseDate, mediumFromText, parseCsv, parseJsonArray, hashId } = C;
  const TRAKT = "https://api.trakt.tv";
  const jsonGet = (db, k, d) => { try { return JSON.parse(db.get(k, "")) || d; } catch (e) { return d; } };

  // ================================================================ Refract import
  // Refract's export is a ZIP with no published layout and no IMDb/TMDB ids, so this reads whatever tables it
  // finds (CSV, TSV, JSON, NDJSON), recognises columns by name and decides what each table is from its file
  // name, its JSON key and its columns. The report says what was understood so nothing is silently dropped.
  const COLS = {
    title: ["title", "name", "originaltitle", "original_title", "movie", "show", "series", "showtitle", "show_title", "seriestitle", "series_title", "movietitle", "movie_title", "mediatitle", "media_title", "item"],
    year: ["year", "releaseyear", "release_year", "firstairyear", "first_air_year", "startyear"],
    rdate: ["releasedate", "release_date", "firstairdate", "first_air_date", "airdate", "air_date", "premiered", "released"],
    type: ["type", "mediatype", "media_type", "kind", "category", "format", "itemtype", "item_type"],
    rating: ["rating", "myrating", "my_rating", "userrating", "user_rating", "score", "stars", "yourrating"],
    date: ["watchedat", "watched_at", "watcheddate", "watched_date", "datewatched", "date_watched", "watchedon", "watched_on", "lastwatched", "last_watched", "completedat", "completed_at", "ratedat", "rated_at", "date", "addedat", "added_at", "createdat", "created_at", "timestamp"],
    list: ["list", "listname", "list_name", "collection", "collectionname"],
    status: ["status", "state", "watchstatus", "watch_status"],
    imdb: ["imdb", "imdbid", "imdb_id", "const"],
    tmdb: ["tmdb", "tmdbid", "tmdb_id"],
    season: ["season", "seasonnumber", "season_number"],
    episode: ["episode", "episodenumber", "episode_number"],
    watched: ["watched", "iswatched", "is_watched", "seen", "completed"],
  };
  const keyOf = k => String(k || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
  function pickCol(obj, names) {
    for (const k of Object.keys(obj)) { const kk = keyOf(k); if (names.includes(kk) || names.includes(kk.replace(/_/g, ""))) { const v = obj[k]; if (v !== null && v !== undefined && v !== "") return v; } }
    return null;
  }
  const kindFromName = n => {
    const s = String(n || "").toLowerCase();
    if (/watch.?list|want|to.?watch|plan|queue|bookmark/.test(s)) return "watchlist";
    if (/rating|rated|review|score/.test(s)) return "rated";
    if (/watched|history|diary|seen|progress|episode|completed|log|activity/.test(s)) return "watched";
    if (/list|collection|favou?rite/.test(s)) return "list";
    return null;
  };
  const mediumOf = v => {
    const s = String(v || "").toLowerCase();
    if (!s) return null;
    if (/anime|tv|show|series|season|episode/.test(s)) return "TV Series";
    if (/special|ova|short/.test(s)) return "Special";
    if (/game/.test(s)) return "Video Game";
    if (/movie|film/.test(s)) return "Movie";
    return mediumFromText(s);
  };
  const truthy = v => v === true || v === 1 || /^(1|true|yes|y|watched|completed|seen)$/i.test(String(v));

  function tablesFromJson(data, path, out) {
    if (Array.isArray(data)) {
      const objs = data.filter(x => x && typeof x === "object" && !Array.isArray(x));
      if (objs.length) out.push({ path, rows: objs });
      // nested arrays inside rows (lists with items, shows with episodes)
      for (const o of objs.slice(0, 5000)) for (const [k, v] of Object.entries(o)) {
        if (Array.isArray(v) && v.some(x => x && typeof x === "object")) tablesFromJson(v, `${path}/${pickCol(o, COLS.title.concat(COLS.list)) || k}#${k}`, out);
      }
    } else if (data && typeof data === "object") {
      for (const [k, v] of Object.entries(data)) if (v && typeof v === "object") tablesFromJson(v, `${path}/${k}`, out);
    }
  }

  function refractTables(zip) {
    const tables = [], unread = [];
    for (const [name, text0] of Object.entries(zip || {})) {
      const text = String(text0 || "").replace(/^﻿/, "");
      if (!text.trim()) continue;
      try {
        if (/\.(json)$/i.test(name) || /^[\[{]/.test(text.trim())) {
          tablesFromJson(JSON.parse(text), name, tables);
        } else if (/\.ndjson$/i.test(name)) {
          tables.push({ path: name, rows: text.split("\n").filter(Boolean).map(l => JSON.parse(l)) });
        } else {
          const rows = parseCsv(/\.tsv$/i.test(name) || (text.split("\n")[0].split("\t").length > 2) ? text.replace(/\t/g, ",") : text);
          if (rows.length < 2) { unread.push(name); continue; }
          const head = rows[0];
          tables.push({ path: name, rows: rows.slice(1).filter(r => r.length > 1 || r[0]).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]]))) });
        }
      } catch (e) { unread.push(name); }
    }
    return { tables, unread };
  }

  // → { records:[{title,year,medium,rating,date,kind,list,imdb,tmdb}], report:[{file,rows,used,kind}], unread:[names] }
  function parseRefract(zip) {
    const { tables, unread } = refractTables(zip);
    const records = [], report = [];
    for (const t of tables) {
      const fileKind = kindFromName(t.path.split("#")[0].split("/").slice(-2).join("/")) || kindFromName(t.path);
      const listName = /#/.test(t.path) ? t.path.split("/").pop().split("#")[0] : null;
      let used = 0;
      const kinds = {};
      const top = maxRating(t.rows), scale = top <= 5 ? 2 : top <= 10 ? 1 : 0.1; // stars out of 5, points out of 10, or a percentage
      const shows = new Map(); // episode rows collapse into one show
      for (const r of t.rows) {
        // a row that holds its own table (a list with items, a show with episodes) is a container, not a title
        if (Object.values(r).some(v => Array.isArray(v) && v.some(x => x && typeof x === "object")) && pickCol(r, COLS.year.concat(COLS.type, COLS.rdate)) === null) continue;
        const hasEp = pickCol(r, COLS.episode) !== null || pickCol(r, COLS.season) !== null;
        let title = pickCol(r, hasEp ? ["show", "series", "showtitle", "show_title", "seriestitle", "series_title"].concat(COLS.title) : COLS.title);
        if (title && typeof title === "object") title = pickCol(title, COLS.title);
        if (!title || typeof title !== "string") continue;
        const rd = pickCol(r, COLS.rdate);
        const year = parseYear(pickCol(r, COLS.year)) || (rd ? parseYear(String(rd).slice(0, 4)) : null) || null;
        const status = String(pickCol(r, COLS.status) || "").toLowerCase();
        const rawRating = parseFloat(pickCol(r, COLS.rating));
        let kind = fileKind;
        if (/plan|want|watchlist|queue/.test(status)) kind = "watchlist";
        else if (/watched|completed|seen|finished|watching|progress/.test(status)) kind = "watched";
        else if (!kind || kind === "list") {
          const w = pickCol(r, COLS.watched);
          if (w !== null) kind = truthy(w) ? "watched" : "watchlist";
          else if (!kind) kind = rawRating > 0 ? "rated" : (pickCol(r, COLS.date) ? "watched" : "list");
        }
        const medium = mediumOf(pickCol(r, COLS.type)) || (hasEp ? "TV Series" : mediumOf(t.path)) || "Movie";
        const rec = {
          title: title.trim(), year, medium, kind, list: kind === "list" ? (pickCol(r, COLS.list) || listName || t.path.split("/").pop().replace(/\.\w+$/, "")) : "",
          rating: rawRating > 0 ? Math.max(1, Math.min(10, Math.round(rawRating * scale))) : null,
          date: parseDate(String(pickCol(r, COLS.date) || "").slice(0, 10)) || null,
          imdb: /^tt\d+$/.test(String(pickCol(r, COLS.imdb) || "")) ? String(pickCol(r, COLS.imdb)) : null, tmdb: pickCol(r, COLS.tmdb) || null,
        };
        if (hasEp) { // keep one row per show (latest watch date)
          const k = `${norm(rec.title)}|${rec.year || ""}`;
          const cur = shows.get(k);
          if (!cur || (rec.date || "") > (cur.date || "")) shows.set(k, rec);
          continue;
        }
        records.push(rec); used++; kinds[rec.kind] = (kinds[rec.kind] || 0) + 1;
        if (rec.rating && rec.kind !== "rated" && rec.kind !== "watchlist") { records.push(Object.assign({}, rec, { kind: "rated" })); }
      }
      for (const rec of shows.values()) { records.push(rec); used++; kinds[rec.kind] = (kinds[rec.kind] || 0) + 1; }
      report.push({ file: t.path, rows: t.rows.length, used, kinds });
    }
    return { records, report, unread };
  }
  const maxRating = rows => { let m = 0; for (const r of rows.slice(0, 2000)) { const v = parseFloat(pickCol(r, COLS.rating)); if (v > m) m = v; } return m; };

  // Replaces what a previous Refract import stored, then adds the new records. Returns a summary for the report.
  function importRefract(db, zip, other = []) {
    const { records, report, unread } = parseRefract(zip);
    if (!records.length) {
      const seen = Object.keys(zip || {}).concat(other);
      throw new Error(seen.length ? `No titles found in this export. Files inside: ${seen.slice(0, 8).join(", ")}${seen.length > 8 ? "…" : ""}` : "This ZIP has no CSV or JSON files in it.");
    }
    for (const [id, r] of [...db.itemsMap.entries()]) if (r.source === "refract") db.itemsMap.delete(id);
    const by = new Map();
    for (const r of records) { const k = r.kind + "|" + (r.list || ""); if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
    const counts = {};
    for (const [k, rows] of by) {
      const [kind, list] = k.split("|");
      const n = db.addItems(rows.map(r => ({ title: r.title, year: r.year, medium: r.medium, rating: r.rating, date: r.date, rated_at: kind === "rated" ? r.date : null, imdb: r.imdb, tmdb: r.tmdb })), "refract", kind, list);
      counts[kind] = (counts[kind] || 0) + n;
    }
    db.set("refract_last", JSON.stringify({ at: Date.now(), counts, report: report.filter(r => r.used).map(r => `${r.file}: ${r.used} of ${r.rows}`).slice(0, 30),
                                             skipped: report.filter(r => !r.used).map(r => r.file).concat(unread, other).slice(0, 30) }));
    return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), report, unread: unread.concat(other) };
  }

  // ================================================================ Trakt write-back
  // Needs the sign-in from Settings (token). Titles without an IMDb id are looked up on Trakt by title and year.
  async function traktPost(http, clientId, token, path, body) {
    const r = await http("POST", TRAKT + path, { headers: { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": clientId, Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (r.status === 401 || r.status === 403) throw new Error("Trakt sign-in has expired. Sign in again in Settings.");
    if (r.status === 420) throw new Error("Trakt account limit reached (list or watchlist is full).");
    if (r.status < 200 || r.status >= 300) throw new Error(`Trakt answered ${r.status || "nothing"}${r.error ? ": " + r.error : ""}`);
    return JSON.parse(r.body || "{}");
  }

  async function traktFind(http, clientId, c) {
    const type = c.medium === "Movie" ? "movie" : "show";
    const r = await http("GET", `${TRAKT}/search/${type}?query=${encodeURIComponent(c.title)}&limit=5`, { headers: { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": clientId } });
    if (r.status !== 200) return null;
    const hits = (JSON.parse(r.body) || []).map(h => h[type]).filter(Boolean);
    const ok = hits.find(h => norm(h.title) === norm(c.title) && (!c.year || !h.year || Math.abs(h.year - c.year) <= 1)) || (hits[0] && !c.year ? hits[0] : null);
    return ok ? { type, ids: ok.ids, title: ok.title, year: ok.year } : null;
  }

  // action: "history" (mark watched), "watchlist", "ratings" (needs rating 1-10), or "history/remove", "watchlist/remove"
  async function traktPush(db, http, c, action, opts = {}) {
    const token = db.get("token"), cid = db.get("client_id");
    if (!token) throw new Error("Sign in to Trakt in Settings first.");
    if (c.medium === "Video Game") throw new Error("Trakt doesn't track games.");
    let type = c.medium === "Movie" ? "movies" : "shows", ids = c.imdb ? { imdb: c.imdb } : null;
    if (!ids) {
      const hit = await traktFind(http, cid, c);
      if (!hit) throw new Error(`Couldn't find "${c.title}" on Trakt.`);
      ids = hit.ids; type = hit.type + "s";
    }
    const item = { ids };
    if (action === "ratings") item.rating = Math.max(1, Math.min(10, Math.round(opts.rating)));
    if (action === "history" && opts.watchedAt) item.watched_at = opts.watchedAt;
    const res = await traktPost(http, cid, token, `/sync/${action}`, { [type]: [item] });
    const nf = res.not_found && (res.not_found[type] || []).length;
    if (nf) throw new Error(`Trakt didn't recognise "${c.title}".`);
    return res;
  }

  // ================================================================ streaming alerts
  // "X is now on Netflix": compares the cached streaming info of titles you still need with what was known before.
  function streamAlerts(db, status, myServices) {
    const mine = (myServices || []).map(s => String(s).toLowerCase().replace(/amazon prime video|prime video/, "prime video").replace(/disney plus/, "disney+").replace(/[^a-z0-9+]/g, "")).filter(Boolean);
    const known = jsonGet(db, "stream_known", {});
    const baseline = !db.get("stream_baseline");
    const notes = [];
    const svcKey = n => String(n || "").toLowerCase().replace(/\s+with ads$|\s+standard with ads$/i, "").replace(/amazon prime video|prime video/, "prime video").replace(/disney plus/, "disney+").replace(/[^a-z0-9+]/g, "");
    for (const c of status) {
      if (c.have && c.state !== "listed") continue;
      const inf = C.cachedInfo(db, c);
      if (!inf || !Array.isArray(inf.offers)) continue;
      const key = `${c.norm}|${c.year || ""}`;
      const now = [...new Set(inf.offers.filter(o => ["flatrate", "free", "ads"].includes(o.type)).map(o => svcKey(o.name)))].filter(k => !mine.length || mine.includes(k));
      const before = known[key];
      if (before !== undefined && !baseline) {
        const fresh = now.filter(k => !before.includes(k));
        if (fresh.length) {
          const names = fresh.map(k => (inf.offers.find(o => svcKey(o.name) === k) || {}).name || k);
          notes.push({ id: hashId("s" + key + fresh.join()), title: `Now streaming: ${c.title}`, text: `On ${names.join(", ")} in ${inf.region || "your country"}. ${c.franchise}.`, tab: "missing" });
        }
      }
      known[key] = now;
    }
    db.set("stream_known", JSON.stringify(known));
    db.set("stream_baseline", "1");
    return notes.length > 4 ? [{ id: hashId("smany" + notes.length + notes[0].id), title: `${notes.length} titles now streaming on your services`, text: notes.slice(0, 6).map(n => n.title.replace("Now streaming: ", "")).join(", ") + (notes.length > 6 ? "…" : "."), tab: "missing" }] : notes;
  }

  // ================================================================ other tabs (Games, Doctor Who)
  // Each tab writes a small index to a shared file; these read it.
  const parseIndex = text => { try { const j = JSON.parse(text || ""); return j && typeof j === "object" ? j : null; } catch (e) { return null; } };

  // One search over Canon (status + your titles), Games and Doctor Who. → [{app, id, title, sub, done}]
  function searchAll(q, status, items, games, dw, limit = 40, books = null) {
    const n = norm(q);
    if (n.length < 2) return [];
    const words = n.split(" ").filter(Boolean);
    const hit = t => { const x = norm(t); return words.every(w => x.includes(w)); };
    const rank = t => { const x = norm(t); return x === n ? 0 : x.startsWith(n) ? 1 : 2; };
    const out = [], seen = new Set();
    for (const c of status || []) if (hit(c.title)) { seen.add(c.norm + "|" + (c.year || "")); out.push({ app: "canon", c, title: c.title, sub: [c.franchise, c.year, c.medium].filter(Boolean).join(" · "), done: c.have && c.state !== "listed", state: c.state, r: rank(c.title) }); }
    for (const i of items || []) if (!seen.has(i.norm + "|" + (i.year || "")) && hit(i.title)) { seen.add(i.norm + "|" + (i.year || "")); out.push({ app: "canon", item: i, title: i.title, sub: [i.year, i.medium, i.kind === "watchlist" || i.kind === "list" ? "on your list" : "seen"].filter(Boolean).join(" · "), done: i.kind === "watched" || i.kind === "rated", r: rank(i.title) }); }
    for (const g of (games && games.games) || []) if (hit(g.t) || (g.rn && hit(g.rn))) out.push({ app: "games", id: g.id, title: g.t, sub: [g.m && g.m !== g.f ? g.m : null, g.f, g.y, "Game"].filter(Boolean).join(" · "), done: !!g.d, r: rank(g.t) });
    for (const b of (books && books.books) || []) if (hit(b.t) || (b.a && hit(b.a + " " + b.t)) || (b.se && hit(b.se))) out.push({ app: "books", id: b.id, title: b.t, sub: [b.a, b.se ? `${b.se}${b.n != null ? " #" + b.n : ""}` : "", { reading: "reading", want: "want to read", read: "read", dnf: "didn't finish" }[b.s]].filter(Boolean).join(" · "), done: !!b.d, r: rank(b.t) });
    for (const s of (dw && dw.stories) || []) if (hit(s.t)) out.push({ app: "dw", id: s.k, tab: s.tab, title: s.t, sub: [s.ty, s.tabName].filter(Boolean).join(" · "), done: !!s.d, r: rank(s.t) });
    out.sort((a, b) => a.r - b.r || a.title.length - b.title.length || a.title.localeCompare(b.title));
    return out.slice(0, limit);
  }

  // Games and Doctor Who entries that belong to a Canon multiverse (matched by name). → {games:{n,done}, dw:{n,done}}
  const WHO = new Set(["whoniverse", "doctor who", "doctor who universe"]);
  function crossCounts(mvName, games, dw) {
    const n = norm(mvName), out = { games: null, dw: null };
    const mv = games && games.mv ? Object.entries(games.mv).find(([k]) => norm(k) === n || (WHO.has(n) && WHO.has(norm(k)))) : null;
    if (mv) out.games = { n: mv[1].n, done: mv[1].d, name: mv[0] };
    if (dw && dw.total && WHO.has(n)) out.dw = { n: dw.total.n, done: dw.total.d };
    return out;
  }

  // ================================================================ watch order
  function orderPrompt(mv, rows) {
    return `Put the entries of the "${mv}" multiverse in IN-UNIVERSE CHRONOLOGICAL order (the order the story happens, earliest first).
For series that run alongside other entries, place the whole series where it starts. Use Google Search or fan wikis' timeline pages if unsure.
Reply with one \`\`\`json code block and nothing else: {"order": [numbers in chronological order, every number exactly once], "notes": "one sentence on anything debatable"}

ENTRIES (number. Title (Year) [Medium]):
${rows.map((c, i) => `${i + 1}. ${c.title} (${c.year || "?"}) [${c.medium}]`).join("\n")}`;
  }

  function parseOrder(text, rows) {
    let j = null;
    const m = String(text || "").match(/\{[\s\S]*\}/);
    try { j = JSON.parse(m ? m[0] : text); } catch (e) { j = null; }
    let arr = j && Array.isArray(j.order) ? j.order : null;
    if (!arr) { try { arr = parseJsonArray(text); } catch (e) { arr = []; } }
    const seen = new Set(), keys = [];
    for (const x of arr || []) { const c = rows[parseInt(x, 10) - 1]; if (c && !seen.has(c)) { seen.add(c); keys.push(`${c.norm}|${c.year || ""}`); } }
    if (keys.length < Math.min(2, rows.length)) throw new Error("That answer has no usable order in it.");
    return { keys, notes: j && j.notes ? String(j.notes).slice(0, 240) : "" };
  }

  const relKey = c => c.date || (c.year ? `${c.year}-99` : "9999");
  // mode "release" | "chrono" (falls back to release order for entries Gemini didn't place)
  function watchOrder(db, mv, status, mode = "release") {
    const rows = status.filter(c => c.franchise === mv).sort((a, b) => relKey(a).localeCompare(relKey(b)) || a.title.localeCompare(b.title));
    const saved = jsonGet(db, "mv_chrono", {})[mv];
    if (mode !== "chrono" || !saved) return { rows, chrono: !!saved, notes: saved ? saved.notes : "" };
    const pos = new Map(saved.keys.map((k, i) => [k, i]));
    const placed = rows.filter(c => pos.has(`${c.norm}|${c.year || ""}`)).sort((a, b) => pos.get(`${a.norm}|${a.year || ""}`) - pos.get(`${b.norm}|${b.year || ""}`));
    const rest = rows.filter(c => !pos.has(`${c.norm}|${c.year || ""}`));
    return { rows: placed.concat(rest), chrono: true, unplaced: rest.length, notes: saved.notes, at: saved.at };
  }
  function saveOrder(db, mv, order) {
    const all = jsonGet(db, "mv_chrono", {});
    all[mv] = { keys: order.keys, notes: order.notes, at: Date.now() };
    db.set("mv_chrono", JSON.stringify(all));
  }

  // ================================================================ home-screen widget
  function widgetText(status, games, dw, today, books) {
    today = today || new Date().toISOString().slice(0, 10);
    const lines = [];
    const rb = books && books.reading && books.reading[0]; if (rb) lines.push(`📖 ${rb.t}${rb.pct ? ` · ${rb.pct}%` : ""}`);
    for (const c of C.upNext(status).slice(0, 3)) lines.push(`▶ ${c.title}${c.year ? ` (${c.year})` : ""}`);
    const g = games && games.next && games.next[0]; if (g) lines.push(`🎮 ${g.t}`);
    const d = dw && dw.next && dw.next[0]; if (d) lines.push(`🔊 ${d.t}`);
    const up = status.filter(c => !c.have && c.date && c.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 2);
    for (const c of up) lines.push(`⏳ ${c.date.slice(8, 10)}/${c.date.slice(5, 7)} ${c.title}`);
    return (lines.length ? "Up next" : "CanonSync") + "\n" + (lines.length ? lines.join("\n") : "Nothing queued. Sync to fill this in.");
  }

  // ================================================================ whole-app backup
  function bundleBackup(db, gamesSnap, dwSnap, version, booksSnap) {
    return JSON.stringify({ app: "canonsync-all", v: 1, version, at: new Date().toISOString(), canon: db.toJSON(), games: gamesSnap || null, dw: dwSnap || null, books: booksSnap || null });
  }
  // Works out what a picked file is. → {kind:"all"|"canon"|"games"|"dw", canon?, games?, dw?}
  function readBackup(text) {
    let j;
    try { j = JSON.parse(String(text || "").replace(/^﻿/, "")); } catch (e) { throw new Error("That file isn't a backup (it isn't JSON)."); }
    if (j && j.app === "canonsync-all") return { kind: "all", canon: j.canon, games: j.games, dw: j.dw, books: j.books || null, at: j.at };
    if (j && (j.app === "BookCheck" || j.app === "books") && Array.isArray(j.books)) return { kind: "books", books: JSON.stringify(j) };
    if (j && j.app === "dwcanon" && j.state) return { kind: "dw", dw: JSON.stringify(j) };
    if (j && j.v && j.done && (j.ov || j.ex)) return { kind: "games", games: JSON.stringify(j) };
    if (j && j.settings && Array.isArray(j.items)) return { kind: "canon", canon: j };
    throw new Error("That file isn't a CanonSync, GameCheck, DW Canon or BookCheck backup.");
  }

  Object.assign(C, { parseRefract, importRefract, refractTables, traktPush, traktFind, streamAlerts, parseIndex, searchAll, crossCounts,
                     orderPrompt, parseOrder, watchOrder, saveOrder, widgetText, bundleBackup, readBackup });
  if (typeof module !== "undefined" && module.exports) module.exports = C;
})(typeof window !== "undefined" ? window : globalThis);
