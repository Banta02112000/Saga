// 0.5.6: saves that don't hold the screen. The text is built and handed over in pieces, the look-up cache is a
// journal, the library is written in small steps during a sync. Run: node test_storage.js
const assert = require("assert");
const C = require("./core.js"), L = require("./library.js");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // ---- jsonParts gives exactly JSON.stringify's text, for stores, backups (deep 1) and odd values
  { const st = { v: 1, settings: { a: "1", u: undefined }, items: Array.from({ length: 3000 }, (_, i) => ({ i, t: 'Title "q" ' + i, n: null, u: undefined, d: new Date(0) })), z: [undefined, 1], e: [], o: {} };
    assert.strictEqual((await C.jsonParts(st)).join(""), JSON.stringify(st));
    const lib = { items: Object.fromEntries(Array.from({ length: 500 }, (_, i) => ["k" + i, { x: i, eps: { "1:1": "2024-01-01" }, f: () => 1 }])), adopted: {}, outbox: [] };
    assert.strictEqual((await C.jsonParts(lib)).join(""), JSON.stringify(lib));
    const bundle = { app: "x", at: "now", canon: st, library: lib, games: { games: Array.from({ length: 200 }, (_, i) => ({ i })) }, dw: null, u: undefined };
    const parts = await C.jsonParts(bundle, 6, 1);
    assert.strictEqual(parts.join(""), JSON.stringify(bundle));
    const many = await C.jsonParts({ items: Array.from({ length: 20000 }, (_, i) => ({ i, t: "x".repeat(40) })) });
    assert.ok(many.length > 3 && many.every(p => p.length < 260000), "pieces of about 200 KB: " + many.map(p => p.length).slice(0, 4));
    for (const v of [null, 1, "x", [], {}, [1, 2], { a: 1 }]) assert.strictEqual((await C.jsonParts(v)).join(""), JSON.stringify(v));
  }
  // ---- no step of a big save runs long: the longest stretch without a pause stays short
  { const st = { items: Array.from({ length: 60000 }, (_, i) => ({ i, title: "Title " + i, norm: "title " + i, genres: "Drama, Crime", rating: 7, key: "k" + i })) };
    let last = Date.now(), worst = 0; const iv = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last); last = n; }, 1);
    const t = (await C.jsonParts(st)).join(""); clearInterval(iv);
    assert.strictEqual(t.length, JSON.stringify(st).length);
    assert.ok(worst < 120, "longest stretch " + worst + " ms");
  }
  // ---- Store with saveParts: a save is built in pieces, the file text is complete and right, nothing is written twice
  { const files = { "canonsync.json": "" }, calls = { parts: 0, save: 0, later: 0 };
    const persist = { load: () => files["canonsync.json"], save: t => { calls.save++; files["canonsync.json"] = t; }, saveLater: t => { calls.later++; files["canonsync.json"] = t; },
      saveParts: async (parts, still) => { calls.parts++; await sleep(5); if (still && !still()) return false; files["canonsync.json"] = parts.join(""); return true; }, ownStamp: () => "", stamp: () => "" };
    const db = new C.Store(persist);
    db.addItems(Array.from({ length: 2500 }, (_, i) => ({ title: "Film " + i, year: 2000, medium: "Movie", imdb: "tt" + (1000 + i) })), "imdb", "rated");
    db.set("x", "1");
    db.flush(); // not at once: in pieces
    assert.strictEqual(files["canonsync.json"], "", "nothing written inside the call");
    await db.settled();
    const j = JSON.parse(files["canonsync.json"]);
    assert.strictEqual(j.items.length, 2500); assert.strictEqual(j.settings.x, "1");
    assert.deepStrictEqual([calls.parts, calls.save, calls.later], [1, 0, 0]);
    // a change during a save in pieces is saved by the next one
    db.flush(); db.set("y", "2"); db.flush();
    await db.settled();
    assert.strictEqual(JSON.parse(files["canonsync.json"]).settings.y, "2");
    // leaving the app in the middle of one: the at-once save wins, the older pieces are dropped
    db.set("z", "3"); db.flush(); db.set("z", "4"); db.flush(true);
    assert.strictEqual(JSON.parse(files["canonsync.json"]).settings.z, "4", "written at once");
    await db.settled(); await sleep(30);
    assert.strictEqual(JSON.parse(files["canonsync.json"]).settings.z, "4", "not overwritten by the older save");
    // while a job runs, automatic saves are spaced far apart
    C.BUSY.on = true; db._lastFlush = Date.now(); const before = calls.parts; db.set("w", "1"); await sleep(700);
    assert.strictEqual(calls.parts, before, "no save during the job");
    C.BUSY.on = false; db._lastFlush = 0; db.touch(); await sleep(600); await db.settled();
    assert.strictEqual(JSON.parse(files["canonsync.json"]).settings.w, "1", "saved once the job is over");
  }
  // ---- the look-up cache as a journal: new entries are appended (small), read back on start, folded in when it has grown
  { const files = { main: "", cache: "", log: "" }, n = { append: 0, full: 0, clear: 0 };
    const mk = () => new C.Store({ load: () => files.main, save: t => { files.main = t; }, saveParts: async p => { files.main = p.join(""); return true; },
      cache: { load: () => files.cache, save: t => { n.full++; files.cache = t; }, loadLog: () => files.log, append: t => { n.append++; files.log += t; }, clearLog: () => { n.clear++; files.log = ""; }, saveParts: async p => { n.full++; files.cache = p.join(""); return true; } } });
    const db = mk();
    for (let i = 0; i < 50; i++) db.cacheSet("k" + i, { v: i });
    db.cachePut("p1", 7, 9, "Coll");
    db.flushCache();
    assert.strictEqual(n.append, 1); assert.strictEqual(n.full, 0, "the whole cache isn't rewritten for 51 entries");
    assert.strictEqual(files.log.trim().split("\n").length, 51);
    files.log += '["torn",{"v":'; // a line cut off by a crash
    const db2 = mk();
    assert.deepStrictEqual(db2.cacheGet("k49"), { v: 49 }); assert.strictEqual(db2.cacheGet("p1").collection_id, 9); assert.strictEqual(db2.cacheGet("torn"), null);
    // a journal that has grown is folded into the cache file, and emptied
    for (let i = 0; i < 9000; i++) db2.cacheSet("big" + i, { t: "x".repeat(180) });
    db2.flushCache(); await db2.settled(); await sleep(50); await db2.settled();
    assert.strictEqual(n.full, 1); assert.strictEqual(n.clear, 1); assert.strictEqual(files.log, "");
    assert.strictEqual(JSON.parse(files.cache).length, db2.tmdbCache.size);
    const db3 = mk();
    assert.strictEqual(db3.tmdbCache.size, db2.tmdbCache.size); assert.deepStrictEqual(db3.cacheGet("k3"), { v: 3 });
    // entries added while it was being folded in aren't lost
    for (let i = 0; i < 9000; i++) db3.cacheSet("more" + i, { t: "y".repeat(180) });
    db3.flushCache(); db3.cacheSet("late", { v: 1 }); await db3.settled(); await sleep(50); db3.flushCache();
    assert.deepStrictEqual(mk().cacheGet("late"), { v: 1 });
    // not while a job runs
    C.BUSY.on = true; const f0 = n.full; for (let i = 0; i < 9000; i++) db3.cacheSet("job" + i, { t: "z".repeat(180) }); db3.flushCache(); await sleep(30);
    assert.strictEqual(n.full, f0, "the cache isn't rewritten during a job"); assert.ok(files.log.length > 1000000, "but the journal has the entries");
    C.BUSY.on = false; clearTimeout(db3._cacheTimer);
    // without the journal (the background job, older phones): the cache file is written whole, as before
    const files2 = { main: "", cache: "" }; const old = new C.Store({ load: () => files2.main, save: t => { files2.main = t; }, cache: { load: () => files2.cache, save: t => { files2.cache = t; } } });
    old.cacheSet("a", { v: 1 }); old.flushCache(); assert.strictEqual(JSON.parse(files2.cache).length, 1);
  }
  // ---- the library takes a sync in small steps and ends up exactly as in one go
  { const rows = Array.from({ length: 2600 }, (_, i) => ({ title: "Film " + (i % 2500), year: 1980 + i % 40, medium: i % 5 ? "Movie" : "TV Series", imdb: i < 2500 ? "tt" + (5000 + i) : null, rating: 1 + i % 10, kind: i % 7 ? "rated" : "watchlist", source: "imdb", date: "2024-01-02", rated_at: "2024-01-02T10:00:00Z" }));
    const a = new L.Library(null), b = new L.Library(null);
    let pauses = 0;
    const n1 = a.adopt(rows), n2 = await b.adoptSliced(rows, async () => { pauses++; });
    assert.strictEqual(n1, n2); assert.ok(pauses >= 8, "pauses: " + pauses);
    const strip = l => JSON.stringify(l.all().map(x => [x.title, x.year, x.type, x.status, x.rating, x.imdb, x.watches]));
    assert.strictEqual(strip(a), strip(b));
    assert.strictEqual(b._ix, null, "the index is dropped afterwards");
    assert.strictEqual(await b.adoptSliced(rows, async () => {}), 0, "a second time adds nothing");
  }
  console.log("STORAGE TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
