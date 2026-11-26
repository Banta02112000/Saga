// 0.8.4: a made-up collection shaped like a real one (everything from IMDb, no list with series, accents read in the
// wrong encoding, placeholder series, slid spreadsheet rows, shared Steam apps, remakes as games of their own), the
// grouping tools you have the last word with, undoable batches, Check your games and the AI sort. Run: node test_084.js
const assert = require("assert");
const G = require("./games.js");
const ok = m => console.log("ok  " + m);
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const L = new G.Games(null); L.save = () => {};
let n = 0; const add = (title, date, franchise, multiverse, extra) => { const g = G.blank(Object.assign({ id: "f" + n++, title, date, franchise, multiverse, src: "imdb", imdb: "tt" + (8000000 + n) }, extra || {})); L.games.push(g); return g; };
// big franchises split by their scans into many small groups, as IMDb-only collections are
for (let k = 1; k <= 40; k++) add(`Space Saga: Chapter ${k}`, `${1985 + k}-03-01`, "Space Saga", "Space Saga");
for (const t of ["Space Saga Outlaws", "Space Saga Jedi Path", "Space Saga Jedi Path 2", "Vader Dream: A Space Saga Story"]) add(t, "2020-01-01", t, t);
for (let k = 1; k <= 12; k++) add(`Blob Ball ${k}`, `${1990 + k}-01-01`, "Blob Ball", "Blob Ball");
for (const t of ["Blob Ball Z: Budo", "Blob Ball Z: Budo 2", "Blob Ball Z: Kakarot", "Blob Ball GT: Final"]) add(t, "2005-01-01", t.replace(/:.*/, ""), t.replace(/:.*/, ""));
for (let k = 1; k <= 25; k++) add(`Grimdark: Dawn Siege ${k > 1 ? k : ""}`.trim(), `${1995 + k}-05-01`, "Grimdark 40,000", "Grimdark");
add("Big War: Grimdark", "2016-01-01", "Big War", "Big War"); add("Big War: Grimdark II", "2017-01-01", "Big War", "Big War"); add("Big War: Rome", "2004-01-01", "Big War", "Big War");
// noise: encoding, placeholders, a stray backslash
const moj = add("PokÃ©mon Pocket", "2012-01-01", "PokÃ©mon Pocket", "PokÃ©mon Pocket");
const ph = add("Lost Title", "2010-01-01", "Unsorted", "-\\");
// two games on one Steam app (a sequel picked by name)
const m1 = add("Rocket Kid", "1987-12-17", "Rocket Kid", "Rocket Kid", { steam: 555 }), m11 = add("Rocket Kid 11", "2018-10-02", "Rocket Kid", "Rocket Kid", { steam: 555 });
// a remake held as a game of its own, older than nothing: listed twice in versions
const orig = add("Night Mansion 2", "1998-01-21", "Night Mansion", "Night Mansion"); add("Night Mansion", "1996-03-22", "Night Mansion", "Night Mansion");
orig.versions = [{ title: "Night Mansion 2", date: "2019-01-25", kind: "remake" }, { title: "Night Mansion 2", date: "2019-01-25", kind: "remake" }];
const bad = add("Shooter: Modern Front", "2019-10-25", "Shooter", "Shooter"); bad.versions = [{ title: "Shooter: Modern Front Remastered", date: "2016-11-04", kind: "remaster" }];
// one-offs
for (let k = 0; k < 1600; k++) add(`Indie Thing ${String.fromCharCode(65 + (k % 26))}${k}`, `${2000 + (k % 25)}-0${1 + (k % 9)}-1${k % 9}`, `Indie Thing ${String.fromCharCode(65 + (k % 26))}${k}`, `Indie Thing ${String.fromCharCode(65 + (k % 26))}${k}`);

