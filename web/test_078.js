// 0.7.8: game versions with their own status (one finished = the whole game finished), direct store links only,
// music stats from Spotify alone, the website sync hashed in pieces, Italian patch notes. Made-up data. Run: node test_078.js
const assert = require("assert");
const G = require("./games.js"), M = require("./music.js"), SE = require("./shared/entries.js"), BC = require("./books/core.js");
const ok = m => console.log("ok  " + m);
(async () => {
  // ---- versions
  const lib = new G.Games(null);
  const g = lib.add({ title: "Made Up Saga" }, "backlog").game;
  g.date = "2002-01-01"; g.franchise = "Made Up Saga"; g.multiverse = "Made Up Saga";
  const g2 = lib.add({ title: "Made Up Saga 2" }, "backlog").game;
  g2.date = "2005-01-01"; g2.franchise = "Made Up Saga"; g2.multiverse = "Made Up Saga";
  g.versions = [{ title: "Made Up Saga Remake", date: "2020-05-01", kind: "remake" }];
  assert.ok(!G.versionDone(g));
  G.setVersionStatus(lib, g, 0, "playing");
  assert.strictEqual(g.versions[0].status, "playing"); assert.strictEqual(g.status, "playing", "playing a version = playing the game");
  G.setVersionStatus(lib, g, 0, "done");
  assert.strictEqual(g.versions[0].status, "done"); assert.ok(G.versionDone(g)); assert.strictEqual(g.status, "done", "one version finished = the bundle finished");
  assert.strictEqual(g.versions[0].plays.length, 1);
  assert.strictEqual(G.setVersionStatus(lib, g, 5, "done"), null, "no such version");
  ok("versions: own status, one finished finishes the bundle");

  // ---- links only where they exist
  assert.deepStrictEqual(G.storeLinks({ title: "Nothing Known" }), []);
  const ls = G.storeLinks({ title: "x", steam: 123, imdb: "tt0000001", hltbId: 9 });
  assert.deepStrictEqual(ls.map(l => l[0]), ["Steam", "HowLongToBeat", "IMDb"]);
  assert.ok(ls.every(l => !/search|\?q=/.test(l[1])), "no search links");
  assert.deepStrictEqual(BC.storeLinks({ title: "No ISBN" }), [], "a book without an ISBN has no shop links");
  ok("links: direct ones only");

  // ---- music stats from Spotify alone
  const now = Date.parse("2026-03-15T12:00:00Z"), at = h => Math.floor((now - h * 3600e3) / 1000);
  const d = { spHist: [{ at: at(1), track: "Song A", artist: "Band One" }, { at: at(2), track: "Song B", artist: "Band Two" }, { at: at(30), track: "Song A", artist: "Band One" }] };
  const st = M.stats(d, now);
  assert.strictEqual(st.kept, 3); assert.strictEqual(st.plays30, 3); assert.strictEqual(st.artists30, 2);
  assert.strictEqual(st.top30[0][0], "Band One");
  assert.strictEqual(M.stats({ recent: [{ at: at(1), track: "L", artist: "Lfm" }], spHist: d.spHist }, now).kept, 1, "Last.fm first when there is any");
  ok("music: stats from kept Spotify plays");

  // ---- website sync in pieces gives the same answer as all at once
  const file = { items: {} }; for (let i = 0; i < 400; i++) file.items["id" + i] = { id: "id" + i, title: "Made Up " + i, rating: i % 10 };
  const m = SE.split("library.json", file), before = SE.hashes("library.json", m);
  file.items.id7.rating = 99; delete file.items.id8; file.items.idNew = { id: "idNew", title: "New One" };
  const m2 = SE.split("library.json", file);
  const sync = SE.diff("library.json", before, m2), asy = await SE.diffAsync("library.json", before, m2, 0.01);
  assert.deepStrictEqual(asy.patch.map(p => p[0]).sort(), sync.map(p => p[0]).sort());
  assert.deepStrictEqual(asy.h, SE.hashes("library.json", m2));
  assert.strictEqual(SE.digestOf(asy.h), SE.digestOf(SE.hashes("library.json", m2)));
  ok("sync: hashed in pieces, same changes");

  // ---- patch notes in Italian: every translated version has as many notes as the English one
  global.window = {}; require("./changes-it.js");
  const src = require("fs").readFileSync(__dirname + "/app.js", "utf8"), a = src.indexOf("  const CHANGES = ["), b = src.indexOf('["0.6.9.9"', a);
  const en = eval(src.slice(a + 18, b) + "]");
  for (const [v, notes] of en) { const it = window.SAGA_CHANGES_IT[v]; assert.ok(it, "Italian notes for " + v); assert.strictEqual(it.length, notes.length, "same number of notes for " + v); }
  ok(`patch notes: ${en.length} versions in Italian`);
  console.log("TEST 078 PASSED");
})().catch(e => { console.error(e); process.exit(1); });
