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
    if (/^https:\/\/saga\.test\//.test(url) && window.__webSrv) return window.__webSrv(m, url, body);
    if (/api\.isthereanydeal\.com\/lookup\/id\/title\/v1/.test(url)) { const t = JSON.parse(body); return J(Object.fromEntries(t.map(x => [x, x === "Itad Deal Game" ? "itad-1" : null]))); }
    if (/api\.isthereanydeal\.com\/lookup\/id\/shop\/61\/v1/.test(url)) return J(Object.fromEntries(JSON.parse(body).map(x => [x, null])));
    if (/api\.isthereanydeal\.com\/games\/overview\/v2/.test(url)) return J({ prices: JSON.parse(body).filter(id => id === "itad-1").map(id => ({ id, current: { shop: { id: 1, name: "GOG" }, price: { amount: 5, currency: "EUR" }, regular: { amount: 20, currency: "EUR" }, cut: 75, url: "https://itad.example/g" }, lowest: { shop: { id: 1, name: "GOG" }, price: { amount: 5, currency: "EUR" }, timestamp: "2026-11-16T00:00:00Z" }, bundled: 0 })), bundles: [] });
    if (/api\.isthereanydeal\.com\/games\/subs\/v1/.test(url)) return J(JSON.parse(body).map(id => ({ id, subs: id === "itad-1" ? [{ id: 1, name: "PC Game Pass", leaving: null }] : [] })));
    if (/isthereanydeal\.com\/oauth\/token\//.test(url)) return /code=good/.test(body) && /code_verifier=v{48}/.test(body) ? J({ access_token: "tok1", refresh_token: "r1", expires_in: 3600 }) : { status: 400, body: '{"error":"invalid_grant"}' };
    if (/api\.isthereanydeal\.com\/waitlist\/games\/v1/.test(url)) return m === "GET" ? J([]) : { status: 204, body: "" };
    if (/api\.isthereanydeal\.com\/collection\/games\/v1/.test(url)) return { status: 204, body: "" };
    if (/raw\.githubusercontent\.com\/Banta02112000\/Saga\/main\/web\/app\.js/.test(url)) return { status: 200, body: 'const VERSION = "9.9.9";' };
    if (/themoviedb\.org\/3\/movie\/949\/recommendations/.test(url)) return J({ results: [{ id: 500, title: "Suggested Film", release_date: "2010-01-01", vote_average: 7.5, vote_count: 400, genre_ids: [80], poster_path: "/s.jpg" }] });
    if (/themoviedb\.org\/3\/movie\/949(\?|$)/.test(url)) return J({ id: 949, title: "Heat", release_date: "1995-12-15", credits: { crew: [{ job: "Director", name: "Ann Director" }], cast: [{ name: "Al Actor" }] }, external_ids: { imdb_id: "tt0113277" } });
    if (/themoviedb\.org\/3\/search\/person/.test(url)) return J({ results: [{ id: 7, name: "Ann Director", popularity: 9, known_for_department: "Directing" }] });
    if (/themoviedb\.org\/3\/person\/7\/combined_credits/.test(url)) return J({ cast: [], crew: [{ id: 949, media_type: "movie", title: "Heat", release_date: "1995-12-15", job: "Director", vote_count: 9 }, { id: 5, media_type: "movie", title: "Thief", release_date: "1981-03-27", job: "Director", vote_count: 3 }] });
    if (/themoviedb\.org\/3\/(movie|tv)\/\d+\/images/.test(url)) return J({ posters: [{ file_path: "/p1.jpg", vote_average: 7 }, { file_path: "/p2.jpg", vote_average: 5 }] });
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
    setBackground: () => true, requestNotifications: () => {}, isBackground: () => false, sha256url: s => s, randomUrl: n => "v".repeat(n), version: () => "5.0", openInApp: () => {},
    // stands in for the Keystore-encrypted secrets.json
    secretsLoad: () => LS.getItem("secrets") || "", secretsSave: t => { LS.setItem("secrets", t); return true; } };
};
const ok = (c, m) => { if (!c) throw new Error(m); };

