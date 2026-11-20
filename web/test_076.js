// 0.7.6: games: versions bundled, newest-version order, Up next after finishing, your multiverses, Missing without
// tie-ins / non-canon / story-less / versions, the AI canon check. Made-up data. Run: node test_076.js
const assert = require("assert");
const C = require("./core.js"), G = require("./games.js");
const ok = m => console.log("ok  " + m);
(async () => {
  // ---- versions
  assert.strictEqual(G.storyKey("Made Up Quest: Remastered"), G.storyKey("Made Up Quest"));
  assert.strictEqual(G.storyKey("Made Up Quest HD"), G.norm("Made Up Quest"));
  assert.notStrictEqual(G.storyKey("Made Up Quest Collection"), G.norm("Made Up Quest"), "a collection is several games");
  const lib = new G.Games(null);
  const add = (title, date, extra) => { const g = lib.add({ title }, "backlog").game; g.date = date; Object.assign(g, extra || {}); return g; };
  const q1 = add("Made Up Quest", "2001-03-01", { franchise: "Made Up Quest", multiverse: "Made Up Worlds", fImported: true });
  add("Made Up Quest Remastered", "2015-06-01", { franchise: "Made Up Quest", multiverse: "Made Up Worlds", status: "done" });
  const q2 = add("Made Up Quest II", "2003-05-01", { franchise: "Made Up Quest", multiverse: "Made Up Worlds", fImported: true });
  q2.remake = { title: "Made Up Quest II Reborn", date: "2023-01-10", platform: "PC" };
  add("Made Up Quest II Reborn", "2023-01-10", { franchise: "Made Up Quest II Reborn", multiverse: "Made Up Quest II Reborn" });
  const q3 = add("Made Up Quest III", "2006-09-01", { franchise: "Made Up Quest", multiverse: "Made Up Worlds", fImported: true });
  const party = add("Made Up Quest Party", "2008-01-01", { franchise: "Made Up Quest", multiverse: "Made Up Worlds", fImported: true, story: false });
  const q4 = add("Made Up Quest IV", "2010-01-01", { franchise: "Made Up Quest", multiverse: "Made Up Worlds", fImported: true });
  // guessed series: should join yours
  const stray = add("Made Up Quest Tactics", "2012-01-01"); stray.franchise = "Made Up Quest Tactics"; stray.multiverse = stray.franchise;
  assert.ok(lib.bundleVersions(true).length === 2, JSON.stringify(lib.bundleVersions(true)));
  const b = lib.bundleVersions();
  assert.strictEqual(b.length, 2);
  assert.ok(!lib.games.some(g => g.title === "Made Up Quest Remastered") && !lib.games.some(g => g.title === "Made Up Quest II Reborn"));
  assert.strictEqual(q1.versions[0].title, "Made Up Quest Remastered"); assert.strictEqual(q1.versions[0].kind, "remaster");
  assert.strictEqual(q1.status, "done", "the remaster's progress comes with it");
  assert.strictEqual(G.verDate(q1), "2015-06-01"); assert.strictEqual(G.verDate(q2), "2023-01-10");
  assert.strictEqual(lib.bundleVersions(true).length, 0, "nothing left to bundle");
  ok("remakes, remasters and re-releases bundled with their original, the newest version's date kept");
  const fr = lib.resolveFranchises();
  assert.ok(fr.length === 1 && stray.multiverse === "Made Up Worlds" && stray.franchise === "Made Up Quest", JSON.stringify(fr));
  ok("a game whose series was only guessed joins your list's multiverse");
  // ---- order: by newest version (default), by original release
  const mv = lib.multiverses().find(m => m.name === "Made Up Worlds");
  const byVer = mv.franchises[0].games.map(g => g.title);
  assert.ok(byVer.indexOf("Made Up Quest") > byVer.indexOf("Made Up Quest IV") && byVer.indexOf("Made Up Quest II") === byVer.length - 1, byVer.join(", "));
  const byOrig = lib.multiverses("date").find(m => m.name === "Made Up Worlds").franchises[0].games.map(g => g.title);
  assert.strictEqual(byOrig[0], "Made Up Quest");
  ok("by default in order of each game's newest version; by original release on request");
  // ---- Up next
  q2.status = "backlog";
  let was = q1.status; q1.status = "backlog"; lib.statusChanged(q1, "done"); // reset
  was = q1.status; G.setStatus(q1, "done"); let nx = lib.statusChanged(q1, was);
  assert.ok(nx === q2 && q2.next && q2.nextBy === q1.id, "finishing sets the next one by original release");
  was = q2.status; G.setStatus(q2, "done"); nx = lib.statusChanged(q2, was);
  assert.strictEqual(nx, q3);
  was = q3.status; G.setStatus(q3, "done"); nx = lib.statusChanged(q3, was);
  assert.strictEqual(nx, q4, "a game with no story is skipped");
  assert.ok(!party.next);
  was = q3.status; G.setStatus(q3, "backlog"); lib.statusChanged(q3, was);
  assert.ok(!q4.next && !q4.nextBy, "status changed back: the Up next it set is taken away");
  ok("finished: the next game of the series is Up next; changed back: taken away again");
  // ---- Missing: no tie-ins, AI-checked, versions with their original
  const db = new C.Store();
  db.replaceCanon("ai", [
    { franchise: "Made Up Worlds", title: "Made Up Quest V", year: 2014, medium: "Video Game", norm: C.norm("Made Up Quest V") },
    { franchise: "Made Up Worlds", title: "Made Up Quest Kart", year: 2016, medium: "Video Game", norm: C.norm("Made Up Quest Kart") },
    { franchise: "Made Up Worlds", title: "Made Up Quest V Deluxe", year: 2020, medium: "Video Game", norm: C.norm("Made Up Quest V Deluxe") },
    { franchise: "Big Screen Saga", title: "Big Screen Saga", year: 1999, medium: "Movie", norm: C.norm("Big Screen Saga") },
    { franchise: "Big Screen Saga", title: "Big Screen Saga: The Game", year: 2000, medium: "Video Game", norm: C.norm("Big Screen Saga: The Game") },
  ]);
  let m = G.missingRows(C, db, lib);
  assert.ok(!m.rows.some(c => c.franchise === "Big Screen Saga") && m.hidden.some(h => /tie-in to a film/.test(h.why)), "a film franchise's game left out");
  const rows = m.rows.filter(c => !c.have);
  const prompt = G.canonCheckPrompt(rows, ["Made Up Worlds"]);
  assert.ok(/campaign or story/.test(prompt) && /tie-in/.test(prompt) && /Made Up Quest Kart/.test(prompt));
  const r = G.applyCanonCheck(lib, rows, 'Here: [{"title":"Made Up Quest V","canon":true,"story":true,"tiein":false,"versionOf":"","multiverse":"Made Up Worlds"},{"title":"Made Up Quest Kart","canon":true,"story":false,"tiein":false,"versionOf":"","multiverse":"Made Up Worlds"},{"title":"Made Up Quest V Deluxe","canon":true,"story":true,"tiein":false,"versionOf":"Made Up Quest V","multiverse":"Made Up Worlds"}]');
  assert.deepStrictEqual([r.checked, r.noStory, r.versions], [3, 1, 1]);
  m = G.missingRows(C, db, lib);
  const v = m.rows.find(c => c.title === "Made Up Quest V");
  assert.ok(v && !m.rows.some(c => c.title === "Made Up Quest Kart") && !m.rows.some(c => c.title === "Made Up Quest V Deluxe") && v.versions[0].title === "Made Up Quest V Deluxe", JSON.stringify(m.rows.map(c => c.title)));
  ok("Missing: tie-ins, story-less and non-canon games out, versions under their original; the AI check is kept");
  // ---- 0.7.6b: the canon scan's franchises group your games; your list's multiverse name wins
  {
    const gl = new G.Games(null), db2 = new C.Store();
    const mk = (title, date, extra) => { const g = gl.add({ title }, "backlog").game; g.date = date; Object.assign(g, extra || {}); return g; };
    const a = mk("Hero Legends", "1998-01-01", { franchise: "Hero Legends", multiverse: "Hero Saga", fImported: true });
    const b = mk("Shadow of the Hero", "2002-01-01"); // guessed: its own series
    const c = mk("Hero Tactics Online", "2005-01-01"); // guessed too
    const d = mk("Other Thing", "2004-01-01");
    db2.replaceCanon("ai", [["Hero Legends", 1998], ["Shadow of the Hero", 2002], ["Hero Tactics Online", 2005]].map(([t, y]) => ({ franchise: "The Hero Legends Series", title: t, year: y, medium: "Video Game", norm: C.norm(t) })));
    const ch = gl.followCanon(C.gameCanon(db2, gl.visible()));
    assert.ok(b.multiverse === "Hero Saga" && c.multiverse === "Hero Saga" && b.franchise === "Hero Legends" && a.multiverse === "Hero Saga" && d.multiverse === "Other Thing", JSON.stringify([ch, b, c]));
    const mvs = gl.multiverses().map(m => m.name + ":" + m.total);
    assert.ok(mvs.includes("Hero Saga:3"), mvs.join(", "));
    // nobody of yours in it: the scan's name
    const gl2 = new G.Games(null), x = gl2.add({ title: "Lone Game" }, "backlog").game, y = gl2.add({ title: "Lone Game Returns" }, "backlog").game;
    x.date = "2001-01-01"; y.date = "2003-01-01";
    db2.replaceCanon("ai", [["Lone Game", 2001], ["Lone Game Returns", 2003]].map(([t, yy]) => ({ franchise: "Lone Universe", title: t, year: yy, medium: "Video Game", norm: C.norm(t) })));
    gl2.followCanon(C.gameCanon(db2, gl2.visible()));
    assert.ok(x.multiverse === "Lone Universe" && y.multiverse === "Lone Universe");
    ok("the canon scan's franchises group your games (your list's multiverse name kept)");
  }
  // ---- the film and TV scan asks for no games of film or TV franchises
  assert.ok(/list NO video games/.test(require("fs").readFileSync(__dirname + "/core.js", "utf8")));
  console.log("0.7.6 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
