const assert = require("assert");
const C = require("./core.js"), L = require("./library.js"), I = require("./imports.js");
(async () => {
  // episodes ticked in bulk are remembered as such (stats leave them out); a single tick isn't
  { const lb = new L.Library(null); const it = lb.add({ type: "show", title: "Bulk Show", year: 2020 }, "watching").item;
    it.epl = [[1, 1, "2020-01-01"], [1, 2, "2020-01-08"], [1, 3, "2020-01-15"], [1, 4, "2020-01-22"]];
    lb.markUpTo(it, 1, 3); assert.deepStrictEqual(Object.keys(it.bulk).sort(), ["1:1", "1:2"]);
    lb.toggleEp(it, 1, 4); assert.ok(!it.bulk["1:4"] && it.eps["1:4"]);
    lb.toggleEp(it, 1, 1); assert.ok(!it.bulk["1:1"] && !it.eps["1:1"]);
    lb.markUpTo(it, 1, 2, "2024-05-05"); assert.ok(!it.bulk["1:1"], "a given date is a real date"); }
  // games: the indexed look-up finds the same game a full scan would
  { const G = require("./games.js"); const gl = new G.Games(null);
    for (let i = 0; i < 300; i++) gl.add({ title: "Game " + i, date: (1990 + i % 30) + "-01-01", steam: i % 3 ? 1000 + i : null, imdb: i % 5 ? null : "tt" + (500 + i) }, "backlog");
    const scan = o => { const n = G.norm(o.title), y = o.year; return gl.games.find(g => (o.steam && g.steam === o.steam) || (o.imdb && g.imdb === o.imdb) || (G.norm(g.title) === n && n && (!y || !G.yearOf(g) || Math.abs(G.yearOf(g) - y) <= 1))) || null; };
    for (const o of [{ title: "Game 7" }, { title: "game 8", year: 1998 }, { title: "Game 9", year: 1950 }, { title: "x", steam: 1010 }, { title: "x", imdb: "tt505" }, { title: "Nope" }, { title: "Game 12", steam: 99999 }])
      assert.strictEqual(gl.find(o), scan(o), JSON.stringify(o));
    const { game } = gl.add({ title: "Game 3", steam: 777 }); assert.strictEqual(gl.find({ title: "zz", steam: 777 }), game, "ids filled in later are found"); }
  // Up next in the canon: a franchise whose remaining entries are unreleased or undated has nothing "next"
  { const st = [{ franchise: "X", have: true, title: "A", year: 2000, medium: "Movie" }, { franchise: "X", have: false, title: "B", date: "2999-01-01", year: 2999, medium: "TV Series" },
      { franchise: "Y", have: true, title: "C", year: 2001, medium: "Movie" }, { franchise: "Y", have: false, title: "D", year: 2002, medium: "Movie" }, { franchise: "Y", have: false, title: "E", medium: "TV Series" }];
    assert.deepStrictEqual(C.upNext(st).map(c => c.title), ["D"]);
    assert.deepStrictEqual(C.releaseList(st).released.filter(c => c.upNext).map(c => c.title), ["D"]); }
  // Steam games page fallback
  const json = JSON.stringify({ strProfileName: "x", rgGames: [{ appid: 620, name: "Portal 2 & Co", playtime_forever: 754 }, { appid: 400, name: "Portal", playtime_forever: 0 }] });
  const html = `<html><template id="gameslist_config" data-profile-gameslist="${json.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></template></html>`;
  const sh = async (m, u) => /xml=1/.test(u) ? { status: 200, body: "<?xml version='1.0'?><response><error><![CDATA[This feature is not available]]></error></response>" }
    : /games\/\?tab=all/.test(u) ? { status: 200, body: html } : { status: 404, body: "" };
  const rows = await I.steamLibrary(sh, "https://steamcommunity.com/id/someone/");
  assert.deepStrictEqual(rows.map(r => [r.title, r.steam, r.hours]), [["Portal 2 & Co", 620, 12.6], ["Portal", 400, 0]]);
  await assert.rejects(I.steamLibrary(async () => ({ status: 200, body: '<div class="profile_private_info">This profile is private.</div>' }), "someone"), /private/);
  // Search with TMDB blocked: IMDb + TVmaze, merged
  const calls = [];
  const h = async (m, u) => {
    calls.push(u);
    if (/themoviedb/.test(u)) return { status: 0, body: "", error: 'java.net.UnknownHostException: Unable to resolve host "api.themoviedb.org"' };
    if (/sg\.media-imdb/.test(u)) return { status: 200, body: JSON.stringify({ d: [{ id: "tt0903747", l: "Breaking Bad", y: 2008, qid: "tvSeries", i: { imageUrl: "https://m.media-amazon.com/images/M/x._V1_.jpg" } }, { id: "tt1234567", l: "Breaking Bad Movie", y: 2019, qid: "movie" }, { id: "nm1", l: "Someone" }] }) };
    if (/tvmaze.*search/.test(u)) return { status: 200, body: JSON.stringify([{ show: { id: 169, name: "Breaking Bad", premiered: "2008-01-20", externals: { imdb: "tt0903747" }, genres: ["Drama"] } }]) };
    if (/itunes/.test(u)) return { status: 200, body: JSON.stringify({ results: [] }) };
    if (/tvmaze.*shows\/169/.test(u)) return { status: 200, body: JSON.stringify({ id: 169, name: "Breaking Bad", status: "Ended", _embedded: { episodes: [{ season: 1, number: 1, airdate: "2008-01-20", name: "Pilot" }, { season: 1, number: 2, airdate: "2008-01-27", name: "Cat's in the Bag" }] } }) };
    return { status: 404, body: "" };
  };
  const res = await L.search(h, "breaking bad", { tmdbKey: "abc" });
  const bb = res.filter(r => r.title === "Breaking Bad");
  assert.strictEqual(bb.length, 1, JSON.stringify(res));
  assert.strictEqual(bb[0].tvmaze, 169); assert.strictEqual(bb[0].imdb, "tt0903747");
  assert.ok(res.some(r => r.type === "movie" && r.imdb === "tt1234567"));
  // an item with a TMDB id still gets its episodes when TMDB is blocked
  const lib = new L.Library(null);
  const it = lib.add({ type: "show", title: "Breaking Bad", year: 2008, tmdb: 1396, imdb: "tt0903747" }, "watching").item;
  calls.length = 0;
  const lookup = async (m, u) => /lookup\/shows\?imdb=tt0903747/.test(u) ? { status: 200, body: JSON.stringify({ id: 169 }) } : h(m, u);
  assert.ok(await L.details(lookup, it, { tmdbKey: "abc" }));
  assert.strictEqual(it.epl.length, 2);
  assert.ok(!calls.some(u => /themoviedb/.test(u)), "TMDB skipped while it's known to be blocked");
  // IMDb-only movie gets a stable id
  assert.ok(lib.add({ type: "movie", title: "X", imdb: "tt7654321" }).item.id === "im:tt7654321");
  // rated episodes are kept by series
  const ex = C.pageExtract([JSON.stringify({ edges: [
    { node: { title: { id: "tt0959621", titleText: { text: "Pilot" }, titleType: { id: "tvEpisode" }, series: { series: { id: "tt0903747", titleText: { text: "Breaking Bad" } }, episodeNumber: { seasonNumber: 1, episodeNumber: 1 } } } }, userRating: { value: 9, date: "2021-03-04T10:00:00Z" } }] })]);
  const ep = ex.find(x => x.i === "tt0959621"), ser = ex.find(x => x.i === "tt0903747");
  assert.deepStrictEqual(ep.s, ["tt0903747", 1, 1, "2021-03-04"]);
  assert.ok(ser && !ser.r, "the series is not given the episode's rating");
  console.log("NEW TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
// 5.3: a finished series that has ended leaves Watching
(() => {
  const L2 = require("./library.js");
  const lib = new L2.Library(null);
  const a = lib.add({ type: "show", title: "Ended Done" }, "watching").item;
  a.epl = [[1, 1, "2020-01-01"], [1, 2, "2020-01-08"]]; a.eps = { "1:1": "2021-01-01", "1:2": "2021-01-02" }; a.ended = true;
  const b = lib.add({ type: "show", title: "Running Done" }, "watching").item;
  b.epl = [[1, 1, "2020-01-01"]]; b.eps = { "1:1": "2021-01-01" }; b.ended = false;
  const c = lib.add({ type: "show", title: "Ended Half" }, "watching").item;
  c.epl = [[1, 1, "2020-01-01"], [1, 2, "2020-01-08"]]; c.eps = { "1:1": "2021-01-01" }; c.ended = true;
  const d = lib.add({ type: "show", title: "Rated Ended" }, "watching").item; d.autoWatching = true; d.ended = true;
  assert.strictEqual(lib.settleAll(), 2);
  assert.deepStrictEqual([a.status, b.status, c.status, d.status], ["watched", "watching", "watching", "watched"]);
  assert.ok(a.watches.includes("2021-01-02"));
  console.log("SETTLE TESTS PASSED");
})();
// 5.3: compact AI answers
(() => {
  const C2 = require("./core.js");
  const rows = [1, 2, 3, 4].map(i => ({ franchise: "F", title: "T" + i, year: 2000 + i, medium: "Movie", date: null }));
  const vp = C2.verifyPrompt(rows);
  assert.ok(/^OUTPUT: plain lines/m.test(vp) && /1\. F \| T1 \| 2001 \| F \| -/.test(vp));
  const v = C2.parseVerify("2 | X | - | - | recap film\n3 | K | 2003-05-02 | - | date\nEND", rows);
  assert.deepStrictEqual(v.map(x => [x.c.title, x.verdict, x.date]), [["T2", "not_canon", null], ["T3", "ok", "2003-05-02"], ["T1", "ok", null], ["T4", "ok", null]]);
  const cut = C2.parseVerify("2 | D | - | 1 | same film", rows);
  assert.deepStrictEqual(cut.map(x => [x.c.title, x.verdict, x.same]), [["T2", "duplicate", 1]], "a cut-off answer only marks what it names");
  assert.deepStrictEqual(C2.parseCanonRows("# Alien\nAlien: Earth | S | 2025 | 2025-08-12\n**Alien: Romulus** | F | 2024 | -\n- Aliens: Fireteam Elite | G | 2021 | 2021-08-24").map(r => [r.franchise, r.title, r.medium, r.year, r.date]),
    [["Alien", "Alien: Earth", "TV Series", "2025", "2025-08-12"], ["Alien", "Alien: Romulus", "Movie", "2024", null], ["Alien", "Aliens: Fireteam Elite", "Video Game", "2021", "2021-08-24"]]);
  assert.deepStrictEqual(C2.parseCanonRows("NONE"), []);
  assert.strictEqual(C2.parseCanonRows('[{"franchise":"A","title":"B","medium":"Movie","year":"2000"}]').length, 1, "old JSON answers still read");
  // tokens: the line prompt is far shorter than a JSON template would be
  const np = C2.newsPrompt([["Alien", [{ title: "Alien", year: 1979, medium: "Movie" }]]], "2026-11-12");
  assert.ok(/Alien \(1979\) \[F\]/.test(np) && !/"franchise"/.test(np));
  console.log("AI FORMAT TESTS PASSED");
})();
// 5.4.1: Trakt episode ratings, Steam Web API
(async () => {
  const C3 = require("./core.js"), I3 = require("./imports.js");
  const st = new C3.Store();
  const n = C3.storeTrakt(st, [
    { type: "movie", rating: 9, rated_at: "2024-01-01T00:00:00Z", movie: { title: "Heat", year: 1995, ids: { imdb: "tt0113277" } } },
    { type: "episode", rating: 8, episode: { season: 1, number: 2, title: "x" }, show: { title: "Severance", year: 2022, ids: { tmdb: 95396, imdb: "tt11280740" } } },
    { type: "episode", rating: 10, episode: { season: 1, number: 9 }, show: { title: "Severance", year: 2022, ids: { tmdb: 95396 } } },
    { type: "season", rating: 7, season: { number: 1 }, show: { title: "Severance", year: 2022, ids: { tmdb: 95396 } } }], "rated");
  assert.strictEqual(n, 1, "only the film is a title rating");
  assert.deepStrictEqual(JSON.parse(st.get("ep_ratings"))["95396"].r, { "1:2": 8, "1:9": 10 });
  const calls = [];
  const h = async (m, u) => { calls.push(u);
    if (/ResolveVanityURL/.test(u)) return { status: 200, body: JSON.stringify({ response: { success: 1, steamid: "76561198000000001" } }) };
    if (/GetOwnedGames/.test(u)) return { status: 200, body: JSON.stringify({ response: { game_count: 1, games: [{ appid: 620, name: "Portal 2", playtime_forever: 600 }] } }) };
    return { status: 404, body: "" }; };
  const rows = await I3.steamLibrary(h, "https://steamcommunity.com/id/somebody/", "KEY");
  assert.deepStrictEqual(rows.map(r => [r.title, r.steam, r.hours]), [["Portal 2", 620, 10]]);
  assert.ok(/vanityurl=somebody/.test(calls[0]) && /steamid=76561198000000001/.test(calls[1]) && !calls.some(u => /steamcommunity/.test(u)));
  await assert.rejects(I3.steamLibrary(async () => ({ status: 200, body: "<html><title>Sign In</title></html>" }), "somebody"), /Steam Web API key/);
  console.log("5.4.1 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
// 0.5.4.2: more services
(async () => {
  const I4 = require("./imports.js");
  const ani = await I4.anilist(async (m, u, o) => {
    const v = JSON.parse(o.body).variables;
    const entries = v.t === "ANIME"
      ? [{ status: "CURRENT", score: 8.5, progress: 12, repeat: 0, completedAt: {}, startedAt: {}, media: { id: 1, idMal: 42249, format: "TV", episodes: 24, seasonYear: 2021, title: { romaji: "Tokyo Revengers", english: "Tokyo Revengers" } } },
         { status: "COMPLETED", score: 9, progress: 1, repeat: 1, completedAt: { year: 2024, month: 3, day: 2 }, startedAt: {}, media: { id: 2, idMal: 5, format: "MOVIE", seasonYear: 2001, title: { romaji: "Sen to Chihiro", english: "Spirited Away" } } }]
      : [{ status: "CURRENT", score: 7, progress: 120, progressVolumes: 12, completedAt: {}, startedAt: { year: 2023, month: 1, day: 1 }, media: { id: 3, idMal: 99, format: "MANGA", chapters: 278, volumes: 31, title: { romaji: "Tokyo Revengers" } } }];
    return { status: 200, body: JSON.stringify({ data: { MediaListCollection: { lists: [{ entries }] } } }) };
  }, "someone");
  assert.deepStrictEqual(ani.anime.map(a => [a.title, a.type, a.status, a.rating, a.epsWatched, a.mal]), [["Tokyo Revengers", "show", "watching", 9, 12, 42249], ["Spirited Away", "movie", "watched", 9, 0, 5]]);
  assert.deepStrictEqual(ani.anime[1].watches, ["2024-03-02", ""]);
  assert.deepStrictEqual([ani.books[0].status, ani.books[0].chapter, ani.books[0].manga, ani.books[0].started], ["reading", 120, true, "2023-01-01"]);
  const mal = await I4.malLists(async (m, u) => /animelist/.test(u)
    ? { status: 200, body: JSON.stringify([{ status: 2, score: 10, num_watched_episodes: 26, anime_title: "Shingeki no Kyojin", anime_title_eng: "Attack on Titan", anime_id: 16498, anime_media_type_string: "TV", anime_start_date_string: "04-07-13", finish_date_string: "09-28-13" }]) }
    : { status: 200, body: "[]" }, "someone");
  assert.deepStrictEqual([mal.anime[0].title, mal.anime[0].status, mal.anime[0].year, mal.anime[0].watches[0], mal.anime[0].epsWatched], ["Attack on Titan", "watched", 2013, "2013-09-28", 26]);
  const lb = await I4.letterboxdRss(async () => ({ status: 200, body: `<rss><channel><item><title>Heat, 1995 - ★★★★½</title><letterboxd:watchedDate>2026-11-01</letterboxd:watchedDate><letterboxd:filmTitle>Heat</letterboxd:filmTitle><letterboxd:filmYear>1995</letterboxd:filmYear><letterboxd:memberRating>4.5</letterboxd:memberRating><tmdb:movieId>949</tmdb:movieId></item><item><title>A list</title></item></channel></rss>` }), "someone");
  assert.deepStrictEqual(lb, [{ type: "movie", title: "Heat", year: 1995, tmdb: 949, status: "watched", rating: 9, watches: ["2026-11-01"], src: "letterboxd" }]);
  const gr = await I4.goodreadsRss(async (m, u) => /shelf=read/.test(u) ? { status: 200, body: `<rss><channel><item><title><![CDATA[Dune]]></title><author_name>Frank Herbert</author_name><isbn>0441013597</isbn><user_rating>5</user_rating><user_read_at><![CDATA[Mon, 03 Mar 2025 00:00:00 -0800]]></user_read_at><num_pages>604</num_pages></item></channel></rss>` } : { status: 200, body: "<rss></rss>" }, "https://www.goodreads.com/user/show/12345-someone");
  assert.deepStrictEqual([gr[0].title, gr[0].authors[0], gr[0].isbn10, gr[0].rating, gr[0].status, gr[0].finished.slice(0, 7)], ["Dune", "Frank Herbert", "0441013597", 10, "read", "2025-03"]);
  const nf = I4.detect({ name: "NetflixViewingHistory.csv", text: 'Title,Date\n"Stranger Things: Stagione 1: Capitolo uno",25/10/2024\n"Stranger Things: Stagione 1: Capitolo due",26/10/2024\n"Glass Onion",03/01/2023\n' });
  assert.strictEqual(nf.kind, "Netflix viewing history");
  assert.deepStrictEqual(nf.rows.map(r => [r.type, r.title, (r.watches || []).join()]), [["movie", "Glass Onion", "2023-01-03"], ["show", "Stranger Things", ""]]);
  console.log("SERVICES TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
// 0.5.4.2: store prices and other AI services
(async () => {
  const G5 = require("./games.js"), C5 = require("./core.js");
  const g = { title: "Hades", steam: 1145360 };
  await G5.storePrices(g, async (m, u, o) => {
    if (/lookup/.test(u)) return { status: 200, body: JSON.stringify({ found: true, game: { id: "abc" } }) };
    if (/prices\/v3/.test(u)) { assert.deepStrictEqual(JSON.parse(o.body), ["abc"]); assert.ok(/country=IT/.test(u)); return { status: 200, body: JSON.stringify([{ id: "abc", historyLow: { all: { amount: 6.24, currency: "EUR" } }, deals: [
      { shop: { name: "Steam" }, price: { amount: 24.5, currency: "EUR" }, regular: { amount: 24.5 }, cut: 0, url: "https://s" }, { shop: { name: "GOG" }, price: { amount: 12.25, currency: "EUR" }, regular: { amount: 24.5 }, cut: 50, url: "https://g" }] }]) }; }
    return { status: 404, body: "" }; }, { itadKey: "K", country: "IT" });
  assert.deepStrictEqual(g.stores.map(x => [x.shop, x.price, x.cut]), [["GOG", 12.25, 50], ["Steam", 24.5, 0]]);
  assert.deepStrictEqual(g.storesLow, { price: 6.24, cur: "EUR" });
  const h = { title: "Hades" };
  await G5.storePrices(h, async (m, u) => /stores$/.test(u) ? { status: 200, body: JSON.stringify([{ storeID: "1", storeName: "Steam" }, { storeID: "7", storeName: "GOG" }]) }
    : /title=/.test(u) ? { status: 200, body: JSON.stringify([{ gameID: "9", external: "Hades" }]) }
    : /id=9/.test(u) ? { status: 200, body: JSON.stringify({ cheapestPriceEver: { price: "4.99" }, deals: [{ storeID: "1", price: "24.99", retailPrice: "24.99", savings: "0", dealID: "x" }, { storeID: "7", price: "9.99", retailPrice: "24.99", savings: "60.02", dealID: "y" }] }) }
    : { status: 404, body: "" }, {});
  assert.deepStrictEqual(h.stores.map(x => [x.shop, x.price, x.cur, x.cut]), [["GOG", 9.99, "USD", 60], ["Steam", 24.99, "USD", 0]]);
  const st = new C5.Store();
  let sent = null;
  const pv = C5.compatProvider(st, async (m, u, o) => { sent = [u, JSON.parse(o.body), o.headers.Authorization]; return { status: 200, body: JSON.stringify({ choices: [{ message: { content: "# Alien\nAliens | F | 1986 | 1986-07-18" } }] }) }; }, { preset: "mistral", key: "KEY" });
  const out = await pv.call("hello");
  assert.ok(/api\.mistral\.ai\/v1\/chat\/completions$/.test(sent[0]) && sent[1].model === "mistral-small-latest" && sent[2] === "Bearer KEY" && /Aliens/.test(out));
  await assert.rejects(C5.compatProvider(st, async () => ({ status: 404, body: "{}" }), { preset: "groq", key: "K", model: "nope" }).call("x"), /model “nope” not found/);
  console.log("PRICES AND AI TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
// audit fixes: IMDb and Trakt disagree -> the newer rating wins and stays put
(() => {
  const L6 = require("./library.js"), lib = new L6.Library(null);
  const rows = [{ title: "Heat", year: 1995, imdb: "tt0113277", medium: "Movie", kind: "rated", source: "imdb", rating: 8, rated_at: "2020-01-01" },
                { title: "Heat", year: 1995, imdb: "tt0113277", medium: "Movie", kind: "rated", source: "trakt", rating: 9, rated_at: "2024-05-01" }];
  lib.adopt(rows); const it = lib.all()[0];
  assert.strictEqual(it.rating, 9);
  const u = it.updated; lib.adopt(rows); lib.adopt(rows.slice().reverse());
  assert.strictEqual(it.rating, 9); assert.strictEqual(it.updated, u, "no change, no touch");
  console.log("RATING CONFLICT TESTS PASSED");
})();
// audit fix: numbered sequels a year apart are different titles
(() => {
  const C7 = require("./core.js");
  const ix = new C7.TitleIndex([{ norm: C7.norm("Saw II"), year: 2005, medium: "Movie" }, { norm: C7.norm("Star Wars: Episode III"), year: 2005, medium: "Movie" }, { norm: C7.norm("The Lord of the Rings: The Two Towers"), year: 2002, medium: "Movie" }]);
  assert.strictEqual(ix.find(C7.norm("Saw III"), 2006, "Movie"), null);
  assert.ok(ix.find(C7.norm("Lord of the Rings: The Two Towers"), 2002, "Movie"), "an unnumbered near-match still matches");
  console.log("SEQUEL MATCH TESTS PASSED");
})();
