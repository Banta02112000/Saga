// Node tests for core.js — ported from the Python suite (tests/test_core.py).
const assert = require("assert");
const C = require("./core.js");

const HDR = ["Position", "Const", "Created", "Modified", "Description", "Title", "Original Title", "URL", "Title Type",
  "IMDb Rating", "Runtime (mins)", "Year", "Genres", "Num Votes", "Release Date", "Directors", "Your Rating", "Date Rated"];

function csv(rows) {
  const esc = v => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return "﻿" + [HDR.join(",")].concat(rows.map(r => HDR.map(h => esc(r[h] || "")).join(","))).join("\r\n") + "\r\n";
}
const resp = (js, status = 200, headers = {}) => ({ status, headers, body: typeof js === "string" ? js : JSON.stringify(js) });
const noop = () => {};
const eqSet = (a, b, msg) => assert.deepStrictEqual([...a].sort(), [...b].sort(), msg);

async function main() {
  C.CONFIG.retryDelayMs = 5;
  C.CONFIG.imdbGapMs = 0;
  C.CONFIG.aiGapMs = 0;
  const db = new C.Store();

  assert.strictEqual(C.norm("Star Wars: Episode IV - A New Hope"), C.norm("Star Wars: A New Hope"));
  assert.strictEqual(C.norm("Pokémon: The Movie"), "pokemon the movie");
  assert.ok(Math.abs(C.ratio("abcd", "bcde") - 0.75) < 1e-9);

  // IMDb ratings CSV (auto) + exclusion list
  const ratings = csv([
    { Const: "tt0133093", Title: "The Matrix", "Title Type": "movie", Year: "1999", "Your Rating": "9" },
    { Const: "tt0944947", Title: "Game of Thrones", "Title Type": "tvSeries", Year: "2011", "Your Rating": "8" },
    { Const: "tt3235888", Title: "Elden Ring", "Title Type": "videoGame", Year: "2022", "Your Rating": "10" },
    { Const: "tt9999991", Title: "The Walking Dead: Red Machete", "Title Type": "short", Year: "2012", "Your Rating": "7" },
    { Const: "tt0000001", Title: "Some Episode, with comma", "Title Type": "tvEpisode", Year: "2012", "Your Rating": "7" },
  ]);
  assert.strictEqual(C.importImdbCsv(db, "ratings.csv", ratings, "auto"), 5);
  assert.strictEqual(C.importImdbCsv(db, "to-watch.csv",
    csv([{ Const: "tt0234215", Title: "The Matrix Reloaded", "Title Type": "movie", Year: "2003" }]), "list"), 1);
  assert.throws(() => C.importImdbCsv(db, "x.csv", "a,b\n1,2", "auto"));

  // Trakt ZIP (already unpacked by the native layer)
  const zip = {
    "trakt/watched-history-26.json": JSON.stringify([
      { type: "movie", movie: { title: "The Matrix", year: 1999, ids: { imdb: "tt0133093", tmdb: 603, trakt: 1 } } },
      { type: "episode", episode: { season: 1, number: 1, ids: {} }, show: { title: "The Walking Dead", year: 2010, ids: { imdb: "tt1520211", tmdb: 1402 } } }]),
    "lists-list-31109335-to-watch.json": JSON.stringify([
      { type: "movie", movie: { title: "Alien", year: 1979, ids: { imdb: "tt0078748", tmdb: 348 } } },
      { type: "person", person: { name: "x" } }]),
    "ratings-movies.json": JSON.stringify([{ rating: 8, rated_at: "2025-02-03T10:00:00.000Z", type: "movie", movie: { title: "Heat", year: 1995, ids: { imdb: "tt0113277" } } }]),
    "notes.txt": "ignored",
  };
  assert.strictEqual(C.importTraktZip(db, zip), 4);
  assert.ok(db.items("trakt", ["list"]).some(i => i.list_name === "to-watch"));

  // Discrepancies
  let d = C.discrepancies(db);
  eqSet(d.imdb_not_trakt.map(i => i.imdb), ["tt0944947", "tt9999991"]);
  assert.deepStrictEqual(d.games.map(i => i.title), ["Elden Ring"]);
  eqSet(d.trakt_not_imdb.map(i => i.title), ["The Walking Dead", "Heat"]);

  // Franchise files
  assert.ok(C.importFranchiseFile(db, "grouped_by_franchise.txt", "# The Matrix\n- The Matrix (1999)\n- The Matrix Reloaded (2003)\nStar Wars: A New Hope; Rogue One\n") >= 2);
  assert.strictEqual(C.importFranchiseFile(db, "franchises_grouped_by_connected_universe.csv",
    "Connected Universe,Title,Const,Year\nWhoniverse,Doctor Who,tt0436992,2005\n"), 1);

  // Subtraction: exact id, fuzzy AI title, year guard, manual exclusion
  db.replaceCanon("gemini", [
    { franchise: "Matrix", title: "The Matrix", year: "1999", medium: "Movie" },
    { franchise: "Matrix", title: "The Matrix Resurrections", year: "2021", medium: "Movie" },
    { franchise: "Matrix", title: "Enter the Matrix", year: "2003", medium: "Video Game" },
    { franchise: "Star Wars", title: "Alien", year: "1986", medium: "Movie" },
    { franchise: "TWD", title: "Walking Dead: Red Machete", year: "2012", medium: "Special" },
  ]);
  db.replaceCanon("tmdb", [{ franchise: "Matrix", title: "The Matrix Reloaded", year: "2003", medium: "Movie", imdb: "tt0234215" }]);
  eqSet(C.missingCanon(db, 0.8).map(c => c.title), ["The Matrix Resurrections", "Enter the Matrix", "Alien"]);
  db.addExclusion("Enter the Matrix", 2003, "Video Game");
  assert.ok(!C.missingCanon(db, 0.8).some(c => c.title === "Enter the Matrix"));
  const cnt = db.counters();
  assert.ok(cnt.games === 1 && cnt.watched >= 6, JSON.stringify(cnt));

  // Persistence round trip
  let saved = "";
  const p = { load: () => saved, save: t => { saved = t; } };
  const pdb = new C.Store(p);
  pdb.addItems([{ imdb: "tt1", title: "X", year: 2000, medium: "Movie" }], "imdb", "watched");
  pdb.set("username", "ExampleUser");
  pdb.flush();
  const pdb2 = new C.Store(p);
  assert.strictEqual(pdb2.items().length, 1);
  assert.strictEqual(pdb2.get("username"), "ExampleUser");

  // TMDB collection scan
  const tmdbHttp = async (method, url) => {
    const path = url.replace("https://api.themoviedb.org/3", "").split("?")[0];
    assert.ok(url.includes("api_key=KEY"));
    if (path === "/find/tt0133093") return resp({ movie_results: [{ id: 603 }] });
    if (path === "/movie/603" && !url.includes("append")) return resp({ belongs_to_collection: { id: 2344, name: "The Matrix Collection" } });
    if (path === "/collection/2344") return resp({ name: "The Matrix Collection", parts: [
      { id: 603, title: "The Matrix", release_date: "1999-03-30" },
      { id: 604, title: "The Matrix Reloaded", release_date: "2003-05-15" },
      { id: 624860, title: "The Matrix Resurrections", release_date: "2021-12-16" }] });
    if (path.startsWith("/movie/") && path.endsWith("/external_ids")) {
      const ids = { 603: "tt0133093", 604: "tt0234215", 624860: "tt10838180" };
      return resp({ imdb_id: ids[parseInt(path.split("/")[2], 10)] });
    }
    return resp({}, 404);
  };
  const db2 = new C.Store();
  db2.addItems([{ imdb: "tt0133093", title: "The Matrix", year: 1999, medium: "Movie", rating: 9 }], "imdb", "rated");
  assert.strictEqual(await C.collectionScan(db2, tmdbHttp, "KEY", noop), 3);
  eqSet(C.missingCanon(db2).map(c => c.title), ["The Matrix Reloaded", "The Matrix Resurrections"]);
  await assert.rejects(C.collectionScan(db2, tmdbHttp, "", noop), /TMDB API key/);

  // Season 0 resolution
  const s0Http = async (method, url) => {
    const path = url.replace("https://api.themoviedb.org/3", "").split("?")[0];
    if (path === "/search/tv") return resp({ results: [{ id: 1402, name: "The Walking Dead" }] });
    if (path === "/tv/1402/season/0") return resp({ episodes: [{ episode_number: 4, name: "Red Machete" }] });
    if (path.endsWith("/external_ids")) return resp({ imdb_id: null });
    return resp({});
  };
  await C.season0Scan(db, s0Http, "KEY", 0.9, noop);
  const sp = db.specials();
  assert.ok(sp.length && sp[0].status === "Nested special (TMDB lacks IMDb ID)", JSON.stringify(sp));

  // Gemini
  assert.strictEqual(C.parseJsonArray('```json\n[{"a":1},{"b":2},{"c"').length, 2);
  const out = JSON.stringify([{ franchise: "Whoniverse", title: "Doctor Who", medium: "TV Series", year: "2005" },
                              { franchise: "Whoniverse", title: "Torchwood", medium: "TV Series", year: "2006" }]);
  const MODELS = { models: [
    { name: "models/gemini-2.5-flash-image-preview", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.1-flash-lite", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3-flash-preview", supportedGenerationMethods: ["generateContent", "countTokens"] },
    { name: "models/gemini-3.1-pro-preview", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
    { name: "models/gemini-3.1-flash-tts-preview", supportedGenerationMethods: ["generateContent"] }] };
  const gHttp = async (method, url, opt) => {
    assert.strictEqual(opt.headers["x-goog-api-key"], "K");
    assert.ok(!url.includes("key="), "key must not be in the URL");
    if (method === "GET") { assert.ok(url.endsWith("/models?pageSize=200")); return resp(MODELS); }
    assert.ok(url.includes("/models/gemini-3-flash-preview:generateContent") && method === "POST", url);
    assert.ok(JSON.parse(opt.body).contents[0].parts[0].text.includes("The Matrix"));
    return resp({ candidates: [{ content: { parts: [{ thought: true, text: "thinking..." }, { text: out }] } }] });
  };
  // the retired default must fall back to the best live Flash model
  assert.strictEqual(await C.multiverseScan(db, gHttp, "K", "gemini-2.5-flash", noop), 2);
  assert.strictEqual(db.get("gemini_model_used"), "gemini-3-flash-preview");
  assert.strictEqual(await C.resolveGeminiModel(gHttp, "K", "gemini-3.1-flash-lite"), "gemini-3.1-flash-lite");
  assert.ok(C.rankGeminiModel("gemini-3.5-flash") > C.rankGeminiModel("gemini-3-flash-preview"));
  assert.ok(C.rankGeminiModel("gemini-3-flash-preview") > C.rankGeminiModel("gemini-3.1-flash-lite"));
  assert.strictEqual(C.rankGeminiModel("gemini-3.1-flash-image-preview"), -1);

  // Canon dedupe across origins + stats
  db.replaceCanon("tmdb", [{ franchise: "The Matrix Collection", title: "The Matrix", year: "1999", medium: "Movie", imdb: "tt0133093" },
                           { franchise: "The Matrix Collection", title: "The Matrix Resurrections", year: "2021", medium: "Movie", imdb: "tt10838180" }]);
  db.replaceCanon("gemini", [{ franchise: "The Matrix", title: "The Matrix Resurrections", year: "2021", medium: "Movie" },
                             { franchise: "The Matrix", title: "Enter the Matrix", year: "2003", medium: "Video Game" }]);
  const st = C.canonStatus(db, 0.9);
  assert.deepStrictEqual(st.map(c => c.title).sort(), ["Enter the Matrix", "The Matrix", "The Matrix Resurrections"]);
  eqSet(new Set(st.map(c => c.franchise)), ["The Matrix"]);
  assert.ok(st.find(c => c.title === "The Matrix Resurrections").origin.includes("+"));
  const s = C.computeStats(db, st);
  assert.ok(s.total >= 5 && s.avg_rating && s.canon_have === 2 && s.franchises[0].total === 3, JSON.stringify(s.franchises));
  assert.ok(s.overlap.both >= 1 && s.decades.size);

  // Scrapers + syncAll
  const LIST_CSV = csv([{ Const: "tt0234215", Title: "The Matrix Reloaded", "Title Type": "movie", Year: "2003", Genres: "Action, Sci-Fi" }]);
  const PAGE = '<html><script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(
    { x: { id: "tt7777777", titleText: { text: "Page Movie" }, releaseYear: { year: 2001 }, titleType: { id: "movie" } } }) + "</script></html>";
  const gql = resp({ data: { list: { titleListItemSearch: { edges: [{ listItem: {
    id: "tt0111161", titleText: { text: "The Shawshank Redemption" }, releaseYear: { year: 1994 },
    titleType: { id: "movie" }, titleGenres: { genres: [{ genre: { text: "Drama" } }] } } }], pageInfo: { hasNextPage: false } } } } });
  const syncHttp = async (method, url, opt = {}) => {
    if (url.startsWith("https://api.trakt.tv")) {
      assert.strictEqual(opt.headers["trakt-api-key"], "x");
      const path = url.slice("https://api.trakt.tv".length).split("?")[0];
      if (path.endsWith("/watched/movies")) return resp([{ movie: { title: "Heat", year: 1995, ids: { imdb: "tt0113277", tmdb: 949 } } }], 200, { "x-pagination-page-count": "1" });
      if (path.endsWith("/lists")) return resp([{ name: "My List", ids: { trakt: 5 } }]);
      if (path.includes("/users/someone/lists/matrix/items")) return resp([{ type: "movie", movie: { title: "The Matrix", year: 1999, ids: { imdb: "tt0133093" } } }]);
      return resp([]);
    }
    if (url.includes("api.graphql.imdb.com")) return gql;
    if (url.includes("ls111/export")) return resp(LIST_CSV);
    if (url.includes("ls222/export")) return resp("", 404);
    if (url.includes("ratings/export")) return resp("<html>please sign in</html>");
    if (url.includes("/user/ur1/ratings/")) return resp(PAGE);
    return resp("", 404);
  };
  const db3 = new C.Store();
  for (const [k, v] of [["client_id", "x"], ["username", "banta"], ["imdb_user", "ur1"],
                        ["imdb_lists", "https://www.imdb.com/list/ls222/"],
                        ["canon_urls", "Matrix | https://www.imdb.com/list/ls111/\nMatrix | https://trakt.tv/users/someone/lists/matrix"]]) db3.set(k, v);
  const rep = await C.syncAll(db3, syncHttp, noop);
  assert.ok(!rep.report.includes("FAIL") && rep.ok === 4 && /PART IMDb ratings/.test(rep.report) && rep.failed.includes("IMDb ratings"), rep.report);
  assert.ok(rep.report.indexOf("Trakt account") < rep.report.indexOf("IMDb ratings") && db3.get("sync_state").includes("Trakt account"), "report order and per-source state");
  assert.ok(rep.report.includes("GraphQL") && rep.report.includes("page") && rep.report.includes("Trakt API"), rep.report);
  eqSet(db3.items("imdb").map(i => i.title), ["Page Movie", "The Shawshank Redemption"]);
  assert.strictEqual(db3.items("trakt")[0].title, "Heat");
  eqSet(db3.canon().map(c => c.title), ["The Matrix Reloaded", "The Matrix"]);
  assert.ok(parseFloat(db3.get("last_sync")) > 0);
  const failing = await C.syncAll(db3, async () => ({ status: 500, headers: {}, body: "" }), noop);
  assert.strictEqual((failing.report.match(/FAIL/g) || []).length, 5, failing.report);
  const offline = await C.syncAll(db3, async () => ({ status: 0, headers: {}, body: "", error: "UnknownHostException" }), noop);
  assert.ok(offline.report.includes("network error"), offline.report);

  // Trakt pagination + 429 retry
  let calls = 0;
  const pagHttp = async (m, url) => {
    calls++;
    if (calls === 1) return resp("", 429, { "retry-after": "0" });
    const page = parseInt(url.match(/page=(\d+)/)[1], 10);
    return resp([{ movie: { title: "P" + page, year: 2000, ids: { imdb: "tt100000" + page } } }], 200, { "x-pagination-page-count": "3" });
  };
  const got = await new C.Trakt(pagHttp, "x").get("/users/u/watched/movies");
  assert.strictEqual(got.length, 3);

  // v1.2: up next, hidden franchises, removable exclusions, runtime/ratings-per-year stats
  const db4 = new C.Store();
  C.importImdbCsv(db4, "r4.csv", csv([
    { Const: "tt0133093", Title: "The Matrix", "Title Type": "movie", Year: "1999", "Your Rating": "9", "Runtime (mins)": "136", "Date Rated": "2024-05-01" },
    { Const: "tt0076759", Title: "Star Wars", "Title Type": "movie", Year: "1977", "Your Rating": "8", "Runtime (mins)": "121", "Date Rated": "2025-01-02" }]), "auto");
  db4.replaceCanon("url", [
    { franchise: "Matrix", title: "The Matrix", year: 1999, imdb: "tt0133093", medium: "Movie" },
    { franchise: "Matrix", title: "The Matrix Reloaded", year: 2003, imdb: "tt0234215", medium: "Movie" },
    { franchise: "Matrix", title: "The Matrix Revolutions", year: 2003, imdb: "tt0242653", medium: "Movie" },
    { franchise: "Star Wars", title: "Star Wars", year: 1977, imdb: "tt0076759", medium: "Movie" },
    { franchise: "Star Wars", title: "The Empire Strikes Back", year: 1980, imdb: "tt0080684", medium: "Movie" },
    { franchise: "Alien", title: "Alien", year: 1979, imdb: "tt0078748", medium: "Movie" }]);
  const nx = C.upNext(C.canonStatus(db4));
  assert.deepStrictEqual(nx.map(c => c.title), ["The Empire Strikes Back", "The Matrix Reloaded"]);
  db4.setHidden("Star Wars", true);
  assert.ok(!C.canonStatus(db4).some(c => c.franchise === "Star Wars"));
  db4.setHidden("Star Wars", false);
  assert.ok(C.canonStatus(db4).some(c => c.franchise === "Star Wars"));
  db4.addExclusion("Alien", 1979, "Movie", "tt0078748");
  assert.ok(!C.missingCanon(db4).some(c => c.title === "Alien"));
  db4.removeExclusion("tt0078748");
  assert.ok(C.missingCanon(db4).some(c => c.title === "Alien"));
  const s4 = C.computeStats(db4, C.canonStatus(db4));
  assert.strictEqual(s4.movie_hours.toFixed(2), (257 / 60).toFixed(2));
  assert.deepStrictEqual(s4.ratings_per_year, [["2024", 1], ["2025", 1]]);
  assert.strictEqual(s4.avg_by_medium.Movie[0], 8.5);
  db4.clearCache();
  assert.strictEqual(db4.items().length, 0);

  // Performance: 20k items + 3k canon must stay fast on a phone
  const big = new C.Store();
  const many = [];
  for (let i = 0; i < 20000; i++) many.push({ imdb: "tt" + String(1000000 + i), title: "Title number " + i, year: 1950 + (i % 70), medium: i % 7 ? "Movie" : "TV Series", rating: (i % 10) + 1 });
  big.addItems(many, "imdb", "rated");
  const canonBig = [];
  for (let i = 0; i < 3000; i++) canonBig.push({ franchise: "F" + (i % 150), title: "Canon thing " + i, year: 1980 + (i % 40), medium: "Movie" });
  big.replaceCanon("gemini", canonBig);
  const t0 = Date.now();
  const stb = C.canonStatus(big, 0.9);
  C.computeStats(big, stb);
  const ms = Date.now() - t0;
  assert.ok(ms < 4000, `too slow: ${ms}ms`);
  console.log(`perf: 20k items / 3k canon status+stats in ${ms}ms`);


  // v1.2.1: newer IMDb profile IDs, ratings/watchlist links in the list setting, Gemini header auth
  assert.strictEqual(C.imdbUserId("https://www.imdb.com/user/p.exampleuser00000000000000000?ref_=hm_nv_profile"), "p.exampleuser00000000000000000");
  assert.strictEqual(C.imdbUserId("ur1234567"), "ur1234567");
  const WL_CSV = csv([{ Const: "tt15239678", Title: "Dune: Part Two", "Title Type": "movie", Year: "2024" }]);
  const seenUrls = [];
  const imdbHttp = async (m, url) => {
    seenUrls.push(url);
    if (url.includes("/user/p.abc/watchlist/")) return resp('<a href="/list/ls100000006/export">export</a>');
    if (url.includes("/list/ls100000006/export")) return resp(WL_CSV);
    if (url.includes("/user/p.other/ratings/export")) return resp(csv([{ Const: "tt0068646", Title: "The Godfather", "Title Type": "movie", Year: "1972", "Your Rating": "10" }]));
    if (url.includes("/list/ls100000015/export")) return resp(csv([{ Const: "tt0110912", Title: "Pulp Fiction", "Title Type": "movie", Year: "1994" }]));
    return resp("", 404);
  };
  const db5 = new C.Store();
  db5.set("imdb_user", "https://www.imdb.com/user/p.abc?ref_=x");
  db5.set("imdb_lists", "https://www.imdb.com/list/ls100000015/?ref_=up_urls_t_1\nhttps://www.imdb.com/user/p.abc/watchlist/?ref_=uspf_sm\nhttps://www.imdb.com/user/p.abc/ratings/?ref_=uspf_sm\nhttps://www.imdb.com/user/p.other/ratings/");
  const r5 = await C.syncAll(db5, imdbHttp, noop);
  assert.ok(seenUrls.some(u => u.includes("/user/p.abc/ratings/export")), "imdb_user link not normalised");
  assert.ok(r5.report.includes("IMDb watchlist: 1 titles via CSV export (watchlist ls100000006)"), r5.report);
  assert.ok(r5.report.includes("IMDb ratings p.other: 1 titles via"), r5.report);
  assert.strictEqual((r5.report.match(/^(OK|FAIL)\s+IMDb ratings/gm) || []).length, 2, "own ratings link must not sync twice: " + r5.report);
  assert.ok(db5.items("imdb", ["watchlist"]).some(i => i.title === "Dune: Part Two"));
  assert.ok(db5.items("imdb", ["list"]).some(i => i.list_name === "ls100000015"));

  // Google's own error message must reach the user (no masking retries)
  const badKey = async () => resp({ error: { code: 401, status: "UNAUTHENTICATED", message: "API key not valid. Please pass a valid API key." } }, 401);
  db5.addItems([{ imdb: "tt1", title: "Some Film", year: 2000, medium: "Movie" }], "imdb", "watched");
  await assert.rejects(C.multiverseScan(db5, badKey, "AQ.Ab8Rtest", "auto", noop), /401 UNAUTHENTICATED: API key not valid/);

  // v1.3: IMDb through the hidden in-app browser
  const nextData = (edges, total) => JSON.stringify({ props: { pageProps: { mainColumnData: { list: { titleListItemSearch: { total, edges } } } } } });
  const t = (id, text, year, type, extra = {}) => Object.assign({ id, titleText: { text }, releaseYear: { year }, titleType: { id: type } }, extra);
  const page1 = nextData([{ listItem: t("tt0000101", "Alpha", 2001, "movie", { titleGenres: { genres: [{ genre: { text: "Drama" } }] }, runtime: { seconds: 5400 } }) },
                          { listItem: t("tt0000102", "Beta", 2002, "tvSeries") }], 3);
  const page2 = nextData([{ listItem: t("tt0000103", "Gamma", 2003, "videoGame") }], 3);
  const ratingsPage = JSON.stringify({ props: { pageProps: { mainColumnData: { advancedTitleSearch: { total: 2, edges: [
    { node: { title: t("tt0000201", "Rated One", 1999, "movie") }, userRating: { value: 9 } },
    { node: { title: t("tt0000202", "Rated Two", 2010, "tvMiniSeries"), userRating: { value: 6 } } }] } } } } });
  const browsed = [];
  const bHttp = async () => resp("", 404);
  // what the in-page probe returns once scrolling has loaded everything
  const probed = (...texts) => ({ status: 200, value: JSON.stringify({ items: C.pageExtract(texts), loads: texts.length - 1 }) });
  bHttp.browse = async (url, probe, timeout) => {
    browsed.push(url);
    assert.ok(probe.includes("__NEXT_DATA__") && probe.includes("scrollTo"), "probe must be the scrolling page probe");
    if (url === "https://www.imdb.com/list/ls100/") return probed(page1, page2);
    if (url.includes("/user/p.me/ratings/")) return probed(ratingsPage);
    if (url.includes("/list/ls200/")) return { status: 200, value: "ERR:Sign in with IMDb" };
    if (url.includes("/user/p.me/watchlist/")) return { status: 0, value: null, error: "timeout", title: "Just a moment | https://www.imdb.com/" };
    return { status: 200, value: "ERR:404 Error - IMDb" };
  };
  const [li, route] = await C.imdbList(bHttp, "https://www.imdb.com/list/ls100/?ref_=x");
  assert.strictEqual(route, "in-app browser, 1 extra page loads");
  assert.deepStrictEqual(li.map(i => [i.title, i.medium]), [["Alpha", "Movie"], ["Beta", "TV Series"], ["Gamma", "Video Game"]]);
  assert.strictEqual(li[0].genres, "Drama");
  assert.strictEqual(li[0].runtime, 90);
  const [rg] = await C.imdbRatings(bHttp, "https://www.imdb.com/user/p.me?ref_=hm");
  assert.deepStrictEqual(rg.rated.map(i => [i.title, i.rating, i.medium]), [["Rated One", 9, "Movie"], ["Rated Two", 6, "TV Series"]]);
  await assert.rejects(C.imdbList(bHttp, "https://www.imdb.com/list/ls200/"), /Sign in to IMDb in Settings/);
  // 5.1.1: a long list still loading when time runs out is kept, marked partial; lists get a longer browse window
  {
    const cHttp = async () => resp("", 404);
    let gotTimeout = 0;
    cHttp.browse = async (url, probe, timeout) => { gotTimeout = timeout; return { status: 200, value: JSON.stringify({ items: C.pageExtract([page1]), loads: 0, capped: true }) }; };
    const [ci, croute] = await C.imdbList(cHttp, "https://www.imdb.com/list/ls300/");
    assert.ok(ci.length > 0 && /stopped early/.test(croute), croute);
    assert.strictEqual(gotTimeout, C.CONFIG.listBrowseMs);
    assert.ok(C.CONFIG.listTaskMs > C.CONFIG.listBrowseMs);
    assert.ok(/couldn't look up api\.trakt\.tv/.test(C.netHint('java.net.UnknownHostException: Unable to resolve host "api.trakt.tv": No address')));
    assert.ok(/refused/.test(C.netHint("java.net.ConnectException: failed to connect to api.trakt.tv/104.20.13.80 (port 443) after 15000ms: isConnected failed: ECONNREFUSED")));
  }
  await assert.rejects(C.imdbWatchlist(bHttp, "p.me"), /didn't load in time \(Just a moment/);
  // full sync through the browser path
  const db6 = new C.Store();
  db6.set("imdb_user", "p.me");
  db6.set("imdb_lists", "https://www.imdb.com/list/ls100/");
  db6.set("canon_urls", "Test | https://www.imdb.com/list/ls100/");
  const r6 = await C.syncAll(db6, bHttp, noop);
  assert.strictEqual(r6.ok, 3, r6.report);
  assert.ok(r6.report.includes("IMDb ratings: 2 titles (1 series) via in-app browser"), r6.report);
  assert.ok(browsed.every(u => !u.includes("page=")), "no ?page= requests any more");
  assert.strictEqual(C.canonStatus(db6).length, 3);

  // v1.4: seen / listed / missing, list titles seed the scans, release order, incremental Gemini
  assert.strictEqual(C.parseDate("2010-07-16T00:00:00.000Z"), "2010-07-16");
  assert.strictEqual(C.parseDate({ year: 1999, month: 3, day: 31 }), "1999-03-31");
  assert.strictEqual(C.parseDate({ year: 1999 }), null);
  const db7 = new C.Store();
  db7.addItems([{ imdb: "tt0076759", title: "Star Wars", year: 1977, medium: "Movie", rating: 9 }], "imdb", "rated");
  db7.addItems([{ imdb: "tt0086190", title: "Return of the Jedi", year: 1983, medium: "Movie" }], "trakt", "list", "to-watch");
  db7.addItems([{ imdb: "tt0078748", title: "Alien", year: 1979, medium: "Movie" }], "imdb", "watchlist", "watchlist");
  db7.replaceCanon("tmdb", [
    { franchise: "Star Wars Collection", title: "Star Wars", date: "1977-05-25", imdb: "tt0076759", medium: "Movie" },
    { franchise: "Star Wars Collection", title: "The Empire Strikes Back", date: "1980-05-21", imdb: "tt0080684", medium: "Movie" },
    { franchise: "Star Wars Collection", title: "Return of the Jedi", date: "1983-05-25", imdb: "tt0086190", medium: "Movie" },
    { franchise: "Star Wars Collection", title: "Star Wars: Episode X", year: 2099, medium: "Movie" }]);
  db7.replaceCanon("gemini", [
    { franchise: "Star Wars", title: "Star Wars Jedi: Fallen Order", year: "2019", date: "2019-11-15", medium: "Video Game" },
    { franchise: "Star Wars", title: "The Clone Wars", year: "2008", medium: "TV Series" },
    { franchise: "Alien", title: "Aliens", year: "1986", date: "1986-07-18", medium: "Movie" },
    { franchise: "Alien", title: "Alien", year: "1979", medium: "Movie" }]);
  const st7 = C.canonStatus(db7);
  const state = t => st7.find(c => c.title === t).state;
  assert.strictEqual(state("Star Wars"), "seen");
  assert.strictEqual(state("Return of the Jedi"), "listed");
  assert.strictEqual(state("Alien"), "listed");
  assert.strictEqual(state("The Empire Strikes Back"), "missing");
  const sw = C.franchiseProgress(st7).find(f => f.name === "Star Wars");
  assert.deepStrictEqual([sw.seen, sw.listed, sw.total], [1, 1, 6]);
  const rl = C.releaseList(st7, "2026-10-29");
  assert.deepStrictEqual(rl.released.map(c => [c.title, !!c.upNext]),
    [["The Empire Strikes Back", true], ["Aliens", true], ["The Clone Wars", false], ["Star Wars Jedi: Fallen Order", false]]);
  assert.deepStrictEqual(rl.upcoming.map(c => c.title), ["Star Wars: Episode X"]);
  assert.ok(!rl.released.concat(rl.upcoming).some(c => c.title === "Return of the Jedi" || c.title === "Alien"), "listed titles must not be missing");
  assert.deepStrictEqual(C.upNext(st7).map(c => c.title), ["Aliens", "The Empire Strikes Back"]);

  // list titles seed the TMDB scan (a movie only on a list still finds its collection)
  const db8 = new C.Store();
  db8.addItems([{ imdb: "tt0133093", title: "The Matrix", year: 1999, medium: "Movie" }], "imdb", "list", "ls1");
  assert.strictEqual(await C.collectionScan(db8, tmdbHttp, "KEY", noop), 3);
  const m8 = C.releaseList(C.canonStatus(db8), "2026-10-29").released;
  assert.deepStrictEqual(m8.map(c => [c.title, c.date]), [["The Matrix Reloaded", "2003-05-15"], ["The Matrix Resurrections", "2021-12-16"]]);

  // incremental Gemini: second run only sends new titles, merges results, reuses universe names
  const db9 = new C.Store();
  const many9 = [];
  for (let i = 0; i < 5; i++) many9.push({ imdb: "tt900000" + i, title: "Film " + i, year: 2000 + i, medium: "Movie" });
  db9.addItems(many9.slice(0, 3), "imdb", "rated");
  db9.addItems(many9.slice(3), "trakt", "list", "planned");
  const prompts = [];
  const g9 = async (m, url, opt) => {
    if (m === "GET") return resp(MODELS);
    const p = JSON.parse(opt.body).contents[0].parts[0].text;
    prompts.push(p);
    const titles = [...p.matchAll(/^(Film \d) \(/gm)].map(x => x[1]);
    return resp({ candidates: [{ content: { parts: [{ text: JSON.stringify(titles.map(t => ({ franchise: "Films", title: t + " Part 2", medium: "Movie", year: "2010", release_date: "2010-01-0" + t.slice(-1) }))) }] } }] });
  };
  assert.strictEqual(await C.multiverseScan(db9, g9, "K", "auto", noop, 2, 1), 2);   // 1 batch of 2
  assert.strictEqual(C.geminiState(db9).pending.length, 3);
  assert.strictEqual(await C.multiverseScan(db9, g9, "K", "auto", noop, 2, 5), 3);   // the rest
  assert.strictEqual(C.geminiState(db9).pending.length, 0);
  assert.strictEqual(await C.multiverseScan(db9, g9, "K", "auto", noop), 0);         // nothing new
  assert.strictEqual(db9.canon().filter(c => c.origin === "gemini").length, 5);
  assert.ok(prompts[1].includes("Use these franchise names exactly when they fit: Films"), "later batches must reuse universe names");
  assert.ok(prompts.some(p => p.includes("Film 4 (2004)")), "list titles must be sent to Gemini");
  assert.strictEqual(db9.canon().find(c => c.title === "Film 0 Part 2").date, "2010-01");
  assert.strictEqual(db9.canon().find(c => c.title === "Film 3 Part 2").date, "2010-01-03");
  assert.strictEqual(C.parseDate("2010-00-00"), null);
  C.resetGemini(db9);
  assert.strictEqual(C.geminiState(db9).pending.length, 5);
  db9.set("gemini_sent", JSON.stringify(["x"])); db9.clearCache();
  assert.strictEqual(db9.get("gemini_sent", "[]"), "[]");

  // Trakt canon lists ask for full details (release dates)
  let traktUrl = "";
  const tl = async (m, url) => { traktUrl = url; return resp([{ type: "movie", movie: { title: "X", year: 2001, released: "2001-02-03", ids: { imdb: "tt7000001" } } }]); };
  const db10 = new C.Store();
  db10.set("client_id", "x"); db10.set("canon_urls", "Test | https://trakt.tv/users/a/lists/b");
  await C.syncAll(db10, tl, noop);
  assert.ok(traktUrl.includes("extended=full"), traktUrl);
  assert.strictEqual(db10.canon()[0].date, "2001-02-03");

  // v1.5: Banta's real error — 2.5-flash still listed but "no longer available to new users"
  const used = [];
  const g11 = async (m, url, opt) => {
    if (m === "GET") return resp({ models: [
      { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.1-flash-lite", supportedGenerationMethods: ["generateContent"] }] });
    const model = url.match(/models\/([^:]+):/)[1];
    used.push(model);
    if (model === "gemini-2.5-flash") return resp({ error: { code: 404, status: "NOT_FOUND", message: "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements." } }, 404);
    return resp({ candidates: [{ content: { parts: [{ text: '[{"franchise":"F","title":"T","medium":"Movie","year":"2001"}]' }] } }] });
  };
  const db11 = new C.Store();
  db11.set("gemini_model", "gemini-2.5-flash");
  db11.addItems([{ imdb: "tt5", title: "Film", year: 2000, medium: "Movie" }], "imdb", "rated");
  assert.strictEqual(await C.multiverseScan(db11, g11, "AQ.x", "gemini-2.5-flash", noop), 1);
  assert.deepStrictEqual(used, ["gemini-2.5-flash", "gemini-3.8-flash"]);
  assert.strictEqual(db11.get("gemini_model_used"), "gemini-3.8-flash");
  assert.strictEqual(db11.get("gemini_model"), "auto");
  // auto picks 3.8-flash straight away
  used.length = 0; C.resetGemini(db11);
  await C.multiverseScan(db11, g11, "AQ.x", "auto", noop);
  assert.deepStrictEqual(used, ["gemini-3.8-flash"]);

  // v1.6: background check — collection refresh, new seasons, alerts
  {
    const now = new Date("2026-10-29T12:00:00Z");
    const calls = [];
    let collectionParts = [
      { id: 11, title: "Saga One", release_date: "2001-05-01" },
      { id: 12, title: "Saga Two", release_date: "2004-05-01" }];
    let tv = { 1402: { name: "The Walking Dead: Daryl Dixon", status: "Returning Series", next_episode_to_air: null },
               57243: { name: "Doctor Who", status: "Returning Series", next_episode_to_air: { air_date: "2026-12-25", season_number: 16, episode_number: 1, name: "Special" } },
               999: { name: "Old Show", status: "Ended", next_episode_to_air: null } };
    const bgHttp = async (m, url) => {
      calls.push(url);
      const u = new URL(url), path = u.pathname.replace("/3", "");
      if (u.host === "api.trakt.tv") return resp([]);
      if (path === "/collection/500") return resp({ name: "Saga Collection", parts: collectionParts });
      if (/^\/movie\/\d+\/external_ids$/.test(path)) return resp({ imdb_id: { 11: "tt8800011", 12: "tt8800012", 13: null }[path.split("/")[2]] });
      if (path.startsWith("/find/tt0000999")) return resp({ tv_results: [{ id: 999 }] });
      if (path.startsWith("/tv/")) return resp(tv[path.split("/")[2]]);
      return resp({}, 404);
    };
    const bdb = new C.Store();
    bdb.set("tmdb_key", "KEY");
    bdb.addItems([{ imdb: "tt8800011", title: "Saga One", year: 2001, medium: "Movie" }], "imdb", "rated");
    bdb.addItems([{ imdb: "tt1520211", tmdb: 1402, title: "TWD: Daryl Dixon", year: 2023, medium: "TV Series" },
                  { imdb: "tt0436992", tmdb: 57243, title: "Doctor Who", year: 2005, medium: "TV Series" },
                  { imdb: "tt0000999", title: "Old Show", year: 1990, medium: "TV Series" }], "trakt", "watched");
    bdb.cachePut("tt8800011", "11", "500", "Saga Collection");
    // first run: baseline, no notifications even though Doctor Who already has a premiere
    let r = await C.backgroundRun(bdb, bgHttp, noop, now);
    assert.ok(!r.report.includes("FAIL"), r.report);
    assert.strictEqual(r.notes.length, 0, JSON.stringify(r.notes));
    assert.ok(r.report.includes("1 season premieres scheduled"), r.report);
    assert.ok(C.upcomingEvents(bdb, C.canonStatus(bdb), "2026-10-29").some(e => e.title === "Doctor Who season 16"));
    // a new film is announced in the collection and Daryl Dixon gets a new season
    collectionParts = collectionParts.concat([{ id: 13, title: "Saga Three", release_date: "2027-06-11" }]);
    tv[1402].next_episode_to_air = { air_date: "2026-11-30", season_number: 4, episode_number: 1 };
    const later = new Date("2026-10-30T12:00:00Z");
    calls.length = 0;
    r = await C.backgroundRun(bdb, bgHttp, noop, later);
    assert.deepStrictEqual(r.notes.map(n => n.title).sort(),
      ["New in Saga: Saga Three", "New season of The Walking Dead: Daryl Dixon"]);
    assert.strictEqual(r.notes.find(n => n.title.startsWith("New season")).text, "Season 4 starts 30 Nov 2026.");
    assert.ok(r.notes.find(n => n.title.includes("Saga Three")).text.includes("11 Jun 2027"));
    assert.ok(!calls.some(u => u.includes("/tv/999")), "ended shows are not rechecked within a month");
    assert.ok(!calls.some(u => u.includes("/movie/11/external_ids")), "known collection parts use the cache");
    // nothing new: no notifications
    r = await C.backgroundRun(bdb, bgHttp, noop, new Date("2026-10-31T12:00:00Z"));
    assert.strictEqual(r.notes.length, 0, JSON.stringify(r.notes));
    // release day
    r = await C.backgroundRun(bdb, bgHttp, noop, new Date("2026-11-30T08:00:00Z"));
    assert.deepStrictEqual(r.notes.map(n => n.title), ["Out today: The Walking Dead: Daryl Dixon season 4"]);
    r = await C.backgroundRun(bdb, bgHttp, noop, new Date("2026-11-30T20:00:00Z"));
    assert.strictEqual(r.notes.length, 0, "release-day reminder only once");
    // many announcements collapse into one summary notification
    const many = [];
    for (let i = 0; i < 8; i++) many.push({ franchise: "Big", title: "Upcoming " + i, date: "2027-0" + (1 + (i % 9)) + "-01", medium: "Movie" });
    bdb.replaceCanon("gemini", many);
    r = await C.backgroundRun(bdb, bgHttp, noop, new Date("2026-12-01T08:00:00Z"));
    assert.strictEqual(r.notes.length, 1);
    assert.ok(/^8 new releases announced$/.test(r.notes[0].title) && r.notes[0].text.includes("and 2 more"), JSON.stringify(r.notes));
    // seen titles never notify
    bdb.addExclusion("Upcoming 7", 2027, "Movie");
    assert.ok(!C.upcomingEvents(bdb, C.canonStatus(bdb), "2026-12-01").some(e => e.title === "Upcoming 7"));
    // no TMDB key: clear message, no crash
    const nk = new C.Store();
    const rk = await C.backgroundRun(nk, bgHttp, noop, now);
    assert.ok(rk.report.includes("SKIP TMDB"), rk.report);
    // reload picks up what the background job saved
    let file = "";
    const P = { load: () => file, save: x => { file = x; } };
    const a = new C.Store(P), b = new C.Store(P);
    b.set("bg_last", "123"); b.flush();
    a.reload();
    assert.strictEqual(a.get("bg_last"), "123");
  }

  // v1.7: network failures in the hidden browser (Banta's report): fast detection, retries, honest message, retry failed
  {
    const page = JSON.stringify({ props: { pageProps: { list: { titleListItemSearch: { total: 1, edges: [{ listItem: { id: "tt0000301", titleText: { text: "Flaky" }, releaseYear: { year: 2001 }, titleType: { id: "movie" } } }] } } } } });
    const tries = {};
    const nHttp = async () => ({ status: 0, headers: {}, body: "", error: "java.net.UnknownHostException" });
    nHttp.browse = async (url) => {
      tries[url] = (tries[url] || 0) + 1;
      if (url.includes("ls300")) return tries[url] < 3 ? { status: 200, value: "NETERR:Web page not available" } : { status: 200, value: JSON.stringify({ items: C.pageExtract([page]), loads: 0 }) };
      if (url.includes("ls301")) return { status: 0, value: null, error: "timeout", title: "\" | chrome-error://chromewebdata/\"" };
      return { status: 200, value: JSON.stringify({ items: C.pageExtract([page]), loads: 0 }) };
    };
    const ndb = new C.Store();
    ndb.set("imdb_lists", "https://www.imdb.com/list/ls300/\nhttps://www.imdb.com/list/ls301/\nhttps://www.imdb.com/list/ls302/");
    ndb.set("canon_urls", "Keep | https://www.imdb.com/list/ls302/\nRedo | https://www.imdb.com/list/ls301/");
    const r1 = await C.syncAll(ndb, nHttp, noop);
    assert.ok(/OK  IMDb list ls300: 1 titles/.test(r1.report), r1.report);
    assert.strictEqual(tries["https://www.imdb.com/list/ls300/"], 3, "retried twice after failed loads");
    assert.ok(/FAIL IMDb list ls301: couldn't reach IMDb after 3 tries/.test(r1.report), r1.report);
    assert.ok(!/Is it public|private/.test(r1.report.split("\n").find(l => l.includes("ls301"))), "network failures must not blame privacy");
    assert.deepStrictEqual(JSON.parse(ndb.get("last_failed")), ["IMDb list ls301", "Canon: Redo"]);
    assert.strictEqual(ndb.canon().filter(c => c.src === "https://www.imdb.com/list/ls302/").length, 1);
    // retry only the failed ones once IMDb is reachable again: other canon stays, nothing else re-runs
    const before = Object.assign({}, tries);
    nHttp.browse = async (url) => { tries[url] = (tries[url] || 0) + 1; return { status: 200, value: JSON.stringify({ items: C.pageExtract([page]), loads: 0 }) }; };
    const r2 = await C.syncAll(ndb, nHttp, noop, new Set(JSON.parse(ndb.get("last_failed"))));
    assert.strictEqual(r2.total, 2);
    assert.ok(!r2.failed.length, r2.report);
    assert.strictEqual(tries["https://www.imdb.com/list/ls300/"], before["https://www.imdb.com/list/ls300/"], "succeeded sources aren't re-run");
    assert.deepStrictEqual(JSON.parse(ndb.get("last_failed")), []);
    assert.deepStrictEqual(ndb.canon().map(c => c.franchise).sort(), ["Keep", "Redo"]);
  }

  // v1.8: not canon, upcoming episodes, episode notifications, games from every source
  {
    const d8 = new C.Store();
    d8.addItems([{ imdb: "tt0076759", title: "Star Wars", year: 1977, medium: "Movie", rating: 9 }], "imdb", "rated");
    d8.addItems([{ imdb: "tt2000001", title: "Some Game", year: 2020, medium: "Video Game" }], "imdb", "list", "games");
    d8.addItems([{ imdb: "tt2000002", title: "Played Game", year: 2021, medium: "Video Game", rating: 8 }], "imdb", "rated");
    assert.deepStrictEqual([d8.counters().games, d8.counters().gamesPlayed], [2, 1]);
    d8.replaceCanon("gemini", [
      { franchise: "Star Wars", title: "Star Wars", year: 1977, medium: "Movie" },
      { franchise: "Star Wars", title: "Star Wars: The Compilation", year: 1999, medium: "Movie" },
      { franchise: "Star Wars", title: "The Empire Strikes Back", year: 1980, medium: "Movie" }]);
    const comp = C.canonStatus(d8).find(c => c.title === "Star Wars: The Compilation");
    d8.setNotCanon(comp, true);
    let st8 = C.canonStatus(d8);
    assert.ok(!st8.some(c => c.title === "Star Wars: The Compilation"), "not-canon entries leave the canon");
    assert.strictEqual(C.franchiseProgress(st8).find(f => f.name === "Star Wars").total, 2);
    // the mark survives a source adding an IMDb ID for the same entry
    d8.replaceCanon("tmdb", [{ franchise: "Star Wars Collection", title: "Star Wars: The Compilation", year: 1999, medium: "Movie", imdb: "tt3999999" }]);
    assert.ok(!C.canonStatus(d8).some(c => c.title === "Star Wars: The Compilation"));
    d8.setNotCanon(comp, false);
    assert.ok(C.canonStatus(d8).some(c => c.title === "Star Wars: The Compilation"), "undo brings it back");
    assert.deepStrictEqual(d8.notCanon(), {});

    // upcoming episodes: the rest of the season is listed; per-episode notifications are opt-in
    const eHttp = async (m, url) => {
      const path = new URL(url).pathname.replace("/3", "");
      if (path === "/tv/1399") return resp({ name: "House of the Dragon", status: "Returning Series", next_episode_to_air: { air_date: "2026-11-02", season_number: 3, episode_number: 4, name: "Ep 4" } });
      if (path === "/tv/1399/season/3") return resp({ episodes: [
        { air_date: "2026-10-26", season_number: 3, episode_number: 3, name: "Aired" },
        { air_date: "2026-11-02", season_number: 3, episode_number: 4, name: "The Fourth" },
        { air_date: "2026-11-09", season_number: 3, episode_number: 5, name: "Episode 5" },
        { air_date: null, season_number: 3, episode_number: 6, name: "TBA" }] });
      return resp({}, 404);
    };
    const de = new C.Store();
    de.addItems([{ imdb: "tt11198330", tmdb: 1399, title: "House of the Dragon", year: 2022, medium: "TV Series" }], "trakt", "watched");
    const msg = await C.tvNext(de, eHttp, "KEY", 450, Date.parse("2026-10-29T10:00:00Z"));
    assert.ok(msg.includes("1 with new episodes"), msg);
    const ue = C.upcomingEpisodes(de, "2026-10-29");
    assert.deepStrictEqual(ue.map(e => [e.date, e.s, e.e]), [["2026-11-02", 3, 4], ["2026-11-09", 3, 5]]);
    C.computeAlerts(de, [], "2026-10-29"); // baseline
    assert.strictEqual(C.computeAlerts(de, [], "2026-11-02").length, 0, "episode alerts are off by default");
    de.set("bg_eps", "1");
    const n2 = C.computeAlerts(de, [], "2026-11-09");
    assert.deepStrictEqual(n2.map(n => [n.title, n.text, n.tab]), [["New episode today: House of the Dragon", 'S3E5 "Episode 5".', "upcoming"]]);
    assert.strictEqual(C.computeAlerts(de, [], "2026-11-09").length, 0, "once per episode");

    // Sync now refreshes shows when a TMDB key is set
    de.set("tmdb_key", "KEY");
    const rs = await C.details(de, eHttp, noop);
    assert.ok(/OK   Next episodes: /.test(rs), rs);
  }

  // v1.9: Claude canon scan, posters, hiding from Upcoming
  {
    const cdb = new C.Store();
    for (let i = 0; i < 5; i++) cdb.addItems([{ imdb: "tt95000" + i, title: "Show " + i, year: 2010 + i, medium: "TV Series" }], "trakt", "watched");
    const reqs = [];
    let paused = false;
    const ch = async (m, url, opt) => {
      reqs.push({ m, url, h: opt.headers, b: opt.body ? JSON.parse(opt.body) : null });
      assert.strictEqual(opt.headers["x-api-key"], "sk-ant-test");
      assert.strictEqual(opt.headers["anthropic-version"], "2023-06-01");
      if (m === "GET") return resp({ data: [{ id: "claude-haiku-5-5" }, { id: "claude-sonnet-5-5" }, { id: "claude-opus-5-5" }, { id: "claude-sonnet-5" }] });
      const body = JSON.parse(opt.body);
      assert.ok(!("temperature" in body), "no temperature (rejected by Sonnet 5.x)");
      if (body.model === "claude-sonnet-5-5" && !paused && body.tools) {
        paused = true;
        return resp({ stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "new Show 0 season" } }] });
      }
      const titles = [...body.messages[0].content.matchAll(/^(Show \d) \(/gm)].map(x => x[1]);
      return resp({ stop_reason: "end_turn", content: [
        { type: "text", text: "Let me check." },
        { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
        { type: "text", text: "Here you go:\n```json\n" + JSON.stringify(titles.map(t => ({ franchise: t + " universe", title: t + ": The Movie", medium: "Movie", year: "2027", release_date: "2027-03-05" }))) + "\n```" }] });
    };
    const n = await C.claudeScan(cdb, ch, "sk-ant-test", "auto", noop, { webSearch: true, batchSize: 3 });
    assert.strictEqual(n, 5);
    assert.strictEqual(cdb.get("claude_model_used"), "claude-sonnet-5-5", "auto picks the newest Sonnet");
    const posts = reqs.filter(r => r.m === "POST");
    assert.ok(posts[0].b.tools[0].type === "web_search_20250305" && posts[0].b.tools[0].max_uses === 5);
    assert.strictEqual(posts[1].b.messages.length, 2, "pause_turn resumes with the assistant content");
    assert.strictEqual(posts.length, 3, "2 batches + 1 resume");
    assert.ok(posts[0].b.messages[0].content.includes("web search"), "prompt mentions web search");
    assert.strictEqual(cdb.get("claude_searches"), "1");
    assert.deepStrictEqual(C.aiState(cdb, "claude").pending.length, 0);
    assert.strictEqual(C.aiState(cdb, "gemini").pending.length, 5, "providers track progress separately");
    assert.strictEqual(cdb.canon().find(c => c.title === "Show 2: The Movie").date, "2027-03-05");
    // a retired model falls back to the next listed one
    const db2c = new C.Store();
    db2c.addItems([{ imdb: "tt9600001", title: "Solo", year: 2001, medium: "Movie" }], "imdb", "rated");
    const used2 = [];
    const ch2 = async (m, url, opt) => {
      if (m === "GET") return resp({ data: [{ id: "claude-sonnet-5-5" }, { id: "claude-haiku-5-5" }] });
      const b = JSON.parse(opt.body); used2.push(b.model);
      if (b.model === "claude-sonnet-5-5") return resp({ type: "error", error: { type: "not_found_error", message: "model: claude-sonnet-5-5" } }, 404);
      return resp({ stop_reason: "end_turn", content: [{ type: "text", text: '[{"franchise":"F","title":"T","medium":"Movie","year":"2001"}]' }] });
    };
    assert.strictEqual(await C.claudeScan(db2c, ch2, "sk-ant-test", "auto", noop), 1);
    assert.deepStrictEqual(used2, ["claude-sonnet-5-5", "claude-haiku-5-5"]);
    assert.strictEqual(db2c.get("claude_model_used"), "claude-haiku-5-5");
    // clear errors
    C.resetAi(db2c, "claude");
    await assert.rejects(C.claudeScan(db2c, async (m) => m === "GET" ? resp({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401) : resp({}, 500), "bad", "auto", noop),
      /401 authentication_error: invalid x-api-key\. Check the Claude API key/);
    await assert.rejects(C.claudeScan(db2c, async (m) => m === "GET" ? resp({ data: [] }) : resp({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } }, 400), "k", "auto", noop),
      /Add credit in the Claude Console/);
    await assert.rejects(C.claudeScan(new C.Store(), ch2, "", "auto", noop), /Enter a Claude API key/);
    assert.ok(C.rankClaudeModel("claude-sonnet-5-5") > C.rankClaudeModel("claude-sonnet-5"));
    assert.ok(C.rankClaudeModel("claude-sonnet-5-5") > C.rankClaudeModel("claude-haiku-5-5"));
    assert.ok(C.rankClaudeModel("claude-haiku-5-5") > C.rankClaudeModel("claude-opus-5-5"));

    // posters + hide from Upcoming (also silences notifications)
    const hdb = new C.Store();
    hdb.cacheSet("tv:57243", { name: "Doctor Who", status: "Returning Series", checked: 1, poster: "/dw.jpg",
      next: { date: "2026-12-25", s: 16, e: 1 }, eps: [{ date: "2026-12-25", s: 16, e: 1 }, { date: "2027-01-01", s: 16, e: 2 }] });
    hdb.replaceCanon("tmdb", [{ franchise: "Saga", title: "Saga Three", date: "2027-06-11", medium: "Movie", poster: "/s3.jpg" }]);
    const st9 = C.canonStatus(hdb);
    assert.strictEqual(st9[0].poster, "/s3.jpg");
    assert.strictEqual(C.upcomingEpisodes(hdb, "2026-10-30")[0].poster, "/dw.jpg");
    const evs = C.upcomingEvents(hdb, st9, "2026-10-30");
    assert.strictEqual(evs.length, 2);
    hdb.setUpHidden(evs.find(e => e.kind === "season").hideKey, "Doctor Who", true);
    hdb.setUpHidden(evs.find(e => e.kind === "canon").hideKey, "Saga Three", true);
    assert.strictEqual(C.upcomingEvents(hdb, st9, "2026-10-30").length, 0);
    assert.strictEqual(C.upcomingEpisodes(hdb, "2026-10-30").length, 0);
    hdb.set("bg_eps", "1");
    C.computeAlerts(hdb, st9, "2026-10-30");
    assert.strictEqual(C.computeAlerts(hdb, st9, "2026-12-25").length, 0, "hidden shows never notify");
    hdb.setUpHidden("show|tv:57243", "", false);
    assert.strictEqual(C.upcomingEpisodes(hdb, "2026-10-30").length, 2);
  }

  // v2.0: free-tier Gemini
  {
    const quota = (msg, retry, perDay) => resp({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: msg, details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
        quotaId: perDay ? "GenerateRequestsPerDayPerProjectPerModel-FreeTier" : "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: retry }] } }, 429);
    const LIST = resp({ models: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-pro-preview", "gemma-4-31b-it", "gemini-4-argon"].map(n => ({ name: "models/" + n, supportedGenerationMethods: ["generateContent"] })) });
    const answer = titles => resp({ candidates: [{ content: { parts: [{ text: JSON.stringify(titles.map(t => ({ franchise: "U", title: t + " II", medium: "Movie", year: "2001" }))) }] } }] });
    const titlesOf = opt => [...JSON.parse(opt.body).contents[0].parts[0].text.matchAll(/^(Film \d+) \(/gm)].map(x => x[1]);
    const mk = n => { const d = new C.Store(); for (let i = 0; i < n; i++) d.addItems([{ imdb: "tt97000" + i, title: "Film " + i, year: 2000 + i, medium: "Movie" }], "imdb", "rated"); return d; };

    // ranking prefers free Flash, keeps Gemma as last resort, skips paid-only families
    const ranked = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview", "gemma-4-31b-it", "gemini-4-argon"]
      .filter(m => C.rankGeminiModel(m) >= 0).sort((a, b) => C.rankGeminiModel(b) - C.rankGeminiModel(a));
    assert.deepStrictEqual(ranked, ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemma-4-31b-it", "gemini-3.1-pro-preview"]);

    // per-minute limit: waits for Google's retryDelay, then continues on the same model
    let calls = [];
    let first = true;
    const h1 = async (m, url, opt) => {
      if (m === "GET") return LIST;
      const model = url.match(/models\/([^:]+):/)[1]; calls.push(model);
      if (first) { first = false; return quota("Resource has been exhausted (e.g. check quota).", "0.01s", false); }
      return answer(titlesOf(opt));
    };
    const g1 = mk(3);
    assert.strictEqual(await C.multiverseScan(g1, h1, "AQ.k", "auto", noop), 3);
    assert.deepStrictEqual(calls, ["gemini-3.8-flash", "gemini-3.8-flash"]);

    // "limit: 0" (model not on the free tier): moves to the next free model
    calls = [];
    const h2 = async (m, url, opt) => {
      if (m === "GET") return LIST;
      const model = url.match(/models\/([^:]+):/)[1]; calls.push(model);
      if (model === "gemini-3.8-flash") return quota("Quota exceeded for metric: generate_content_free_tier_requests, limit: 0, model: gemini-3.8-flash", "30s", false);
      return answer(titlesOf(opt));
    };
    const g2 = mk(2);
    assert.strictEqual(await C.multiverseScan(g2, h2, "AQ.k", "auto", noop), 2);
    assert.deepStrictEqual(calls, ["gemini-3.8-flash", "gemini-3.6-flash"]);
    assert.strictEqual(g2.get("gemini_model_used"), "gemini-3.6-flash");

    // daily free quota used up on every model mid-run: stops with a clear message, keeps the finished batches
    let ok = 1;
    const h3 = async (m, url, opt) => {
      if (m === "GET") return LIST;
      if (ok-- > 0) return answer(titlesOf(opt));
      return quota("You exceeded your current quota, please check your plan and billing details.", "40s", true);
    };
    const g3 = mk(6);
    await assert.rejects(C.multiverseScan(g3, h3, "AQ.k", "auto", noop, 3, 5), /today's free Gemini quota.*run the scan again tomorrow/);
    assert.strictEqual(C.aiState(g3, "gemini").sent.size, 3, "first batch kept");
    assert.strictEqual(g3.canon().length, 3);

    // Gemma doesn't do JSON mode: retried without it
    const gemmaBodies = [];
    const h4 = async (m, url, opt) => {
      if (m === "GET") return resp({ models: [{ name: "models/gemma-4-31b-it", supportedGenerationMethods: ["generateContent"] }] });
      const b = JSON.parse(opt.body); gemmaBodies.push(!!b.generationConfig.responseMimeType);
      return answer(titlesOf(opt));
    };
    await C.multiverseScan(mk(1), h4, "AQ.k", "auto", noop);
    assert.deepStrictEqual(gemmaBodies, [false], "Gemma is called without JSON mode");

    // the AQ. key problem gets an explanation
    const h5 = async () => resp({ error: { code: 401, status: "UNAUTHENTICATED", message: "Request had invalid authentication credentials.",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_TYPE_UNSUPPORTED" }] } }, 401);
    await assert.rejects(C.testGemini(h5, "AQ.k", "auto"), /401 UNAUTHENTICATED.*rejecting this AQ\. key.*Google Cloud Console/);

    // key test happy path
    const okH = async (m, url, opt) => m === "GET" ? LIST : resp({ candidates: [{ content: { parts: [{ text: '["ok"]' }] } }] });
    const tr = await C.testGemini(okH, "AQ.k", "auto");
    assert.deepStrictEqual([tr.model, tr.reply], ["gemini-3.8-flash", '["ok"]']);
  }

  // v2.1: continue watching, Gemini timeouts/cancel/search, prompt covers connected material
  {
    const prog = C.watchProgress([
      { last_watched_at: "2026-09-01T20:00:00.000Z", show: { title: "Andor", ids: { tmdb: 83867, imdb: "tt9253284" } },
        seasons: [{ number: 1, episodes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => ({ number: n, plays: 1 })) }, { number: 2, episodes: [{ number: 1, plays: 1 }, { number: 2, plays: 1 }] }] },
      { last_watched_at: "2026-10-01T20:00:00.000Z", show: { title: "Done Show", ids: { tmdb: 1 } }, seasons: [{ number: 1, episodes: [{ number: 1, plays: 1 }, { number: 2, plays: 1 }] }] },
      { last_watched_at: "2025-01-01T20:00:00.000Z", show: { title: "Waiting Show", ids: { tmdb: 2 } }, seasons: [{ number: 0, episodes: [{ number: 1, plays: 1 }] }, { number: 1, episodes: [{ number: 1, plays: 1 }] }] }]);
    assert.deepStrictEqual(prog["83867"].eps, { 1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 2: [1, 2] });
    assert.ok(!("0" in prog["2"].eps), "specials season ignored");
    const cw = new C.Store();
    cw.set("trakt_progress", JSON.stringify(prog));
    cw.cacheSet("tv:83867", { name: "Andor", poster: "/a.jpg", aired: { s: 2, e: 6, date: "2026-10-20" }, seasons: [[1, 12], [2, 12]] });
    cw.cacheSet("tv:1", { name: "Done Show", aired: { s: 1, e: 2, date: "2020-01-01" }, seasons: [[1, 2]] });
    cw.cacheSet("tv:2", { name: "Waiting Show", aired: { s: 1, e: 3, date: "2024-05-01" }, seasons: [[1, 3]] });
    const list = C.continueWatching(cw);
    assert.deepStrictEqual(list.map(x => [x.show, x.s, x.e, x.left, x.fresh]), [["Andor", 2, 3, 4, true], ["Waiting Show", 1, 2, 2, false]]);
    cw.setUpHidden("next|tv:2", "Waiting Show", true);
    assert.deepStrictEqual(C.continueWatching(cw).map(x => x.show), ["Andor"]);

    // tvNext stores aired + season counts used above
    const tvH = async (m, url) => {
      const p = new URL(url).pathname.replace("/3", "");
      if (p === "/tv/83867") return resp({ name: "Andor", status: "Ended", poster_path: "/a.jpg", last_episode_to_air: { season_number: 2, episode_number: 12, air_date: "2025-05-13" },
        seasons: [{ season_number: 0, episode_count: 3 }, { season_number: 1, episode_count: 12 }, { season_number: 2, episode_count: 12 }] });
      return resp({}, 404);
    };
    const tv2 = new C.Store();
    tv2.addItems([{ imdb: "tt9253284", tmdb: 83867, title: "Andor", year: 2022, medium: "TV Series" }], "trakt", "watched");
    await C.tvNext(tv2, tvH, "KEY");
    assert.deepStrictEqual([tv2.cacheGet("tv:83867").aired.e, tv2.cacheGet("tv:83867").seasons], [12, [[1, 12], [2, 12]]]);

    // Gemini: a request that never answers times out instead of loading forever
    C.CONFIG.aiTimeoutMs = 200;
    const LIST2 = resp({ models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }] });
    const hang = async (m) => m === "GET" ? LIST2 : new Promise(() => {});
    const gt = new C.Store();
    gt.addItems([{ imdb: "tt9800001", title: "Film", year: 2001, medium: "Movie" }], "imdb", "rated");
    await assert.rejects(C.multiverseScan(gt, hang, "k", "auto", noop), /didn't answer within/);
    C.CONFIG.aiTimeoutMs = 180000;

    // request body: low thinking, smaller output, prompt asks for connected material; optional Google Search drops JSON mode
    const bodies = [];
    const okG = async (m, url, opt) => {
      if (m === "GET") return LIST2;
      bodies.push(JSON.parse(opt.body));
      return resp({ candidates: [{ content: { parts: [{ text: '[{"franchise":"F","title":"T","medium":"Special","year":"2001"}]' }] } }] });
    };
    const gb = new C.Store();
    gb.addItems([{ imdb: "tt9800002", title: "Film", year: 2001, medium: "Movie" }], "imdb", "rated");
    await C.multiverseScan(gb, okG, "k", "auto", noop);
    const b0 = bodies[0];
    assert.deepStrictEqual([b0.generationConfig.thinkingConfig, b0.generationConfig.maxOutputTokens, b0.generationConfig.responseMimeType], [{ thinkingLevel: "low" }, 16000, undefined]);
    assert.ok(/spin-off/.test(b0.contents[0].parts[0].text) && /webisodes/.test(b0.contents[0].parts[0].text));
    C.resetAi(gb, "gemini");
    await C.multiverseScan(gb, okG, "k", "auto", noop, 40, 25, { search: true });
    assert.deepStrictEqual([bodies[1].tools, bodies[1].generationConfig.responseMimeType], [[{ google_search: {} }], undefined]);
    // cancel between batches keeps progress
    const gc = new C.Store();
    for (let i = 0; i < 4; i++) gc.addItems([{ imdb: "tt98100" + i, title: "Film " + i, year: 2000 + i, medium: "Movie" }], "imdb", "rated");
    let nCalls = 0;
    const cancelH = async (m, url, opt) => { if (m === "GET") return LIST2; nCalls++; C.CONFIG.cancelled = true; return okG(m, url, opt); };
    await C.multiverseScan(gc, cancelH, "k", "auto", noop, 2, 5);
    assert.strictEqual(nCalls, 1, "stops after the running batch");
    assert.strictEqual(C.aiState(gc, "gemini").sent.size, 2);
    assert.strictEqual(C.CONFIG.cancelled, false);
  }

  // v2.2: release dates from several sources, digital/VOD, streaming + resolution, details, platform ratings
  {
    const now = Date.parse("2026-10-30T12:00:00Z");
    const jwBodies = [];
    const tm = async (m, url, opt) => {
      const u = new URL(url);
      if (u.host === "apis.justwatch.com") {
        const b = JSON.parse(opt.body); jwBodies.push(b);
        if (b.variables.filter.searchQuery === "Avengers: Doomsday") return resp({ data: { popularTitles: { edges: [
          { node: { objectType: "MOVIE", content: { title: "Avengers: Doomsday", originalReleaseYear: 2026, originalReleaseDate: "2026-12-16", externalIds: { imdbId: "tt21357150", tmdbId: "1003596" }, scoring: { imdbScore: null, tomatoMeter: null } }, offers: [] } }] } } });
        return resp({ data: { popularTitles: { edges: [
          { node: { objectType: "MOVIE", content: { title: "Other", originalReleaseYear: 1999, externalIds: { imdbId: "tt0000001" } }, offers: [] } },
          { node: { objectType: "MOVIE", content: { title: "Rogue One", originalReleaseYear: 2016, originalReleaseDate: "2016-12-15", externalIds: { imdbId: "tt3748528", tmdbId: "330459" }, scoring: { imdbScore: 7.8, imdbVotes: 700000, tomatoMeter: 84 } },
            offers: [{ monetizationType: "FLATRATE", presentationType: "_4K", package: { clearName: "Disney Plus" } }, { monetizationType: "FLATRATE", presentationType: "HD", package: { clearName: "Disney Plus" } },
                     { monetizationType: "RENT", presentationType: "_4K", package: { clearName: "Apple TV" } }, { monetizationType: "FLATRATE", presentationType: "HD", package: { clearName: "Amazon Prime Video" } }] } }] } } });
      }
      const p = u.pathname.replace("/3", "");
      if (p === "/movie/330459") {
        assert.ok(u.searchParams.get("append_to_response").includes("release_dates"));
        return resp({ id: 330459, title: "Rogue One: A Star Wars Story", release_date: "2016-12-14", runtime: 133, genres: [{ name: "Action" }], vote_average: 7.5, vote_count: 15000,
          overview: "Plot.", external_ids: { imdb_id: "tt3748528" }, credits: { crew: [{ job: "Director", name: "Gareth Edwards" }], cast: [{ name: "Felicity Jones" }] },
          release_dates: { results: [{ iso_3166_1: "IT", release_dates: [{ type: 3, release_date: "2016-12-15T00:00:00.000Z", certification: "T" }, { type: 4, release_date: "2017-04-20T00:00:00.000Z" }] }] },
          "watch/providers": { results: { IT: { flatrate: [{ provider_name: "Disney Plus" }, { provider_name: "Amazon Prime Video" }], rent: [{ provider_name: "Apple TV" }] } } } });
      }
      if (p === "/find/tt21357150") return resp({ movie_results: [{ id: 1003596 }] });
      if (p === "/movie/1003596") return resp({ id: 1003596, title: "Avengers: Doomsday", release_date: "2026-12-16", status: "Post Production", external_ids: { imdb_id: "tt21357150" },
        release_dates: { results: [{ iso_3166_1: "IT", release_dates: [{ type: 3, release_date: "2026-12-16T00:00:00.000Z" }] }, { iso_3166_1: "US", release_dates: [{ type: 3, release_date: "2026-12-18T00:00:00.000Z" }, { type: 4, release_date: "2027-02-23T00:00:00.000Z" }] }] },
        "watch/providers": { results: {} }, credits: { crew: [], cast: [] } });
      return resp({}, 404);
    };
    const idb = new C.Store();
    idb.set("tmdb_key", "KEY");
    idb.addItems([{ imdb: "tt3748528", tmdb: 330459, title: "Rogue One", year: 2016, date: "2016-12-16", medium: "Movie" }], "trakt", "list", "to-watch");
    idb.replaceCanon("gemini", [{ franchise: "Star Wars", title: "Rogue One", year: 2016, date: "2017-01-20", medium: "Movie" }]);
    const ro = await C.titleInfo(idb, tm, { title: "Rogue One", year: 2016, imdb: "tt3748528", tmdb: 330459, medium: "Movie" }, { now });
    assert.deepStrictEqual([ro.dates.cinema, ro.dates.digital, ro.unreleased, ro.cert, ro.runtime, ro.crew[0], ro.imdbScore, ro.tomato], ["2016-12-15", "2017-04-20", false, "T", 133, "Gareth Edwards", 7.8, 84]);
    assert.deepStrictEqual(ro.offers.map(o => `${o.name}|${o.type}|${o.res}`), ["Disney Plus|flatrate|4K", "Amazon Prime Video|flatrate|HD", "Apple TV|rent|4K"]);
    assert.deepStrictEqual(C.bestOffer(ro), { name: "Disney Plus", type: "flatrate", res: "4K", url: null });
    assert.deepStrictEqual(ro.sources.map(x => x.name).sort(), ["Gemini", "JustWatch", "TMDB", "Trakt"]);
    assert.ok(ro.conflict, "Gemini's date is >7 days off: flagged");
    assert.strictEqual(C.dateSummary(ro), "Released 14 Dec 2016");
    assert.strictEqual(jwBodies[0].variables.country, "IT");
    // unreleased film: regional cinema date + US digital date, both shown; cached
    const av = await C.titleInfo(idb, tm, { title: "Avengers: Doomsday", year: 2026, imdb: "tt21357150", medium: "Movie" }, { now });
    assert.deepStrictEqual([av.dates.cinema, av.dates.digital, av.dates.digitalRegion, av.unreleased], ["2026-12-16", "2027-02-23", "US", true]);
    assert.strictEqual(C.dateSummary(av), "Cinema 16 Dec 2026 · Digital/VOD 23 Feb 2027");
    const nJw = jwBodies.length;
    assert.strictEqual(await C.titleInfo(idb, tm, { title: "Avengers: Doomsday", year: 2026, imdb: "tt21357150", medium: "Movie" }, { now: now + 864e5 }), C.cachedInfo(idb, { title: "Avengers: Doomsday", year: 2026, imdb: "tt21357150", medium: "Movie" }));
    assert.strictEqual(jwBodies.length, nJw, "served from cache");
    // Upcoming gets a separate digital-release event, and the cinema event uses the regional date
    idb.replaceCanon("tmdb", [{ franchise: "MCU", title: "Avengers: Doomsday", year: 2026, date: "2026-12-18", imdb: "tt21357150", medium: "Movie" }]);
    const evs = C.upcomingEvents(idb, C.canonStatus(idb), "2026-10-30").filter(e => /Doomsday/.test(e.title));
    assert.deepStrictEqual(evs.map(e => [e.date, !!e.vod]), [["2026-12-16", false], ["2027-02-23", true]]);
    // JustWatch failing never breaks details
    const jwDown = async (m, url, opt) => new URL(url).host === "apis.justwatch.com" ? resp("", 503) : tm(m, url, opt);
    const ro2 = await C.titleInfo(idb, jwDown, { title: "Rogue One", year: 2016, imdb: "tt3748528", tmdb: 330459, medium: "Movie" }, { now, force: true });
    assert.ok(ro2.offers.length === 3 && ro2.offers.every(o => o.res === null) && /503/.test(ro2.jwError));

    // ratings per platform for the IMDb/Trakt comparison
    const rdb = new C.Store();
    rdb.addItems([{ imdb: "tt1", title: "A", year: 2000, medium: "Movie", rating: 9 }, { imdb: "tt2", title: "B", year: 2001, medium: "Movie", rating: 6 }], "imdb", "rated");
    rdb.addItems([{ imdb: "tt1", title: "A", year: 2000, medium: "Movie", rating: 7 }], "trakt", "rated");
    rdb.addItems([{ imdb: "tt2", title: "B", year: 2001, medium: "Movie" }], "trakt", "watched");
    const pr = C.platformRatings(rdb);
    assert.deepStrictEqual([pr.get("tt1").imdb.rating, pr.get("tt1").trakt.rating, pr.get("tt2").trakt.rating, pr.get("tt2").trakt.watched], [9, 7, null, true]);
    assert.deepStrictEqual(C.ratingDiffs(rdb).map(x => [x.title, x.imdbRating, x.traktRating]), [["A", 9, 7]]);
  }
  // Multiverses: step 1 groups titles (and maps canon-list franchise names), step 2 searches per multiverse
  {
    const mdb = new C.Store();
    mdb.addItems([{ imdb: "tt1", title: "Doctor Who", year: 2005, medium: "TV Series" }, { imdb: "tt2", title: "Torchwood", year: 2006, medium: "TV Series" },
                  { imdb: "tt3", title: "Paddington", year: 2014, medium: "Movie" }], "imdb", "watched");
    mdb.replaceCanon("url", [{ franchise: "Doctor Who", title: "The Five Doctors", year: 1983, medium: "Special" }]);
    const prompts = [];
    const prov = { label: "Test", call: async (prompt, o) => {
      prompts.push([o.title, prompt]);
      if (o.title === "Group into multiverses") {
        const lines = prompt.split(/TITLES \(n\. Title[^\n]*\n/)[1].split("\n");
        assert.ok(/Also map each of these franchise names.*Doctor Who/.test(prompt));
        assert.ok(/^OUTPUT: plain lines/m.test(prompt) && !/"titles"/.test(prompt), "line format, no JSON template");
        // 5.3: compact line answers
        return lines.map((l, i) => /Paddington/.test(l) ? `${i + 1} | -` : `${i + 1} | Whoniverse | ${/Torchwood/.test(l) ? "Torchwood" : "Doctor Who"}`).join("\n") + "\n= Doctor Who | Whoniverse";
      }
      assert.ok(/## Whoniverse/.test(prompt) && /Torchwood \(2006\) \[S\]/.test(prompt) && /The Five Doctors \(1983\)/.test(prompt) && !/Paddington/.test(prompt));
      return "# Whoniverse\nThe Sarah Jane Adventures | S | 2007 | 2007-01-01 | The Sarah Jane Adventures\n# Somewhere else\nIgnored | F | 2000 | -";
    } };
    const noop = () => {};
    assert.strictEqual(await C.mvGroup(mdb, prov, noop), 3);
    assert.strictEqual(C.mvPending(mdb).pending.length, 0);
    assert.deepStrictEqual(C.multiverses(mdb).map(g => [g.name, g.seeds]), [["Whoniverse", 2]]);
    assert.strictEqual(await C.mvExpand(mdb, prov, noop), 1);
    const st = C.canonStatus(mdb);
    const sja = st.find(c => c.title === "The Sarah Jane Adventures"), fd = st.find(c => c.title === "The Five Doctors");
    assert.strictEqual(sja.franchise, "Whoniverse"); assert.strictEqual(sja.sub, "The Sarah Jane Adventures");
    assert.strictEqual(fd.franchise, "Whoniverse"); assert.strictEqual(fd.sub, "Doctor Who");   // canon-list franchise mapped into its multiverse
    assert.strictEqual(await C.mvExpand(mdb, prov, noop), 0);                                     // searched recently: nothing to do
    assert.strictEqual(prompts.filter(p => p[0] !== "Group into multiverses").length, 1);
    // stopping in the Gemini app ends cleanly
    const mdb2 = new C.Store();
    mdb2.addItems([{ imdb: "tt9", title: "Alien", year: 1979, medium: "Movie" }], "imdb", "watched");
    assert.strictEqual(await C.mvGroup(mdb2, { label: "App", call: async () => { throw Object.assign(new Error("Stopped"), { cancelled: true }); } }, noop), 0);
  }

  // Worldwide streaming for a VPN: services you have first, then free, with JustWatch quality where known
  {
    const world = C.worldFrom({ IT: { flatrate: [{ provider_name: "Netflix" }] }, US: { flatrate: [{ provider_name: "Disney Plus" }, { provider_name: "Max" }] },
      GB: { flatrate: [{ provider_name: "Disney Plus" }], free: [{ provider_name: "BBC iPlayer" }] }, JP: { buy: [{ provider_name: "Apple TV" }] } },
      { US: [{ name: "Disney Plus", type: "flatrate", res: "4K" }], GB: [{ name: "Disney Plus", type: "flatrate", res: "HD" }] });
    assert.ok(!C.worldCountries(world).has("JP"), "buy-only countries aren't streaming");
    assert.ok(JSON.stringify(world).length < 200, "compact: " + JSON.stringify(world));
    const info = { region: "IT", offers: [{ name: "Netflix", type: "flatrate" }], world };
    const v = C.vpnOptions(info, ["Disney+", "Netflix"]);
    assert.deepStrictEqual(v.map(s => s.name), ["Disney Plus", "BBC iPlayer", "Max"]);
    assert.deepStrictEqual(v[0].countries.map(c => c.cc + ":" + c.res), ["US:4K", "GB:HD"]);
    assert.strictEqual(C.bestVpn(info, ["Disney+"]), null, "streams at home: no VPN badge");
    const away = { region: "IT", offers: [], world };
    const b = C.bestVpn(away, ["Disney+"]);
    assert.deepStrictEqual([b.name, b.cc, b.res], ["Disney Plus", "US", "4K"]);
    assert.ok(/\$cUS: Country!/.test(C.jwQuery(["US"])) && /oUS: offers\(country: \$cUS/.test(C.jwQuery(["US"])));
  }
  // Resume: an unchanged file isn't re-read; a file changed by the background sync is
  {
    let file = "", stamp = "a", loads = 0;
    const persist = { load: () => { loads++; return file; }, save: t => { file = t; stamp = "s" + file.length; }, stamp: () => stamp };
    const sdb = new C.Store(persist);
    sdb.set("x", "1"); sdb.flush();
    const l0 = loads;
    assert.strictEqual(sdb.reload(), false, "unchanged file is not re-read");
    assert.strictEqual(loads, l0);
    sdb.set("y", "2");                      // pending debounced change is written before checking
    assert.strictEqual(sdb.reload(), false);
    assert.ok(file.includes('"y":"2"'));
    const other = JSON.parse(file); other.settings.z = "3"; file = JSON.stringify(other); stamp = "bg";
    assert.strictEqual(sdb.reload(), true);
    assert.strictEqual(sdb.get("z"), "3");
  }
  console.log("ALL JS TESTS PASSED");
}

main().catch(e => { console.error(e); process.exit(1); });
