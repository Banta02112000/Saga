// 0.6.9: duplicates (films, series, games), Steam playtime and achievements, backlog hours, calendar link,
// friends' sends and activity, the owner's page, AniList. Run: node test_069.js
const assert = require("assert");
const L = require("./library.js"), G = require("./games.js");
const resp = (b, status = 200) => ({ status, headers: {}, body: typeof b === "string" ? b : JSON.stringify(b) });

(async () => {
  // ---- duplicates: films and series
  { const lib = new L.Library();
    const a = lib.add({ type: "movie", title: "The Thing", year: 1982, imdb: "tt0084787" }, "watched").item; a.rating = 9; a.watches = ["2020-01-01"];
    // a duplicate as an old import or another device leaves it (lib.add itself would have found "The Thing")
    const put = o => { const it = L.blank(Object.assign({ id: "x" + Object.keys(lib.items).length }, o)); lib.items[it.id] = it; return it; };
    const b = put({ type: "movie", title: "Thing", year: 1983, status: "watchlist", notes: "with Kurt Russell" });
    lib.add({ type: "movie", title: "The Thing", year: 2011, imdb: "tt0905372" }, "watchlist");           // the 2011 film: not the same
    lib.add({ type: "show", title: "The Thing", year: 1982 }, "watchlist");                                // a series: not the same
    const s1 = lib.add({ type: "show", title: "Severance (2022)", tmdb: 95396 }, "watching").item; s1.eps = { "1:1": "2022-02-18" };
    const s2 = put({ type: "show", title: "Severance", year: 2022, status: "watchlist", eps: { "1:2": "2022-02-25" } });
    const d = L.findDuplicates(lib);
    assert.deepStrictEqual(d.map(p => [p.a.title, p.b.title].sort().join(" + ")).sort(), ["Severance + Severance (2022)", "The Thing + Thing"], JSON.stringify(d.map(p => p.why)));
    assert.strictEqual(L.findDuplicates(lib, { [[a.id, b.id].sort().join("|")]: 1 }).length, 1, "a pair marked 'not the same' stays out");
    const k = L.mergeItems(lib, a, b);
    assert.ok(k === a && k.rating === 9 && k.notes === "with Kurt Russell" && k.status === "watched" && !lib.get(b.id), JSON.stringify(k));
    const ks = L.mergeItems(lib, s2, s1);
    assert.ok(ks.eps["1:1"] && ks.eps["1:2"] && ks.tmdb === 95396 && ks.status === "watching", "episodes from both, ids filled: " + JSON.stringify(ks));
    assert.strictEqual(L.findDuplicates(lib).length, 0);
    console.log("ok  duplicate films and series: found, kept apart when different, merged with everything"); }

  // ---- duplicates: games
  { const lib = new G.Games();
    const a = lib.add({ title: "Hades", platform: "PC", date: "2020-09-17", steam: 1145360 }, "done").game; a.rating = 10; a.plays = ["2021-01-01"];
    const b = G.blank({ id: "g-switch", title: "Hades", platform: "Switch", date: "2020-09-17", status: "backlog", plays: [] }); lib.games.push(b); // another console: not a duplicate
    lib.games.push(G.blank({ id: "g-dup", title: "HADES", platform: "", date: "2020-01-01", status: "wishlist", owned: "Steam", hours: 22, plays: [] }));
    lib._fi = null;
    const d = G.findDuplicates(lib);
    assert.strictEqual(d.length, 2, "PC and the platform-less one; Switch only with the platform-less one: " + JSON.stringify(d.map(p => [p.a.platform, p.b.platform])));
    const pc = d.find(p => [p.a, p.b].includes(a));
    const k = G.mergeGames(lib, pc.a, pc.b);
    assert.ok(k === a && k.status === "done" && k.owned === "Steam" && k.hours === 22 && lib.games.length === 2 && lib.get(b.id), JSON.stringify(k));
    assert.ok(!lib.removed[G.norm("Hades")], "a merge doesn't block the title from later imports");
    console.log("ok  duplicate games: the same game on two consoles stays apart"); }

  // ---- Steam: playtime, recently played → Playing, achievements
  { const I = require("./imports.js"), lib = new G.Games();
    const a = lib.add({ title: "Portal 2", steam: 620, platform: "PC" }, "backlog").game, b = lib.add({ title: "Celeste", steam: 504230 }, "done").game, c = lib.add({ title: "Hades", steam: 1145360 }, "wishlist").game;
    const http = async (m, url) => {
      if (/GetOwnedGames/.test(url)) return resp({ response: { games: [{ appid: 620, name: "Portal 2", playtime_forever: 750, rtime_last_played: 1763000000 }, { appid: 504230, name: "Celeste", playtime_forever: 1200 }] } });
      if (/GetRecentlyPlayedGames/.test(url)) return resp({ response: { games: [{ appid: 620, playtime_2weeks: 180, playtime_forever: 750 }, { appid: 504230, playtime_2weeks: 60, playtime_forever: 1200 }, { appid: 1145360, playtime_2weeks: 5 }] } });
      if (/GetPlayerAchievements.*appid=620/.test(url)) return resp({ playerstats: { success: true, achievements: [{ achieved: 1 }, { achieved: 0 }, { achieved: 1 }, { achieved: 1 }] } });
      if (/GetPlayerAchievements/.test(url)) return resp({ playerstats: { error: "Requested app has no stats", success: false } }, 400);
      return resp({}, 404); };
    const rows = await I.steamLibrary(http, "76561197960287930", "KEY");
    assert.strictEqual(rows.steamid, "76561197960287930");
    const recent = await I.steamRecent(http, "KEY", rows.steamid);
    const r = G.steamPlay(lib, rows, recent);
    assert.ok(a.steamMins === 750 && a.steamLast && a.steam2w === 180 && a.status === "playing", "played 3 h in two weeks: Playing " + JSON.stringify(a));
    assert.ok(b.status === "done", "a finished game stays finished"); assert.ok(c.status === "wishlist", "5 minutes isn't playing it");
    assert.deepStrictEqual(r.moved, ["Portal 2"]);
    assert.deepStrictEqual(await I.steamAchievements(http, "KEY", rows.steamid, 620), { got: 3, total: 4 });
    assert.strictEqual(await I.steamAchievements(http, "KEY", rows.steamid, 504230), null, "no achievements: null, not an error");
    console.log("ok  Steam: hours played, recently played → Playing, achievements"); }

  // ---- backlog in hours
  { const lib = new G.Games(), now = Date.parse("2026-11-18T12:00:00Z");
    const add = (t, st, o) => { const g = lib.add(Object.assign({ title: t }, o), st).game; return g; };
    const d1 = add("Done A", "done", { hours: 40, franchise: "Saga" }); d1.plays = ["2026-05-01"];
    const d2 = add("Done B", "done", { hours: 20 }); d2.plays = ["2026-09-01"];
    const old = add("Done Old", "done", { hours: 100 }); old.plays = ["2020-01-01"];
    add("Left 1", "backlog", { hours: 30, owned: "PC", franchise: "Saga" }); add("Left 2", "backlog", { hours: 5, owned: "Switch" }); add("Left 3", "backlog", { hours: 85 }); add("No Time", "backlog", { owned: "PC" });
    add("Future", "backlog", { hours: 2, owned: "PC", date: "2030-01-01" });
    const b = G.backlogHours(lib, now);
    assert.ok(b.games === 5 && b.known === 4 && b.hours === 122 && b.paceH === 60 && Math.abs(b.years - 122 / 60) < 1e-9, JSON.stringify(b));
    assert.deepStrictEqual(b.quick.map(g => g.title), ["Left 1", "Left 2"], "owned, released, started series first, then shortest");
    console.log("ok  backlog in hours, your pace, short ones to finish next"); }

  // ---- the website: calendar address, sending to a friend, inbox, activity, the owner's page
  { const { spawn, execFileSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "s69-")), port = 19980, SRV = path.join(__dirname, "../site/server.js");
    const env = Object.assign({}, process.env, { SAGA_DATA: data, SAGA_WEB: __dirname, SAGA_PORT: String(port), SAGA_PUBLIC_PORT: String(port + 1), SAGA_HOST: "127.0.0.1" });
    execFileSync(process.execPath, [SRV, "--set-password", "me", "pw-one-two-three"], { env, stdio: "ignore" });
    execFileSync(process.execPath, [SRV, "--add-user", "pal", "pw-four-five-six"], { env, stdio: "ignore" });
    const auth = JSON.parse(fs.readFileSync(path.join(data, "auth.json"), "utf8")), mine = auth.users.me.token, his = auth.users.pal.token;
    const PL = new L.Library(); const w = PL.add({ type: "movie", title: "Heat", year: 1995, imdb: "tt0113277" }, "watched").item; w.watches = ["2026-11-10"]; w.rating = 9;
    fs.mkdirSync(path.join(data, "users", "pal"), { recursive: true }); fs.writeFileSync(path.join(data, "users", "pal", "library.json"), JSON.stringify(PL.toJSON()));
    const srv = spawn(process.execPath, [SRV], { env, stdio: "ignore" });
    try {
      const api = (p, o = {}) => fetch(`http://127.0.0.1:${port + 1}${p}`, Object.assign({ redirect: "manual" }, o));
      const as = (t, o = {}) => Object.assign({ headers: Object.assign({ Authorization: "Bearer " + t, "Content-Type": "application/json" }, o.headers || {}) }, o);
      for (let i = 0; i < 40; i++) { try { if ((await api("/api/health")).ok) break; } catch (e) { /* starting */ } await new Promise(r => setTimeout(r, 150)); }
      // calendar
      const c1 = await (await api("/api/calendar", as(mine, { method: "POST", body: JSON.stringify({ text: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n" }) }))).json();
      assert.ok(/^cal\/[A-Za-z0-9_-]{20,}\.ics$/.test(c1.path), JSON.stringify(c1));
      assert.ok(!c1.path.includes(mine), "not the sync key");
      const ics = await api("/" + c1.path); assert.ok(ics.status === 200 && /text\/calendar/.test(ics.headers.get("content-type")) && /BEGIN:VCALENDAR/.test(await ics.text()), "Google Calendar can read it, no sign-in");
      const c2 = await (await api("/api/calendar", as(mine, { method: "POST", body: JSON.stringify({ text: "BEGIN:VCALENDAR\r\nEND:VCALENDAR", renew: true }) }))).json();
      assert.ok(c2.path !== c1.path && (await api("/" + c1.path)).status === 404, "a new address retires the old one");
      assert.strictEqual((await api("/api/calendar", as(mine, { method: "POST", body: JSON.stringify({ text: "<html>" }) }))).status, 400);
      // sending: only when both share
      const item = { type: "movie", title: "Past Lives", year: 2023, tmdb: 666277 };
      assert.strictEqual((await api("/api/send", as(mine, { method: "POST", body: JSON.stringify({ to: "pal", item }) }))).status, 403, "nobody shares yet");
      await api("/api/share", as(mine, { method: "POST", body: '{"on":true}' })); await api("/api/share", as(his, { method: "POST", body: '{"on":true}' }));
      assert.ok((await api("/api/send", as(mine, { method: "POST", body: JSON.stringify({ to: "pal", item, note: "you'll love it" }) }))).ok);
      const box = await (await api("/api/inbox", as(his))).json();
      assert.ok(box.length === 1 && box[0].from === "me" && box[0].item.title === "Past Lives" && box[0].note === "you'll love it", JSON.stringify(box));
      assert.deepStrictEqual(await (await api("/api/inbox", as(mine))).json(), [], "it's his, not yours");
      await api("/api/inbox", as(his, { method: "POST", body: JSON.stringify({ done: box[0].id }) }));
      assert.deepStrictEqual(await (await api("/api/inbox", as(his))).json(), [], "done with it");
      // activity
      const pp = (await (await api("/api/people", as(mine))).json()).people;
      assert.ok(pp[0].recent.some(x => x.kind === "watched" && x.title === "Heat" && x.date === "2026-11-10" && x.rating === 9), JSON.stringify(pp[0].recent));
      // owner's page
      const ad = await (await api("/api/admin", as(mine))).json();
      assert.ok(ad.version && ad.people.length === 2 && ad.people.find(p => p.name === "pal").shares && ad.people.find(p => p.name === "me").calendar && ad.people.find(p => p.name === "pal").at > 0, JSON.stringify(ad).slice(0, 300));
      assert.strictEqual((await api("/api/admin", as(his))).status, 403, "only the owner");
      console.log("ok  website: calendar address, sending to friends, inbox, activity, owner's page");
    } finally { srv.kill(); }
  }
  // ---- AniList two-way: sign-in token from the address, what changed in Saga goes back
  { const I = require("./imports.js");
    assert.deepStrictEqual(I.anilistTokenFrom("bantaapps://oauth/anilist#access_token=abc.def&token_type=Bearer&expires_in=31536000").token, "abc.def");
    assert.strictEqual(I.anilistTokenFrom("bantaapps://oauth/anilist?error=access_denied"), null);
    assert.ok(/client_id=42&response_type=token/.test(I.anilistAuthUrl("42")));
    const rows = [{ mal: 1, anilist: 101, status: "watching", epsWatched: 3, rating: 0, type: "show" }, { mal: 2, anilist: 102, status: "watched", epsWatched: 12, rating: 8, type: "show" }];
    const st = I.alStateFrom(rows);
    const lib = new L.Library(), eps = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`1:${i + 1}`, "2026-01-01"]));
    const a = lib.add({ type: "show", title: "Ahead In Saga", anime: true, mal: 1 }, "watching").item; a.eps = eps(5);              // 5 > 3: send
    const b = lib.add({ type: "show", title: "Same Everywhere", anime: true, mal: 2 }, "watched").item; b.eps = eps(12); b.rating = 8; // same: nothing
    const c = lib.add({ type: "movie", title: "New Here", anime: true, mal: 3 }, "watched").item; c.rating = 9;                        // not on AniList yet: send
    lib.add({ type: "show", title: "Just Planned", anime: true, mal: 4 }, "watchlist");                                                // planned, untouched: nothing
    lib.add({ type: "movie", title: "Not Anime", mal: 5 }, "watched");
    const calls = [];
    const http = async (m, url, o) => { const j = JSON.parse(o.body); calls.push(j); assert.strictEqual(o.headers.Authorization, "Bearer TOK");
      if (/Media\(idMal/.test(j.query)) return resp({ data: { Media: { id: 300 + j.variables.m } } });
      if (/SaveMediaListEntry/.test(j.query)) return resp({ data: { SaveMediaListEntry: { id: 1, status: j.variables.status, progress: j.variables.progress } } });
      return resp({ errors: [{ message: "?" }] }); };
    const r = await I.anilistPush(http, "TOK", lib.all(), st);
    const saves = calls.filter(c0 => /SaveMediaListEntry/.test(c0.query)).map(c0 => c0.variables);
    assert.strictEqual(r.sent, 2);
    assert.deepStrictEqual(saves.find(v => v.mediaId === 101), { mediaId: 101, status: "CURRENT", scoreRaw: 0, progress: 5 }, "more episodes in Saga");
    assert.deepStrictEqual(saves.find(v => v.mediaId === 303), { mediaId: 303, status: "COMPLETED", scoreRaw: 90 }, "looked up by its MyAnimeList id, rating ×10");
    assert.strictEqual(c.anilist, 303, "the AniList id is kept");
    calls.length = 0; const r2 = await I.anilistPush(http, "TOK", lib.all(), st); assert.strictEqual(r2.sent, 0, "nothing twice");
    await assert.rejects(I.anilistPush(async () => ({ status: 401, body: "" }), "OLD", [Object.assign(a, { eps: eps(9) })], st), /expired/);
    console.log("ok  AniList: changes in Saga go back (episodes, status, rating), nothing twice"); }
  // ---- 0.6.9.1: only a rating means watched / finished; a listed title is to watch, a listed game is wishlist
  { const C = require("./core.js"), I = require("./imports.js");
    const csv = "Const,Your Rating,Date Rated,Title,Title Type,Year,Release Date\n" +
      "tt0000001,8,2024-03-05,Rated Film,Movie,1999,1999-05-01\n" +
      "tt0000002,,,Listed Film,Movie,2001,2001-06-01\n" +
      "tt0000003,,,Listed Show,TV Series,2010,2010-01-01\n" +
      "tt0000004,,,Listed Game,Video Game,2015,2015-02-02\n" +
      "tt0000005,7,2023-01-01,Rated Game,Video Game,2012,2012-01-01\n";
    const db = new C.Store(); C.importImdbCsv(db, "My favourites.csv", csv, "auto");
    const kinds = Object.fromEntries(db.items().map(r => [r.title, r.kind + (r.list_name ? ":" + r.list_name : "")]));
    assert.deepStrictEqual(kinds, { "Rated Film": "rated", "Listed Film": "list:My favourites", "Listed Show": "list:My favourites", "Listed Game": "list:My favourites", "Rated Game": "rated" });
    const db2 = new C.Store(); C.importImdbCsv(db2, "WATCHLIST.csv", csv, "auto");
    assert.ok(db2.items().filter(r => !r.rating).every(r => r.kind === "watchlist"), "a watchlist file goes to the watchlist");
    const lib = new L.Library(); lib.adopt(db.items());
    const st = t => lib.all().find(x => x.title === t);
    assert.strictEqual(st("Rated Film").status, "watched"); assert.deepStrictEqual(st("Rated Film").watches, ["2024-03-05"], "watched the day you rated it, not the release day");
    assert.strictEqual(st("Listed Film").status, "watchlist"); assert.strictEqual(st("Listed Show").status, "watchlist");
    const gl = new G.Games(); G.fromImdb(gl, db.items());
    assert.strictEqual(gl.games.find(g => g.title === "Rated Game").status, "done");
    assert.strictEqual(gl.games.find(g => g.title === "Listed Game").status, "wishlist");
    // any CSV: a plain list is to watch; a rating, a watched status or a watched date means watched
    const d = I.detect({ name: "mine.csv", text: "Title,Year,Date,Rating,Status\nPlain,2000,2024-01-01,,\nRated,2001,,8,\nSeen,2002,,,Watched\nPlanned,2003,,9,Plan to watch\n" });
    const by = Object.fromEntries(d.rows.map(r => [r.title, r.status]));
    assert.deepStrictEqual(by, { Plain: "watchlist", Rated: "watched", Seen: "watched", Planned: "watched" }, JSON.stringify(by));
    console.log("ok  only rated titles and games count as watched / finished; listed ones are to watch / wishlist"); }
  console.log("0.6.9 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
