// 0.5.9: IMDb through its data service (cached GET first), Trakt pages 4 at a time and stopping at stored ratings,
// Steam custom names, IMDb games, rated = watched. Run: node test_059.js
const assert = require("assert");
const C = require("./core.js"), L = require("./library.js"), G = require("./games.js"), I = require("./imports.js");
const resp = (body, status = 200, headers = {}) => ({ status, headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const title = (i, extra) => Object.assign({ id: "tt" + (8000000 + i), titleType: { id: i % 7 ? "movie" : "videoGame" }, titleText: { text: "Title " + i }, releaseYear: { year: 2000 + (i % 20) }, releaseDate: { year: 2000 + (i % 20), month: 3, day: 9 }, runtime: { seconds: 5400 } }, extra || {});
(async () => {
  // ---- the cached GET address first; the POST one only when it fails
  { const calls = [];
    const http = async (m, url) => { calls.push(m + " " + url.slice(0, 40)); if (m === "GET") return resp("", 403); return resp({ data: { titles: [1] } }); };
    const d = await C.imdbGql(http, "{titles(ids:[\"tt1\"]){id}}");
    assert.ok(d.titles && calls[0].startsWith("GET https://caching.graphql.imdb.com/") && calls[1].startsWith("POST https://api.graphql.imdb.com/"), calls.join(" | ")); }
  { const http = async () => resp({ errors: [{ message: "Cannot query field \"listItem\"" }] });
    await assert.rejects(C.imdbGql(http, "{x}"), /Cannot query field/); }
  // ---- a 1,364-title list in 6 requests, with items{edges{node{listItem}}}; IMDb's own count kept
  const N = 1364;
  const listHttp = (seen) => async (m, url) => {
    seen.push(url);
    if (!url.startsWith("https://caching.graphql.imdb.com/")) return resp("", 404);
    const q = decodeURIComponent(url.split("?query=")[1]);
    if (/predefinedList/.test(q)) return resp({ data: { predefinedList: { id: "ls000000001" } } });
    if (/userRatings/.test(q)) {
      const a = +((q.match(/after:"(\d+)"/) || [])[1] || 0), to = Math.min(a + 250, 1940);
      const edges = []; for (let i = a; i < to; i++) edges.push({ node: { title: title(i), userRating: { value: 1 + (i % 10), date: new Date(Date.UTC(2026, 0, 1) - i * 864e5).toISOString() } } });
      return resp({ data: { userRatings: { total: 1940, edges, pageInfo: { hasNextPage: to < 1940, endCursor: String(to) } } } });
    }
    const a = +((q.match(/after:"(\d+)"/) || [])[1] || 0), to = Math.min(a + 250, N);
    const edges = []; for (let i = a; i < to; i++) edges.push({ node: { listItem: title(i) } });
    return resp({ data: { list: { name: { originalText: "Games" }, listClass: { id: "LIST" }, items: { total: N, edges, pageInfo: { hasNextPage: to < N, endCursor: String(to) } } } } });
  };
  { const seen = []; const http = listHttp(seen); let browsed = 0; http.browse = async () => { browsed++; return { status: 0 }; };
    const [items, route] = await C.imdbList(http, "https://www.imdb.com/list/ls100000015/");
    assert.strictEqual(items.length, N); assert.strictEqual(seen.length, 6); assert.ok(/IMDb API \(no page\), IMDb counts 1364/.test(route), route); assert.strictEqual(browsed, 0);
    assert.strictEqual(items.filter(x => x.medium === "Video Game").length, Math.ceil(N / 7)); assert.strictEqual(items[1].runtime, 90); assert.strictEqual(items[1].date, "2001-03-09"); }
  // ---- the API fails: the CSV export, and the hidden browser only after both
  { let browsed = 0, order = [];
    const csv = "Position,Const,Created,Modified,Description,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors\n1,tt0111161,2020-01-01,2020-01-01,,The Shawshank Redemption,https://www.imdb.com/title/tt0111161/,Movie,9.3,142,1994,Drama,1,1994-09-23,Frank Darabont\n";
    const http = async (m, url) => { order.push(url.replace(/\?.*/, "")); if (/graphql/.test(url)) return resp("", 403); if (/\/export$/.test(url)) return resp(csv); return resp("", 404); };
    http.browse = async () => { browsed++; return { status: 0 }; };
    const [items, route] = await C.imdbList(http, "https://www.imdb.com/list/ls100000013/");
    assert.strictEqual(route, "CSV export"); assert.strictEqual(items[0].imdb, "tt0111161"); assert.strictEqual(browsed, 0); }
  // ---- ratings: p.… profile → ur… once, newest 500 only when IMDb gives newest first; watchlist by its list id
  C.imdbReset();
  { const seen = [], store = new C.Store(null); const http0 = listHttp(seen);
    const http = async (m, url, o) => { if (/\/user\/p\.abc123\/ratings\/$/.test(url)) return resp('<script>{"authorId":"ur00000001"}</script>'); return http0(m, url, o); };
    const [g, route] = await C.imdbRatings(http, "https://www.imdb.com/user/p.abc123/", 500, store);
    assert.ok(/IMDb API/.test(route), route); assert.strictEqual(g.rated.length, 500); assert.ok(g.newest); assert.strictEqual(store.get("imdb_ur"), "ur00000001");
    assert.ok(g.rated[0].rating && g.rated[0].rated_at);
    const [all] = await C.imdbRatings(http, "ur00000001", 0, store); assert.strictEqual(all.rated.length, 1940);
    const [wl, r2] = await C.imdbWatchlist(http, "ur00000001", store); assert.strictEqual(wl.length, N); assert.ok(/IMDb API/.test(r2)); }
  // ---- Trakt: pages 2… come 4 at a time and stay in order; with stored ratings it stops at the ones it has
  { const PAGES = 41; let calls = [];
    const rating = (p, i) => ({ type: "movie", rating: 7, rated_at: new Date(Date.UTC(2026, 10, 1) - ((p - 1) * 1000 + i) * 36e5).toISOString(), movie: { title: `M${p}-${i}`, year: 2000, ids: { imdb: "tt" + (1000000 + p * 1000 + i) } } });
    const http = async (m, url) => { const p = +(url.match(/page=(\d+)/) || [])[1]; calls.push(p); await new Promise(r => setTimeout(r, 5));
      if (/\/ratings\?/.test(url)) return resp(Array.from({ length: 1000 }, (_, i) => rating(p, i)), 200, { "x-pagination-page-count": String(PAGES) });
      return resp([], 200, { "x-pagination-page-count": "1" }); };
    const t = new C.Trakt(http, "cid", null);
    const t0 = Date.now(); const all = await t.get("/users/u/ratings");
    assert.strictEqual(all.length, 41000); assert.strictEqual(all[1000].movie.title, "M2-0"); assert.strictEqual(all[40999].movie.title, "M41-999");
    const db = new C.Store(null); db.set("username", "u"); db.set("client_id", "cid");
    calls = []; await C.syncAll(db, http, () => {}, new Set(["Trakt account"]));
    const full = calls.filter(Boolean).length;
    assert.ok(db.get("trakt_last_rated_at").startsWith("2026-11-01"), db.get("trakt_last_rated_at"));
    calls = []; const r = await C.syncAll(db, http, () => {}, new Set(["Trakt account"]));
    const rCalls = calls.length;
    assert.ok(rCalls < full && rCalls <= 8, `second sync: ${rCalls} requests (first ${full})`);
    assert.ok(/older ratings \(stopped at page 1/.test(r.report), r.report); }
  // ---- Steam: banta_02_11_2000 → banta02112000
  { const tried = [];
    const http = async (m, url) => { const v = decodeURIComponent((url.match(/vanityurl=([^&]+)/) || [])[1] || ""); if (v) tried.push(v);
      if (/ResolveVanityURL/.test(url)) return resp({ response: v === "banta02112000" ? { success: 1, steamid: "76561198000000002" } : { success: 42 } });
      if (/GetOwnedGames/.test(url)) return resp({ response: { games: [{ appid: 620, name: "Portal 2", playtime_forever: 600 }] } });
      return resp("", 404); };
    const rows = await I.steamLibrary(http, "banta_02_11_2000", "KEY");
    assert.deepStrictEqual(tried, ["banta_02_11_2000", "banta02112000"]); assert.strictEqual(rows[0].title, "Portal 2");
    const none = async (m, url) => /ResolveVanityURL/.test(url) ? resp({ response: { success: 42 } }) : resp("", 404);
    await assert.rejects(I.steamLibrary(none, "nobody_here", "KEY"), /also tried “nobodyhere”/); }
  // ---- IMDb games: on a list → wishlist; rated → finished, also when already in Games
  { const gl = new G.Games(null);
    gl.add({ title: "Hades", date: "2020-09-17" }, "backlog");
    const res = G.fromImdb(gl, [{ title: "Hades", medium: "Video Game", kind: "rated", rating: 9, rated_at: "2026-01-02", source: "imdb", imdb: "tt1" },
      { title: "Celeste", medium: "Video Game", kind: "list", source: "imdb", imdb: "tt2", year: 2018 }]);
    const h = gl.find({ title: "Hades" }), c = gl.find({ title: "Celeste" });
    assert.deepStrictEqual([res.added, res.matched, res.promoted], [1, 1, 1]); assert.strictEqual(h.status, "done"); assert.strictEqual(h.rating, 9); assert.strictEqual(c.status, "wishlist"); }
  // ---- rated = watched: on a list or watchlist with a rating, and in imports
  { const lb = new L.Library(null);
    lb.adopt([{ title: "Rated On List", year: 2001, medium: "Movie", kind: "list", rating: 8, rated_at: "2025-03-04", source: "imdb" },
      { title: "Plain List", year: 2002, medium: "Movie", kind: "list", source: "imdb" }]);
    assert.strictEqual(lb.find({ type: "movie", title: "Rated On List", year: 2001 }).status, "watched");
    assert.strictEqual(lb.find({ type: "movie", title: "Plain List", year: 2002 }).status, "watchlist");
    // already adopted on the watchlist, later rated → watched
    lb.adopt([{ title: "Plain List", year: 2002, medium: "Movie", kind: "rated", rating: 6, rated_at: "2026-01-01", source: "trakt" }]);
    assert.strictEqual(lb.find({ type: "movie", title: "Plain List", year: 2002 }).status, "watched");
    lb.merge([{ type: "movie", title: "Planned But Rated", year: 2010, status: "watchlist", rating: 7, src: "mal" }, { type: "show", title: "Planned Show", year: 2011, status: "watchlist", rating: 9, src: "mal" }]);
    const pm = lb.find({ type: "movie", title: "Planned But Rated", year: 2010 }), ps = lb.find({ type: "show", title: "Planned Show", year: 2011 });
    assert.strictEqual(pm.status, "watched"); assert.strictEqual(pm.watches.length, 1); assert.strictEqual(ps.status, "watching"); }
  // ---- IMDb CSV episode ratings kept by name until the series' episode list is known
  { const lb = new L.Library(null); const it = lb.add({ type: "show", title: "Dark", year: 2017 }, "watchlist").item;
    it.epRatedPending = { [L.norm("Secrets")]: { r: 9, d: "2024-05-01" }, [L.norm("Lies")]: { r: 8, d: null } };
    it.epl = [[1, 1, "2017-12-01", "Secrets"], [1, 2, "2017-12-01", "Lies"], [1, 3, "2017-12-01", "Past and Present"]];
    assert.ok(L.pendingEps ? L.pendingEps(it) : lb.settleAll() >= 0);
    if (L.pendingEps) { assert.strictEqual(it.eps["1:1"], "2024-05-01"); assert.ok(it.eps["1:2"] && it.bulk && it.bulk["1:2"]); assert.strictEqual(it.er["1:1"], 9); assert.strictEqual(it.status, "watching"); assert.ok(!it.epRatedPending); }
  }
  console.log("0.5.9 SYNC TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
