// 0.7.3: the change log of the library, the weekly-copy check, and the IMDb check that runs on the website.
// Made-up data. Run: node test_073.js
const assert = require("assert");
const C = require("./core.js"), L = require("./library.js"), G = require("./games.js"), Auto = require("./auto.js"), IC = require("./check_imdb.js");
const ok = m => console.log("ok  " + m);
(async () => {
  // ---- library: the file, then the changes since, line by line (a torn last line is skipped)
  const base = JSON.stringify({ v: 1, items: { a: { id: "a", type: "movie", title: "A", rating: 4 }, b: { id: "b", type: "movie", title: "B" } }, adopted: {}, outbox: [] });
  const log = JSON.stringify(["a", { id: "a", type: "movie", title: "A", rating: 9 }]) + "\n" + JSON.stringify(["b", null]) + "\n" + JSON.stringify(["@ob+", [{ id: "a", op: "rate", v: 9, ts: 1 }]]) + "\n" + '["c", {"id":"c","ty';
  const lib = new L.Library({ load: () => base, loadLog: () => log });
  assert.strictEqual(lib.items.a.rating, 9); assert.ok(!lib.items.b); assert.ok(!lib.items.c); assert.strictEqual(lib.outbox.length, 1); assert.strictEqual(lib.logLines, 3);
  ok("library: the file plus its change log, a torn last line ignored");

  // ---- the weekly copy is opened and compared
  const db = new C.Store(), games = new G.Games(null), lib2 = new L.Library(null);
  for (let i = 0; i < 50; i++) lib2.items["m" + i] = L.blank({ id: "m" + i, type: "movie", title: "Film " + i });
  const files = { "auto_backup_1.json": JSON.stringify({ library: { items: Object.fromEntries(Object.entries(lib2.items).slice(0, 48)) }, games: { games: [] } }) };
  let remade = 0;
  const S = { db, ui: {}, C, GC: G, L, lib: lib2, games, feat: () => true, Native: {}, doSync: () => {}, libOpt: () => ({}), libSave: () => {}, snapshot: () => {}, changed: () => {}, logError: () => {}, esc: t => t, lang: () => "en", Kit: { head: t => t },
    SH: { read: n => files[n] || "" }, autoBackup: () => { remade++; } };
  db.set("auto_backups", JSON.stringify([{ slot: 1, at: Date.now() - 864e5 }]));
  ["dupes", "gamecanon", "gameinfo", "cast", "retry"].forEach(k => db.set("auto_" + k, "0"));
  const A = Auto.make(S);
  await A.run("test");
  assert.ok(/Weekly copy checked: it opens, with 48 titles/.test(JSON.parse(db.get("auto_log"))[0].what)); assert.strictEqual(remade, 0);
  files["auto_backup_1.json"] = "{ broken"; db.set("auto_bcheck_at", "0");
  await A.run("test");
  assert.ok(/doesn't open/.test(JSON.parse(db.get("auto_log"))[0].what)); assert.strictEqual(remade, 1, "a broken copy: a new one made at once");
  ok("the weekly copy: opened and compared; a broken one is replaced");

  // ---- IMDb check (the website runs it daily)
  const fake = status => async (m, url) => status === 200
    ? { status: 200, body: JSON.stringify({ data: /chartTitles/.test(decodeURIComponent(url) + "") ? { chartTitles: { edges: [{ node: {} }] } } : { title: { titleText: { text: "X" }, releaseYear: { year: 1994 } } } }) }
    : status === 400 ? { status: 200, body: JSON.stringify({ errors: [{ message: 'Cannot query field "endYear" on type "YearRange"' }], data: null }) } : { status, body: "" };
  assert.strictEqual((await IC.check(fake(200))).state, "ok");
  assert.strictEqual((await IC.check(fake(403))).state, "inconclusive");
  ok("IMDb check: OK when IMDb answers as Saga expects; inconclusive when it turns the server away");
  console.log("0.7.3 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
