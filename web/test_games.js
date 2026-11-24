// Games core: moving the old Games tab's data over, statuses and playthroughs, Steam linking/prices/dates,
// imports, games from IMDb ratings; and the Trakt outbox (two-way sync) from the library.
const G = require("./games.js"), L = require("./library.js");
const assert = (c, m) => { if (!c) throw new Error(m); };
(async () => {
  // ---- old storage → new model
  const base = [{ t: "Hades", od: "September 17, 2020", op: "PC", rn: "N/A", rd: "N/A", rp: "N/A", ow: "Steam", h: "22", hb: "N/A", r: "8.6", f: "Hades", m: "Hades", n: 0 },
    { t: "Hades", od: "September 17, 2020", op: "Switch", rn: "N/A", rd: "N/A", rp: "N/A", ow: "N/A", h: "22", hb: "N/A", r: "8.6", f: "Hades", m: "Hades", n: 0 },
    { t: "Silksong", od: "TBA", op: "PC", rn: "N/A", rd: "N/A", rp: "N/A", ow: "N/A", h: "N/A", hb: "N/A", r: "N/A", f: "Hollow Knight", m: "Hollow Knight", n: 2 }];
  const ls = { gc_base: JSON.stringify(base), gc_done: JSON.stringify({ "Hades|September 17, 2020": Date.parse("2021-02-02T10:00:00Z") }),
    gc_ov: JSON.stringify({ "Hades|September 17, 2020#Switch": { hid: 1 }, "Silksong|TBA": { t: "Hollow Knight: Silksong", target: 19.99 } }),
    gc_live: JSON.stringify({ "Silksong|TBA": { steam: 1030300, rel: "2025-09-04" } }), gc_ex: JSON.stringify([{ id: "x1", cu: 1, t: "Celeste", od: "January 25, 2018", op: "PC", rn: "N/A", ow: "PC", f: "Celeste", m: "Celeste", n: 0 }]),
    gc_acm: JSON.stringify({ "Hades|September 17, 2020": { ir: 9 } }) };
  assert(G.hasOld(ls), "old data detected");
  const rows = G.fromOld(ls);
  assert(rows.length === 4, "all rows, duplicates kept apart: " + rows.length);
  const h = rows[0], sw = rows[1], sk = rows[2], ce = rows[3];
  assert(h.status === "done" && h.plays[0] === "2021-02-02" && h.rating === 9 && h.date === "2020-09-17" && h.hours === 22 && h.imdbR === 8.6, "Hades: " + JSON.stringify(h));
  assert(sw.hidden && sw.oldId === "Hades|September 17, 2020#Switch", "second platform keeps its own id and hidden mark");
  assert(sk.title === "Hollow Knight: Silksong" && sk.next && sk.steam === 1030300 && sk.date === "2025-09-04" && sk.target === 19.99, "overrides, live date, next, target: " + JSON.stringify(sk));
  assert(ce.src === "added" && ce.status === "backlog", "custom games come too");
  // snapshot form (snap_games.json): same keys without the prefix
  assert(G.fromOld({ base, done: { "Hades|September 17, 2020": 1 } }).filter(g => g.status === "done").length === 1, "snapshot form");
  // built-in list only (own edition, Games never opened)
  assert(G.fromOld({}, base).length === 3, "built-in list");

  // ---- model
  const lib = new G.Games(null);
  lib.games = rows;
  assert(lib.visible().length === 3, "hidden left out");
  G.logPlay(h, "2024-05-05");
  assert(h.plays.length === 2 && lib.recent(1)[0].date === "2024-05-05", "second playthrough, recent");
  G.removePlay(h, 0); G.removePlay(h, 0);
  assert(h.status === "backlog", "no playthroughs left: back to backlog");
  G.setStatus(h, "done", "2025-01-01");
  assert(h.plays[0] === "2025-01-01", "finished with date");
  const { game: o, existed } = lib.add({ title: "Outer Wilds", date: "2019-05-28" }, "wishlist");
  assert(!existed && o.franchise === "Outer Wilds" && lib.add({ title: "outer wilds" }).existed, "add and find");
  assert(G.franchiseGuess("Mass Effect 2") === "Mass Effect", "franchise guess");
  const mv = lib.multiverses();
  assert(mv.some(m => m.name === "Hollow Knight" && m.total === 1) || mv.some(m => m.standalone && m.all.some(g => /^Hollow Knight/.test(g.title))), "multiverses (0.8.2: one-game ones in Standalone games)");
  assert(lib.nextUp().some(g => g === sk), "next up");

  // ---- Steam
  const calls = [];
  const http = async (m, url) => {
    calls.push(url);
    if (/storesearch.*Outer%20Wilds/.test(url)) return { status: 200, body: JSON.stringify({ items: [{ id: 753640, name: "Outer Wilds", price: { final: 2299, initial: 2299 } }] }) };
    if (/storesearch.*Celeste/.test(url)) return { status: 200, body: JSON.stringify({ items: [{ id: 504230, name: "Celeste" }] }) };
    if (/storesearch/.test(url)) return { status: 200, body: JSON.stringify({ items: [] }) };
    if (/appdetails\?appids=.*filters=price_overview/.test(url)) return { status: 200, body: JSON.stringify({ 753640: { success: true, data: { price_overview: { final: 1149, initial: 2299, discount_percent: 50 } } }, 1030300: { success: true, data: { price_overview: { final: 1950, initial: 1950, discount_percent: 0 } } } }) };
    if (/appdetails\?appids=1030300/.test(url)) return { status: 200, body: JSON.stringify({ 1030300: { success: true, data: { release_date: { coming_soon: false, date: "4 Sep, 2025" } } } }) };
    return { status: 404, body: "" };
  };
  const linked = await G.linkSteam(lib, http, 10, 0);
  assert(linked >= 2 && o.steam === 753640 && ce.steam === 504230, "linked by exact title: " + linked);
  assert(lib.meta.noSteam[h.id], "not found is remembered (no search next time)");
  const alerts = await G.steamPrices(lib, http);
  assert(alerts.length === 2 && alerts.some(a => a.g === o && a.why === "sale") && alerts.some(a => a.g === sk && a.why === "target"), "sale and target alerts: " + JSON.stringify(alerts.map(a => [a.g.title, a.why])));
  assert((await G.steamPrices(lib, http)).length === 0, "no repeat alert at the same price");
  sk.date = ""; assert(await G.steamDates(lib, http, 5) >= 1 && sk.date === "2025-09-04", "release date from Steam");

  // ---- imports and IMDb
  const r = G.importRows(lib, [{ title: "Celeste", status: "done", date: "2019-01-01", rating: 9 }, { title: "Tunic", status: "backlog", platform: "PC", owned: "PC (Steam)", steam: 553420, hours: 30 }], "Steam library");
  assert(r.added === 1 && r.updated === 1 && ce.status === "done" && ce.plays.includes("2019-01-01") && !lib.find({ title: "Tunic" }).hours, "imports merge; Steam hours aren't time to beat");
  lib.remove(lib.find({ title: "Tunic" }).id);
  assert(G.importRows(lib, [{ title: "Tunic" }], "x").added === 0, "removed games stay removed");
  const im = G.fromImdb(lib, [{ title: "Elden Ring", year: 2022, imdb: "tt10215402", medium: "Video Game", kind: "rated", rating: 10 }, { title: "Some Film", medium: "Movie", kind: "rated" }, { title: "Pragmata", year: 2026, medium: "Video Game", kind: "list" }]);
  const er = lib.find({ title: "Elden Ring" });
  assert(im.added === 2 && er.status === "done" && er.rating === 10 && lib.find({ title: "Pragmata" }).status === "wishlist", "IMDb: rated = finished, listed = wishlist");
  assert(G.storeLinks(o)[0][1] === "https://store.steampowered.com/app/753640/", "store link");
  const idx = G.indexFor(lib);
  assert(idx.games.length === lib.visible().length && idx.next.length, "index");
  // persistence
  let saved = "";
  const p = new G.Games({ load: () => "", save: t => { saved = t; } }); p.games = lib.games; p.save();
  assert(new G.Games({ load: () => saved }).games.length === lib.games.length, "saved and loaded");

  // ---- Trakt outbox
  const lb = new L.Library(null);
  const m1 = lb.add({ type: "movie", title: "Alien", year: 1979, imdb: "tt0078748" }, "watchlist").item;
  lb.setStatus(m1, "watched", "2020-01-01"); lb.logWatch(m1, "2024-10-31"); lb.rate(m1, 9);
  const s1 = lb.add({ type: "show", title: "Severance", tmdb: 95396 }, "watching").item;
  s1.epl = [[1, 1, "2022-02-18", ""], [1, 2, "2022-02-18", ""], [1, 3, "2022-02-25", ""]];
  lb.toggleEp(s1, 1, 1, "2024-12-01"); lb.toggleEp(s1, 1, 2, "2024-12-02"); lb.toggleEp(s1, 1, 2); // unticked again
  const noIds = lb.add({ type: "movie", title: "Homemade" }, "watched").item; lb.logWatch(noIds, "2025-01-01");
  const posts = [];
  const th = async (m, url, o) => { posts.push([url.replace("https://api.trakt.tv", ""), JSON.parse(o.body)]); return { status: 201, body: JSON.stringify({ added: { movies: 2, episodes: 1 }, deleted: { episodes: 1 } }) }; };
  assert(/not signed in/.test(await L.traktPush(lb, th, "cid", "")), "needs sign-in");
  const msg = await L.traktPush(lb, th, "cid", "tok");
  const hist = posts.find(p => p[0] === "/sync/history")[1], rem = posts.find(p => p[0] === "/sync/history/remove")[1], rat = posts.find(p => p[0] === "/sync/ratings")[1];
  assert(hist.movies.length === 2 && hist.movies[1].watched_at.startsWith("2024-10-31") && hist.movies[0].ids.imdb === "tt0078748", "film watches with dates");
  assert(hist.shows[0].ids.tmdb === 95396 && hist.shows[0].seasons[0].episodes.length === 1 && hist.shows[0].seasons[0].episodes[0].number === 1, "the last state of each episode only");
  assert(rem.shows[0].seasons[0].episodes[0].number === 2, "unticked episode removed on Trakt");
  assert(rat.movies[0].rating === 9 && !posts.some(p => JSON.stringify(p).includes("Homemade")), "rating sent; titles without ids stay out");
  assert(!lb.outbox.length && /added/.test(msg), "outbox emptied: " + msg);
  console.log(`games: ${rows.length} moved over, ${linked} linked to Steam, ${alerts.length} alerts · Trakt: ${posts.length} requests`);
  console.log("GAMES AND TRAKT PUSH TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
