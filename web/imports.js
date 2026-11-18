/* Reads exports from other tracking sites and says where they go:
   films and series → your library here (Letterboxd, MyAnimeList/AniList, Simkl, TV Time, any CSV with titles),
   games → the Games tab (HowLongToBeat, Grouvee, Backloggd-style CSV, a Steam library),
   books → the Books tab (Goodreads, StoryGraph, LibraryThing, Libib, BookWyrm, MyAnimeList manga, any CSV).
   Trakt, IMDb and Refract keep their own importers in the Watch tab. Pure functions; Node runs them in the tests. */
(function (root) {
  "use strict";
  const day = d => { if (!d) return ""; const s = String(d).trim(); if (!s || /^0000/.test(s)) return ""; if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); if (/^\d{4}\/\d{2}\/\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, "-"); const t = Date.parse(s); return isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10); };
  const yearOf = d => { const m = String(d || "").match(/\b(18|19|20)\d\d\b/); return m ? +m[0] : null; };
  const low = s => String(s || "").toLowerCase().trim();

  // ------------------------------------------------------------------ CSV
  function parseCsv(text) {
    const t = String(text || "").replace(/^﻿/, "");
    const first = t.split(/\r?\n/, 1)[0] || "";
    const sep = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? "\t" : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"' && cell === "") q = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(x => x !== "")) rows.push(row); row = []; }
      else cell += c;
    }
    row.push(cell); if (row.some(x => x !== "")) rows.push(row);
    if (rows.length < 1) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => { o[h] = (r[i] || "").trim(); }); return o; });
  }
  // the first column whose name matches one of the aliases (case and punctuation ignored)
  function col(cols, aliases) {
    const k = s => low(s).replace(/[^a-z0-9]/g, "");
    for (const a of aliases) { const hit = cols.find(c => k(c) === k(a)); if (hit) return hit; }
    return null;
  }

  // ------------------------------------------------------------------ XML (MyAnimeList)
  function xmlEntries(text, tag) {
    const out = [], re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
    let m;
    while ((m = re.exec(text))) {
      const o = {}, fre = /<([A-Za-z_0-9]+)>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/\1>/g;
      let f;
      while ((f = fre.exec(m[1]))) o[f[1]] = f[2].trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'");
      out.push(o);
    }
    return out;
  }

  // ------------------------------------------------------------------ films and series
  function letterboxd(files) {
    const by = new Map();
    const keyOf = r => `${String(r.Name || "").toLowerCase()}|${r.Year || ""}`; // diary rows each have their own URI
    const get = r => { const k = keyOf(r); if (!by.has(k)) by.set(k, { type: "movie", title: r.Name, year: +r.Year || null, status: "watchlist", watches: [], rating: 0, src: "letterboxd", _diary: 0 }); return by.get(k); };
    const named = n => Object.keys(files).find(k => low(k).split("/").pop() === n);
    const rows = n => (named(n) ? parseCsv(files[named(n)]) : []);
    for (const r of rows("watchlist.csv")) get(r);
    for (const r of rows("diary.csv")) { const x = get(r); x.status = "watched"; const d = day(r["Watched Date"] || r.Date); x.watches.push(d); x._diary++; if (r.Rating) x.rating = Math.round(parseFloat(r.Rating) * 2); }
    for (const r of rows("watched.csv")) { const x = get(r); x.status = "watched"; if (!x._diary && !x.watches.length) x.watches.push(""); }
    for (const r of rows("ratings.csv")) { const x = get(r); x.status = "watched"; if (r.Rating) x.rating = Math.round(parseFloat(r.Rating) * 2); if (!x.watches.length) x.watches.push(""); }
    for (const r of rows("reviews.csv")) { const x = get(r); if (r.Review && !x.notes) x.notes = r.Review; }
    const out = [...by.values()].filter(x => x.title);
    out.forEach(x => { delete x._diary; x.watches.sort(); });
    return out;
  }
  const MAL_STATUS = { completed: "watched", watching: "watching", reading: "watching", "plan to watch": "watchlist", "plan to read": "watchlist", dropped: "dropped", "on-hold": "watching" };
  function malAnime(text) {
    return xmlEntries(text, "anime").map(a => {
      const st = MAL_STATUS[low(a.my_status)] || "watchlist";
      const fin = day(a.my_finish_date), times = +a.my_times_watched || 0;
      const watches = st === "watched" ? [fin].concat(Array(times).fill("")) : [];
      const movie = /^movie$/i.test(a.series_type || "");
      return { type: movie ? "movie" : "show", title: a.series_title, year: null, anime: true, mal: +a.series_animedb_id || null, status: st, rating: +a.my_score || 0, watches,
        epsWatched: movie ? 0 : +a.my_watched_episodes || 0, mal: +a.series_animedb_id || null, src: "myanimelist", notes: a.my_comments || "" };
    }).filter(x => x.title);
  }
  function malManga(text) {
    return xmlEntries(text, "manga").map(m => {
      const st = { completed: "read", reading: "reading", "plan to read": "want", dropped: "dnf", "on-hold": "reading" }[low(m.my_status)] || "want";
      return { title: m.manga_title, authors: [], status: st, rating: +m.my_score || 0, finished: day(m.my_finish_date), started: day(m.my_start_date), categories: ["Manga"], format: "Manga",
        manga: true, mal: +m.manga_mangadb_id || null, chapter: +m.my_read_chapters || 0, volume: +m.my_read_volumes || 0, chapters: +m.manga_chapters || 0, volumes: +m.manga_volumes || 0 };
    }).filter(x => x.title);
  }
  // TV Time (GDPR export): seen episodes and followed shows; column names vary between export versions.
  function tvtime(files) {
    const shows = new Map(), movies = new Map();
    for (const [name, text] of Object.entries(files)) {
      if (!/\.csv$/i.test(name)) continue;
      const rows = parseCsv(text);
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const sc = col(cols, ["tv_show_name", "series_name", "show_name", "series_title"]), sn = col(cols, ["episode_season_number", "season_number", "season"]),
        en = col(cols, ["episode_number", "number", "episode"]), dc = col(cols, ["updated_at", "created_at", "watched_at", "seen_at"]),
        mc = col(cols, ["movie_name", "movie_title"]), tc = col(cols, ["entity_type", "type"]);
      for (const r of rows) {
        if (mc && r[mc] && (!tc || /movie/i.test(r[tc]))) {
          const k = low(r[mc]); const x = movies.get(k) || { type: "movie", title: r[mc], status: "watched", watches: [], src: "tvtime" };
          const d = day(r[dc]); if (d && !x.watches.includes(d)) x.watches.push(d); if (!x.watches.length) x.watches.push("");
          movies.set(k, x); continue;
        }
        if (!sc || !r[sc]) continue;
        const k = low(r[sc]); const x = shows.get(k) || { type: "show", title: r[sc], status: "watchlist", eps: {}, src: "tvtime" };
        if (sn && en && +r[en] > 0 && +r[sn] >= 0) { x.eps[`${+r[sn]}:${+r[en]}`] = day(r[dc]) || x.eps[`${+r[sn]}:${+r[en]}`] || ""; x.status = "watching"; }
        shows.set(k, x);
      }
    }
    return [...shows.values(), ...movies.values()];
  }
  // Any CSV with a title column: Simkl, Serializd, a spreadsheet of your own…
  function genericWatch(rows, src) {
    if (!rows.length) return [];
    const cols = Object.keys(rows[0]);
    const tc = col(cols, ["Title", "Name", "Film", "Movie", "Show", "Series", "title_name", "Original Title"]);
    if (!tc) return [];
    const yc = col(cols, ["Year", "Release Year", "release_year", "Released"]), typ = col(cols, ["Type", "Media", "Media Type", "Kind", "Category", "Title Type"]),
      ic = col(cols, ["IMDB", "imdb_id", "IMDb ID", "Const", "imdb"]), tm = col(cols, ["TMDB", "tmdb_id", "TMDb ID"]),
      st = col(cols, ["Status", "Watchlist", "List", "Shelf", "State"]), rc = col(cols, ["Rating", "My Rating", "Your Rating", "Score", "user_rating"]),
      dc = col(cols, ["WatchedDate", "Watched Date", "Last Watched", "Date Watched", "watched_at", "Date", "Date Rated", "Completed"]),
      ec = col(cols, ["LastEpWatched", "Episodes Watched", "Progress", "watched_episodes"]);
    return rows.map(r => {
      const title = r[tc]; if (!title) return null;
      const ty = low(r[typ]);
      const type = /tv|show|series|anime|serie|episode/.test(ty) && !/movie|film/.test(ty) ? "show" : "movie";
      const s = low(r[st]);
      const status = /plan|watchlist|want|to.?watch|da vedere/.test(s) ? "watchlist" : /drop|abandon/.test(s) ? "dropped" : /watching|progress|current|in corso|hold/.test(s) ? "watching" : (s || r[dc] || r[rc]) ? "watched" : "watchlist";
      let rating = parseFloat(String(r[rc] || "").replace(",", ".")) || 0;
      if (rating > 10) rating = Math.round(rating / 10); else if (rating && rating <= 5 && /letterboxd|5/.test(src || "")) rating = Math.round(rating * 2);
      const imdb = ((r[ic] || Object.values(r).join(" ")).match(/tt\d{6,10}/) || [])[0] || null;
      const d = day(r[dc]);
      const o = { type, title, year: yearOf(r[yc]) || null, imdb, tmdb: +r[tm] || null, status, rating: Math.round(rating), watches: status === "watched" && type === "movie" ? [d] : [], src: src || "csv" };
      const ep = String(r[ec] || "").match(/s(\d+)\s*e(\d+)/i);
      if (type === "show" && ep) o.lastEp = [+ep[1], +ep[2]];
      else if (type === "show" && +r[ec]) o.epsWatched = +r[ec];
      if (type === "show" && status === "watched") o.watches = [d];
      return o;
    }).filter(Boolean);
  }

  // ------------------------------------------------------------------ games
  // rows: {title, platform, status: done|playing|backlog|wishlist|dropped, date, rating (0-10), hours, steam}
  function hltb(rows) {
    return rows.map(r => {
      const title = r.Title || r["Game"] || r.Name; if (!title) return null;
      const yes = k => r[k] && r[k] !== "0" && !/^(no|false)$/i.test(r[k]);
      const status = yes("Completed") ? "done" : yes("Playing") ? "playing" : yes("Retired") ? "dropped" : yes("Backlog") ? "backlog" : yes("Replay") ? "done" : "backlog";
      return { title, platform: r.Platform || "", status, date: day(r["Completion Date"] || r["Completed Date"] || r.Finished || ""), rating: (+r.Review || +r.Rating || 0) / 10, hours: parseFloat(r["Main Story"] || r.Progress || "") || null, src: "HowLongToBeat" };
    }).filter(Boolean);
  }
  function grouvee(rows) {
    return rows.map(r => {
      const title = r.name || r.Name; if (!title) return null;
      let shelves = {}; try { shelves = JSON.parse(r.shelves || "{}"); } catch (e) { shelves = {}; }
      const names = Object.keys(shelves).map(low).join(" ") || low(r.shelves);
      const status = /played|beaten|completed/.test(names) ? "done" : /playing/.test(names) ? "playing" : /wish/.test(names) ? "wishlist" : /abandon|drop/.test(names) ? "dropped" : "backlog";
      let date = ""; try { const ds = JSON.parse(r.dates || "[]"); const d = (ds[ds.length - 1] || {}).date_finished || (ds[ds.length - 1] || {}).finished; date = day(d); } catch (e) { date = ""; }
      let plat = ""; try { plat = Object.keys(JSON.parse(r.platforms || "{}"))[0] || ""; } catch (e) { plat = r.platforms || ""; }
      return { title, platform: plat, status, date, rating: (+r.rating || 0) * 2, src: "Grouvee" };
    }).filter(Boolean);
  }
  function genericGames(rows, src) {
    if (!rows.length) return [];
    const cols = Object.keys(rows[0]);
    const tc = col(cols, ["Title", "Name", "Game", "Game Title", "game_name"]); if (!tc) return [];
    const pc = col(cols, ["Platform", "Platforms", "System", "Console"]), sc = col(cols, ["Status", "Shelf", "List", "State", "Played Status"]),
      dc = col(cols, ["Completed", "Completion Date", "Finished", "Date Finished", "Beaten", "Date"]), rc = col(cols, ["Rating", "Score", "My Rating", "Stars"]);
    return rows.map(r => {
      const s = low(r[sc]);
      const status = /beat|complet|finish|played|done|100|mastered/.test(s) ? "done" : /playing|current|progress/.test(s) ? "playing" : /wish/.test(s) ? "wishlist" : /drop|abandon|shelved|retired/.test(s) ? "dropped" : r[dc] ? "done" : "backlog";
      let rating = parseFloat(String(r[rc] || "").replace(",", ".")) || 0;
      if (rating > 10) rating /= 10; else if (rating && rating <= 5) rating *= 2;
      return r[tc] ? { title: r[tc], platform: r[pc] || "", status, date: day(r[dc]), rating, src: src || "CSV" } : null;
    }).filter(Boolean);
  }
  // steamcommunity.com/id/NAME/games?tab=all&xml=1 (public profile)
  function steamXml(text) {
    return xmlEntries(text, "game").map(g => ({ title: g.name, platform: "PC", status: "backlog", owned: "PC (Steam)", steam: +g.appID || null, hours: parseFloat(String(g.hoursOnRecord || "").replace(",", "")) || 0, src: "Steam" }))
      .filter(x => x.title);
  }
  // The games page itself (the XML version is gone on some profiles): JSON in data-profile-gameslist, or the older rgGames.
  const unent = t => String(t).replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  function steamHtml(html) {
    let games = null;
    const a = String(html).match(/data-profile-gameslist="([^"]*)"/);
    if (a) { try { games = (JSON.parse(unent(a[1])) || {}).rgGames || []; } catch (e) { games = null; } }
    if (!games) { const b = String(html).match(/var\s+rgGames\s*=\s*(\[[\s\S]*?\]);\s*\n/); if (b) { try { games = JSON.parse(b[1]); } catch (e) { games = null; } } }
    if (!games) return null;
    return games.map(g => ({ title: unent(g.name || ""), platform: "PC", status: "backlog", owned: "PC (Steam)", steam: +g.appid || null,
      hours: g.playtime_forever ? Math.round(g.playtime_forever / 6) / 10 : parseFloat(String(g.hours_forever || "").replace(",", "")) || 0, src: "Steam" })).filter(x => x.title);
  }
  // Your owned games from a public Steam profile: tries the XML list, then the games page. Returns rows for GamesCore.importRows.
  // ---------------------------------------------------------------- live sync from more services (no sign-in, public profiles)
  const getText = async (http, url, what, accept) => {
    const r = await http("GET", url, { headers: { Accept: accept || "*/*" } });
    if (r.status === 0) throw new Error(`${what}: network error (${r.error || "no connection"})`);
    if (r.status === 404) throw new Error(`${what}: no such user, or the profile is private`);
    if (r.status === 403 || r.status === 401) throw new Error(`${what}: the profile or list is private`);
    if (r.status === 429) throw new Error(`${what}: too many requests, try again in a few minutes`);
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status}`);
    return r.body || "";
  };
  const ymd = o => o && o.year ? `${o.year}-${String(o.month || 1).padStart(2, "0")}-${String(o.day || 1).padStart(2, "0")}` : "";
  // AniList: anime to the library, manga and light novels to Books
  // ---- 0.6.9: writing to AniList (two-way). Sign-in gives a token (implicit grant: the token comes back in the address).
  // alState: what AniList said at the last sync, per anime: { mal|al id: { st, pr, sc } }. After the sync has read
  // AniList, an anime whose Saga status, episodes or rating differ from that was changed in Saga: it's sent.
  const AL_STATUS = { watchlist: "PLANNING", watching: "CURRENT", watched: "COMPLETED", paused: "PAUSED", dropped: "DROPPED" };
  const anilistAuthUrl = clientId => `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token`;
  function anilistTokenFrom(url) { const m = /[#&?]access_token=([^&]+)/.exec(String(url || "")); const e = /[#&?]expires_in=(\d+)/.exec(String(url || "")); return m ? { token: decodeURIComponent(m[1]), until: Date.now() + (e ? +e[1] * 1000 : 365 * 864e5) } : null; }
  async function anilistGql(http, token, query, variables) {
    const r = await http("POST", "https://graphql.anilist.co", { headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ query, variables }) });
    if (r.status === 401 || r.status === 400 && /Invalid token/i.test(r.body || "")) throw new Error("AniList sign-in expired: sign in again");
    if (r.status === 429) throw new Error("AniList: too many requests, try again in a minute");
    let j; try { j = JSON.parse(r.body); } catch (e) { throw new Error(`AniList: HTTP ${r.status || r.error}`); }
    if (j.errors && j.errors.length) throw new Error(`AniList: ${j.errors[0].message}`);
    return j.data || {};
  }
  // Saga's state of an anime, as AniList counts it
  const alOf = it => ({ st: AL_STATUS[it.status] || "PLANNING", pr: it.type === "movie" ? 0 : Object.keys(it.eps || {}).length, sc: it.rating || 0 });
  function alStateFrom(rows) { const st = {}; for (const r of rows || []) { const k = r.mal ? "m" + r.mal : r.anilist ? "a" + r.anilist : null; if (k) st[k] = { st: AL_STATUS[r.status] || "PLANNING", pr: r.epsWatched || 0, sc: r.rating || 0, id: r.anilist || null }; } return st; }
  async function anilistPush(http, token, items, alState, opt = {}) {
    const out = { sent: 0, failed: [] }, max = opt.max || 40;
    for (const it of items) {
      if (out.sent >= max) break;
      if (!it.anime || (!it.mal && !it.anilist)) continue;
      const k = it.mal ? "m" + it.mal : "a" + it.anilist, was = alState[k], now = alOf(it);
      if (was && was.st === now.st && was.pr === now.pr && was.sc === now.sc) continue;
      if (!was && it.status === "watchlist" && !now.pr && !now.sc) continue; // nothing to tell AniList
      try {
        let id = it.anilist || (was && was.id);
        if (!id) { const d = await anilistGql(http, token, "query($m:Int){Media(idMal:$m,type:ANIME){id}}", { m: +it.mal }); id = d.Media && d.Media.id; if (id) it.anilist = id; }
        if (!id) continue;
        const v = { mediaId: id, status: now.st, scoreRaw: now.sc * 10 }; if (now.pr) v.progress = now.pr;
        await anilistGql(http, token, "mutation($mediaId:Int,$status:MediaListStatus,$progress:Int,$scoreRaw:Int){SaveMediaListEntry(mediaId:$mediaId,status:$status,progress:$progress,scoreRaw:$scoreRaw){id status progress}}", v);
        alState[k] = Object.assign({}, now, { id }); out.sent++;
      } catch (e) { if (/expired|too many/.test(e.message)) throw e; out.failed.push(`${it.title}: ${e.message}`); }
    }
    return out;
  }
  async function anilist(http, user) {
    const q = `query($u:String,$t:MediaType){MediaListCollection(userName:$u,type:$t){lists{entries{status score(format:POINT_10) progress progressVolumes repeat completedAt{year month day} startedAt{year month day}
      media{id idMal format episodes chapters volumes seasonYear startDate{year} title{romaji english}}}}}}`;
    const run = async t => {
      const r = await http("POST", "https://graphql.anilist.co", { headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ query: q, variables: { u: user, t } }) });
      if (r.status === 0) throw new Error(`AniList: network error (${r.error || "no connection"})`);
      let j; try { j = JSON.parse(r.body); } catch (e) { throw new Error(`AniList: HTTP ${r.status}`); }
      if (j.errors && j.errors.length) throw new Error(`AniList: ${/not found|private/i.test(j.errors[0].message) ? "no such user, or the list is private" : j.errors[0].message}`);
      return ((j.data || {}).MediaListCollection || {}).lists || [];
    };
    const AS = { CURRENT: "watching", REPEATING: "watching", PAUSED: "watching", COMPLETED: "watched", PLANNING: "watchlist", DROPPED: "dropped" };
    const BS = { CURRENT: "reading", REPEATING: "reading", PAUSED: "reading", COMPLETED: "read", PLANNING: "want", DROPPED: "dnf" };
    const anime = [], books = [];
    for (const l of await run("ANIME")) for (const e of l.entries || []) {
      const m = e.media || {}, movie = m.format === "MOVIE", st = AS[e.status] || "watchlist", fin = ymd(e.completedAt);
      anime.push({ type: movie ? "movie" : "show", title: (m.title || {}).english || (m.title || {}).romaji || "", orig: (m.title || {}).romaji || "", year: m.seasonYear || (m.startDate || {}).year || null,
        anime: true, mal: m.idMal || null, anilist: m.id, status: st, rating: Math.round(e.score || 0), watches: st === "watched" ? [fin].concat(Array(e.repeat || 0).fill("")) : [],
        epsWatched: movie ? 0 : e.progress || 0, src: "anilist" });
    }
    for (const l of await run("MANGA")) for (const e of l.entries || []) {
      const m = e.media || {}, novel = m.format === "NOVEL";
      books.push({ title: (m.title || {}).english || (m.title || {}).romaji || "", authors: [], status: BS[e.status] || "want", rating: Math.round(e.score || 0), finished: ymd(e.completedAt), started: ymd(e.startedAt),
        categories: [novel ? "Light novel" : "Manga"], format: novel ? "Light novel" : "Manga", manga: !novel, mal: m.idMal || null, chapter: e.progress || 0, volume: e.progressVolumes || 0, chapters: m.chapters || 0, volumes: m.volumes || 0 });
    }
    return { anime: anime.filter(x => x.title), books: books.filter(x => x.title) };
  }
  // MyAnimeList's public list pages (the same data the list page shows)
  async function malLists(http, user) {
    const pages = async kind => {
      const out = [];
      for (let off = 0; off < 30000; off += 300) {
        const t = await getText(http, `https://myanimelist.net/${kind}list/${encodeURIComponent(user)}/load.json?status=7&offset=${off}`, "MyAnimeList", "application/json");
        let a; try { a = JSON.parse(t); } catch (e) { throw new Error("MyAnimeList: the list page didn't answer with data (the list may be private)"); }
        if (!Array.isArray(a)) break;
        out.push(...a);
        if (a.length < 300) break;
      }
      return out;
    };
    const malDay = s => { const m = String(s || "").match(/^(\d\d)-(\d\d)-(\d\d)$/); return m ? `${+m[3] > 50 ? "19" : "20"}${m[3]}-${m[1]}-${m[2]}` : day(s); };
    const AS = { 1: "watching", 2: "watched", 3: "watching", 4: "dropped", 6: "watchlist" }, BS = { 1: "reading", 2: "read", 3: "reading", 4: "dnf", 6: "want" };
    const anime = (await pages("anime")).map(a => {
      const movie = /movie/i.test(a.anime_media_type_string || ""), st = AS[a.status] || "watchlist";
      return { type: movie ? "movie" : "show", title: a.anime_title_eng || a.anime_title || "", orig: a.anime_title || "", year: yearOf(a.anime_start_date_string ? malDay(a.anime_start_date_string) : "") || null, anime: true,
        mal: +a.anime_id || null, status: st, rating: +a.score || 0, watches: st === "watched" ? [malDay(a.finish_date_string) || ""] : [], epsWatched: movie ? 0 : +a.num_watched_episodes || 0, src: "myanimelist" };
    }).filter(x => x.title);
    const books = (await pages("manga")).map(m => {
      const novel = /novel/i.test(m.manga_media_type_string || "");
      return { title: m.manga_english || m.manga_title || "", authors: [], status: BS[m.status] || "want", rating: +m.score || 0, finished: malDay(m.finish_date_string), started: malDay(m.start_date_string),
        categories: [novel ? "Light novel" : "Manga"], format: novel ? "Light novel" : "Manga", manga: !novel, mal: +m.manga_id || null, chapter: +m.num_read_chapters || 0, volume: +m.num_read_volumes || 0,
        chapters: +m.manga_num_chapters || 0, volumes: +m.manga_num_volumes || 0 };
    }).filter(x => x.title);
    return { anime, books };
  }
  const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? unent(m[1].replace(/<!\[CDATA\[|\]\]>/g, "")).trim() : ""; };
  // Letterboxd: the public diary feed (your latest 50 entries) with ratings and watch dates
  async function letterboxdRss(http, user) {
    const xml = await getText(http, `https://letterboxd.com/${encodeURIComponent(String(user).replace(/^@/, ""))}/rss/`, "Letterboxd", "application/rss+xml");
    const out = [];
    for (const it of xml.split(/<item>/i).slice(1)) {
      const title = tag(it, "letterboxd:filmTitle");
      if (!title) continue;
      const r = parseFloat(tag(it, "letterboxd:memberRating")) || 0, d = tag(it, "letterboxd:watchedDate");
      out.push({ type: "movie", title, year: +tag(it, "letterboxd:filmYear") || null, tmdb: +tag(it, "tmdb:movieId") || null, status: "watched", rating: Math.round(r * 2), watches: d ? [d] : [], src: "letterboxd" });
    }
    return out;
  }
  // Goodreads: the public shelf feeds (read, reading, to read). The user is the number in your profile link.
  async function goodreadsRss(http, user) {
    const id = (String(user).match(/(\d{3,})/) || [])[1];
    if (!id) throw new Error("Goodreads: use the number from your profile link (goodreads.com/user/show/12345-name → 12345)");
    const out = [];
    for (const [shelf, st] of [["read", "read"], ["currently-reading", "reading"], ["to-read", "want"]]) {
      for (let page = 1; page <= 20; page++) {
        const xml = await getText(http, `https://www.goodreads.com/review/list_rss/${id}?shelf=${shelf}&per_page=200&page=${page}`, "Goodreads", "application/rss+xml");
        const items = xml.split(/<item>/i).slice(1);
        for (const it of items) {
          const isbn = tag(it, "isbn").replace(/\D/g, ""), rd = tag(it, "user_read_at"), ad = tag(it, "user_date_added");
          out.push({ title: tag(it, "title"), authors: [tag(it, "author_name")].filter(Boolean), isbn13: isbn.length === 13 ? isbn : "", isbn10: isbn.length === 10 ? isbn : "", status: st,
            rating: (+tag(it, "user_rating") || 0) * 2, pages: +tag(it, "num_pages") || 0, finished: st === "read" ? day(rd || ad) : "", started: st === "reading" ? day(ad) : "", published: tag(it, "book_published") });
        }
        if (items.length < 200) break;
      }
    }
    return out.filter(x => x.title);
  }
  // Netflix: Account › Profile › Viewing activity › Download all (CSV with Title and Date)
  function netflix(rows) {
    const shows = new Map(), movies = new Map();
    const dates = rows.map(r => String(r.Date || "")).filter(Boolean);
    const dayFirst = dates.some(d => +d.split(/[/.-]/)[0] > 12) || !dates.some(d => +d.split(/[/.-]/)[1] > 12);
    const toDay = d => { const p = String(d || "").split(/[/.-]/).map(Number); if (p.length < 3) return ""; let [a, b, y] = p; if (y < 100) y += 2000; const [dd, mm] = dayFirst ? [a, b] : [b, a]; return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`; };
    for (const r of rows) {
      const t = String(r.Title || "").trim(), d = toDay(r.Date);
      if (!t) continue;
      const m = t.match(/^(.+?): (?:Season|Stagione|Temporada|Saison|Staffel|Part|Parte|Limited Series|Miniserie|Volume|Book|Libro|Chapter|Capitolo)\b/i);
      if (m) { const k = m[1].trim(), e = shows.get(k) || { title: k, n: 0, last: "" }; e.n++; if (d > e.last) e.last = d; shows.set(k, e); }
      else { const e = movies.get(t) || { title: t, dates: [] }; if (d) e.dates.push(d); movies.set(t, e); }
    }
    return [...[...movies.values()].map(m => ({ type: "movie", title: m.title, status: "watched", watches: [...new Set(m.dates)].sort(), src: "netflix" })),
            ...[...shows.values()].map(s => ({ type: "show", title: s.title, status: "watching", src: "netflix", note: `${s.n} episodes on Netflix, last ${s.last}` }))];
  }
  // With a Steam Web API key (free, from steamcommunity.com/dev/apikey) the list comes from Steam's official API, which
  // doesn't depend on how the profile page is built.
  async function steamApi(http, profile, key) {
    const get = async url => { const r = await http("GET", url, { headers: { Accept: "application/json" } });
      if (r.status === 0) throw new Error(`Steam: network error (${r.error || "no connection"})`);
      if (r.status === 401 || r.status === 403) throw new Error("Steam: the Web API key was refused. Check it in Settings › Accounts and sync");
      if (r.status !== 200) throw new Error(`Steam API: HTTP ${r.status}`);
      try { return JSON.parse(r.body); } catch (e) { throw new Error("Steam API: unreadable answer"); } };
    const p = String(profile || "").trim();
    let id = (p.match(/(?:profiles\/)?(\d{17})(?:\/|$)/) || [])[1];
    if (!id) {
      const name = (p.match(/\/id\/([^/?#]+)/) || [])[1] || p.replace(/^@/, "");
      // 0.5.9: the custom name as typed, then without _ - . (people often type it the way it's shown, not the way it's set),
      // then the community page's own XML, which carries the numeric id
      const variants = [...new Set([name, name.replace(/[_\-.]/g, ""), name.toLowerCase(), name.replace(/[_\-.]/g, "").toLowerCase()])].filter(Boolean);
      for (const v of variants) {
        const j = await get(`https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(key)}&vanityurl=${encodeURIComponent(v)}`);
        id = j && j.response && j.response.success === 1 ? j.response.steamid : null;
        if (id) break;
      }
      if (!id) {
        try { const r = await http("GET", `https://steamcommunity.com/id/${encodeURIComponent(name)}/?xml=1`, { headers: { Accept: "text/xml" } }); id = ((r.body || "").match(/<steamID64>(\d{17})<\/steamID64>/) || [])[1] || null; } catch (e) { id = null; }
      }
      if (!id) throw new Error(`Steam: no profile with the custom name “${name}” (also tried ${variants.slice(1).map(v => `“${v}”`).join(", ") || "no variants"}). Open your profile in Steam, copy its link (…/profiles/7656… or …/id/…) and paste it in Settings › Accounts and sync`);
    }
    const j = await get(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}&steamid=${id}&include_appinfo=1&include_played_free_games=1`);
    const games = j && j.response && j.response.games;
    if (!games) throw new Error("Steam: no games visible. Set Game details to Public in Steam › Edit profile › Privacy");
    const rows = games.map(g => ({ title: g.name || "", platform: "PC", status: "backlog", owned: "PC (Steam)", steam: +g.appid || null, hours: g.playtime_forever ? Math.round(g.playtime_forever / 6) / 10 : 0, src: "Steam",
      mins: g.playtime_forever || 0, last: g.rtime_last_played ? new Date(g.rtime_last_played * 1000).toISOString().slice(0, 10) : "" })).filter(x => x.title);
    rows.steamid = id; // 0.6.9: for recently played and achievements
    return rows;
  }
  // 0.6.9: what you played in the last two weeks: [{ steam, mins2w, mins }]
  async function steamRecent(http, key, steamid) {
    const r = await http("GET", `https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/?key=${encodeURIComponent(key)}&steamid=${steamid}`, { headers: { Accept: "application/json" } });
    if (r.status !== 200) throw new Error(`Steam recently played: HTTP ${r.status || r.error}`);
    const j = JSON.parse(r.body || "{}");
    return ((j.response && j.response.games) || []).map(g => ({ steam: +g.appid, mins2w: g.playtime_2weeks || 0, mins: g.playtime_forever || 0 }));
  }
  // 0.6.9: achievements of one game: { got, total } (null: the game has none, or they're hidden)
  async function steamAchievements(http, key, steamid, appid) {
    const r = await http("GET", `https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key=${encodeURIComponent(key)}&steamid=${steamid}&appid=${appid}`, { headers: { Accept: "application/json" } });
    if (r.status === 400 || r.status === 403) return null; // no achievements, or the stats are private
    if (r.status !== 200) throw new Error(`Steam achievements: HTTP ${r.status || r.error}`);
    const ps = (JSON.parse(r.body || "{}").playerstats) || {};
    if (!ps.success || !ps.achievements) return null;
    return { got: ps.achievements.filter(a => a.achieved).length, total: ps.achievements.length };
  }
  async function steamLibrary(http, profile, key) {
    if (key && String(key).trim()) return steamApi(http, profile, String(key).trim());
    const xmlUrl = steamProfileUrl(profile);
    if (!xmlUrl) throw new Error("Type your Steam profile link (steamcommunity.com/id/… or /profiles/…) or its custom name");
    const pageUrl = xmlUrl.replace(/games\?tab=all&xml=1$/, "games/?tab=all");
    let why = "";
    try {
      const r = await http("GET", xmlUrl, { headers: { Accept: "text/xml" } });
      if (r.status === 200 && /<gamesList>/i.test(r.body || "")) { const rows = steamXml(r.body); if (rows.length) return rows; why = "the XML list was empty"; }
      else if (r.status === 0) why = `network error (${r.error || "no connection"})`;
      else why = /<error>([\s\S]*?)<\/error>/i.test(r.body || "") ? RegExp.$1.replace(/<!\[CDATA\[|\]\]>/g, "").trim() : `HTTP ${r.status}`;
    } catch (e) { why = e.message; }
    const r = await http("GET", pageUrl, { headers: { Accept: "text/html", "Accept-Language": "en" } });
    if (r.status === 0) throw new Error(`Steam: network error (${r.error || "no connection"})`);
    if (r.status !== 200) throw new Error(`Steam: HTTP ${r.status}`);
    const body = r.body || "";
    if (/profile_private_info|This profile is private/i.test(body)) throw new Error("Steam: that profile is private. In Steam › Edit profile › Privacy, set My profile and Game details to Public");
    if (/The specified profile could not be found/i.test(body)) throw new Error("Steam: no profile with that name. Use the link from your profile page (the custom URL can differ from your display name)");
    const rows = steamHtml(body);
    if (rows && rows.length) return rows;
    if (rows) throw new Error("Steam: no games visible. Set Game details to Public in Steam › Edit profile › Privacy");
    const title = ((body.match(/<title>([^<]*)<\/title>/i) || [])[1] || "").trim().slice(0, 60);
    throw new Error(`Steam no longer shows the game list on the profile page without signing in (page “${title || "untitled"}”, ${why || "no list"}). Add a free Steam Web API key in Settings › Accounts and sync › Steam and it will work`);
  }
  const steamProfileUrl = s => {
    s = String(s || "").trim();
    const id = s.match(/steamcommunity\.com\/(id|profiles)\/([^/?#]+)/);
    if (id) return `https://steamcommunity.com/${id[1]}/${id[2]}/games?tab=all&xml=1`;
    if (/^\d{17}$/.test(s)) return `https://steamcommunity.com/profiles/${s}/games?tab=all&xml=1`;
    if (/^[\w-]{2,32}$/.test(s)) return `https://steamcommunity.com/id/${s}/games?tab=all&xml=1`;
    return null;
  };

  // ------------------------------------------------------------------ routing
  // file: {name, text} or {name, zip:{entry: text}}. Returns {target: "watch"|"games"|"books"|"canon", kind, rows?, raw?}
  function detect(file) {
    const name = low(file.name);
    const zip = file.zip || null;
    if (zip) {
      const keys = Object.keys(zip).map(k => low(k).split("/").pop());
      if (keys.includes("diary.csv") || keys.includes("watched.csv") && keys.includes("watchlist.csv") || keys.includes("ratings.csv") && Object.values(zip).some(t => /Letterboxd URI/.test(String(t).slice(0, 300))))
        return { target: "watch", kind: "Letterboxd", rows: letterboxd(zip) };
      if (keys.some(k => /seen_episode|followed_tv_show|tracking-prod-records|tv_show/.test(k))) return { target: "watch", kind: "TV Time", rows: tvtime(zip) };
      if (keys.some(k => /^(watched|ratings|watchlist|lists|history)[-_].*\.json$/.test(k) || /^watched-(movies|shows)\.json$/.test(k))) return { target: "canon", kind: "trakt" };
      const xml = Object.entries(zip).find(([k]) => /\.xml$/i.test(k));
      if (xml) { const d = detect({ name: xml[0], text: xml[1] }); if (d) return d; }
      const csv = Object.entries(zip).filter(([k]) => /\.(csv|tsv)$/i.test(k));
      for (const [k, t] of csv) { const d = detect({ name: k, text: t }); if (d && d.target !== "unknown") return d; }
      return { target: "canon", kind: "refract" };
    }
    const text = String(file.text || "");
    const head = text.slice(0, 2000);
    if (/<myanimelist>/i.test(head) || /<anime>/.test(head)) {
      const anime = malAnime(text), manga = malManga(text);
      if (manga.length && !anime.length) return { target: "books", kind: "MyAnimeList manga", rows: manga };
      return { target: "watch", kind: "MyAnimeList / AniList", rows: anime, books: manga };
    }
    if (/<gamesList>/i.test(head)) return { target: "games", kind: "Steam library", rows: steamXml(text) };
    if (/^\s*[[{]/.test(text)) {
      try {
        const j = JSON.parse(text);
        if (j && (j.app === "BookCheck" || j.app === "books")) return { target: "books", kind: "Books backup", raw: text, name: file.name };
        if (j && !Array.isArray(j) && Object.values(j).slice(0, 3).every(v => v && typeof v === "object" && ("primaryauthor" in v || "authors" in v) && "title" in v)) return { target: "books", kind: "LibraryThing", raw: text, name: file.name };
        if (j && (j.movies || j.shows || j.anime) && (Array.isArray(j.movies) || Array.isArray(j.shows))) return { target: "watch", kind: "Simkl", rows: simklJson(j) };
      } catch (e) { /* not JSON after all */ }
      return { target: "canon", kind: "file" };
    }
    const rows = parseCsv(text);
    if (!rows.length) return { target: "unknown", kind: "empty" };
    const cols = Object.keys(rows[0]), has = (...c) => c.every(x => cols.includes(x));
    if (has("Const", "Title") && (cols.includes("Your Rating") || cols.includes("Title Type") || cols.includes("Created"))) return { target: "canon", kind: "imdb" };
    if (cols.includes("Letterboxd URI")) return { target: "watch", kind: "Letterboxd", rows: letterboxd({ [/diary/.test(name) ? "diary.csv" : /rating/.test(name) ? "ratings.csv" : /watchlist/.test(name) ? "watchlist.csv" : "watched.csv"]: text }) };
    if (cols.includes("Exclusive Shelf") || cols.includes("Read Status") || cols.includes("ISBN/UID") || col(cols, ["Primary Author", "author_text", "ean_isbn13", "creators"]) ||
        (col(cols, ["Author", "Authors"]) && col(cols, ["Title"]))) return { target: "books", kind: cols.includes("Exclusive Shelf") ? "Goodreads" : cols.includes("Read Status") ? "StoryGraph" : cols.includes("ean_isbn13") ? "Libib" : cols.includes("author_text") ? "BookWyrm" : cols.includes("Primary Author") ? "LibraryThing" : "Books CSV", raw: text, name: file.name };
    if (has("shelves", "name") && cols.includes("platforms")) return { target: "games", kind: "Grouvee", rows: grouvee(rows) };
    if (col(cols, ["Title"]) && (cols.includes("Backlog") || cols.includes("Completed") && cols.includes("Playing"))) return { target: "games", kind: "HowLongToBeat", rows: hltb(rows) };
    if (col(cols, ["Platform", "Platforms", "Console", "System"]) && col(cols, ["Title", "Name", "Game"]) || /backloggd|game/.test(name)) return { target: "games", kind: /backloggd/.test(name) ? "Backloggd" : "Games CSV", rows: genericGames(rows, /backloggd/.test(name) ? "Backloggd" : "CSV") };
    if (cols.length <= 4 && cols.includes("Title") && cols.includes("Date") && (/netflix|viewing/i.test(name) || rows.some(r => /: (Season|Stagione) \d/.test(r.Title || "")))) return { target: "watch", kind: "Netflix viewing history", rows: netflix(rows) };
    if (cols.includes("SIMKL_ID") || /simkl/.test(name)) return { target: "watch", kind: "Simkl", rows: genericWatch(rows, "simkl") };
    if (col(cols, ["tv_show_name", "series_name"])) return { target: "watch", kind: "TV Time", rows: tvtime({ [file.name || "tvtime.csv"]: text }) };
    const w = genericWatch(rows, /serializd/.test(name) ? "serializd" : "csv");
    if (w.length) return { target: "watch", kind: "CSV list", rows: w };
    return { target: "canon", kind: "file" };
  }
  function simklJson(j) {
    const out = [];
    const take = (list, type) => (list || []).forEach(x => {
      const m = x.movie || x.show || x.anime || {}, ids = m.ids || {};
      const st = low(x.status);
      const status = /plan/.test(st) ? "watchlist" : /drop/.test(st) ? "dropped" : /watching|hold/.test(st) ? "watching" : "watched";
      const o = { type, title: m.title, year: m.year || null, imdb: ids.imdb || null, tmdb: +ids.tmdb || null, status, rating: +x.user_rating || 0, watches: [], src: "simkl" };
      if (status === "watched") o.watches.push(day(x.last_watched_at) || "");
      if (type === "show" && x.watched_episodes_count) o.epsWatched = +x.watched_episodes_count;
      if (m.title) out.push(o);
    });
    take(j.movies, "movie"); take(j.shows, "show"); take(j.anime, "show");
    return out;
  }
  // A shows import that only says "up to S2 E5": tick everything before it once episodes are known
  function lastEpToCount(row) { return row.lastEp ? row.lastEp : null; }

  // One short guess at a franchise for a game nobody grouped yet ("Hades II" → "Hades").
  function franchiseGuess(t) {
    let s = String(t || "").split(/\s*[:–—]\s+|\s+-\s+/)[0];
    s = s.replace(/\s+(\d+|[IVX]{1,4}|Remastered|Remake|HD|Deluxe|Edition|Definitive Edition|GOTY)$/i, "").replace(/\s+(\d+|[IVX]{1,4})$/i, "").trim();
    return s || String(t || "");
  }

  const API = { anilistAuthUrl, anilistTokenFrom, anilistGql, anilistPush, alStateFrom, parseCsv, col, xmlEntries, letterboxd, malAnime, malManga, tvtime, genericWatch, hltb, grouvee, genericGames, steamXml, steamHtml, steamApi, steamLibrary, steamRecent, steamAchievements, anilist, malLists, letterboxdRss, goodreadsRss, netflix, steamProfileUrl, detect, simklJson, franchiseGuess, day, lastEpToCount };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Imports = API;
})(typeof window !== "undefined" ? window : globalThis);
