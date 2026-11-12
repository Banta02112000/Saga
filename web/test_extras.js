// node tests for extras.js (Refract import, Trakt write-back, streaming alerts, cross-tab search, watch order, backups)
const assert = require("assert");
const C = require("./extras.js");
(async () => {
  // ---- Refract: CSV and JSON layouts, no ids, stars out of 5, episodes collapse into shows, custom lists
  {
    const zip = {
      "refract-export/watched_movies.csv": "Title,Year,Watched At,Rating\n\"Alien\",1979,2025-03-02T20:00:00Z,4.5\nBlade Runner,1982,2025-04-01,\n",
      "refract-export/watchlist.csv": "name,release_date,media_type\nDune: Part Three,2026-12-18,movie\nSeverance,2022-02-18,tv\n",
      "refract-export/episodes.csv": "Show,Season,Episode,Watched At\nAndor,1,1,2024-01-01\nAndor,1,2,2024-01-02\nFrieren,1,5,2024-05-05\n",
      "refract-export/lists.json": JSON.stringify({ lists: [{ name: "Comfort rewatches", items: [{ title: "Paddington 2", year: 2017, type: "movie" }, { title: "Bluey", year: 2018, type: "tv" }] }] }),
      "refract-export/settings.json": JSON.stringify({ theme: "dark", region: "IT" }),
    };
    const p = C.parseRefract(zip);
    const by = k => p.records.filter(r => r.kind === k).map(r => r.title).sort();
    assert.deepStrictEqual(by("watched"), ["Alien", "Andor", "Blade Runner", "Frieren"]);
    assert.deepStrictEqual(by("watchlist"), ["Dune: Part Three", "Severance"]);
    assert.deepStrictEqual(by("rated"), ["Alien"]);
    assert.deepStrictEqual(by("list"), ["Bluey", "Paddington 2"]);
    const alien = p.records.find(r => r.title === "Alien" && r.kind === "rated");
    assert.strictEqual(alien.rating, 9); assert.strictEqual(alien.year, 1979); assert.strictEqual(alien.date, "2025-03-02");
    assert.strictEqual(p.records.find(r => r.title === "Andor").medium, "TV Series");
    assert.strictEqual(p.records.find(r => r.title === "Andor").date, "2024-01-02");
    assert.strictEqual(p.records.find(r => r.title === "Dune: Part Three").year, 2026);
    assert.strictEqual(p.records.find(r => r.title === "Bluey").list, "Comfort rewatches");
    const db = new C.Store();
    db.addItems([{ imdb: "tt0078748", title: "Alien", year: 1979, medium: "Movie" }], "imdb", "watched");
    const res = C.importRefract(db, zip, ["refract-export/posters/1.jpg"]);
    assert.deepStrictEqual(res.counts, { watched: 4, rated: 1, watchlist: 2, list: 2 });
    assert.strictEqual(db.items("refract").length, 9);
    // importing again replaces, doesn't double
    C.importRefract(db, zip);
    assert.strictEqual(db.items("refract").length, 9);
    assert.strictEqual(db.items("imdb").length, 1);
    // Refract titles count as seen for canon matching (by title + year)
    db.replaceCanon("url", [{ franchise: "Blade Runner", title: "Blade Runner", year: 1982, medium: "Movie" }, { franchise: "Blade Runner", title: "Blade Runner 2049", year: 2017, medium: "Movie" }]);
    const st = C.canonStatus(db);
    assert.strictEqual(st.find(c => c.title === "Blade Runner").have, true);
    assert.strictEqual(st.find(c => c.title === "Blade Runner 2049").have, false);
    assert.throws(() => C.importRefract(new C.Store(), { "a/settings.json": "{\"x\":1}" }), /No titles found/);
    // points out of 10 stay as they are
    assert.strictEqual(C.parseRefract({ "ratings.csv": "title,year,rating\nA,2000,7\nB,2001,10\n" }).records.find(r => r.title === "A").rating, 7);
  }

  // ---- Trakt write-back
  {
    const db = new C.Store(); db.set("client_id", "cid");
    const calls = [];
    const http = async (m, url, o) => { calls.push([m, url, o && o.body ? JSON.parse(o.body) : null, o && o.headers]);
      if (/\/search\/show/.test(url)) return { status: 200, body: JSON.stringify([{ show: { title: "Andor", year: 2022, ids: { trakt: 5, imdb: "tt9253284" } } }]) };
      if (/\/sync\/history$/.test(url)) return { status: 201, body: JSON.stringify({ added: { movies: 1 }, not_found: { movies: [], shows: [] } }) };
      if (/\/sync\/watchlist$/.test(url)) return { status: 401, body: "" };
      return { status: 201, body: "{}" }; };
    await assert.rejects(C.traktPush(db, http, { title: "Alien", medium: "Movie", imdb: "tt0078748" }, "history"), /Sign in to Trakt/);
    db.set("token", "tok");
    await C.traktPush(db, http, { title: "Alien", medium: "Movie", imdb: "tt0078748" }, "history");
    assert.deepStrictEqual(calls[0][2], { movies: [{ ids: { imdb: "tt0078748" } }] });
    assert.strictEqual(calls[0][3].Authorization, "Bearer tok");
    await C.traktPush(db, http, { title: "Andor", year: 2022, medium: "TV Series" }, "ratings", { rating: 9 });
    assert.deepStrictEqual(calls[calls.length - 1][2], { shows: [{ ids: { trakt: 5, imdb: "tt9253284" }, rating: 9 }] });
    await assert.rejects(C.traktPush(db, http, { title: "Alien", medium: "Movie", imdb: "tt1" }, "watchlist"), /expired/);
    await assert.rejects(C.traktPush(db, http, { title: "Halo", medium: "Video Game" }, "history"), /games/);
  }

  // ---- streaming alerts: silent the first time, then only for newly added services you have
  {
    const db = new C.Store();
    db.replaceCanon("url", [{ franchise: "Dune", title: "Dune: Part Two", year: 2024, medium: "Movie" }]);
    const st = C.canonStatus(db);
    db.cacheSet("tid:dune part two|2024|m", { id: "99", tv: false });
    const put = offers => db.cacheSet("info:m99", { v: 4, at: Date.now(), region: "IT", offers });
    put([{ name: "Apple TV", type: "buy" }]);
    assert.deepStrictEqual(C.streamAlerts(db, st, ["Netflix", "Disney+"]), [], "first run only records");
    put([{ name: "Apple TV", type: "buy" }, { name: "Netflix", type: "flatrate" }, { name: "Paramount Plus", type: "flatrate" }]);
    const notes = C.streamAlerts(db, st, ["Netflix", "Disney+"]);
    assert.strictEqual(notes.length, 1); assert.ok(/Now streaming: Dune: Part Two/.test(notes[0].title) && /Netflix/.test(notes[0].text) && !/Paramount/.test(notes[0].text));
    assert.deepStrictEqual(C.streamAlerts(db, st, ["Netflix", "Disney+"]), [], "no repeat");
  }

  // ---- search across tabs, cross-tab multiverse counts
  {
    const st = [{ title: "Doctor Who", norm: "doctor who", year: 2005, medium: "TV Series", franchise: "Whoniverse", have: true, state: "seen" }];
    const games = { games: [{ id: "g1", t: "Doctor Who: The Adventure Games", f: "Doctor Who", m: "Doctor Who", y: 2010, d: 1 }, { id: "g2", t: "Halo", f: "Halo", m: "Halo" }], mv: { "Doctor Who": { n: 3, d: 1 }, Halo: { n: 9, d: 4 } } };
    const dw = { stories: [{ k: "k1", t: "Doctor Who and the Daleks", ty: "Novel", tab: "t1", tabName: "First Doctor", d: 0 }], total: { n: 1322, d: 410 } };
    const r = C.searchAll("doctor who", st, [], games, dw);
    assert.deepStrictEqual(r.map(x => x.app), ["canon", "dw", "games"]);
    assert.strictEqual(C.searchAll("d", st, [], games, dw).length, 0);
    assert.deepStrictEqual(C.crossCounts("Whoniverse", games, dw), { games: { n: 3, done: 1, name: "Doctor Who" }, dw: { n: 1322, done: 410 } });
    assert.deepStrictEqual(C.crossCounts("Halo", games, dw), { games: { n: 9, done: 4, name: "Halo" }, dw: null });
    const books = { books: [{ id: "b1", t: "Doctor Who: Shada", a: "Douglas Adams", s: "read", d: 1 }, { id: "b2", t: "Dune", a: "Frank Herbert", s: "want" }] };
    const rb = C.searchAll("doctor who", st, [], games, dw, 40, books);
    assert.ok(rb.some(x => x.app === "books" && x.id === "b1" && /Douglas Adams/.test(x.sub)), "books in search");
    assert.strictEqual(C.searchAll("herbert", st, [], games, dw, 40, books)[0].title, "Dune", "search by author");
    assert.strictEqual(C.readBackup('{"app":"BookCheck","version":1,"books":[]}').kind, "books");
  }

  // ---- watch order
  {
    const db = new C.Store();
    const rows = [["A New Hope", 1977], ["The Phantom Menace", 1999], ["Rogue One", 2016]].map(([t, y]) => ({ title: t, norm: C.norm(t), year: y, medium: "Movie", franchise: "Star Wars", date: null }));
    assert.deepStrictEqual(C.watchOrder(db, "Star Wars", rows, "chrono").rows.map(r => r.year), [1977, 1999, 2016]); // no saved order yet: release
    const rel = C.watchOrder(db, "Star Wars", rows, "release").rows;
    assert.ok(/1\. A New Hope \(1977\)/.test(C.orderPrompt("Star Wars", rel)));
    const o = C.parseOrder('```json\n{"order":[2,3,1],"notes":"Rogue One ends where A New Hope starts."}\n```', rel);
    C.saveOrder(db, "Star Wars", o);
    assert.deepStrictEqual(C.watchOrder(db, "Star Wars", rows, "chrono").rows.map(r => r.title), ["The Phantom Menace", "Rogue One", "A New Hope"]);
    assert.throws(() => C.parseOrder("no idea", rel), /no usable order/);
  }

  // ---- backups
  {
    const db = new C.Store(); db.set("x", "1");
    const all = C.readBackup(C.bundleBackup(db, '{"v":3,"done":{},"ov":{}}', '{"app":"dwcanon","v":1,"state":{}}', "4.0"));
    assert.strictEqual(all.kind, "all"); assert.strictEqual(all.canon.settings.x, "1"); assert.ok(all.games && all.dw);
    assert.strictEqual(C.readBackup('{"v":3,"done":{"g1":1},"ov":{},"ex":[]}').kind, "games");
    assert.strictEqual(C.readBackup('{"app":"dwcanon","v":1,"state":{"works":{}}}').kind, "dw");
    assert.strictEqual(C.readBackup(JSON.stringify(db.toJSON())).kind, "canon");
    assert.throws(() => C.readBackup("hello"), /isn't a backup/);
    assert.throws(() => C.readBackup('{"a":1}'), /isn't a CanonSync/);
  }

  // ---- widget text
  {
    const t = C.widgetText([{ title: "Andor", year: 2022, have: false, upNext: true, franchise: "Star Wars", medium: "TV Series", date: "2022-09-21" }], { next: [{ t: "Halo 3" }] }, { next: [{ t: "The Chimes of Midnight" }] }, "2026-11-09");
    assert.ok(/^Up next\n/.test(t) && /🎮 Halo 3/.test(t) && /🔊 The Chimes of Midnight/.test(t), t);
  }
  console.log("EXTRAS TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