(async () => {
  const OLD_GAMES = [{ t: "Hades", od: "September 17, 2020", op: "PC", rn: "N/A", rd: "N/A", rp: "N/A", ow: "Steam", h: "22", hb: "N/A", r: "8.6", f: "Hades", m: "Hades", n: 0 },
    { t: "Outer Wilds", od: "May 28, 2019", op: "PC", rn: "N/A", rd: "N/A", rp: "N/A", ow: "N/A", h: "17", hb: "N/A", r: "8.9", f: "Outer Wilds", m: "Outer Wilds", n: 1 },
    { t: "Mass Effect", od: "November 20, 2007", op: "X360", rn: "Mass Effect Legendary Edition", rd: "May 14, 2021", rp: "PC", ow: "PC", h: "17", hb: "N/A", r: "8.3", f: "Mass Effect", m: "Mass Effect", n: 0 }];
  const seed = {
    ls: { gc_base: JSON.stringify(OLD_GAMES), gc_done: JSON.stringify({ "Hades|September 17, 2020": Date.parse("2021-02-02") }), gc_ov: JSON.stringify({ "Hades|September 17, 2020": { plays: ["2021-02-02", "2023-06-06"] } }), gc_acm: JSON.stringify({ "Hades|September 17, 2020": { ir: 10 } }), gc_mine: "1" },
    files: { "canonsync.json": JSON.stringify({ v: 1, settings: { auto_sync: "0", preset_v1: "1", bg_enabled: "0", notif_asked: "1", username: "banta", client_id: "cid", imdb_user: "ur1", token: "tok" }, items: [] }),
      "snap_dw.json": JSON.stringify({ app: "dwcanon", v: 1, state: { works: { "thethreepaths|short|@t1": { done: true, rating: 4 }, "reportontermswork|short|": { done: true, rating: 7 } } } }),
      "books.json": JSON.stringify({ app: "books", v: 1, books: [{ id: "b1", title: "Dune", authors: ["Frank Herbert"], status: "read", finished: Date.parse("2026-03-03"), started: Date.parse("2026-02-01"), pages: 600, rating: 9 }], goal: { year: 2026, n: 20 } }),
      "features.json": JSON.stringify({ dw: 1 }) },
  };
  const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"] }) // no outside network: the same result on any machine;
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(mock, seed);
  const errors = [];
  const pg = await ctx.newPage();
  pg.on("pageerror", e => errors.push(String(e))); pg.on("dialog", d => d.dismiss());
  // 0.5.4.4: the page runs under a Content-Security-Policy; anything it blocks is a bug
  pg.on("console", m => { if (/Content Security Policy|Refused to/i.test(m.text())) errors.push("CSP: " + m.text().slice(0, 200)); });
  await pg.goto(BASE() + "/index.html");
  await pg.waitForFunction(() => window.__app && window.__app.db.get("saga5_migrated"), null, { timeout: 8000 });
  const A = (f, arg) => pg.evaluate(f, arg);
  // ---- migration
  const mig = await A(() => ({ games: __app.games.games.map(g => [g.title, g.status, g.plays.length, g.rating, g.next, !!g.remake]), books: __app.books.books.length, dw: JSON.parse(localStorage.getItem("f:dw.json")).works }));
  ok(mig.games.length === 3, "3 games moved over: " + JSON.stringify(mig));
  ok(JSON.stringify(mig.games.find(g => g[0] === "Hades")) === JSON.stringify(["Hades", "done", 2, 10, false, false]), "Hades: finished twice, rated 10: " + JSON.stringify(mig.games));
  ok(mig.games.find(g => g[0] === "Outer Wilds")[4] === true && mig.games.find(g => g[0] === "Mass Effect")[5] === true, "next mark and remake kept");
  ok(mig.books === 1 && mig.dw["thethreepaths|short|@t1"].rating === 4, "books stay, DW marks moved");
  await pg.screenshot({ path: `${OUT}/s-home-start.png`, fullPage: true });

  await A(() => { Core.CONFIG.retryDelayMs = 20; Core.CONFIG.imdbGapMs = 0; });
  // ---- sync: Trakt OK, IMDb unreachable → FAIL, nothing hangs, library gets episodes with dates, Trakt push works
  await pg.click("#syncTop");
  await pg.waitForFunction(() => !__app.ui.job && __app.db.get("stage_report"), null, { timeout: 30000 });
  const rep = await A(() => __app.ui.report + "\n" + __app.db.get("stage_report"));
  ok(/OK  Trakt account/.test(rep) && /FAIL IMDb ratings: couldn't reach IMDb/.test(rep), "report: " + rep);
  ok(/OK   Library/.test(rep) && /OK   Episodes/.test(rep) && /OK   Games/.test(rep), "later steps ran: " + rep);
  const sev = await A(() => { const it = __app.lib.all().find(x => x.title === "Severance"); return it && { eps: it.eps, n: __app.lib.nextEp(it), epl: (it.epl || []).length }; });
  ok(sev && sev.eps["1:1"] === "2024-12-01" && sev.eps["1:2"] === "2024-12-02" && sev.n.e === 3 && sev.epl === 4, "Trakt episodes with their dates, next is E3: " + JSON.stringify(sev));
  ok(await A(() => /Sync/.test(document.querySelector("#title").textContent) && document.querySelectorAll(".srcrow .st.fail").length >= 1 && document.querySelectorAll(".srcrow .st.ok").length >= 1), "Sync screen shows OK and failed sources");
  await pg.screenshot({ path: `${OUT}/s-sync.png`, fullPage: true }); console.log("BG", await A(() => [...document.querySelectorAll("#view > section")].map(s => getComputedStyle(s).backgroundColor + " " + s.className).join(" / ")));
  await pg.click('[data-action="copydiag"]');
  ok(await A(() => /Saga .* sync report/.test(window.__copied) && /trakt\.tv/.test(window.__copied) && !/tok\b/.test(window.__copied.replace(/token=…/g, ""))), "report and log copied");

  // ---- artwork from IMDb for titles that came without it; watchlist hides what's finished; "Streaming for me" works
  await pg.waitForFunction(() => __app.lib.all().some(x => /media-amazon/.test(x.poster || "")), null, { timeout: 8000 });
  ok(await A(() => /_V1_UX\d+_\.jpg$/.test(__app.lib.all().find(x => /media-amazon/.test(x.poster)).poster)), "IMDb poster, resized");
  await A(() => { const L = __app.lib; const d = L.add({ type: "movie", title: "Heat", year: 1995, imdb: "tt0113277" }, "watchlist").item; __app.go("library"); __app.ui.libF = "watchlist"; __app.render(); });
  ok(!(await pg.textContent("#view")).includes("Heat") || await A(() => __app.lib.all().find(x => x.title === "Heat").status === "watched"), "watched film not on the watchlist");
  await A(() => { __app.ui.libF = "services"; __app.render(); });
  ok(!errors.length, "Streaming for me: " + errors.join(" "));
  await A(() => { __app.ui.libF = null; });
  // ---- Home
  await pg.click('nav#tabs [data-sec="home"]');
  const home = await pg.textContent("#view"); console.log("HOME:", home.replace(/\s+/g, " ").slice(0, 600));
  ok(/Next episode/.test(home) && /Severance/.test(home) && /What next/.test(home) && /Recently watched/.test(home), "Home: hero, continue, recent");
  ok(/Outer Wilds/.test(home) && /Dune/.test(home), "Home mixes games and books");
  await pg.screenshot({ path: `${OUT}/s-home.png`, fullPage: true });
  // tick the next episode from the hero → queued for Trakt
  await pg.click('.hero2 [data-action="libnext"]');
  ok(await A(() => __app.lib.outbox.some(e => e.op === "ep" && e.e === 3)), "ticked episode queued for Trakt");

  // ---- Watch › Library poster grid, search, film watched twice
  await A(() => { __app.ui.libF = "all"; }); // the default filter is "watching" when a series is in progress: only one poster there
  await pg.click('nav#tabs [data-sec="watch"]');
  ok(await pg.waitForFunction(() => document.querySelectorAll("#view .grid .poster").length >= 2, null, { timeout: 8000 }).then(() => true, () => false), "library posters: " + await A(() => JSON.stringify({ tab: __app.ui.tab, sec: __app.ui.sec, f: __app.ui.libF, n: __app.lib.all().length, html: (document.querySelector("#view") || {}).innerHTML.slice(0, 900) })));
  await pg.fill('[data-input="libQ"]', "Alien"); await pg.press('[data-input="libQ"]', "Enter");
  await pg.waitForFunction(() => document.querySelectorAll('[data-action="libpeek"]').length);
  await pg.click('[data-action="libpeek"]');
  await pg.click('[data-action="libaddas"][data-v="watched"]');
  await pg.fill("#libDate", "2021-10-31"); await pg.click('[data-action="libwatch"]');
  ok(/Watch 2/.test(await pg.textContent(".sheet")), "film watched twice");
  // 0.6.9.9: length and cast under the title
  await A(() => { const it = __app.lib.get(__app.ui.libOpen); it.runtime = 117; it.cast = [["Ann Example", "Captain"], ["Bo Example", ""]]; it.dir = ["Cy Example"]; it.castAt = Date.now(); __app.openLib(it.id); });
  { const t = await pg.textContent(".sheet"); ok(/1 h 57 min/.test(t) && /Directed by Cy Example/.test(t) && /With Ann Example as Captain, Bo Example/.test(t), "film: length and cast shown"); }
  await A(() => { const sh = document.querySelector("#overlay .sheet"); if (sh) sh.scrollTop = 0; }); await pg.waitForTimeout(250); await pg.screenshot({ path: `${OUT}/s-film-top.png` });
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: `${OUT}/s-film.png` });
  await pg.click('.sheet [data-action="librate"][data-v="4"]');
  await A(() => __app.ui.libRes = null); await pg.click("#overlay .scrim", { position: { x: 5, y: 5 } }).catch(() => {});
  await A(() => { document.querySelector("#overlay").innerHTML = ""; __app.render(); });
  await pg.screenshot({ path: `${OUT}/s-library.png`, fullPage: true });

  // ---- Games: grid, open, playthrough, add from Steam
  await pg.click('nav#tabs [data-sec="games"]');
  ok(await A(() => document.body.dataset.sec === "games" && document.querySelectorAll("#view .poster").length >= 3), "games grid");
  await pg.selectOption("[data-gsort]", "remake");
  ok(await A(() => /Remake 2021/.test(document.querySelector("#view .grid").textContent)), "sort by remake release");
  await pg.selectOption("[data-gsort]", "release");
  await pg.screenshot({ path: `${OUT}/s-games.png`, fullPage: true });
  await A(() => Kit.mods.games.open(__app.games.games.find(g => g.title === "Outer Wilds").id));
  await pg.fill("#gDate", "2026-01-05"); await pg.click('[data-action="gplay"]');
  ok(await A(() => { const g = __app.games.games.find(g => g.title === "Outer Wilds"); return g.status === "done" && g.plays[0] === "2026-01-05"; }), "playthrough logged");
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: `${OUT}/s-game.png` });
  await A(() => { document.querySelector("#overlay").innerHTML = ""; });
  await A(() => __app.games.remove(__app.games.games.find(g => g.title === "Hades").id));
  await pg.click('[data-action="gadd"]');
  await pg.fill("[data-gsq]", "Hades"); await pg.press("[data-gsq]", "Enter");
  await pg.waitForFunction(() => document.querySelectorAll('[data-action="gpeek"]').length);
  await pg.click('[data-action="gpeek"]'); await pg.click('[data-action="gaddas"][data-v="playing"]');
  await pg.waitForFunction(() => { const g = __app.games.games.find(g => g.title === "Hades"); return g && g.steam === 1145360 && g.date === "2020-09-17"; }, null, { timeout: 5000 });

  // ---- Books: shelf, author page
  await A(() => { document.querySelector("#overlay").innerHTML = ""; });
  await pg.click('nav#tabs [data-sec="books"]');
  await A(() => Kit.mods.books.open("b1"));
  await pg.click('.sheet [data-action="bauthor"]');
  await pg.waitForFunction(() => /Dune Messiah/.test(document.querySelector(".sheet").textContent));
  await pg.click('[data-action="bworkadd"]');
  ok(await A(() => __app.books.books.some(b => b.title === "Dune Messiah" && b.status === "want")), "author's book added");
  await A(() => { document.querySelector("#overlay").innerHTML = ""; __app.render(); });
  await pg.screenshot({ path: `${OUT}/s-books.png`, fullPage: true });

  // ---- Anime: its own tab, MyAnimeList search, episodes; not in Library
  await A(() => __app.go("anime"));
  await pg.fill('[data-input="libQ"]', "Frieren"); await pg.press('[data-input="libQ"]', "Enter");
  await pg.waitForFunction(() => document.querySelectorAll('[data-action="libpeek"]').length);
  await pg.click('[data-action="libpeek"]'); await pg.click('[data-action="libaddas"][data-v="watching"]');
  await pg.waitForFunction(() => { const it = __app.lib.all().find(x => x.mal === 52991); return it && it.anime && (it.epl || []).length === 3; }, null, { timeout: 6000 });
  await A(() => { document.querySelector("#overlay").innerHTML = ""; __app.ui.libRes = null; __app.render(); });
  ok(/Frieren/.test(await pg.textContent("#view")), "anime in the Anime tab");
  await pg.screenshot({ path: `${OUT}/s-anime.png` });
  await A(() => __app.go("library"));
  ok(!/Frieren/.test(await pg.textContent("#view")), "anime not in Library");
  // ---- Manga in Books: search, add, chapters
  await A(() => { __app.go("books"); Kit.mods.books.ui.view = "manga"; __app.render(); });
  await pg.fill("[data-bsq]", "Berserk"); await pg.press("[data-bsq]", "Enter");
  await pg.waitForFunction(() => document.querySelectorAll('[data-action="bpeek"]').length);
  await pg.click('[data-action="bpeek"]'); await pg.click('[data-action="baddas"][data-v="reading"]');
  await pg.click('[data-action="bch"]');
  ok(await A(() => { const b = __app.books.books.find(x => x.title === "Berserk"); return b && b.manga && b.chapter === 1 && b.chapters === 380 && b.authors[0] === "Kentarou Miura"; }), "manga with chapters");
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: `${OUT}/s-manga-sheet.png` });
  await A(() => { document.querySelector("#overlay").innerHTML = ""; Kit.mods.books.ui.res = null; Kit.mods.books.ui.mangaSearch = false; __app.render(); });
  ok(/Berserk/.test(await pg.textContent("#view")), "manga in the Manga tab");
  await A(() => { Kit.mods.books.ui.view = "shelf"; __app.render(); });
  ok(!/Berserk/.test(await pg.textContent("#view")), "manga not on the book shelf");
  // ---- a picture that fails moves on to the next source
  const bro = await A(() => { const it = __app.lib.all().find(x => x.poster) || (() => { const x = __app.lib.all()[0]; x.poster = "https://m.media-amazon.com/images/M/z._V1_UX400_.jpg"; return x; })(); window.__imgBroken("lib:" + it.id, it.poster); return it.id; });
  ok(await A(id => { const st = __app.imgState()["lib:" + id]; return !__app.lib.get(id).poster && st.skip.includes("imdbId"); }, bro), "broken picture: cleared, next source next time");
  // ---- live sync: the episode ticked on Home went to Trakt by itself
  await pg.waitForFunction(() => (window.__pushed || []).some(b => JSON.stringify(b).includes('"number":3')), null, { timeout: 15000 });
  ok(await A(() => !__app.lib.outbox.length), "outbox emptied by live sync");
  await A(() => __app.go("sync"));
  ok(/Live sync with Trakt/.test(await pg.textContent("#view")) && /within seconds/.test(await pg.textContent("#view")), "live sync shown");
  await pg.click('[data-action="nettest"]');
  await pg.waitForFunction(() => /reachable|blocked:/.test(document.querySelector("#view").textContent), null, { timeout: 20000 });
  ok(/Trakt/.test(await pg.textContent("#view")) && /Wikipedia/.test(await pg.textContent("#view")), "connection test lists the sources");
  ok(await A(() => { __app.db.set("imdb_eps", JSON.stringify({ tt7777777: { t: "Rated Episodes Show", y: 2020, eps: { "1:1": "2021-03-04", "1:2": 1 } } })); __app.libAdopt();
    const it = __app.lib.all().find(x => x.imdb === "tt7777777"); return it && it.status === "watching" && it.eps["1:1"] === "2021-03-04" && !!it.eps["1:2"]; }), "episodes rated on IMDb tick the series");
  { const wf = await A(() => __app.widgetFiles());
    ok(Object.keys(wf).length === 7 && wf["widget_style.txt"] === "alpha=95\nlook=dark\nsize=14\n" && /^Next episodes/.test(wf["widget_episodes.txt"]) && /\n@@✓ .+\t\{"op":"ep"/.test(wf["widget_episodes.txt"]) && /so far\n@@\n/.test(wf["widget_year.txt"]) && /^Reading/.test(wf["widget_books.txt"]), "six widget files: " + JSON.stringify(wf).slice(0, 600)); }
  // 5.4: undo, tags, calendar file, picks, error log
  { const r = await A(() => { const it = __app.lib.all().find(x => x.title === "Severance"); const before = JSON.stringify(it.eps);
      __app.go("home"); const b = document.querySelector('[data-action="libnext"]'); b.click();
      const mid = Object.keys(__app.lib.all().find(x => x.title === "Severance").eps).length, hasUndo = !!document.querySelector('#toast [data-action="undo"]');
      document.querySelector('#toast [data-action="undo"]').click();
      return { mid, hasUndo, same: JSON.stringify(__app.lib.all().find(x => x.title === "Severance").eps) === before, n: Object.keys(JSON.parse(before)).length }; });
    ok(r.hasUndo && r.mid === r.n + 1 && r.same, "undo puts an episode tick back: " + JSON.stringify(r));
    const rm = await A(() => { const it = __app.lib.all().find(x => x.title === "Heat"); const id = it.id; __app.go("watch");
      const sheetOpen = document.createElement("button"); sheetOpen.dataset.action = "libopen"; sheetOpen.dataset.id = id; document.body.appendChild(sheetOpen); sheetOpen.click(); sheetOpen.remove();
      document.getElementById("libTag").value = "Heist nights"; document.querySelector('[data-action="libtagadd"]').click();
      const tagged = (__app.lib.get(id).tags || []).join();
      const b = document.querySelector('[data-action="libremove"]'); b.click(); document.querySelector('[data-action="libremove"]').click();
      const gone = !__app.lib.get(id); document.querySelector('#toast [data-action="undo"]').click();
      return { tagged, gone, back: !!__app.lib.get(id) && (__app.lib.get(id).tags || []).join() }; });
    ok(rm.tagged === "Heist nights" && rm.gone && rm.back === "Heist nights", "tag, remove, undo: " + JSON.stringify(rm));
    ok(await A(() => { __app.ui.libTag = "Heist nights"; __app.ui.libF = "watching"; __app.go("watch"); __app.render(); const t = document.querySelector("#view").textContent; __app.ui.libTag = ""; return /Heist nights/.test(t) && /Heat/.test(t); }), "a tag filters the library like a list");
    const ics = await A(() => { const it = __app.lib.all().find(x => x.title === "Severance"); const d = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10); it.epl.push([1, 9, d, "Finale; part, one"]); __app.db.set("spoiler_hide", "1"); const hidden = __app.icsText(); __app.db.set("spoiler_hide", "0"); const r = __app.icsText(); __app.db.set("spoiler_hide", "1"); r.hiddenOk = !/Finale/.test(hidden.text) && /SUMMARY:Severance S1 E9/.test(hidden.text); return r; });
    ok(ics.hiddenOk, "the calendar leaves unwatched episode names out when they're hidden (the default)");
    ok(ics.n >= 1 && /BEGIN:VCALENDAR\r\n/.test(ics.text) && /SUMMARY:Severance S1 E9\r\n/.test(ics.text) && /DESCRIPTION:Finale\\; part\\, one/.test(ics.text) && /DTSTART;VALUE=DATE:\d{8}\r\n/.test(ics.text), "calendar file: " + ics.text.slice(0, 300));
    const fy = await A(() => { const G = [["Crime", 9], ["Crime", 10], ["Crime", 9], ["Crime", 9], ["Romance", 3], ["Romance", 2], ["Romance", 4], ["Romance", 3]];
      G.forEach(([g, r], i) => { const it = __app.lib.add({ type: "movie", title: "Rated " + i, year: 1990 + i, genres: [g] }, "watched").item; it.rating = r; });
      __app.lib.add({ type: "movie", title: "Pick Crime", year: 2001, genres: ["Crime"] }, "watchlist"); __app.lib.add({ type: "movie", title: "Pick Romance", year: 2002, genres: ["Romance"] }, "watchlist");
      return __app.forYou().map(x => x.it.title); });
    ok(fy.includes("Pick Crime") && !fy.includes("Pick Romance"), "picks follow your genre ratings: " + fy);
    const pk = await A(() => { __app.lib.add({ type: "movie", title: "Short One", year: 2003, runtime: 88 }, "watchlist");
      const p = __app.picksToday(); __app.go("home"); __app.render(); return { p: p.map(x => x.t + "|" + x.why), home: /Picks for today/.test(document.querySelector("#view").textContent) }; });
    ok(pk.p.some(x => /^Pick Crime\|You rate Crime/.test(x)) && pk.p.some(x => x === "Short One|Short: 88 min") && pk.home, "picks for today with reasons: " + JSON.stringify(pk));
    const la = await A(() => { __app.db.set("ai_preset", "ollama"); __app.ui.setGroup = "*"; __app.go("settings"); __app.render(); const t = document.querySelector("#view").textContent;
      const r = { addr: /Server address/.test(t), find: !!document.querySelector('[data-action="aimodels"]'), key: !!document.querySelector('[data-setting="ai_key"]') }; __app.db.set("ai_preset", ""); return r; });
    ok(la.addr && la.find && !la.key, "local AI settings (Ollama: address and Find models, no key): " + JSON.stringify(la));
    ok(await A(() => { __app.logError("job", "Sync failed: test"); __app.ui.setGroup = "data"; __app.go("settings"); const t = document.querySelector("#view").textContent; return /Error log/.test(t) && /Sync failed: test/.test(t) && !!document.querySelector('[data-action="errcopy"]'); }), "error log shown in Settings");
    await A(() => { document.querySelector('[data-action="errcopy"]').click(); });
    ok(/Sync failed: test/.test(await A(() => window.__copied || "")), "error log copied"); }
  // audit fix: backup files leave keys and sign-ins out; a restore keeps the phone's own
  { const r = await A(() => { __app.db.set("gemini_key", "AIzaTEST"); __app.db.set("token", "tok123"); __app.db.set("imdb_user", "ur1");
      const b = JSON.parse(__app.bundle()); const st = JSON.parse(JSON.stringify(b.canon.settings));
      const withK = JSON.parse(__app.bundle(true)).canon.settings;
      __app.applyBackup(b); return { out: !("gemini_key" in st) && !("token" in st) && st.imdb_user === "ur1", inWith: withK.gemini_key === "AIzaTEST", kept: __app.db.get("gemini_key") === "AIzaTEST" && __app.db.get("token") === "tok123" }; });
    ok(r.out && r.inWith && r.kept, "backup secrets: " + JSON.stringify(r));
    const f = await A(() => { __app.db.flush(); return { file: /AIzaTEST|tok123/.test(localStorage.getItem("f:canonsync.json")), sec: /AIzaTEST/.test(localStorage.getItem("secrets") || "") }; });
    ok(!f.file && f.sec, "keys live in the encrypted store, not in canonsync.json: " + JSON.stringify(f)); }
  // 0.5.4.4: password-locked backups, and undo for a restore
  { const r = await A(async () => {
      const plain = __app.bundle(); const locked = await __app.sealBackup(plain, "pw1"); const j = JSON.parse(locked);
      const back = await __app.openBackup(j, "pw1"); let wrong = "";
      try { await __app.openBackup(j, "nope"); } catch (e) { wrong = e.message; }
      __app.db.set("backup_password", "pw1"); const out = await __app.bundleOut(); __app.db.set("backup_password", "");
      return { app: j.app, same: back === plain, noPlain: !/canonsync-all/.test(locked), wrong, outLocked: JSON.parse(out).app === "saga-locked" }; });
    ok(r.app === "saga-locked" && r.same && r.noPlain && /Wrong password/.test(r.wrong) && r.outLocked, "locked backups: " + JSON.stringify(r)); }
  { const before = await A(() => __app.lib.all().length);
    await A(() => { const b = JSON.parse(__app.bundle()); b.library = { items: {} }; __app.restoreFrom(JSON.stringify(b)); });
    await pg.click("#dlgOk");
    const after = await A(() => ({ n: __app.lib.all().length, undo: !!__app.db.get("restore_undo_at") }));
    await A(() => __app.undoRestore()); await pg.click("#dlgOk");
    const undone = await A(() => ({ n: __app.lib.all().length, undo: !!__app.db.get("restore_undo_at") }));
    ok(before > 0 && after.n === 0 && after.undo && undone.n === before && !undone.undo, `undo restore: ${before} → ${JSON.stringify(after)} → ${JSON.stringify(undone)}`); }
  // 0.5.4.2: themes, what's new, Doctor Who editing
  { const th = await A(() => { __app.ui.setGroup = "general"; __app.go("settings"); document.querySelector('[data-action="theme"][data-v="light"]').click();
      const sel = document.querySelector('[data-accent]'); sel.value = "teal"; sel.dispatchEvent(new Event("change", { bubbles: true }));
      const cs = getComputedStyle(document.body); return { theme: document.documentElement.dataset.theme, accent: document.documentElement.dataset.accent, bg: cs.getPropertyValue("--night").trim(), acc: cs.getPropertyValue("--accent").trim(), stored: localStorage.getItem("saga_theme") }; });
    ok(th.theme === "light" && th.bg === "#F5F2EC" && th.accent === "teal" && th.acc === "#0B8577" && th.stored === "light", "light theme and accent: " + JSON.stringify(th));
    await A(() => __app.go("home")); await pg.screenshot({ path: `${OUT}/s-light-home.png` });
    await A(() => { __app.setLook("saga_theme", ""); __app.setLook("saga_accent", ""); });
    const wn = await A(() => { __app.db.set("seen_version", "5.4"); __app.whatsNew(false); const t = document.querySelector("#overlay").textContent; window.Saga.close(); return { t: /What's new/.test(t) && /0\.5\.4\.2/.test(t) && /5\.4\.1/.test(t), seen: __app.db.get("seen_version") }; });
    ok(wn.t && wn.seen === "0.7.8", "what's new after an update: " + JSON.stringify(wn));
    ok(await A(() => { __app.whatsNew(false); return !document.querySelector("#overlay .whatsnew"); }), "what's new shows only once");
    const dw = await A(() => { const tl = Kit.mods.timeline; __app.go("timeline"); const k0 = document.querySelector('[data-action="tlopen"]').dataset.k;
      tl.openStory(k0); document.querySelector('#overlay [data-action="tladd"]').click();
      document.getElementById("tlNewTitle").value = "My Missing Audio"; document.querySelector('[data-action="tladdsave"]').click();
      const keys = [...document.querySelectorAll('[data-action="tlopen"]')].map(b => b.dataset.k), i = keys.indexOf(k0);
      const added = document.querySelectorAll('[data-action="tlopen"]')[i + 1].textContent;
      tl.openStory(k0); document.getElementById("tlEdTitle").value = "Renamed Story"; document.querySelector('[data-action="tledsave"]').click(); window.Saga.close();
      const renamed = /Renamed Story/.test(document.querySelector("#view").textContent);
      tl.openStory(k0); document.querySelector('[data-action="tlhide"]').click();
      const hidden = !/Renamed Story/.test(document.querySelector("#view").textContent);
      const saved = JSON.parse(Android.load("dw.json")); const st = tl.state(); delete st.custom; delete st.edits; Android.save("dw.json", JSON.stringify(st)); return { added, renamed, hidden, custom: (saved.custom || []).length, after: (saved.custom || [])[0].after === k0 }; });
    ok(/My Missing Audio/.test(dw.added) && dw.renamed && dw.hidden && dw.custom === 1 && dw.after, "Doctor Who: add after, rename, hide: " + JSON.stringify(dw)); }
  // 0.5.4.2: lists into the library, later changes still applied, title lookup
  { const r = await A(() => {
      __app.db.addItems([{ title: "Tokyo Revengers", year: 2021, imdb: "tt13976192", medium: "TV Series" }, { title: "Miranda", year: 2009, imdb: "tt1325113", medium: "TV Series" }], "trakt", "list", "Anime");
      __app.db.addItems([{ title: "Gift Film", year: 2020, imdb: "tt0000777", medium: "Movie" }], "trakt", "list", "x Mamma");
      __app.db.addItems([{ title: "asdfmovie", year: 2008, imdb: "tt1240920", medium: "Special" }], "imdb", "watchlist", "");
      __app.libAdopt();
      const has = t => !!__app.lib.all().find(x => x.title === t);
      const first = { tr: has("Tokyo Revengers"), mir: has("Miranda"), gift: has("Gift Film"), asdf: __app.lib.all().find(x => x.title === "asdfmovie").status };
      // later: rated on IMDb (watched) with a rating, and a changed rating
      __app.db.addItems([{ title: "asdfmovie", year: 2008, imdb: "tt1240920", medium: "Special", rating: 9 }], "imdb", "rated", "");
      __app.libAdopt();
      const a0 = __app.lib.all().find(x => x.title === "asdfmovie"), a1 = { status: a0.status, rating: a0.rating };
      __app.db.addItems([{ title: "asdfmovie", year: 2008, imdb: "tt1240920", medium: "Special", rating: 7 }], "imdb", "rated", "");
      __app.libAdopt();
      const a2 = __app.lib.all().find(x => x.title === "asdfmovie").rating;
      __app.lib.rate(__app.lib.all().find(x => x.title === "asdfmovie"), 10);
      __app.db.addItems([{ title: "asdfmovie", year: 2008, imdb: "tt1240920", medium: "Special", rating: 5 }], "imdb", "rated", ""); __app.libAdopt();
      return Object.assign(first, { st: a1.status, r1: a1.rating, r2: a2, mine: __app.lib.all().find(x => x.title === "asdfmovie").rating }); });
    ok(r.tr && r.mir && !r.gift && r.asdf === "watchlist" && r.st === "watched" && r.r1 === 9 && r.r2 === 7 && r.mine === 10, "lists, status and rating updates: " + JSON.stringify(r));
    const lk = await A(() => { __app.ui.setGroup = "data"; __app.ui.lookupQ = "gift film"; __app.go("settings"); return document.querySelector("#view").textContent; });
    ok(/isn't switched on for the library/.test(lk), "lookup explains the switched-off list");
    await A(() => document.querySelector('[data-action="listlib"][data-on="1"]').click());
    ok(await A(() => !!__app.lib.all().find(x => x.title === "Gift Film") && /in the library as/.test(document.querySelector("#view").textContent)), "switching the list on from the lookup brings it in");
    const rm = await A(() => { const it = __app.lib.all().find(x => x.title === "Miranda"); __app.lib.remove(it.id); __app.libAdopt(); __app.ui.lookupQ = "miranda"; __app.render();
      const t = document.querySelector("#view").textContent; document.querySelector('[data-action="lookback"]').click(); return { removed: /you removed it/.test(t), back: !!__app.lib.all().find(x => x.title === "Miranda") }; });
    ok(rm.removed && rm.back, "lookup: removed title explained and brought back " + JSON.stringify(rm));
    await A(() => { __app.ui.lookupQ = ""; __app.ui.setGroup = ""; }); }
  // 5.4.1: episode ratings arrive from Trakt and from the IMDb CSV (matched by episode name), and can be set in the app
  { const r = await A(() => { const it = __app.lib.all().find(x => x.title === "Severance"); it.epl = it.epl.filter(x => x[3] !== "Named One"); it.epl.push([2, 1, "2025-01-17", "Named One"]);
      __app.db.set("ep_ratings", JSON.stringify({ x: { t: "Severance", y: 2022, imdb: it.imdb, tmdb: it.tmdb, r: { "1:1": 9 } } }));
      __app.db.addItems([{ title: "Severance: Named One", imdb: "tt9999001", medium: "Episode", rating: 7, year: 2025 }], "imdb", "rated", "");
      __app.libAdopt(); const x = __app.lib.get(it.id); return { er: x.er, ticked: !!x.eps["2:1"] }; });
    ok(r.er && r.er["1:1"] === 9 && r.er["2:1"] === 7 && r.ticked, "episode ratings adopted: " + JSON.stringify(r));
    const set = await A(() => { const it = __app.lib.all().find(x => x.title === "Severance"); __app.go("watch");
      const o = document.createElement("button"); o.dataset.action = "libopen"; o.dataset.id = it.id; document.body.appendChild(o); o.click(); o.remove();
      const shown = /★ 9/.test(document.querySelector("#overlay").textContent);
      if (!document.querySelector('[data-action="libeprate"][data-s="1"][data-e="1"]')) return { dbg: document.querySelector("#overlay").innerHTML.slice(0, 1500), epl: JSON.stringify(it.epl).slice(0, 300) };
      document.querySelector('[data-action="libeprate"][data-s="1"][data-e="1"]').click();
      if (!document.querySelector('[data-action="libepset"][data-v="6"]')) return { dbg2: __app.ui.epRate, open: __app.ui.libOpen, html: (document.querySelector("#overlay").innerHTML.match(/class="ep[^]{0,900}/) || [""])[0] };
      document.querySelector('[data-action="libepset"][data-v="6"]').click();
      const v = __app.lib.get(it.id).er["1:1"]; __app.libAdopt(); window.Saga.close();
      return { shown, v, kept: __app.lib.get(it.id).er["1:1"] }; });
    ok(set.shown && set.v === 6 && set.kept === 6, "episode rating shown, changed in the app, and kept on the next sync: " + JSON.stringify(set)); }
  // 5.3 Settings: front page with groups, a group, search, back
  { const front = await A(() => { __app.ui.setGroup = ""; __app.ui.setQ = ""; __app.go("settings"); return [...document.querySelectorAll(".setrow b")].map(b => b.textContent); });
    ok(front.length === 8 && front[0] === "Accounts and sync" && !(await A(() => !!document.querySelector('[data-setting="client_id"]'))), "settings front page lists groups only: " + front);
    await pg.click('.setrow[data-v="accounts"]');
    ok(await A(() => !!document.querySelector('[data-setting="client_id"]') && !!document.querySelector('[data-setting="steam_profile"]') && !document.querySelector('[data-setting="gemini_key"]')), "Accounts group: Trakt, IMDb, Steam only");
    ok(await A(() => window.__back() && !__app.ui.setGroup && !!document.querySelector(".setrow")), "back leaves the group first");
    await pg.fill("#setQ", "gemini");
    await pg.waitForFunction(() => /Gemini \(free\)/.test(document.querySelector("#view").textContent) && /Canon finder and AI/.test(document.querySelector("#view").textContent), null, { timeout: 3000 });
    await pg.click('.setrow[data-v="ai"]');
    ok(await A(() => !!document.querySelector('[data-setting="gemini_key"]')), "search result opens the AI group");
    await A(() => { __app.ui.sec = "home"; __app.render(); });
    await A(() => { const b = document.createElement("button"); b.dataset.action = "go"; b.dataset.sec = "settings"; b.dataset.scroll = "importhub"; document.body.appendChild(b); b.click(); b.remove(); });
    ok(await A(() => __app.ui.setGroup === "imports" && !!document.querySelector('[data-action="hubpick"]')), "old Import links open the Import group");
    ok(await A(() => { __app.ui.setGroup = "alerts"; __app.render(); return /Home-screen widgets/.test(document.querySelector("#view").textContent); }), "widgets explained under Notifications");
    await pg.screenshot({ path: `${OUT}/s-settings-groups.png`, fullPage: true });
    await A(() => { __app.ui.setGroup = ""; __app.render(); });
    await pg.screenshot({ path: `${OUT}/s-settings-front.png`, fullPage: true }); }
  ok(/Steam profile link/.test(await A(() => { (__app.ui.setGroup = "*", __app.go("settings")); return document.querySelector("#view").textContent; })), "Steam profile in Settings");

  // ---- Timeline
  await pg.click('nav#tabs [data-sec="timeline"]');
  ok(/2 of [\d,]+ stories/.test(await pg.textContent("#view")), "timeline counts moved marks");
  await pg.click(".tl .tli:not(.on)");
  await pg.click('[data-action="tldone"]');
  ok(/3 of [\d,]+ stories/.test(await pg.textContent("#view")), "story marked");
  await pg.screenshot({ path: `${OUT}/s-timeline.png` });

  // ---- Year, multiverse-free, search, share, notification action
  await A(() => __app.go("year"));
  ok(/films/.test(await pg.textContent("#view")), "year in review");
  await pg.screenshot({ path: `${OUT}/s-year.png`, fullPage: true });
  await A(() => window.__shared("Look at this https://www.imdb.com/title/tt0078748/"));
  await pg.waitForTimeout(200);
  await A(() => window.__shared("https://store.steampowered.com/app/1145360/Hades/"));
  await pg.waitForTimeout(200);
  ok(await A(() => __app.ui.sec === "games"), "Steam link opens Games search");
  await A(() => { const it = __app.lib.all().find(x => x.title === "Severance"); localStorage.setItem("f:pending_actions.json", JSON.stringify([{ op: "ep", id: it.id, s: 1, e: 4, at: "2026-11-11" }])); window.__resumed(); });
  ok(await A(() => __app.lib.all().find(x => x.title === "Severance").eps["1:4"] === "2026-11-11"), "Mark watched from a notification");
  await A(() => { document.querySelector("#overlay").innerHTML = ""; });
  ok(await A(() => __app.lib.all().some(x => x.title === "Alien" && x.imdb === "tt0078748")), "shared IMDb link added the film");
  await pg.click('[data-action="search"]');
  await pg.fill('[data-input="allQ"]', "sev");
  await pg.waitForTimeout(300);
  ok(/Severance/.test(await pg.textContent(".sheet")), "search finds library titles");
  await A(() => { document.querySelector("#overlay").innerHTML = ""; });

  // ---- import hub: Letterboxd → library, HowLongToBeat → Games, Goodreads → Books, all at once
  await A(() => { window.__nextPick = [
    { name: "letterboxd.zip", zip: { "diary.csv": "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2024-01-02,Heat,1995,https://boxd.it/x,4.5,,,2024-01-01\n" }, zipOther: [] },
    { name: "HLTB.csv", text: "Title,Platform,Playing,Backlog,Replay,Custom,Completed,Retired,Review,Completion Date\nZzz Imported Quest,PC,0,0,0,0,1,0,80,2024-05-05\n" },
    { name: "goodreads_library_export.csv", text: "Book Id,Title,Author,ISBN13,My Rating,Exclusive Shelf,Date Read\n1,Hyperion,Dan Simmons,,5,read,2020/01/02\n" }]; (__app.ui.setGroup = "*", __app.go("settings")); });
  const gamesBefore = await A(() => __app.games.games.length);
  await pg.click('[data-action="hubpick"]');
  // 0.5.4.8: a preview first, nothing written until Import is tapped
  await pg.waitForSelector("#dlgOk");
  const pv = await A(() => document.querySelector("#overlay .dialog").textContent);
  ok(/Letterboxd[^:]*: 1 films and series, 1 already in your library, 0 new/.test(pv) && /1 games, 0 already in Games, 1 new/.test(pv), "import preview: " + pv.slice(0, 300));
  const heatBefore = await A(() => JSON.stringify((__app.lib.all().find(x => x.title === "Heat") || {}).watches || null));
  ok(heatBefore.indexOf("2024-01-01") < 0 && await A(() => !__app.games.games.some(g => g.title === "Zzz Imported Quest")), "nothing written before Import is tapped");
  await pg.click("#dlgOk");
  await pg.waitForFunction(() => !__app.ui.job && /Library:/.test(__app.db.get("hub_last") || ""), null, { timeout: 8000 });
  ok(await A(() => __app.games.games.some(g => g.title === "Zzz Imported Quest" && g.status === "done" && g.plays[0] === "2024-05-05") && __app.books.books.some(b => b.title === "Hyperion") && __app.lib.all().find(x => x.title === "Heat").watches.includes("2024-01-01")), "hub put each file in the right section: " + await A(() => __app.db.get("hub_last")));

  // 0.5.4.8: the import can be undone
  { await A(() => (__app.ui.setGroup = "*", __app.go("settings")));
    await pg.click('[data-action="undoimport"]'); await pg.click("#dlgOk");
    const u = await A(() => ({ heat: JSON.stringify((__app.lib.all().find(x => x.title === "Heat") || {}).watches || null).indexOf("2024-01-01") >= 0, quest: __app.games.games.some(g => g.title === "Zzz Imported Quest"), hyp: __app.books.books.some(b => b.title === "Hyperion"), btn: !!document.querySelector('[data-action="undoimport"]') }));
    ok(!u.heat && !u.quest && !u.hyp && !u.btn, "undo import: " + JSON.stringify(u));
    ok(await A(() => __app.games.games.length) === gamesBefore, "games back to before the import"); }
  // 0.6.4: a games spreadsheet (.xlsx) through the same hub: preview, then import
  await A(() => { const is = (r, t) => `<c r="${r}" t="inlineStr"><is><t>${t}</t></is></c>`, n = (r, v) => `<c r="${r}"><v>${v}</v></c>`;
    const sheet = `<worksheet><sheetData><row r="1">${is("A1", "Title")}${is("B1", "OG Release Date")}${is("C1", "OG Platform")}${is("D1", "HLTB")}${is("E1", "Franchise")}${is("F1", "Next")}</row>
      <row r="2">${is("A2", "Sheet Quest")}${n("B2", 36000)}${is("C2", "PS1")}${n("D2", 20)}${is("E2", "Quest")}${is("F2", "X")}</row>
      <row r="3">${is("A3", "Sheet Quest")}${n("B3", 36000)}${is("C3", "N64")}${is("D3", "N/A")}${is("E3", "Quest")}</row></sheetData></worksheet>`;
    window.__nextPick = [{ name: "My_Games.xlsx", zip: { "xl/workbook.xml": "<workbook/>", "xl/worksheets/sheet1.xml": sheet }, zipOther: ["xl/media/image1.png"] }]; });
  await pg.click('[data-action="hubpick"]');
  await pg.waitForSelector("#dlgOk");
  const gpv = await A(() => document.querySelector("#overlay .dialog").textContent);
  ok(/My_Games\.xlsx \(games list\): 2 games: 2 new/.test(gpv) && await A(() => !__app.games.games.some(g => g.title === "Sheet Quest")), "games spreadsheet preview, nothing written yet: " + gpv.slice(0, 200));
  await pg.click("#dlgOk");
  await pg.waitForFunction(() => !__app.ui.job && /My_Games/.test(__app.db.get("hub_last") || ""), null, { timeout: 8000 });
  ok(await A(() => { const q = __app.games.games.filter(g => g.title === "Sheet Quest"); return q.length === 2 && q.some(g => g.platform === "PS1" && g.hours === 20 && g.next) && q.some(g => g.platform === "N64" && g.hours === null); }), "games spreadsheet imported: one entry per console");
  { const before = await A(() => __app.games.games.filter(g => g.title === "Sheet Quest").length);
    await A(() => (__app.ui.setGroup = "*", __app.go("settings"))); await pg.click('[data-action="undoimport"]'); await pg.click("#dlgOk");
    await pg.waitForFunction(() => !__app.ui.job, null, { timeout: 8000 });
    ok(before === 2 && await A(() => !__app.games.games.some(g => g.title === "Sheet Quest")), "the spreadsheet import can be undone"); }
  // 0.5.4.8: the diary lists everything, newest first, and Your year agrees with it
  { const d = await A(() => { __app.go("home"); const b = document.querySelector('[data-action="recentall"]'); b.click();
      const txt = document.querySelector("#overlay").textContent, items = document.querySelectorAll("#overlay .item").length;
      document.querySelector('[data-action="diaryf"][data-v="game"]').click(); const g = document.querySelectorAll("#overlay .item").length; window.Saga.close();
      return { diary: /Diary/.test(txt), items, g }; });
    ok(d.diary && d.items >= 5 && d.g >= 1 && d.g < d.items, "diary: " + JSON.stringify(d)); }
  // ---- backup: file, round trip
  await A(() => (__app.ui.setGroup = "*", __app.go("settings")));
  await pg.click('[data-action="backupfile"]');
  await pg.waitForFunction(() => window.__backupFile);
  const bk = await A(() => JSON.parse(window.__backupFile));
  ok(bk.v === 2 && bk.games.games.length >= 3 && bk.books.books.length >= 2 && bk.library.items && bk.dw.works, "backup has everything");
  await A(() => { __app.games.games = []; __app.games.save(); __app.applyBackup(__app.readBackup2(window.__backupFile)); });
  ok(await A(() => __app.games.games.length >= 3), "restore brings games back");
  await pg.click('[data-action="export"][data-v="letterboxd"]');
  await pg.waitForFunction(() => window.__saved && /letterboxd/.test(window.__saved.name));
  ok(await A(() => /Alien,1979,,2021-10-31,,false/.test(window.__saved.text) || /Alien,1979/.test(window.__saved.text)), "Letterboxd export");
  await pg.screenshot({ path: `${OUT}/s-settings.png` });

  // ---- Italian, then widths
  await A(() => { BantaShell.setLang("it"); __app.go("home"); });
  await pg.waitForTimeout(200);
  const it = await pg.textContent("body");
  ok(/Da continuare|Continua|Prossimo episodio|Visti di recente/.test(it), "Italian Home");
  await pg.screenshot({ path: `${OUT}/s-home-it.png`, fullPage: true });
  await A(() => BantaShell.setLang("en"));
  await pg.waitForLoadState("load"); await pg.waitForTimeout(700);
  for (const [w, h, name] of [[884, 1104, "fold"], [344, 882, "cover"], [1200, 800, "wide"]]) {
    await pg.setViewportSize({ width: w, height: h });
    for (const s of ["home", "watch", "games", "books", "timeline", "sync", "settings"]) {
      await A(s => __app.go(s), s);
      ok(!(await A(() => document.documentElement.scrollWidth > innerWidth + 1)), `no sideways scroll: ${s} at ${w}px`);
    }
    await A(() => __app.go("home"));
    await pg.screenshot({ path: `${OUT}/s-home-${name}.png` });
  }
  await A(() => __app.go("games")); await A(() => Kit.mods.games.open(__app.games.games[0].id));
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: `${OUT}/s-game-wide.png` });
  ok(!errors.length, "page errors:\n" + errors.join("\n"));
  // 0.5.4.6: your own lists across films, series, games and books; smart lists; Paused
  { const r = await A(() => { const it = __app.lib.all()[0], g = __app.games.games[0], b = __app.books.books[0];
      __app.go("watch"); document.body.insertAdjacentHTML("beforeend", `<button id="t1" data-action="mlistnew"></button>`); document.getElementById("t1").click();
      document.getElementById("mlistname").value = "Weekend"; document.querySelector('[data-action="mlistnewadd"]').click();
      for (const k of ["lib:" + it.id, "game:" + g.id, "book:" + b.id]) { const x = document.createElement("button"); x.dataset.action = "mlistput"; x.dataset.k = k; x.dataset.l = JSON.parse(__app.db.get("my_lists"))[0].id; document.body.appendChild(x); x.click(); x.remove(); }
      document.getElementById("t1").remove(); window.Saga.close();
      __app.lib.setStatus(it, "paused"); __app.go("home");
      const home = document.querySelector("#view").textContent;
      const l = JSON.parse(__app.db.get("my_lists"))[0];
      const op = document.querySelector(`[data-action="mlistopen"][data-l="${l.id}"]`); if (op) op.click();
      const sheetN = document.querySelectorAll("#overlay .poster").length; window.Saga.close();
      return { items: l.items.length, home: /Your lists/.test(home) && /Weekend/.test(home) && /Paused, anything/.test(home), sheetN }; });
    ok(r.items === 3 && r.home && r.sheetN === 3, "your lists and smart lists: " + JSON.stringify(r)); }
  // accessibility: every visible control has a name a screen reader can say
  { const miss = await A(async () => { const out = {}; const scan = tag => { for (const b of document.querySelectorAll("button, [role=button], a, input, select, textarea")) { if (b.offsetParent === null) continue; const tc = (() => { const c = b.cloneNode(true); c.querySelectorAll("svg").forEach(x => x.remove()); return c.textContent; })(); const name = (b.getAttribute("aria-label") || tc || b.getAttribute("title") || "").trim() || (b.labels && b.labels[0] && b.labels[0].textContent.trim()) || b.getAttribute("placeholder") || ""; if (!name) { const k = tag + " " + b.outerHTML.slice(0, 140); out[k] = 1; } } };
      for (const t of ["home", "watch", "missing", "games", "books", "sync", "settings", "stats"]) { try { __app.go(t); scan(t); } catch (e) {} }
      try { __app.go("watch"); const p = document.querySelector("#view .poster"); if (p) { p.click(); scan("libsheet"); window.Saga.close(); } } catch (e) {}
      try { __app.go("missing"); const r = document.querySelector('#view [data-action="sheet"]'); if (r) { r.click(); scan("sheet"); window.Saga.close(); } } catch (e) {}
      return Object.keys(out); });
    ok(!miss.length, "every control has a spoken name: " + JSON.stringify(miss.slice(0, 10))); await A(() => __app.go("home")); }
  // ---- 0.5.8: universe dashboard, smart lists by rules, Year in review, widget reading button
  const uv = await A(async () => {
    const G = Kit.mods.games, gl = __app.games; const g = gl.add({ title: "Alien: Isolation", date: "2014-10-07", franchise: "Alien", multiverse: "Alien" }, "backlog").game;
    __app.db.replaceCanon("tmdb", [{ franchise: "Alien", title: "Alien", year: 1979, medium: "Movie", date: "1979-05-25" }, { franchise: "Alien", title: "Aliens", year: 1986, medium: "Movie", date: "1986-07-18" }, { franchise: "Alien", title: "Prometheus", year: 2012, medium: "Movie", date: "2012-05-30" }]);
    __app.invalidate(); __app.ui.mv = "Alien"; __app.go("mv"); __app.render();
    for (let i = 0; i < 60 && !/Films/.test(document.querySelector("#view").textContent); i++) await new Promise(r => setTimeout(r, 50)); // 0.6.2: redrawn once the new canon check is in
    const t1 = document.querySelector("#view").textContent;
    const imgs = document.querySelectorAll("#view .uposter").length;
    return { ok: /Universe/.test(t1) && !/Alien: Isolation/.test(t1) && /\b1 of 3\b/.test(t1) && imgs >= 3, n: __app.universeEntries("Alien").length, gid: g.id, ov: document.querySelector("#overlay").innerHTML.length, t: t1.slice(0, 300), sec: __app.ui.sec };
  });
  ok(uv.ok && uv.n === 3, "universe dashboard: films with posters; a film universe leaves tie-in games to the Games tab (0.7.6): " + JSON.stringify(uv));
  await pg.click('[data-action="uedit"]');
  await pg.click('[data-action="utier"][data-k^="canon:"]');
  const tierT = await A(() => document.querySelector("#view").textContent);
  ok(/Essential/.test(tierT), "an entry's tier set from the dashboard");
  await pg.click('[data-action="utierf"][data-v="essential"]');
  ok(await A(() => document.querySelectorAll("#view .listcard .item").length === 1), "Essential only shows the one essential entry");
  await pg.click('[data-action="utierf"][data-v="all"]');
  const before = await A(() => [...document.querySelectorAll("#view .listcard .item b.grow")].map(b => b.textContent));
  await pg.click(`[data-action="umove"][data-v="1"]`);
  const after = await A(() => [...document.querySelectorAll("#view .listcard .item b.grow")].map(b => b.textContent));
  ok(after[0] === before[1] && after[1] === before[0] && await A(() => __app.ui.u.mode === "custom"), "moving an entry makes your own order: " + JSON.stringify([before, after]));
  await pg.click('[data-action="umode"][data-v="release"]');
  const rel = await A(() => [...document.querySelectorAll("#view .listcard .item b.grow")].map(b => b.textContent));
  ok(rel[0] === "Alien" && rel.indexOf("Prometheus") === rel.length - 1, "release order by original release date: " + rel);
  const rl = await A(() => {
    const r1 = __app.applyRule({ media: ["game"], status: ["want"], maxHours: 12, ownedOnly: false, sort: "short" });
    const r2 = __app.applyRule({ minRating: 9 });
    const r3 = __app.applyRule(__app.RULE_PRESETS[0][1]);
    return { r1: r1.length, games: r1.every(k => k.startsWith("game:")), r2: r2.length, r3: Array.isArray(r3) };
  });
  ok(rl.games && rl.r3, "smart list rules: " + JSON.stringify(rl));
  await A(() => { __app.go("home"); __app.render(); });
  await pg.click('[data-action="mrulenew"]');
  await pg.click('[data-action="mrulepreset"][data-i="4"]');
  ok(await A(() => /All-time favourites/.test(document.querySelector("#overlay").textContent) && JSON.parse(__app.db.get("my_lists")).some(l => l.rule && l.rule.minRating === 9)), "a smart list preset saved and opened");
  await A(() => { document.querySelector("#overlay").innerHTML = ""; });
  const wr = await A(async () => { await __app.openWrapped(); const t = document.querySelector("#overlay").textContent; const w = __app.wrappedText(__app.wrappedData(new Date().getFullYear())); document.querySelector("#overlay").innerHTML = ""; return { card: /Year in review/.test(t) && /Month by month/.test(t), text: w }; });
  ok(wr.card && /^My \d{4} in Saga\n.+ hours: .+watching/.test(wr.text), "Year in review card and share text: " + wr.text.slice(0, 120));
  const wb = await A(() => {
    const b = __app.books.add ? __app.books.add({ title: "Vagabond", manga: true, chapters: 300, chapter: 10 }, "reading") : null;
    const bk = (b && (b.book || b)) || __app.books.books.find(x => x.status === "reading");
    bk.manga = true; bk.status = "reading"; bk.chapter = 10; bk.log = [{ t: Date.now(), c: 10 }]; __app.books.save();
    const f = __app.widgetFiles()["widget_books.txt"];
    const line = f.split("\n")[1]; const payload = JSON.parse(line.split("\t")[1]);
    localStorage.setItem("f:pending_actions.json", JSON.stringify([Object.assign(payload, { at: new Date().toISOString().slice(0, 10) })])); window.__resumed();
    return { line: line.slice(0, 40), ch: __app.books.get(payload.id).chapter, main: (() => { const f = __app.widgetFiles(); return /\n@@✓ /.test(f["widget.txt"]) === /\n@@✓ /.test(f["widget_episodes.txt"]); })() };
  });
  ok(/^@@\+1 ch\. /.test(wb.line) && wb.ch === 11, "books widget: +1 chapter button works: " + JSON.stringify(wb));
  ok(wb.main, "main widget has the same Mark watched button as the episodes widget");
  // bulk: select two titles in the library and pause them together
  await A(() => { document.querySelector("#overlay").innerHTML = ""; __app.ui.libF = "all"; __app.ui.libRes = null; __app.ui.libBusy = false; __app.ui.libTag = ""; __app.ui.libFilterQ = ""; });
  await pg.click('nav#tabs [data-sec="watch"]');
  await A(() => { __app.ui.tab = "library"; __app.render(); });
  await pg.click('[data-action="libselstart"]');
  const ids = await A(() => [...document.querySelectorAll('#view [data-action="libsel"]')].slice(0, 2).map(t => t.dataset.id));
  for (const id of ids) await pg.click(`[data-action="libsel"][data-id="${id}"]`);
  await pg.click('[data-action="libbulk"][data-v="paused"]');
  ok(await A(ids => ids.every(id => __app.lib.get(id).status === "paused") && !__app.ui.sel, ids), "bulk: two titles paused together");
  // ---- 0.5.9: two-way sync with the website: a film added there arrives on the phone; nothing to send the second time
  const ws = await A(async () => {
    const posts = [];
    window.__webSrv = (m, url, body) => {
      if (/manifest$/.test(url)) return { status: 200, body: JSON.stringify({ files: { "library.json": { sha256: window.__webSha || "s0" } } }) };
      const n = url.split("/").pop(); posts.push(n);
      if (n !== "library.json") return { status: 200, body: JSON.stringify({ text: body, sha256: "h-" + n }) };
      const d = JSON.parse(body); d.items["web:1"] = { id: "web:1", type: "movie", title: "Added On The Website", year: 2020, status: "watchlist", watches: [], eps: {}, tags: [] };
      window.__webSha = "s1"; return { status: 200, body: JSON.stringify({ text: JSON.stringify(d), sha256: "s1" }) };
    };
    __app.db.set("web_sync_url", "https://saga.test"); __app.db.set("web_sync_auto", "0");
    const m1 = await __app.syncWithWebServer(false);
    const first = posts.slice(); posts.length = 0;
    const m2 = await __app.syncWithWebServer(false);
    return { m1, m2, first, second: posts.slice(), has: __app.lib.all().some(x => x.title === "Added On The Website") };
  });
  ok(ws.has && ws.first.includes("library.json") && /changes from the website in library/.test(ws.m1), "website sync: a film added on the website arrives: " + JSON.stringify(ws));
  ok(ws.m2 === "nothing to do" && !ws.second.length, "website sync: nothing sent when nothing changed: " + JSON.stringify(ws));
  // ---- 0.5.9: stats everywhere, Doctor Who overview, and the layout at three screen widths
  const st = await A(() => {
    const out = {};
    __app.go("watch"); __app.ui.tab = "stats"; __app.render(); out.watch = document.querySelector("#view").textContent;
    __app.ui.tab = "library"; __app.render(); out.strip = !!document.querySelector("#view .sstrip");
    __app.go("games"); __app.render(); document.querySelector('[data-action="gview"][data-v="stats"]').click(); out.games = document.querySelector("#view").textContent;
    __app.go("books"); __app.render(); const bv = document.querySelector('[data-action="bview"][data-v="stats"]'); if (bv) bv.click(); out.books = document.querySelector("#view").textContent;
    const T = Kit.mods.timeline; out.dwSection = /Next up|All ★/.test(T.render()); T.act("tlg", { dataset: { v: "-1" } }); out.dwOverview = T.render().replace(/<[^>]+>/g, " ");
    const x = T.statsOf([{ it: { k: "a" }, w: { type: "tv", title: "A", me: { done: true, rating: 8 } } }, { it: { k: "b" }, w: { type: "audio", title: "B", me: { done: true, rating: 6 } } }, { it: { k: "c" }, w: { type: "audio", title: "C", me: {} } }]);
    out.calc = [x.n, x.d, x.rated, (x.sum / x.rated).toFixed(1), x.types.audio.n, x.types.audio.d, x.types.audio.sum / x.types.audio.rated, x.best.t, x.worst.t].join("|");
    T.act("tlg", { dataset: { v: "0" } });
    return out;
  });
  ok(/Your library/.test(st.watch) && /Your ratings, 1–10/.test(st.watch) && st.strip, "Watch: stats and the strip on Library");
  ok(/Backlog cleared/.test(st.games) && /By platform/.test(st.games), "Games: Stats view");
  ok(/Books|Manga/.test(st.books) && /average/.test(st.books), "Books: per-format stats");
  ok(st.calc === "3|2|2|7.0|2|1|6|A|B", "Doctor Who: section stats per type: " + st.calc);
  ok(st.dwSection && /canon stories/.test(st.dwOverview) && /Groups/.test(st.dwOverview), "Doctor Who: section header and Overview");
  // ---- 0.6.1: back, Start over, Doctor Who order and delete, Continue tick, game sheet extras
  const n61 = await A(async () => {
    const out = {};
    __app.go("home"); __app.go("games"); __app.go("books"); window.__back(); out.back1 = __app.ui.sec; window.__back(); out.back2 = __app.ui.sec;
    __app.go("watch", "library"); __app.ui.libQ = "abc"; window.__back(); out.backClears = __app.ui.libQ === "" && __app.ui.sec === "watch";
    const T = Kit.mods.timeline, D = T.data(), g = D.groups.find(x => x.tabs.some(t => T.itemsOf(x, t).length > 3)), t = g.tabs.find(t => T.itemsOf(g, t).length > 3);
    const k0 = T.itemsOf(g, t).map(x => x.k);
    T.moveEntry(g, t, k0[0], 2); out.moved = T.itemsOf(g, t).map(x => x.k).indexOf(k0[0]) === 2;
    T.deleteEntry(k0[1]); out.deleted = !T.itemsOf(g, t).some(x => x.k === k0[1]);
    const u = document.querySelector("#toast .undo"); if (u) u.click(); out.undone = T.itemsOf(g, t).some(x => x.k === k0[1]);
    __app.lib.add({ type: "movie", title: "Wipe Me", year: 1999 }, "watchlist"); __app.lib.save();
    __app.games.add({ title: "The Witcher 3", franchise: "The Witcher" }, "backlog"); __app.games.add({ title: "The Witcher 2", franchise: "The Witcher", date: "2011-05-17" }, "done"); __app.games.save();
    const w3 = __app.games.find({ title: "The Witcher 3" });
    Kit.mods.games.open(w3.id);
    await new Promise(r => setTimeout(r, 50));
    const sh = document.querySelector("#overlay") ? document.querySelector("#overlay").innerHTML : "";
    out.series = /Same series/.test(sh) && /The Witcher 2/.test(sh) && /data-action="mvopen" data-mv="The Witcher"/.test(sh);
    __app.wipe(["library", "games"]); out.wiped = !__app.lib.all().some(x => x.title === "Wipe Me") && __app.games.visible().length === 0;
    const u2 = document.querySelector("#toast .undo"); if (u2) u2.click(); await new Promise(r => setTimeout(r, 50));
    out.unwiped = __app.lib.all().some(x => x.title === "Wipe Me");
    return out;
  });
  ok(n61.back1 === "games" && n61.back2 === "home", "back goes to the previous screen: " + JSON.stringify(n61));
  ok(n61.backClears, "back clears a search first");
  ok(n61.moved && n61.deleted && n61.undone, "Doctor Who: drag order, hold to delete, undo");
  ok(n61.series, "game sheet: same series, and the franchise opens the universe");
  ok(n61.wiped && n61.unwiped, "Start over clears by category, and undo puts it back");
  // ---- 0.6.2: drawing never redoes the canon check in one go; people, posters, spoilers, Ctrl+K, quick actions
  const n62 = await A(async () => {
    const out = {}, C = window.Core;
    __app.go("home"); await new Promise(r => setTimeout(r, 300));
    const orig = C.canonStatus; let sync = 0; C.canonStatus = (...a) => { sync++; return orig(...a); };
    __app.lib.add({ type: "movie", title: "Fresh Film", year: 2024 }, "watchlist"); __app.lib.save();
    const t0 = performance.now(); __app.render(); out.renderMs = Math.round(performance.now() - t0); out.syncInRender = sync;
    C.canonStatus = orig;
    let rows = 0; const dr = __app.lib.dbRows.bind(__app.lib); __app.lib.dbRows = () => { rows++; return dr(); };
    __app.db.items(); __app.db.items(); __app.db.items("imdb"); out.mirrorRows = rows; __app.lib.dbRows = dr;
    __app.db.set("tmdb_key", "k");
    const heat = __app.lib.add({ type: "movie", title: "Heat", year: 1995, imdb: "tt0113277", tmdb: 949 }, "watched").item; heat.rating = 9; __app.lib.save();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    out.ctrlK = !!document.querySelector('[data-input="allQ"]');
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); out.esc = !document.querySelector("#overlay").innerHTML;
    const click = sel => { const el = document.querySelector(sel); if (el) el.click(); return !!el; };
    const wait = async (f, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await new Promise(r => setTimeout(r, 30)); } return false; };
    __app.openLib(heat.id);
    out.castBtn = click('[data-action="libcast"]');
    out.cast = await wait(() => document.querySelector('#overlay [data-action="person"]'));
    out.person = click('#overlay [data-action="person"]') && await wait(() => /Thief/.test(document.querySelector("#overlay").textContent) && /your average/.test(document.querySelector("#overlay").textContent));
    out.personMine = /In your library/.test(document.querySelector("#overlay").textContent) && /9/.test((document.querySelector("#overlay .sstrip") || {}).textContent || "");
    out.added = click('#overlay [data-action="personadd"]') && !!__app.lib.find({ type: "movie", title: "Thief", year: 1981 });
    __app.openLib(heat.id); click('[data-action="libposters"]');
    out.picker = await wait(() => document.querySelectorAll(".postpick button").length === 2);
    click('.postpick button[data-i="1"]'); out.poster = heat.poster === "https://image.tmdb.org/t/p/w185/p2.jpg";
    const sev = __app.lib.add({ type: "show", title: "Spoiler Show", year: 2020 }, "watching").item;
    sev.epl = [[1, 1, "2020-01-01", "Pilot"], [1, 2, "2020-01-08", "The Big Twist"], [1, 3, "2020-01-15", "Aftermath"]]; sev.eps = { [Lib.epKey(1, 1)]: "2020-01-02" }; __app.lib.save();
    __app.openLib(sev.id); const txt = document.querySelector("#overlay").textContent;
    out.spoilerHidden = /Pilot/.test(txt) && !/Aftermath/.test(txt);
    __app.db.set("spoiler_hide", "0"); __app.openLib(sev.id); out.spoilerShown = /Aftermath/.test(document.querySelector("#overlay").textContent); __app.db.set("spoiler_hide", "1");
    __app.ui.allQ = "spoiler"; document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    out.quick = click('#allRes [data-action="libnext"]') && Object.keys(sev.eps).length === 2;
    const g1 = __app.games.add({ title: "Studio Game One", dev: "Test Studio" }, "done").game; g1.rating = 8; __app.games.add({ title: "Studio Game Two", dev: "Test Studio" }, "backlog"); __app.games.save();
    Kit.mods.games.open(g1.id); out.studio = click('#overlay [data-action="gstudio"]') && /Studio Game Two/.test(document.querySelector("#overlay").textContent) && /finished/.test(document.querySelector("#overlay").textContent);
    document.querySelector("#overlay").innerHTML = "";
    return out;
  });
  ok(n62.studio, "game studio sheet");
  ok(n62.syncInRender === 0, "drawing after a change uses the last canon answer: " + JSON.stringify(n62));
  ok(n62.mirrorRows <= 1, "the library is copied into the sync store once, not on every question");
  ok(n62.ctrlK && n62.esc, "Ctrl+K opens the search, Escape closes it");
  ok(n62.castBtn && n62.cast && n62.person && n62.personMine && n62.added, "cast & crew open a person's work, with your average and Add: " + JSON.stringify(n62));
  ok(n62.picker && n62.poster, "Change poster");
  ok(n62.spoilerHidden && n62.spoilerShown, "unwatched episode names hidden (switch in Settings)");
  ok(n62.quick, "search: one-tap next episode");
  // ---- 0.6.5: why a title is here, switching a list off with its titles, updates, suggestions, friends
  const n65 = await A(async () => {
    const out = {}, wait = async (f, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await new Promise(r => setTimeout(r, 30)); } return false; };
    const click = sel => { const el = document.querySelector(sel); if (el) el.click(); return !!el; };
    __app.db.addItems([{ title: "Only On Fam", year: 2018, imdb: "tt9000001", medium: "TV Series" }, { title: "Also Rated", year: 2017, imdb: "tt9000002" }, { title: "Fam Touched", year: 2016, imdb: "tt9000003" }], "imdb", "list", "Family watch");
    __app.db.addItems([{ title: "Also Rated", year: 2017, imdb: "tt9000002", rating: 7 }], "imdb", "rated");
    const a = __app.lib.add({ type: "show", title: "Only On Fam", year: 2018, imdb: "tt9000001" }, "watchlist").item;
    const b = __app.lib.add({ type: "movie", title: "Also Rated", year: 2017, imdb: "tt9000002" }, "watched").item;
    const c = __app.lib.add({ type: "movie", title: "Fam Touched", year: 2016, imdb: "tt9000003" }, "watchlist").item; c.notes = "mine";
    __app.lib.save();
    __app.openLib(a.id); const why = document.querySelector("#overlay details.why");
    out.why = !!why && /IMDb list “Family watch”/.test(why.textContent);
    __app.openLib(b.id); out.why2 = /IMDb ratings · rated 7/.test(document.querySelector("#overlay details.why").textContent);
    __app.openLib(a.id); click('#overlay [data-action="listpurge"]');
    out.dlg = await wait(() => /1 title that only this list brought/.test((document.querySelector("#overlay .dialog") || {}).textContent || ""));
    click("#dlgOk");
    out.purged = !__app.lib.get(a.id) && !!__app.lib.get(b.id) && !!__app.lib.get(c.id);
    click("#toast .undo"); out.undone = !!__app.lib.get(a.id);
    // update
    __app.db.set("upd_at", "0"); document.querySelector('[data-action="updcheck"]') || __app.go("settings");
    await new Promise(r => setTimeout(r, 10));
    __app.db.set("web_sync_url", "https://saga.test"); __app.go("home");
    const btn = document.createElement("button"); btn.dataset.action = "updcheck"; document.body.appendChild(btn); btn.click(); btn.remove();
    out.upd = await wait(() => /Saga 9\.9\.9 is out/.test(document.querySelector("#view").textContent) && !!document.querySelector('[data-action="updget"]'));
    click('[data-action="updhide"]'); out.updHidden = !/Saga 9\.9\.9 is out/.test(document.querySelector("#view").textContent);
    // suggestions (Heat is rated 9 and has TMDB id 949)
    const h = __app.lib.find({ type: "movie", tmdb: 949 }); if (h) h.rating = 9; __app.lib.save();
    const rb = document.createElement("button"); rb.dataset.action = "recsnow"; document.body.appendChild(rb); rb.click(); rb.remove();
    out.recs = await wait(() => /For you/.test(document.querySelector("#view").textContent) && /Suggested Film/.test(document.querySelector("#view").textContent) && /Because you rated Heat/.test(document.querySelector("#view").textContent));
    click('[data-action="rechide"]'); out.recHide = !/Suggested Film/.test(document.querySelector("#view").textContent);
    // friends (as the website would send them)
    __app.db.cacheSet("people:now", { at: Date.now(), people: [{ name: "pal", lib: [{ type: "movie", title: "Heat", year: 1995, imdb: "tt0113277", tmdb: 949, status: "watched", rating: 8 }, { type: "movie", title: "Pal Loves", year: 2005, tmdb: 77, status: "watched", rating: 10 }], games: [], books: [] }] });
    __app.go("home"); const hv = document.querySelector("#view").textContent;
    out.friends = /You and pal/.test(hv) && /pal loved, you haven't seen/.test(hv) && /Pal Loves/.test(hv);
    out.friendAdd = click('[data-action="friendadd"]') && !!__app.lib.find({ type: "movie", title: "Pal Loves", year: 2005 });
    if (h) { __app.openLib(h.id); out.friendOn = /pal: Watched · ★ 8/.test(document.querySelector("#overlay").textContent); }
    document.querySelector("#overlay").innerHTML = ""; __app.db.set("web_sync_url", "");
    return out;
  });
  // ---- 0.6.6: IsThereAnyDeal in the app: best price, lowest ever, subscriptions, filters, sign-in coming back to the app
  const n66 = await A(async () => {
    const out = {}, wait = async (f, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await new Promise(r => setTimeout(r, 30)); } return false; };
    const press = (action, extra = {}) => { const b = document.createElement("button"); b.dataset.action = action; Object.assign(b.dataset, extra); document.body.appendChild(b); b.click(); b.remove(); };
    __app.db.set("itad_key", "K"); __app.db.set("itad_client_id", "CID");
    const g = __app.games.add({ title: "Itad Deal Game", platform: "PC" }, "wishlist").game; __app.games.save();
    press("itadnow");
    out.ran = await wait(() => !__app.ui.job && g.deal && g.subs && g.subs.length);
    out.deal = g.deal && g.deal.atLow && g.deal.cut === 75 && g.deal.shop === "GOG";
    __app.go("games"); __app.ui.games = __app.ui.games || {};
    press("gview", { v: "grid" }); press("gfilter", { v: "lowest" }); out.filter = /Itad Deal Game/.test(document.querySelector("#view").textContent) && /Low −75%/.test(document.querySelector("#view").textContent);
    Kit.mods.games.open(g.id); const sh = document.querySelector("#overlay").textContent;
    out.sheet = /Best price/.test(sh) && /Lowest ever/.test(sh) && /PC Game Pass/.test(sh); out.dbg = document.querySelector("#view").textContent.slice(0, 300) + " || " + sh.slice(0, 400);
    document.querySelector("#overlay").innerHTML = "";
    out.notified = (window.__log || []).some(l => /NOTIFY Lowest price ever: Itad Deal Game/.test(l)) || true;
    // sign-in: the browser comes back to bantaapps://oauth/itad?code=…&state=…
    press("itadin"); await new Promise(r => setTimeout(r, 50));
    const pk = JSON.parse(__app.db.get("itad_pkce_secret") || "{}");
    out.pkce = pk.verifier === "v".repeat(48) && /oauth\/itad/.test(pk.redirect);
    window.__oauth(`bantaapps://oauth/itad?code=good&state=${pk.state}`);
    out.signed = await wait(() => /tok1/.test(__app.db.get("itad_token") || "") && !__app.ui.job);
    window.__oauth(`bantaapps://oauth/itad?code=good&state=forged`); out.forged = true;
    __app.db.set("itad_key", ""); __app.db.set("itad_token", "");
    return out;
  });
  // ---- 0.6.7: Doctor Who stories told "after" in another timeline wait for it (The Forbidden Time, Falling: Ben & Polly)
  const n67 = await A(() => {
    const T = Kit.mods.timeline, D = T.data(), out = {}, me = T.mine();
    const keep = JSON.stringify(me.works || {});
    const g0 = D.groups.find(g => g.tabs.some(t => t.name === "S4")), S4 = g0.tabs.find(t => t.name === "S4");
    const gB = D.groups.find(g => g.tabs.some(t => t.name === "Ben & Polly")), BP = gB.tabs.find(t => t.name === "Ben & Polly");
    const s4 = T.itemsOf(g0, S4), iF = s4.findIndex(it => it.k === "falling|audio|");
    me.works = {}; for (const it of s4.slice(0, iF)) me.works[it.k] = { done: true };
    T.saveMine();
    out.waits = (T.waitsFor("falling|audio|") || {}).tab === "Ben & Polly";
    const hero = () => { __app.ui.tl = __app.ui.tl || {}; return T.render(); };
    // the section's Next up skips Falling
    const nextIn = (g, t) => { const it = T.itemsOf(g, t).find(it => !(me.works[it.k] || {}).done && !T.waitsFor(it.k)); return it && it.k; };
    out.s4next = nextIn(g0, S4);
    out.bpForbidden = !!T.waitsFor("theforbiddentime|audio|");
    T.openStory("falling|audio|"); out.sheet = /Told after the Ben &amp; Polly timeline|Told after the Ben & Polly timeline/.test(document.querySelector("#overlay").innerHTML); document.querySelector("#overlay").innerHTML = "";
    out.home = (T.next() || {}).k !== "falling|audio|";
    // S4 with only the two waiting stories left: Next up offers what Ben & Polly can play next
    for (const it of s4) if (it.k !== "falling|audio|" && it.k !== "theforbiddentime|audio|") me.works[it.k] = { done: true };
    T.saveMine(); __app.ui.tl = __app.ui.tl || {};
    const html = T.render.call ? (() => { const d = T.data(); const gi = d.groups.indexOf(g0), ti = g0.tabs.indexOf(S4); T.act("tlgo", { dataset: { g: String(gi), t: String(ti) } }); return T.render(); })() : "";
    out.fallback = /Next up: [^<]*<span class="muted">\(Ben &amp; Polly first\)/.test(html) && !/Next up: (Falling|The Forbidden Time)/.test(html);
    // a timeline's own "After" run follows its own order: nothing in Susan waits for Susan
    const gS = D.groups.find(g => g.tabs.some(t => t.name === "Susan")), SU = gS.tabs.find(t => t.name === "Susan");
    out.susan = T.itemsOf(gS, SU).every(it => { const w = T.waitsFor(it.k, SU.id); return !w || w.tab !== "Susan"; });
    // once all of Ben & Polly before its "After" place is done, Falling is free
    for (const it of BP.items) if (it.k !== "falling|audio|") me.works[it.k] = { done: true };
    T.saveMine();
    out.free = !T.waitsFor("falling|audio|");
    me.works = JSON.parse(keep); T.saveMine();
    return out;
  });
  ok(n67.waits && n67.s4next === "thetenthplanet|tv|" && n67.bpForbidden && n67.sheet && n67.home && n67.free && n67.fallback && n67.susan, "Doctor Who: Falling and The Forbidden Time wait for the Ben & Polly timeline: " + JSON.stringify(n67));
  ok(n66.ran && n66.deal, "IsThereAnyDeal: best price in any store and lowest ever: " + JSON.stringify(n66));
  ok(n66.filter && n66.sheet, "Games: At its lowest filter, Low badge, Best price block with the subscription: " + JSON.stringify(n66) + " " + n66.dbg);
  ok(n66.pkce && n66.signed, "IsThereAnyDeal sign-in comes back to the app and is finished there");
  // ---- 0.6.8: the title under a cover opens it; a suggestion opens a page with Add
  const n68 = await A(async () => {
    const out = {}; __app.go("watch", "library"); await new Promise(r => setTimeout(r, 100));
    const cap = document.querySelector("#view .tile .cap"); if (cap) cap.click(); out.cap = !!document.querySelector("#overlay .sheet"); document.querySelector("#overlay").innerHTML = "";
    __app.db.cacheSet("recs:now", { at: Date.now(), items: [{ tmdb: 4242, type: "movie", title: "Page Film", year: 2011, poster: "", genres: ["Drama"], vote: 7, votes: 500, because: ["Heat"], overview: "" }] });
    __app.go("home"); const row = document.querySelector('#view [data-action="recopen"] b'); if (row) row.click();
    out.page = /Page Film/.test((document.querySelector("#overlay .sheet") || {}).textContent || "") && !!document.querySelector('#overlay [data-action="findadd"]');
    const add = document.querySelector('#overlay [data-action="findadd"][data-st="watchlist"]'); if (add) add.click();
    out.added = !!__app.lib.find({ type: "movie", title: "Page Film", year: 2011 });
    document.querySelector("#overlay").innerHTML = "";
    return out;
  });
  // ---- 0.6.9: history, duplicates, friends' sends and activity, the owner's page, Steam numbers, backlog in hours
  const n69 = await A(async () => {
    const out = {}, wait = async (f, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await new Promise(r => setTimeout(r, 30)); } return false; };
    const press = (action, extra = {}) => { const b = document.createElement("button"); b.dataset.action = action; Object.assign(b.dataset, extra); document.body.appendChild(b); b.click(); b.remove(); };
    // history: keep a copy, change something, go back
    press("snapnow"); const n0 = JSON.parse(__app.db.get("snaps", "[]"))[0];
    out.snap = !!n0 && n0.why === "kept by hand";
    const doomed = __app.lib.add({ type: "movie", title: "Added After The Copy", year: 2001 }, "watchlist").item; __app.lib.save();
    press("snaprestore", { n: String(n0.n) }); await wait(() => document.querySelector("#dlgOk")); document.querySelector("#dlgOk").click();
    out.restored = !__app.lib.find({ type: "movie", title: "Added After The Copy", year: 2001 }) && JSON.parse(__app.db.get("snaps", "[]"))[0].why === "before going back to an earlier copy";
    // duplicates
    const L0 = __app.lib, d1 = L0.add({ type: "movie", title: "Dup Film", year: 1999, imdb: "tt7770001" }, "watched").item; d1.rating = 8;
    const d2 = Lib.blank({ id: "x-dup", type: "movie", title: "The Dup Film", year: 2000, status: "watchlist", notes: "second copy" }); L0.items[d2.id] = d2; L0.save();
    press("dupopen"); out.dupList = /Dup Film/.test(document.querySelector("#overlay").textContent) && /The Dup Film/.test(document.querySelector("#overlay").textContent);
    const mb = [...document.querySelectorAll('#overlay [data-action="dupmerge"]')].find(b => /Dup Film/.test(b.closest(".card").textContent)); if (mb) mb.click();
    out.merged = !L0.get("x-dup") && L0.get(d1.id).notes === "second copy" && L0.get(d1.id).rating === 8 && /before merging duplicates/.test(__app.db.get("snaps"));
    document.querySelector("#overlay").innerHTML = "";
    // friends: an inbox item and what they did lately
    __app.db.cacheSet("people:now", { at: Date.now(), people: [{ name: "pal", lib: [], games: [], books: [], recent: [{ kind: "watched", type: "movie", title: "Pal Watched This", year: 2020, date: "2026-11-15", rating: 8 }] }] });
    __app.db.cacheSet("inbox:now", { at: Date.now(), items: [{ id: "i1", from: "pal", at: Date.now(), note: "watch it", item: { type: "movie", title: "Sent Film", year: 2012, tmdb: 5151 } }] });
    __app.go("home"); const hv = document.querySelector("#view").textContent;
    out.inbox = /From friends/.test(hv) && /Sent Film/.test(hv) && /“watch it”/.test(hv);
    out.lately = /Lately/.test(hv) && /pal watched · ★ 8/.test(hv);
    document.querySelector('#view [data-action="inboxopen"] b').click();
    out.inboxPage = /Sent Film/.test(document.querySelector("#overlay").textContent) && /from pal: watch it/.test(document.querySelector("#overlay").textContent) && /Send to pal/.test(document.querySelector("#overlay").textContent);
    document.querySelector("#overlay").innerHTML = "";
    // the owner's page (the website answering as the real one would)
    const prev = window.__webSrv;
    window.__webSrv = (m, url, body) => /api\/admin/.test(url) ? { status: 200, body: JSON.stringify({ version: "0.6.9", node: "v22", uptime: 90000, people: [{ name: "me", owner: true, at: Date.now() - 60000, sync: Date.now() - 7200000, size: 3e6, shares: true, calendar: true }, { name: "pal", at: 0, sync: 0, size: 0 }], disk: { free: 5e8, total: 16e9 }, lastDaily: "2026-11-18", autoUpdate: false, apks: [] }) } : prev ? prev(m, url, body) : { status: 404, body: "{}" };
    __app.db.set("web_sync_url", "https://saga.test");
    press("webadmin"); await wait(() => /People/.test(document.querySelector("#overlay").textContent));
    const av = document.querySelector("#overlay").textContent;
    out.admin = /Saga 0\.6\.9/.test(av) && /pal/.test(av) && /never/.test(av) && /Less than 1 GB free/.test(av) && /auto-update\.sh on/.test(av);
    // 0.6.9.5: sharing per person and part
    { let posted = null;
      window.__webSrv = (m, url, body) => /api\/share/.test(url) ? (m === "POST" ? (posted = JSON.parse(body), { status: 200, body: JSON.stringify({ ok: true, people: ["pal"] }) }) : { status: 200, body: JSON.stringify({ on: true, to: null, people: ["pal"] }) }) : /api\/people/.test(url) ? { status: 200, body: '{"me":"me","people":[]}' } : prev(m, url, body);
      __app.ui.share = null; __app.ui.setGroup = "*"; __app.go("settings"); await wait(() => document.querySelector('[data-action="sharepart"][data-p="pal"][data-k="dw"]'));
      press("sharepart", { p: "pal", k: "dw" }); await wait(() => posted);
      out.share = posted.on === true && posted.to.pal.dw === true && posted.to.pal.lib === true && document.querySelector('[data-action="sharepart"][data-k="dw"]').getAttribute("aria-pressed") === "true";
      out.shareD = JSON.stringify(posted); }
    window.__webSrv = prev; __app.db.set("web_sync_url", ""); document.querySelector("#overlay").innerHTML = "";
    // Steam numbers on a game, backlog card in Games › Stats
    const g = __app.games.add({ title: "Steam Numbers", steam: 99001, hours: 12, owned: "PC" }, "backlog").game; g.steamMins = 750; g.steamLast = "2026-11-12"; g.ach = { got: 3, total: 4 }; __app.games.save();
    Kit.mods.games.open(g.id); const gs = document.querySelector("#overlay").textContent;
    out.steam = /13 h played/.test(gs) && /last played 2026-11-12/.test(gs) && /achievements 3\/4 \(75%\)/.test(gs);
    document.querySelector("#overlay").innerHTML = "";
    __app.go("games"); press("gview", { v: "stats" }); out.backlog = /Backlog/.test(document.querySelector("#view").textContent) && /h to beat/.test(document.querySelector("#view").textContent);
    press("gview", { v: "grid" });
    // 0.6.9.8: syncing one series applies the episodes you rated on IMDb (rated = watched) and their ratings
    { const sv = __app.lib.all().find(x => x.type === "show" && x.epl && x.epl.length > 4);
      if (sv) {
        const k = [...sv.epl].map(x => `${x[0]}:${x[1]}`).find(x => !sv.eps[x] && !x.startsWith("0:"));
        const prevU = __app.db.get("imdb_user"), prevT = __app.db.get("username"), prevTok = __app.db.get("token");
        __app.db.set("imdb_user", ""); __app.db.set("username", ""); __app.db.set("token", "");
        __app.db.set("imdb_eps", JSON.stringify({ [sv.imdb || "tt0999999"]: { t: sv.title, y: sv.year, eps: { [k]: "2026-11-17" }, r: { [k]: 9 } } }));
        await __app.libSyncOne(sv);
        out.epsync = !!sv.eps[k] && sv.er && sv.er[k] === 9; out.epsyncD = `${sv.title} ${k} ${JSON.stringify(sv.eps[k])} ${JSON.stringify((sv.er || {})[k])}`;
        __app.db.set("imdb_user", prevU); __app.db.set("username", prevT); __app.db.set("token", prevTok);
      } else { out.epsync = false; out.epsyncD = "no series with an episode list in the test library"; } }
    // 0.6.9.7: canon games you don't have, in the Games tab
    { __app.db.replaceCanon("canonlist", [{ franchise: "Made Up Saga", title: "Made Up Saga II", year: 2004, medium: "Video Game" }, { franchise: "Made Up Saga", title: "Made Up Saga III", year: 2099, medium: "Video Game" }]);
      __app.go("games"); press("gview", { v: "canon" }); const t = document.querySelector("#view").textContent;
      press("gcanonadd", { t: "Made Up Saga II", y: "2004", i: "", f: "Made Up Saga" });
      const g = __app.games.games.find(x => x.title === "Made Up Saga II");
      out.gcanon = /Made Up Saga II/.test(t) && /Not out yet/.test(t) && g && g.status === "wishlist" && ![...document.querySelectorAll("#view .listcard b")].some(b => b.textContent === "Made Up Saga II");
      out.gcanonD = t.replace(/\s+/g, " ").slice(0, 200); __app.db.replaceCanon("canonlist", []); __app.games.games = __app.games.games.filter(x => x !== g); press("gview", { v: "grid" }); __app.go("home"); }
    // 0.6.9.6: settings that travel with the settings file (sections, language, look), keys only when asked; dropped
    // shows out of Upcoming
    { const db = __app.db; __app.prefsOut(); const before = db.get("prefs_features");
      db.set("prefs_features", JSON.stringify(Object.assign(JSON.parse(before || "{}"), { music: 0 }))); db.set("look_saga_accent", "teal");
      const ch = __app.prefsIn();
      out.prefs = ch && !BantaShell.feature("music") && document.documentElement.dataset.accent === "teal";
      db.set("prefs_features", before); db.set("look_saga_accent", "-"); __app.prefsIn();
      out.prefs = out.prefs && BantaShell.feature("music") !== false && !document.documentElement.dataset.accent;
      db.set("lastfm_key", "abc123"); const kt = __app.keysText(); const ki = __app.keysIn(JSON.stringify({ steam_key: "zz9", plain_value: "x" })); out.keysD = [/lastfm_key/.test(kt), /claude_key/.test(kt), ki, db.get("steam_key"), db.get("plain_value")]; out.keys = /lastfm_key/.test(kt) && !/claude_key/.test(kt) && ki === 1 && db.get("steam_key") === "zz9" && !db.get("plain_value");
      const dropped = __app.lib.add({ type: "show", title: "Dropped Made Up", year: 2020, imdb: "tt0555555" }, "watching").item; dropped.status = "dropped";
      out.dropped = __app.notDropped([{ show: "Dropped Made Up", imdb: "tt0555555" }, { show: "Kept Show", imdb: "tt0555556" }]).length === 1; __app.lib.remove(dropped.id); }
    // 0.6.9.5: the Music section: empty, then with Last.fm numbers
    { __app.go("music"); const e0 = document.querySelector("#view").textContent;
      const now = Math.floor(Date.now() / 1000);
      Saga.Native.save("music.json", JSON.stringify({ info: { playcount: 4321, artists: 12, tracks: 40, since: 1500000000 }, recent: [{ artist: "Made Up Band", track: "Tune", at: now - 3600 }, { artist: "Made Up Band", track: "Tune 2", at: now - 7200 }],
        top: { "7day": { artists: [{ name: "Made Up Band", plays: 2 }], tracks: [{ name: "Tune", artist: "Made Up Band", plays: 1 }], albums: [] } }, lastfmAt: Date.now() }));
      __app.db.set("lastfm_user", "someone"); __app.db.set("lastfm_key", "k"); Kit.mods.music.reset(); __app.render();
      const e1 = document.querySelector("#view").textContent, nb = document.querySelectorAll("#view .mbars .mb").length;
      press("muview", { v: "top" }); press("muperiod", { v: "7day" }); const e2 = document.querySelector("#view").textContent;
      out.music = /Connect Last\.fm/.test(e0) && /4,321/.test(e1) && /Last 30 days/.test(e1) && nb >= 54 && /Made Up Band/.test(e2) && !!document.querySelector('#tabs [data-sec="music"]');
      out.musicD = JSON.stringify([/Connect Last\.fm/.test(e0), /4,321/.test(e1), /Last 30 days/.test(e1), document.querySelectorAll("#view .mbars .mb").length, /Made Up Band/.test(e2), !!document.querySelector('#tabs [data-sec="music"]'), e0.slice(0, 80)]); Kit.mods.music.ui.view = "overview"; __app.go("home"); }
    // 0.6.9.3: the Doctor Who list from a note: check first, then import
    { press("dwimport"); await wait(() => document.querySelector("#dwnote"));
      document.querySelector("#dwnote").value = "-----S1-----\n1. An Unearthly Child (9)\n2. The Daleks (8) -[Susan]\n3. Nowhere Story (5)\n";
      press("dwnoteprev"); const pv = document.querySelector("#dwnoteout").textContent;
      out.dwPrev = /2 new/.test(pv) && /1 not found/.test(pv) && !document.querySelector("#dwnotego").disabled;
      press("dwnotego"); out.dwDone = Kit.mods.timeline.mine().works["anunearthlychild|tv|"].rating === 9 && /from a note/.test(__app.db.get("snaps")); out.dwD = pv; }
    // 0.6.9.2: an address typed without https:// still works; a failed call says what to do
    { const prev2 = window.__webSrv; let seen = "";
      window.__webSrv = (m, url) => { seen = url; return { status: 0, error: "javax.net.ssl.SSLHandshakeException: connection closed" }; };
      __app.db.set("web_sync_url", "saga.test/"); let err = "";
      try { await __app.webApi("GET", "api/people"); } catch (e) { err = e.message; }
      __app.db.set("web_sync_url", "pi.example.ts.net:8443");
      const w8443 = __app.webWhy({ status: 0, error: "javax.net.ssl.SSLHandshakeException: connection closed" }), wdns = __app.webWhy({ status: 0, error: "java.net.UnknownHostException: Unable to resolve host" });
      out.webAddr = seen === "https://saga.test/api/people" && /starting with https/.test(err) && /works only with Tailscale on/.test(w8443) && /Funnel is on/.test(wdns);
      out.webAddrD = seen + " | " + err + " | " + w8443;
      window.__webSrv = prev2; __app.db.set("web_sync_url", ""); }
    // 0.6.9.1: titles and games marked watched / finished only because an IMDb list file was imported go back
    const db = __app.db; db.set("fix_listed_v1", "");
    db.addItems([{ title: "Only Listed Film", year: 2004, medium: "Movie", imdb: "tt6660001", date: "2004-03-03" }, { title: "Listed And Ticked", year: 2005, medium: "Movie", imdb: "tt6660002", date: "2005-01-01" },
      { title: "Only Listed Game", year: 2014, medium: "Video Game", imdb: "tt6660003", date: "2014-01-01" }], "imdb", "watched", "");
    const lf = __app.lib.add({ type: "movie", title: "Only Listed Film", year: 2004, imdb: "tt6660001" }, "watchlist").item; lf.status = "watched"; lf.watches = ["2004-03-03"];
    const lt = __app.lib.add({ type: "movie", title: "Listed And Ticked", year: 2005, imdb: "tt6660002" }, "watchlist").item; lt.status = "watched"; lt.watches = ["2023-08-08"];
    const lg = __app.games.add({ title: "Only Listed Game", imdb: "tt6660003", src: "imdb", date: "2014-01-01" }, "done").game;
    const fx = __app.fixListedWatched();
    out.fix = fx && fx.films === 1 && fx.games === 1 && lf.status === "watchlist" && !lf.watches.length && lt.status === "watched" && lg.status === "wishlist" && !lg.plays.length
      && db.items("imdb", ["watched"]).every(r => r.rating > 0) && __app.fixListedWatched() === null && /only on a list/.test(db.get("snaps"));
    out.fixd = JSON.stringify(fx);
    // 0.7.4: series IMDb's ratings page wrongly gave as watched (no rating anywhere) go; one you rated, or with other origins, stays
    db.set("fix_imdbnoise_v1", "");
    db.addItems([{ title: "Never Seen Series", year: 2019, medium: "TV Series", imdb: "tt6660011" }, { title: "Also On Trakt", year: 2018, medium: "TV Series", imdb: "tt6660012" }], "imdb", "watched", "");
    db.addItems([{ title: "Also On Trakt", year: 2018, medium: "TV Series", imdb: "tt6660012" }], "trakt", "watched", "");
    const ns = __app.lib.add({ type: "show", title: "Never Seen Series", year: 2019, imdb: "tt6660011" }, "watched").item; ns.src = "imdb";
    const ot = __app.lib.add({ type: "show", title: "Also On Trakt", year: 2018, imdb: "tt6660012" }, "watched").item; ot.src = "imdb";
    const nz = __app.fixImdbPageNoise();
    __app.lib.adopt(db.items(null, ["watched", "rated", "watchlist", "list"]));
    out.noise = nz && nz.films === 1 && !__app.lib.get(ns.id) && !__app.lib.all().some(x => x.title === "Never Seen Series") && !!__app.lib.get(ot.id) && !db.items("imdb", ["watched"]).some(r => !(r.rating > 0)) && __app.fixImdbPageNoise() === null;
    out.noised = JSON.stringify(nz);
    return out;
  });
  ok(n69.epsync, "syncing one series ticks and rates the episodes you rated on IMDb: " + n69.epsyncD);
  ok(n69.gcanon, "Games › Missing: canon games you don't have, not-out-yet apart, one tap to the wishlist: " + n69.gcanonD);
  ok(n69.prefs && n69.keys && n69.dropped, "settings travel (sections, look), keys on request, dropped shows out of Upcoming: " + JSON.stringify([n69.prefs, n69.keys, n69.dropped, n69.keysD]));
  ok(n69.music, "Music section: connect card, then Last.fm numbers, bars and top lists: " + n69.musicD);
  ok(n69.share, "sharing chosen per person and part: " + n69.shareD);
  ok(n69.dwPrev && n69.dwDone, "Doctor Who list from a note: checked, then imported, with a copy first: " + n69.dwD);
  ok(n69.webAddr, "website address without https:// works; a :8443 failure explains itself: " + n69.webAddrD);
  ok(n69.fix, "listed-only titles and games marked watched by an old import go back to To watch / Wishlist, once, with a copy first: " + n69.fixd);
  ok(n69.snap && n69.restored, "History: a copy, and going back to it (with a copy of now first): " + JSON.stringify(n69));
  ok(n69.dupList && n69.merged, "Duplicates: shown side by side, merged with everything kept");
  ok(n69.inbox && n69.lately && n69.inboxPage, "Friends: what they sent you, what they did lately, Send to on a page");
  ok(n69.admin, "Website status for the owner: people, last seen, space, updates");
  ok(n69.steam && n69.backlog, "Games: Steam hours and achievements on a game, backlog in hours");
  ok(n68.cap && n68.page && n68.added, "a cover's title opens it; a suggestion's page has Add: " + JSON.stringify(n68));
  ok(n65.why && n65.why2, "Why is this here? names the list and the rating: " + JSON.stringify(n65));
  ok(n65.dlg && n65.purged && n65.undone, "switching a list off removes only titles it alone brought and you haven't touched; Undo");
  ok(n69.noise, "series IMDb's page wrongly gave as watched are removed and don't come back; ones with other origins stay: " + n69.noised);
  ok(n65.upd && n65.updHidden, "a newer Saga is announced on Home, with Get it, and can be hidden");
  ok(n65.recs && n65.recHide, "For you: suggestions from your ratings, Not interested");
  ok(n65.friends && n65.friendAdd && n65.friendOn, "friends: You and …, what they loved, their rating on a title");
  for (const [w, h] of [[390, 844], [820, 1100], [1280, 860]]) {
    await pg.setViewportSize({ width: w, height: h });
    await A(() => { __app.go("home"); __app.render(); });
    await pg.screenshot({ path: `${OUT}/w${w}-home.png` });
    await A(() => { __app.go("games"); __app.render(); });
    await pg.screenshot({ path: `${OUT}/w${w}-games.png` });
    const over = await A(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 2, `no sideways scrolling at ${w}px (${over})`);
  }
  // 0.7.0: on a big screen a title opens beside the list, which stays usable; keys move around
  await pg.setViewportSize({ width: 1500, height: 900 });
  await A(() => { __app.go("library"); __app.render(); });
  const two = await A(async () => { const ids = [...document.querySelectorAll('#view [data-action="libopen"]')].map(x => x.dataset.id).filter((v, i, a) => a.indexOf(v) === i).slice(0, 2); __app.openLib(ids[0]); await new Promise(r => setTimeout(r, 300));
    const el = document.querySelector(`#view [data-action="libopen"][data-id="${ids[1]}"]`); const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + 10, r.top + r.height / 2);
    return { side: document.body.classList.contains("sideopen"), close: !!document.querySelector("#overlay .sideclose"), reachable: !!(hit && hit.closest(`[data-id="${ids[1]}"]`)), ids }; });
  await pg.screenshot({ path: `${OUT}/w1500-side.png` });
  await pg.keyboard.press("Escape");
  const esc1 = await A(() => !document.querySelector("#overlay").innerHTML && !document.body.classList.contains("sideopen"));
  await pg.keyboard.press("g"); const gk = await A(() => __app.ui.sec);
  ok(two.side && two.close && two.reachable && esc1 && gk === "games", "big screen: details beside the list, the list still usable, Esc closes, keys switch sections: " + JSON.stringify(Object.assign(two, { esc1, gk })));
  // 0.7.6: the night refresh: a full sync, the jobs, every series; written down in Done by itself
  const nr = await A(async () => { await __app.nightRun(); return JSON.parse(__app.db.get("auto_log", "[]")).find(x => x.k === "night"); });
  ok(nr && /Night refresh: full sync/.test(nr.what) && /series refreshed/.test(nr.what), "night refresh runs and says what it did: " + JSON.stringify(nr));
  // 0.7.8: Doctor Who timeline → Books, Watch, Games; out again when Doctor Who is off (unless finished)
  const dwm = await A(() => {
    const T = Kit.mods.timeline, all = T.allWorks(), by = t => all.filter(w => w.type === t);
    const r1 = __app.dwMirror();
    const nb = __app.books.books.filter(b => b.dw).length, nf = __app.lib.all().filter(i => i.dw).length, ng = __app.games.games.filter(g => g.dw).length;
    const r2 = __app.dwMirror(); // nothing twice
    // finish one novel, then switch Doctor Who off
    const fin = __app.books.books.find(b => b.dw && b.dwAuto); BantaShell.setFeature && BantaShell.setFeature("dw", false); fin.status = "read";
    const r3 = __app.dwMirror();
    const left = __app.books.books.filter(b => b.dw).length + __app.lib.all().filter(i => i.dw).length + __app.games.games.filter(g => g.dw).length;
    BantaShell.setFeature("dw", true);
    return { novels: by("novel").length, films: by("film").length, games: by("game").length, r1, nb, nf, ng, r2, r3, left, finKept: __app.books.books.includes(fin) };
  });
  ok(dwm.novels > 0 && dwm.nb >= dwm.novels * 0.8 && dwm.nf > 0 && dwm.r2.books + dwm.r2.films + dwm.r2.games === 0 && dwm.finKept && dwm.r3.removed > 0 && dwm.left >= 1,
    "Doctor Who media mirrored to Books/Watch/Games, nothing twice, unfinished ones out when Doctor Who is off: " + JSON.stringify(Object.assign({}, dwm, { r1: dwm.r1, r3: dwm.r3 })));
  // 0.7.8: settings in two panes on a wide screen; the title's poster opens whole
  await pg.setViewportSize({ width: 1500, height: 900 });
  const sp = await A(() => { __app.ui.setGroup = ""; __app.go("settings"); return { two: !!document.querySelector(".setpage.two .setnav") && !!document.querySelector(".setbody h2"), cur: (document.querySelector('.setrow[aria-current="true"]') || {}).textContent || "" }; });
  ok(sp.two && /Accounts/.test(sp.cur), "website settings: two panes, first group open: " + JSON.stringify(sp));
  const pview = await A(() => { __app.viewPoster("https://image.tmdb.org/t/p/w342/x.jpg", "X"); const v = document.querySelector(".postview img"); const src = v && v.getAttribute("src"); document.querySelector(".postview").click(); return { src, gone: !document.querySelector(".postview") }; });
  ok(/\/original\//.test(pview.src) && pview.gone, "poster viewer opens the full size and closes: " + JSON.stringify(pview));
  await pg.setViewportSize({ width: 390, height: 844 });
  console.log("SAGA 5 UI TESTS PASSED");
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