// ---- regroup: speed and result
let t = Date.now(); L.resolveFranchises(); const tr = Date.now() - t;
t = Date.now(); const mv = L.multiverses("date"); const tm = Date.now() - t;
assert.ok(tr < 4000 && tm < 1500, `fast enough on ${L.games.length} games: regroup ${tr} ms, multiverses ${tm} ms`);
const names = mv.map(m => m.name);
assert.ok(!names.some(x => /Outlaws|Jedi Path|Vader Dream/.test(x)), "Space Saga's small groups joined it: " + names.filter(x => /Space/.test(x)));
assert.ok(!names.some(x => /^Blob Ball (Z|GT)$/.test(x)), "a family under its head");
assert.ok(!names.includes("Big War") || mv.find(m => m.name === "Big War").total === 1, "Big War: Grimdark went to Grimdark");
assert.strictEqual(moj.title, "Pokémon Pocket"); assert.strictEqual(ph.multiverse, "Lost Title");
const sa = mv[mv.length - 1]; assert.ok(sa.standalone && sa.total >= 1600, "one-offs in one row at the end");
assert.ok(L.meta.batches && L.meta.batches[0].items.length > 0, "the regroup is one batch in Changes");
ok(`regrouped ${L.games.length} games in ${tr} ms (multiverses ${tm} ms): ${mv.length} groups`);

// ---- undo the regroup, then do it again
const b0 = L.meta.batches[0], movedOne = L.get(b0.items.find(i => i.k === "changed").id), before = movedOne.multiverse;
const u = L.undoBatch(b0.id); assert.ok(u.back > 0 && b0.undone, JSON.stringify(u));
assert.notStrictEqual(movedOne.multiverse, before, "undone: back where it was");
L.resolveFranchises(); assert.strictEqual(movedOne.multiverse, before);
ok("a batch undone, and redone");

// ---- your tools win, and stay
const so = L.games.find(g => g.title === "Space Saga Outlaws");
L.moveGame(so, "Outlaws Universe", "Outlaws");
L.resolveFranchises();
assert.strictEqual(so.multiverse, "Outlaws Universe", "a game you moved is not moved again"); assert.ok(so.fManual);
assert.ok(L.renameMv("Blob Ball", "Blob Ball Saga") > 0 && L.mvGames("Blob Ball Saga").length >= 16);
assert.ok(L.mergeMv("Night Mansion", "Grimdark") > 0 && !L.mvGames("Night Mansion").length);
const gd = L.multiverses("date").find(m => m.name === "Grimdark"), seriesN = gd.series.length;
assert.ok(L.splitSeries("Grimdark", "Big War") > 0 && L.mvGames("Big War").length >= 2, "a series split off");
const opened = L.openUpMv("Grimdark"); assert.ok(opened > 0 && L.multiverses("date").filter(m => /Dawn Siege|Night Mansion/.test(m.name)).length >= 1, "opened up into its series");
// a version that isn't one
const nm = L.games.find(g => g.title === "Night Mansion 2" && g.date === "1998-01-21");
const det = L.detachVersion(nm, 0); assert.ok(det && L.games.includes(det) && nm.versions.length === 1);
L.bundleVersions(false); assert.ok(L.games.includes(det), "never joined back");
L.attachVersion(nm, det); assert.ok(!L.games.includes(det) && nm.versions.some(v => v.date === "2019-01-25"));
ok("move, rename, merge, split, open up, detach and attach: what you set stays");

// ---- Check your games
const dup = add("Twice Told", "2001-01-01", "Twice Told", "Twice Told", { versions: [{ title: "Twice Told HD", date: "2015-01-01", kind: "remaster" }, { title: "Twice Told HD", date: "2015-01-01", kind: "remaster" }] });
const ck = L.check();
assert.strictEqual(ck.steam.length, 1); assert.ok(ck.versions.some(x => x.g === bad && /older/.test(x.why)) && ck.versions.some(x => x.g === dup && /twice/.test(x.why)), JSON.stringify(ck.versions.map(x => [x.g.title, x.why])));
L.unlinkSteam(m1); assert.ok(!m1.steam && m11.steam === 555);
L.swapOriginal(bad, 0); const nb = L.games.find(g => g.title === "Shooter: Modern Front Remastered"); assert.ok(nb && nb.versions.some(v => v.title === "Shooter: Modern Front"), "the older one became the original");
L.dropVersion(dup, 1);
const ck2 = L.check(); assert.strictEqual(ck2.steam.length, 0); assert.ok(!ck2.versions.length, JSON.stringify(ck2.versions.map(x => x.why)));
ok("Check your games finds and fixes: shared Steam app, a version older than its original, a version listed twice");

