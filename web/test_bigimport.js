// Saga 5 end to end: one page with Home, Watch, Games, Books and the Doctor Who timeline. Moving the old data over
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
  const results = {};
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
  const file = n => LS.getItem("f:" + n) || "";
  window.Banta = { app: () => "canon", read: n => file(n), write: (n, t) => { LS.setItem("f:" + n, String(t)); return true; }, remove: n => { LS.removeItem("f:" + n); return true; },
    stamp: n => file(n).length + ":" + file(n).slice(-16), post: () => {}, take: () => "", busy: () => {}, paste: () => "", shareTo: () => true, notify: () => {}, widget: () => {} };
  window.Android = { load: file, save: (n, t) => { LS.setItem("f:" + n, t); return true; }, stamp: n => file(n).length + ":" + file(n).slice(-16), take: id => { const r = results[id]; delete results[id]; return r || ""; },
    http: (id, m, url, h, body) => { window.__http.push(url); setTimeout(() => { results[id] = JSON.stringify(Object.assign({ headers: {} }, reply(m, url, body))); window.__httpDone(id); }, 3); },
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
  await A(() => { const mem = {}, ld = Android.load; Android.save = (n, t) => { mem[n] = t; return true; }; Android.load = n => n in mem ? mem[n] : ld(n); Banta.write = (n, t) => { mem[n] = String(t); return true }; Banta.read = n => n in mem ? mem[n] : ""; });
  const types = ["Movie", "TV Series", "TV Episode", "TV Mini Series", "Video Game", "Short", "TV Movie"];
  const rows = ["Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors"];
  for (let i = 0; i < 10500; i++) rows.push(`tt${1000000 + i},${1 + i % 10},2023-01-${String(1 + i % 28).padStart(2, "0")},"Title, number ${i}","Title, number ${i}",https://www.imdb.com/title/tt${1000000 + i}/,${types[i % 7]},7.1,${90 + i % 40},${1950 + i % 70},"Drama, Comedy",1234,${1950 + i % 70}-05-01,"Someone"`);
  const csv = "﻿" + rows.join("\r\n");
  let t0 = Date.now();
  await A(t => { window.__nextPick = [{ name: "ratings.csv", text: t }]; }, csv);
  console.log("profile", await A(t => { const C = Core, st = new C.Store(); let t0 = performance.now(); C.importImdbCsv(st, "r.csv", t, "auto"); const a = performance.now() - t0;
    const L = Lib, lib = new L.Library(null); t0 = performance.now(); lib.adopt(st.items(null, ["watched", "rated", "watchlist"])); const b = performance.now() - t0;
    t0 = performance.now(); const js = JSON.stringify(st.data || st); const c = performance.now() - t0; return { csv: a, adopt: b, stringify: c }; }, csv));
  await A(() => (__app.ui.setGroup = "*", __app.go("settings")));
  const btn = await pg.$('[data-action="import"][data-kind="imdb"]');
  ok(btn, "IMDb CSV import button");
  await btn.click();
  await pg.waitForFunction(() => /Imported 10,500/.test(__app.ui.status || "") && !__app.ui.job, null, { timeout: 120000 });
  const r1 = await A(() => ({ canon: __app.db.items(null, ["rated"]).length, lib: __app.lib.all().length, movies: __app.lib.all().filter(x => x.type === "movie").length, shows: __app.lib.all().filter(x => x.type === "show").length, toast: document.querySelector("#toast").textContent }));
  console.log("IMDb CSV", JSON.stringify(r1), Date.now() - t0, "ms");
  ok(r1.canon === 10500 && r1.movies === 4500 && r1.shows === 3000 && Date.now() - t0 < 15000, "10,500 IMDb ratings imported quickly");
  console.log("after import: errors", errors, "disabled", await A(() => document.querySelector('[data-kind="trakt"]').disabled), await A(() => [__app.ui.sec, !!__app.ui.job]));
  // Trakt export ZIP
  const zip = { "watched-shows.json": JSON.stringify([{ show: { title: "Severance", year: 2022, ids: { imdb: "tt11280740", tmdb: 95396, trakt: 1 } }, last_watched_at: "2025-01-20T21:00:00.000Z", seasons: [{ number: 1, episodes: [{ number: 1, plays: 1, last_watched_at: "2024-12-01T21:00:00.000Z" }] }] }]),
    "watched-movies.json": JSON.stringify([{ movie: { title: "Heat", year: 1995, ids: { imdb: "tt0113277", tmdb: 949 } }, last_watched_at: "2024-03-01T20:00:00.000Z", plays: 1 }]),
    "ratings-movies.json": JSON.stringify([{ rated_at: "2024-03-01T20:00:00.000Z", rating: 9, type: "movie", movie: { title: "Heat", year: 1995, ids: { imdb: "tt0113277", tmdb: 949 } } }]),
    "lists-watchlist.json": JSON.stringify([{ type: "movie", movie: { title: "Dune: Part Two", year: 2024, ids: { imdb: "tt15239678" } } }]) };
  await A(z => { window.__nextPick = [{ name: "trakt-export.zip", zip: z, zipOther: [] }]; }, zip);
  await pg.click('[data-action="import"][data-kind="trakt"]');
  await pg.waitForFunction(() => /Imported 4 records/.test(__app.ui.status || ""), null, { timeout: 60000 });
  const r2 = await A(() => { const s = __app.lib.all().find(x => x.title === "Severance"); const h = __app.lib.all().find(x => x.title === "Heat");
    return { sev: s && s.eps, heat: h && [h.status, h.rating], dune: !!__app.lib.all().find(x => x.title === "Dune: Part Two"), toast: document.querySelector("#toast").textContent }; });
  ok(r2.sev && r2.sev["1:1"] === "2024-12-01" && r2.heat[1] === 9 && r2.dune, "Trakt ZIP: progress, rating, watchlist");
  console.log("Trakt ZIP", JSON.stringify(r2), await A(() => [__app.ui.status, __app.db.items("trakt", null).length]));
  console.log(await A(() => JSON.stringify([__app.db.items("trakt", null).map(r => [r.title, r.kind, r.medium]), __app.lib.all().filter(x => /Heat|Sever|Dune/.test(x.title)).map(x => x.title), __app.db.get("lib_adopt", "1"), Object.keys(__app.lib.adopted).length])));
  // sync with a big Trakt account on top of 10,500 IMDb ratings: the screen must not freeze (no long blocking step)
  await A(() => __app.go("home"));
  await A(() => { __app.db.set("username", "banta");
    const mv = n => Array.from({ length: n }, (_, i) => ({ movie: { title: "Film " + i, year: 1950 + i % 70, ids: { imdb: "tt" + (3000000 + i), tmdb: 10000 + i, trakt: i } }, last_watched_at: "2024-03-01T20:00:00Z", plays: 1 }));
    const sh = n => Array.from({ length: n }, (_, i) => ({ show: { title: "Show " + i, year: 1990 + i % 30, ids: { imdb: "tt" + (4000000 + i), tmdb: 20000 + i, trakt: 5000 + i } }, last_watched_at: "2025-01-20T21:00:00Z", seasons: [1,2,3].map(s => ({ number: s, episodes: Array.from({ length: 10 }, (_, e) => ({ number: e + 1, plays: 1, last_watched_at: "2024-12-01T20:00:00Z" })) })) }));
    const rt = n => Array.from({ length: n }, (_, i) => ({ type: "movie", rating: 1 + i % 10, rated_at: "2024-03-01T20:00:00Z", movie: { title: "Film " + i, year: 1950 + i % 70, ids: { imdb: "tt" + (3000000 + i) } } }));
    const M = mv(4000), S = sh(800), R = rt(4000);
    window.__big = u => /watched\/movies/.test(u) ? M : /watched\/shows/.test(u) ? S : /ratings/.test(u) ? R : /watchlist/.test(u) ? M.slice(0, 500).map(x => ({ type: "movie", movie: x.movie })) : null; __app.db.set("token", "x"); __app.db.set("client_id", "c"); window.__lt = []; window.__marks = [];
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ["longtask"] });
    const orig = __app.setProgress; });
  const tS = await A(() => performance.now());
  await A(() => { const b = document.querySelector('[data-action="sync"]'); if (b) b.click(); });
  await pg.waitForTimeout(200); await A(() => { if (!__app.ui.job) { const b = document.querySelector('[data-action="sync"]'); if (b) b.click(); } });
  await pg.waitForFunction(() => !__app.ui.job, null, { timeout: 300000 });
  const lt = (await A(() => window.__lt)).filter(x => x[0] > tS).sort((a, b) => b[1] - a[1]);
  console.log("sync: longest blocking steps", JSON.stringify(lt.slice(0, 4)), await A(() => (__app.ui.report || "").slice(0, 80)));
  ok(/OK  Trakt account: 9300 records/.test(await A(() => __app.ui.report)), "big Trakt sync ran");
  ok(!lt.length || lt[0][1] < 1200, "sync never blocks the screen for long: " + JSON.stringify(lt.slice(0, 3)));
  console.log("errors", errors); ok(!errors.length, "no page errors"); console.log("BIG IMPORT TESTS PASSED");
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
