// Every import format through Settings › Import (the hub): picked together, checked first, then brought in.
// Made-up rows only. Run: node test_imports_all.js
// (old Games storage, the Doctor Who snapshot, books.json), sync with failing and partial sources, the Sync screen,
// library posters and episodes, games (Steam add, playthroughs), books (author), timeline marks, year in review,
// share to Saga, notification actions, backup round-trip, Italian, foldable widths. Fake phone bridge throughout.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const OUT = process.argv[2] || "/tmp/shots";
fs.mkdirSync(OUT, { recursive: true });
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split("?")[0]); const f = path.join(__dirname, u);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" }[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); }).listen(0);
const BASE = () => `http://127.0.0.1:${srv.address().port}`;

const mock = (seed) => {
  const LS = localStorage;
  if (!LS.getItem("__seeded")) { LS.setItem("__seeded", "1"); for (const [k, v] of Object.entries(seed.ls || {})) LS.setItem(k, v); for (const [k, v] of Object.entries(seed.files || {})) LS.setItem("f:" + k, v); }
  const push = (k, v) => { const a = JSON.parse(LS.getItem(k) || "[]"); a.push(v); LS.setItem(k, JSON.stringify(a)); };
  const results = {}, bodies = {};
  window.__http = [];
  const reply = (m, url, body) => {
    const J = (o, st) => ({ status: st || 200, body: JSON.stringify(o) });
    if (window.__big) { const b = window.__big(url); if (b) return J(b); }
    if (/api\.trakt\.tv\/users\/banta\/watched\/movies/.test(url)) return J([{ movie: { title: "Heat", year: 1995, ids: { imdb: "tt0113277", tmdb: 949 } }, last_watched_at: "2024-03-01T20:00:00Z" }]);
    if (/api\.trakt\.tv\/users\/banta\/watched\/shows/.test(url)) return J([{ show: { title: "Severance", year: 2022, ids: { imdb: "tt11280740", tmdb: 95396 } }, last_watched_at: "2025-01-20T21:00:00Z", seasons: [{ number: 1, episodes: [{ number: 1, plays: 1, last_watched_at: "2024-12-01T21:00:00Z" }, { number: 2, plays: 1, last_watched_at: "2024-12-02T21:00:00Z" }] }] }]);
    if (/api\.trakt\.tv\/users\/banta\/ratings/.test(url)) return J([]);
    if (/api\.trakt\.tv\/users\/banta\/watchlist/.test(url)) return J([{ type: "movie", movie: { title: "Dune: Part Two", year: 2024, ids: { imdb: "tt15239678" } } }]);
    if (/api\.trakt\.tv\/users\/banta\/lists$|api\.trakt\.tv\/users\/banta\/lists\?/.test(url)) return J([]);
    if (/api\.trakt\.tv\/sync\/history/.test(url)) { window.__pushed = (window.__pushed || []).concat([JSON.parse(body)]); return J({ added: { movies: 1, episodes: 2 } }, 201); }
    if (/api\.trakt\.tv\/sync\/ratings/.test(url)) return J({ added: { movies: 1 } }, 201);
    if (/www\.imdb\.com|m\.imdb\.com|graphql\.imdb/.test(url)) return { status: 0, body: "", error: "java.net.SocketTimeoutException" };
    if (/tvmaze\.com\/lookup\/shows\?imdb=tt11280740/.test(url)) return J({ id: 44933 });
    if (/tvmaze\.com\/shows\/44933/.test(url)) return J({ id: 44933, name: "Severance", premiered: "2022-02-18", status: "Running", externals: { imdb: "tt11280740" }, image: { medium: "" }, _embedded: { episodes: [1, 2, 3, 4].map(e => ({ season: 1, number: e, airdate: `2022-02-${10 + e}`, name: "Episode " + e })) } });
    if (/tvmaze\.com\/search\/shows/.test(url)) return J([{ show: { id: 44933, name: "Severance", premiered: "2022-02-18", status: "Running", externals: { imdb: "tt11280740" } } }]);
    if (/tvmaze\.com\/singlesearch/.test(url)) return J({ id: 1, premiered: "1995-01-01" });
    if (/itunes\.apple\.com/.test(url)) return J({ results: [{ trackId: 7, trackName: "Alien", releaseDate: "1979-05-25T00:00:00Z", trackTimeMillis: 7020000 }] });
    if (/api\.trakt\.tv\/sync\/last_activities/.test(url)) return J({ all: "2026-11-11T10:00:00.000Z" });
    if (/jikan\.moe\/v4\/anime\?q=/.test(url)) return J({ data: [{ mal_id: 52991, title: "Sousou no Frieren", title_english: "Frieren", type: "TV", episodes: 3, status: "Finished Airing", year: 2023, images: { jpg: { large_image_url: "" } } }] });
    if (/jikan\.moe\/v4\/anime\/52991\/episodes/.test(url)) return J({ data: [1, 2, 3].map(e => ({ mal_id: e, title: "E" + e, aired: "2023-10-0" + e + "T00:00:00+00:00" })), pagination: { has_next_page: false } });
    if (/jikan\.moe\/v4\/anime\/52991/.test(url)) return J({ data: { mal_id: 52991, title: "Sousou no Frieren", title_english: "Frieren", type: "TV", episodes: 3, status: "Finished Airing" } });
    if (/jikan\.moe\/v4\/manga\?q=/.test(url)) return J({ data: [{ mal_id: 2, title: "Berserk", type: "Manga", chapters: 380, volumes: 42, status: "Publishing", authors: [{ name: "Miura, Kentarou" }], images: { jpg: { large_image_url: "" } } }] });
    if (/storesearch/.test(url)) return J({ items: [{ id: 1145360, name: "Hades", price: { final: 2450, initial: 2450 } }] });
    if (/appdetails\?appids=1145360&cc=IT&l=/.test(url)) return J({ 1145360: { success: true, data: { release_date: { coming_soon: false, date: "17 Sep, 2020" } } } });
    if (/appdetails/.test(url)) return J({});
    if (/media-imdb\.com\/suggestion\/x\/tt0078748/.test(url)) return J({ d: [{ id: "tt0078748", l: "Alien", y: 1979, q: "feature", i: { imageUrl: "" } }] });
    { const m = url.match(/media-imdb\.com\/suggestion\/x\/(tt\d+)\.json/); if (m) return J({ d: [{ id: m[1], l: "X", i: { imageUrl: `https://m.media-amazon.com/images/M/${m[1]}._V1_.jpg` } }] }); }
    if (/openlibrary\.org\/search\.json\?author=/.test(url)) return J({ docs: [{ key: "/works/A", title: "Dune Messiah", author_name: ["Frank Herbert"], first_publish_year: 1969 }] });
    return { status: 404, body: "" };
  };
  const file = n => (window.__files && n in window.__files ? window.__files[n] : LS.getItem("f:" + n) || "");
  window.Banta = { app: () => "canon", read: n => file(n), write: (n, t) => { LS.setItem("f:" + n, String(t)); return true; }, remove: n => { LS.removeItem("f:" + n); return true; },
    stamp: n => file(n).length + ":" + file(n).slice(-16), post: () => {}, take: () => "", busy: () => {}, paste: () => "", shareTo: () => true, notify: () => {}, widget: () => {} };
  window.Android = { load: file, save: (n, t) => { LS.setItem("f:" + n, t); return true; },
    // 0.5.4.9: background writes (here: done at once), and the stamp the writer left
    saveLater: (n, t) => { window.__files = window.__files || {}; window.__files[n] = t; window.__own = window.__own || {}; window.__own[n] = t.length + ":" + t.slice(-16); return true; },
    bufAdd: (k, t) => { window.__buf = window.__buf || {}; window.__buf[k] = (window.__buf[k] || "") + t; window.__bufCalls = (window.__bufCalls || 0) + 1; }, bufDrop: k => { delete (window.__buf || {})[k]; },
    saveBuf: (n, k) => { const t = (window.__buf || {})[k]; if (t == null) return false; delete window.__buf[k]; window.__files = window.__files || {}; window.__files[n] = t; window.__own = window.__own || {}; window.__own[n] = t.length + ":" + t.slice(-16); return true; },
    appendLater: (n, t) => { window.__files = window.__files || {}; window.__files[n] = (window.__files[n] || "") + t; return true; },
    writeUriBuf: (id, uri, k) => { const t = (window.__buf || {})[k]; delete window.__buf[k]; window.__backupFile = t; setTimeout(() => { results[id] = "true"; window.__saveDone(id); }, 50); },
    ownStamp: n => (window.__own || {})[n] || "", stamp: n => file(n).length + ":" + file(n).slice(-16), take: id => { const r = results[id]; delete results[id]; return r || ""; },
    // like the phone since 0.5.7: the answer's facts as JSON, its body handed over as it is
    http: (id, m, url, h, body) => { window.__http.push(url); setTimeout(() => { const r = Object.assign({ headers: {} }, reply(m, url, body)), b = String(r.body == null ? "" : r.body); bodies[id] = b; delete r.body; r.split = 1; r.len = b.length; results[id] = JSON.stringify(r); window.__httpDone(id); }, 3); },
    takeBody: id => { const b = bodies[id]; delete bodies[id]; return b || ""; },
    takeBodyPart: (id, a, e) => { const b = bodies[id] || ""; const p = b.slice(a, e); if (e >= b.length) delete bodies[id]; return p; },
    browse: (id) => setTimeout(() => { results[id] = JSON.stringify({ status: 0, value: "NETERR:Web page not available", error: "x" }); window.__httpDone(id); }, 3),
    pick: id => setTimeout(() => { results[id] = JSON.stringify(window.__nextPick || []); window.__pickDone(id); }, 3),
    saveAs: (id, name, text) => { window.__saved = { name, text }; setTimeout(() => { results[id] = "true"; window.__saveDone(id); }, 3); },
    writeUri: (u, t) => { window.__backupFile = t; return true; }, pickBackupFile: () => setTimeout(() => window.__backupPicked("content://drive/saga-backup.json"), 3),
    openApp: () => {}, openUrl: u => push("log", "OPEN " + u), copy: t => { window.__copied = t; }, notify: (i, t, x) => push("log", `NOTIFY ${t} | ${x}`), status: () => {}, clearStatus: () => {},
    setBackground: () => true, requestNotifications: () => {}, isBackground: () => false, sha256url: s => s, randomUrl: n => "v".repeat(n), version: () => "5.0", openInApp: () => {} };
};
const ok = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const seed = { ls: {}, files: { "canonsync.json": JSON.stringify({ v: 1, settings: { auto_sync: "0", preset_v1: "1", bg_enabled: "0", notif_asked: "1" }, items: [] }) } };
  const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"] }) // no outside network: the same result on any machine;
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await ctx.addInitScript(mock, seed);
  const errors = [];
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(String(e))); pg.on("dialog", d => d.dismiss());
  await pg.goto(BASE() + "/index.html");
  await pg.waitForFunction(() => window.__app && window.__app.db.get("saga5_migrated"), null, { timeout: 8000 });
  const A = (f, arg) => pg.evaluate(f, arg);
  // the phone saves to files, not to the browser's 5 MB storage
  await A(() => { window.__files = window.__files || {}; const mem = window.__files, ld = Android.load; Android.save = (n, t) => { mem[n] = t; return true; }; Android.load = n => n in mem ? mem[n] : ld(n); Banta.write = (n, t) => { mem[n] = String(t); return true }; Banta.read = n => n in mem ? mem[n] : ""; });
  const files = [
    { name: "ratings.csv", text: "Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors\ntt7000001,8,2024-05-05,Rated Hub Film,https://www.imdb.com/title/tt7000001/,Movie,7.1,100,2001,Drama,100,2001-02-02,X\ntt7000009,7,2024-05-06,Rated Hub Game,https://www.imdb.com/title/tt7000009/,Video Game,7,0,2015,Action,10,2015-01-01,\n" },
    { name: "WATCHLIST.csv", text: "Position,Const,Created,Modified,Description,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors,Your Rating,Date Rated\n1,tt7000002,2024-01-01,2024-01-01,,Wanted Hub Film,https://www.imdb.com/title/tt7000002/,Movie,7,90,2010,Drama,10,2010-01-01,Y,,\n" },
    { name: "My favourites.csv", text: "Position,Const,Created,Modified,Description,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors,Your Rating,Date Rated\n1,tt7000003,2024-01-01,2024-01-01,,Listed Hub Film,https://www.imdb.com/title/tt7000003/,Movie,7,90,2012,Drama,10,2012-01-01,Y,,\n2,tt7000010,2024-01-01,2024-01-01,,Listed Hub Game,https://www.imdb.com/title/tt7000010/,Video Game,7,0,2016,Action,10,2016-01-01,,,\n" },
    { name: "trakt-export.zip", zip: { "watched-movies.json": JSON.stringify([{ movie: { title: "Trakt Hub Film", year: 1995, ids: { imdb: "tt7000004", tmdb: 70004 } }, last_watched_at: "2024-03-01T20:00:00.000Z", plays: 1 }]),
      "ratings-movies.json": JSON.stringify([{ rated_at: "2024-03-01T20:00:00.000Z", rating: 9, type: "movie", movie: { title: "Trakt Hub Film", year: 1995, ids: { imdb: "tt7000004", tmdb: 70004 } } }]),
      "lists-watchlist.json": JSON.stringify([{ type: "movie", movie: { title: "Trakt Wanted Film", year: 2024, ids: { imdb: "tt7000005" } } }]) }, zipOther: [] },
    { name: "letterboxd-export.zip", zip: { "diary.csv": "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2024-01-02,Boxd Logged Film,1979,https://boxd.it/a1,4.5,,,2024-01-01\n",
      "watched.csv": "Date,Name,Year,Letterboxd URI\n2024-01-02,Boxd Logged Film,1979,https://boxd.it/a1\n", "ratings.csv": "Date,Name,Year,Letterboxd URI,Rating\n2024-01-02,Boxd Logged Film,1979,https://boxd.it/a1,4.5\n",
      "watchlist.csv": "Date,Name,Year,Letterboxd URI\n2026-01-01,Boxd Wanted Film,2024,https://boxd.it/d\n" }, zipOther: [] },
    { name: "animelist.xml", text: `<?xml version="1.0"?><myanimelist><myinfo><user_name>x</user_name></myinfo><anime><series_title>Mal Hub Film</series_title><series_type>Movie</series_type><my_watched_episodes>1</my_watched_episodes><my_finish_date>2019-08-08</my_finish_date><my_score>10</my_score><my_status>Completed</my_status><my_times_watched>1</my_times_watched></anime><anime><series_title>Mal Planned Show</series_title><series_type>TV</series_type><series_episodes>12</series_episodes><my_watched_episodes>0</my_watched_episodes><my_score>0</my_score><my_status>Plan to Watch</my_status></anime><manga><manga_title>Mal Hub Manga</manga_title><my_status>Reading</my_status><my_score>10</my_score></manga></myanimelist>` },
    { name: "simkl_export.csv", text: "SIMKL_ID,Title,Type,Year,Watchlist,LastEpWatched,WatchedDate,Rating,IMDB\n2,Simkl Planned Film,movie,2016,plantowatch,,,,tt7000006\n3,Simkl Seen Film,movie,2015,completed,,2025-05-13,8,tt7000007\n" },
    { name: "NetflixViewingHistory.csv", text: "Title,Date\nNetflix Hub Film,1/2/24\nNetflix Hub Show: Season 1: Pilot,1/3/24\n" },
    { name: "my sheet.csv", text: "Title,Year,Rating\nSheet Rated Film,2003,7\nSheet Plain Film,2004,\n" },
    { name: "tvtime.zip", zip: { "seen_episode.csv": "tv_show_name,episode_season_number,episode_number,updated_at\nTvTime Hub Show,1,1,2023-07-01 20:00:00\n", "user.csv": "id\n1\n" }, zipOther: [] },
    { name: "goodreads_library_export.csv", text: "Book Id,Title,Author,ISBN13,My Rating,Exclusive Shelf,Date Read\n1,Goodreads Hub Book,Some Author,=\"9780000000001\",5,read,2020/01/02\n2,Goodreads Wanted Book,Some Author,,0,to-read,\n" },
    { name: "games.xml", text: '<?xml version="1.0"?><gamesList><steamID64>1</steamID64><games><game><appID>7000011</appID><name><![CDATA[Steam Hub Game]]></name><hoursOnRecord>6.2</hoursOnRecord></game></games></gamesList>' },
    { name: "HLTB_games.csv", text: "Title,Platform,Playing,Backlog,Replay,Custom,Completed,Retired,Review,Completion Date\nHltb Hub Game,PC,0,0,0,0,1,0,90,2021-03-04\n" },
    { name: "grouvee.csv", text: 'id,name,shelves,platforms,rating,review,dates,release_date\n1,Grouvee Hub Game,"{""Played"": {}}","{""PC"": {}}",5,,"[{""date_finished"": ""2020-02-02""}]",2018-01-25\n' },
    { name: "backloggd.csv", text: "Game,Platform,Status,Rating\nBackloggd Hub Game,PC,Completed,5\nBackloggd Wanted Game,PS5,Wishlist,\n" },
  ];
  await A(() => { __app.db.set("feat_games", "1"); __app.db.set("feat_books", "1"); });
  await A(f => { window.__nextPick = f; }, files);
  await A(() => (__app.ui.setGroup = "*", __app.go("settings")));
  await pg.click('[data-action="hubpick"]');
  await pg.waitForSelector("#dlgOk", { timeout: 20000 });
  const pv = await A(() => document.querySelector("#overlay .dialog").innerText);
  console.log(pv);
  const bad = files.filter(f => new RegExp(f.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[^\\n]*(couldn't|not a|no Title|failed|error|unknown|isn't)", "i").test(pv));
  ok(!bad.length, "every file is recognised in the check: " + bad.map(f => f.name).join(", "));
  await pg.click("#dlgOk");
  await pg.waitForFunction(() => !__app.ui.job && /ratings\.csv/.test(__app.db.get("hub_last") || ""), null, { timeout: 60000 });
  await pg.waitForTimeout(500);
  const r = await A(() => {
    const L = t => __app.lib.all().find(x => x.title === t), G = t => __app.games.games.find(g => g.title === t), B = t => __app.books.books.find(b => b.title === t);
    const s = x => x ? x.status + (x.rating ? "/" + x.rating : "") : "missing";
    return { lib: Object.fromEntries(["Rated Hub Film", "Wanted Hub Film", "Listed Hub Film", "Trakt Hub Film", "Trakt Wanted Film", "Boxd Logged Film", "Boxd Wanted Film", "Mal Hub Film", "Mal Planned Show",
        "Simkl Planned Film", "Simkl Seen Film", "Netflix Hub Film", "Netflix Hub Show", "Sheet Rated Film", "Sheet Plain Film", "TvTime Hub Show"].map(t => [t, s(L(t))])),
      games: Object.fromEntries(["Rated Hub Game", "Listed Hub Game", "Steam Hub Game", "Hltb Hub Game", "Grouvee Hub Game", "Backloggd Hub Game", "Backloggd Wanted Game"].map(t => [t, s(G(t))])),
      books: Object.fromEntries(["Goodreads Hub Book", "Goodreads Wanted Book", "Mal Hub Manga"].map(t => [t, s(B(t))])), last: __app.db.get("hub_last") };
  });
  console.log(JSON.stringify(r, null, 1));
  const want = { lib: { "Rated Hub Film": "watched/8", "Wanted Hub Film": "watchlist", "Listed Hub Film": "watchlist", "Trakt Hub Film": "watched/9", "Trakt Wanted Film": "watchlist", "Boxd Logged Film": "watched/9",
      "Boxd Wanted Film": "watchlist", "Mal Hub Film": "watched/10", "Mal Planned Show": "watchlist", "Simkl Planned Film": "watchlist", "Simkl Seen Film": "watched/8", "Netflix Hub Film": "watched", "Netflix Hub Show": "watching",
      "Sheet Rated Film": "watched/7", "Sheet Plain Film": "watchlist", "TvTime Hub Show": "watching" },
    games: { "Rated Hub Game": "done/7", "Listed Hub Game": "wishlist", "Steam Hub Game": "backlog", "Hltb Hub Game": "done/9", "Grouvee Hub Game": "done/10", "Backloggd Hub Game": "done/10", "Backloggd Wanted Game": "wishlist" },
    books: { "Goodreads Hub Book": "read/10", "Goodreads Wanted Book": "want", "Mal Hub Manga": "reading/10" } };
  const miss = [];
  for (const sec of ["lib", "games", "books"]) for (const [t, w] of Object.entries(want[sec])) if (r[sec][t] !== w) miss.push(`${t}: ${r[sec][t]} (expected ${w})`);
  ok(!miss.length, "every import lands where it should:\n  " + miss.join("\n  "));
  ok(!errors.length, "no page errors: " + errors.join(" | "));
  console.log("ALL IMPORTS TEST PASSED");
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