// ---- the AI sort: prompts, answers read, approved ones applied as one step
const ps = G.aiSortPrompts(L); assert.ok(ps.length >= 1 && /MERGE:/.test(ps[0]) && /All groups:/.test(ps[0]));
const mvNow = L.multiverses("size").filter(m => !m.standalone).map(m => m.name);
const a1 = mvNow.find(x => /Blob Ball Saga/.test(x)), a2 = mvNow.find(x => /Rocket Kid/.test(x));
const solo = L.multiverses("size").find(m => m.standalone).all[0];
const props = G.parseAiSort(L, `Sure! Here you go:\n- **MERGE: ${a2} => ${a1}**\nMOVE: ${solo.title} => ${a1}\nMERGE: Nonexistent => ${a1}\nMOVE: Nope => Nowhere`);
assert.strictEqual(props.length, 2, JSON.stringify(props));
const nAp = L.applyProposals(props); assert.strictEqual(nAp, 2);
assert.strictEqual(L.get(solo.id).multiverse, L.mvGames(a1)[0].multiverse);
const last = L.meta.batches[0]; assert.ok(/AI sort: 2/.test(last.what)); L.undoBatch(last.id); assert.ok(L.mvGames(a2).length > 0, "AI sort undone in one tap");
ok("AI sort: answers read, approved ones applied as one undoable step");
// ---- 0.8.5: remakes found however they're written, possible remakes asked to the AI
const R = new G.Games(null); R.save = () => {};
const mk = (title, date, extra) => { const g = G.blank(Object.assign({ id: "r" + R.games.length, title, date, franchise: "Night Mansion", multiverse: "Night Mansion", src: "imdb", imdb: "tt77" + R.games.length }, extra || {})); R.games.push(g); return g; };
const o4 = mk("Night Mansion 4", "2005-01-11", { remake: { title: "Night Mansion IV (2023)", date: "2023-03-24" } }); const r4 = mk("Night Mansion 4", "2023-03-24", { status: "done" });
const o2 = mk("Night Mansion 2", "1998-01-21", { versions: [{ title: "Night Mansion 2 Remake", date: "2019-01-25", kind: "remake" }] }); const r2 = mk("Night Mansion 2", "2019-01-25");
const doom = mk("Rip Fest", "1993-12-10"), doom16 = mk("Rip Fest", "2016-05-13"), sm = mk("Web Hero 2", "2004-06-29"), sm23 = mk("Web Hero 2", "2023-10-20");
R.bundleVersions(false);
assert.ok(!R.games.includes(r4) && o4.status === "done" && o4.versions.some(v => v.date === "2023-03-24"), "a remake named \"IV (2023)\" found as \"4\" from 2023");
assert.ok(!R.games.includes(r2), "\"Night Mansion 2 Remake\" found as \"Night Mansion 2\" from 2019");
assert.ok(R.games.includes(doom16) && R.games.includes(sm23), "same names years apart are not joined by themselves");
const pairs = G.remakeCandidates(R); assert.strictEqual(pairs.length, 2, pairs.map(p => p.b.title).join());
const pr2 = G.remakePrompt(pairs); assert.ok(/1: Rip Fest \(1993\) \/ Rip Fest \(2016\)/.test(pr2), pr2);
const vd = G.parseRemakeAnswer(pairs, "1: DIFFERENT\n**2: REMASTER**"); assert.deepStrictEqual(vd.map(x => x.kind), ["different", "remaster"]);
const rr = R.applyRemakeVerdicts(vd); assert.deepStrictEqual(rr, { joined: 1, apart: 1 });
assert.ok(R.games.includes(doom16) && !R.games.includes(sm23) && sm.versions.find(v => v.date === "2023-10-20").kind === "remaster");
assert.strictEqual(G.remakeCandidates(R).length, 0, "a pair called different isn't asked again");
ok("remakes: found however written, possible ones asked, verdicts applied");
console.log("TEST 084 PASSED");
