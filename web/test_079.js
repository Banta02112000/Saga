// 0.7.9: one place per series in Games › Franchises. Made-up data. Run: node test_079.js
const assert = require("assert");
const G = require("./games.js");
const ok = m => console.log("ok  " + m);
const lib = new G.Games(null);
const mine = (title, date, franchise, multiverse) => { const g = lib.add({ title }, "backlog").game; Object.assign(g, { date, franchise, multiverse, src: "list" }); return g; };
const other = (title, date, franchise, extra) => { const g = G.blank(Object.assign({ id: "o" + lib.games.length, title, date, franchise, multiverse: franchise, fCanon: true, src: "canon" }, extra || {})); lib.games.push(g); return g; };
// your list: one multiverse with series inside, one with the series being the multiverse
mine("Grimdark Tactics: Iron Siege", "2004-01-01", "Grimdark", "Grimdark");
mine("Grimdark Tactics: Iron Siege II", "2009-01-01", "Grimdark", "Grimdark");
mine("Grimdark: Rat Swarm", "2015-01-01", "Grimdark", "Grimdark");
mine("Grimdark: Rat Swarm 2", "2018-01-01", "Grimdark", "Grimdark");
mine("Hive Gangers: Underworld", "2020-01-01", "Grimdark", "Grimdark");
mine("Mega War: Grimdark", "2016-01-01", "Grimdark", "Grimdark");
mine("Mega War: Grimdark II", "2017-01-01", "Grimdark", "Grimdark");
mine("Mega War: Old Empire", "2012-01-01", "Mega War", "Mega War");
mine("Web Hero", "2002-01-01", "Web Hero", "Comic Universe");
mine("Web Hero 2", "2004-01-01", "Web Hero", "Comic Universe");
lib.games.push(G.blank({ id: "wh2b", title: "Web Hero 2", date: "2005-03-23", platform: "PSP", franchise: "Web Hero", multiverse: "Comic Universe", src: "list" })); // a second game of the same name (another platform): kept
mine("Claw Man", "2009-01-01", "Claw Man", "Comic Universe");
// what canon scans, IMDb and Steam added, each in a series of its own
const a = other("Grimdark Tactics: Iron Siege III", "2022-01-01", "Grimdark Tactics: Iron Siege");
const b = other("Mega War: Grimdark III", "2022-02-17", "Mega War");
const c = other("Brand's Web Hero: Miles", "2020-11-12", "Brand's Web Hero");
const d = other("Hive Gangers: Hired Blade", "2021-06-01", "Hive Gangers");
const e = other("Web Hero II", "2004-06-28", "Web Hero (Studio)", { fCanon: false, src: "imdb" });
const f = other("Unknown Indie Gem", "2021-01-01", "Unknown Indie Gem");
lib.save = () => {};
const moved = lib.resolveFranchises();
assert.strictEqual(a.multiverse, "Grimdark"); assert.strictEqual(a.franchise, "Grimdark", "your series; its sub-series comes from its title, like your own games'");
assert.strictEqual(b.multiverse, "Grimdark", "two of your names in the title: your own games with both decide");
assert.strictEqual(c.multiverse, "Comic Universe"); assert.strictEqual(c.franchise, "Web Hero");
assert.strictEqual(d.multiverse, "Grimdark", "a series your list starts titles with (Hive Gangers) is yours too");
assert.ok(!lib.games.includes(e), "the same game added twice (II = 2, same year) is merged into your list's");
assert.strictEqual(lib.games.filter(g => g.title === "Web Hero 2").length, 2, "two games of your list with one name both stay");
assert.strictEqual(f.multiverse, "Unknown Indie Gem", "no name of yours: left as the canon scan said");
assert.ok(moved.some(x => /merged/.test(x)));
ok("everything goes where its name says; copies merged");

const mvs = lib.multiverses("date"), gd = mvs.find(m => m.name === "Grimdark");
assert.ok(!mvs.some(m => /Iron Siege|Hive Gangers/.test(m.name)), "no split multiverses: " + mvs.map(m => m.name).join(", "));
assert.strictEqual(gd.all.length, 10, "all in one row");
const names = gd.series.map(s => s.name);
assert.strictEqual((gd.series.find(s => s.name === "Grimdark Tactics") || { games: [] }).games.length, 3, names.join(" | "));
assert.ok(names.some(n => /Rat Swarm/.test(n)) && names.some(n => /Hive Gangers/.test(n)) && names.some(n => /Mega War/.test(n)), names.join(" | "));
assert.deepStrictEqual(gd.all.map(g => g.date), gd.all.map(g => g.date).slice().sort(), "release order");
ok("one multiverse, its sub-series inside: " + names.join(" · "));

// stems and cleaning
assert.strictEqual(G.seriesStem("Grimdark 40,000: Dawn Siege II – Retribution", "Grimdark"), "Dawn Siege");
assert.strictEqual(G.cleanSeries("Red Range Red Range X"), "Red Range");
assert.strictEqual(G.looseKey("Marvel\u2019s Web Hero III"), G.looseKey("Web Hero 3"));
// your list put back: a slid row (series in the rating column) read right
const lib2 = new G.Games(null); lib2.save = () => {};
const g1 = lib2.add({ title: "Old Stone Tablets" }, "backlog").game; Object.assign(g1, { date: "1997-03-30", src: "list", franchise: "Wrong", multiverse: "Wrong", fCanon: true });
const n = G.repairFromList(lib2, [{ t: "Old Stone Tablets", od: "March 30, 1997", r: "Hero Quest", f: "Big Crossover", m: "" }]);
assert.strictEqual(n, 1); assert.strictEqual(g1.franchise, "Hero Quest"); assert.strictEqual(g1.multiverse, "Big Crossover"); assert.ok(g1.fImported && !g1.fCanon);
ok("your list's series put back, slid columns read right");
// 0.8.1: one-game "series" join the main line; "The X" and "X" are one; single words keep what they belong to
const lib3 = new G.Games(null); lib3.save = () => {};
for (const [t, d] of [["Raider Tomb", "1996-01-01"], ["Raider Tomb: Legend", "2006-01-01"], ["Raider Tomb: Underworld", "2008-01-01"], ["Rise of the Raider Tomb", "2015-01-01"], ["Raider Tomb: Dusk Isle", "2001-01-01"], ["Raider Tomb: Dusk Isle 2", "2003-01-01"]]) { const g = lib3.add({ title: t }, "backlog").game; Object.assign(g, { date: d, franchise: "Raider Tomb", multiverse: "Raider Tomb", src: "list" }); }
const rt = lib3.multiverses("date")[0];
assert.deepStrictEqual(rt.series.map(x => `${x.name}:${x.games.length}`).sort(), ["Dusk Isle:2", "Raider Tomb:4"]);
assert.strictEqual(G.seriesStem("Grimdark Wars Episode I: The Shadow", "Grimdark Wars"), "Grimdark Wars Episode");
assert.strictEqual(G.seriesStem("Xeno: Isolation", "Xeno"), "Xeno: Isolation");
ok("main line keeps its one-offs; one-word series keep their name");
// Up next stays in the line you're playing
const lib4 = new G.Games(null); lib4.save = () => {};
const mk = (t, d) => { const g = lib4.add({ title: t }, "backlog").game; Object.assign(g, { date: d, franchise: "Grimdark", multiverse: "Grimdark", src: "list" }); return g; };
const d1 = mk("Grimdark: Dawn Siege", "2004-01-01"); mk("Grimdark: Rat Swarm", "2005-01-01"); const d2 = mk("Grimdark: Dawn Siege II", "2009-01-01");
const was = d1.status; G.setStatus(d1, "done"); const nx = lib4.statusChanged(d1, was);
assert.strictEqual(nx && nx.id, d2.id, "next in Dawn Siege, not the next Grimdark game");
ok("Up next follows the sub-series");
console.log("TEST 079 PASSED");
// ---- 0.8.2: games from IMDb / scans with no list of yours: the multiverses' own names decide
(async () => {
const L = new G.Games(null); L.save = () => {};
let i = 0; const add = (title, date, franchise, multiverse, extra) => { const g = G.blank(Object.assign({ id: "z" + i++, title, date, franchise, multiverse, src: "imdb" }, extra || {})); L.games.push(g); return g; };
for (let k = 1; k <= 6; k++) add(`Space Saga: Chapter ${k}`, `${2000 + k}-01-01`, "Space Saga", "Space Saga");
const so = add("Space Saga Outlaws", "2024-01-01", "Space Saga Outlaws", "Space Saga Outlaws");
const tw = add("Big War: Space Saga III", "2022-01-01", "Big War", "Big War"); add("Big War: Rome", "2004-01-01", "Big War", "Big War");
for (let k = 1; k <= 4; k++) add(`Blob Ball ${k}`, `${1990 + k}-01-01`, "Blob Ball", "Blob Ball");
const z = []; for (let k = 1; k <= 3; k++) z.push(add(`Blob Ball Z: Fight ${k}`, `${2000 + k}-01-01`, "Blob Ball Z", "Blob Ball Z"));
const ph = add("Lost Title", "2010-01-01", "Unsorted", "-\\\\");
const mo = add("PokÃ©mon Pocket", "2012-01-01", "PokÃ©mon Pocket", "PokÃ©mon Pocket");
const solo1 = add("Lonely Game", "2015-01-01", "Lonely Game", "Lonely Game"), solo2 = add("Other Lonely", "2016-01-01", "Other Lonely", "Other Lonely");
const big1 = add("Same Name", "1993-12-10", "Same Name", "Same Name", { steam: 777, cover: "https://cdn.cloudflare.steamstatic.com/steam/apps/777/library_600x900.jpg", price: { eur: 9 } });
const big2 = add("Same Name", "2016-05-13", "Same Name", "Same Name", { steam: 777 });
L.resolveFranchises();
assert.strictEqual(so.multiverse, "Space Saga", "a small group whose title names a bigger multiverse joins it");
assert.strictEqual(tw.multiverse, "Space Saga"); assert.strictEqual(tw.franchise, "Big War", "its old series stays as a sub-series");
assert.ok(z.every(g => g.multiverse === "Blob Ball") && z[0].franchise === "Blob Ball Z", "a family goes under its head: " + z[0].multiverse);
assert.strictEqual(ph.multiverse, "Lost Title", "a placeholder series is not a series");
assert.strictEqual(mo.title, "Pokémon Pocket", "accents read in the wrong encoding put right");
const mv = L.multiverses("size");
assert.ok(!mv.some(m => m.name === "Big War" && m.total > 1) || mv.find(m => m.name === "Big War").total === 1);
const sa = mv.find(m => m.standalone); assert.ok(sa && sa.all.includes(solo1) && sa.all.includes(solo2), "one-game multiverses go together");
assert.strictEqual(mv[mv.length - 1], sa, "at the end");
ok("no list of yours: names decide, families under their head, standalone games together");
// two games sharing one Steam app: Steam's name and date decide
const http = async () => ({ status: 200, body: JSON.stringify({ 777: { success: true, data: { name: "SAME NAME", release_date: { date: "13 May, 2016" } } } }) });
const r = await G.fixSharedSteam(L, http, null);
assert.strictEqual(big2.steam, 777); assert.ok(!big1.steam && !big1.cover && !big1.price, "the 1993 one loses the 2016 app, its cover and price");
assert.strictEqual(r[0].cleared[0], "Same Name");
ok("shared Steam app given back to the right game");
// a sequel number is not a near match
assert.strictEqual(G.storyKey ? G.storyKey("Mega Hero 11") !== G.storyKey("Mega Hero") : true, true);
console.log("TEST 079b PASSED");
})().catch(e => { console.error(e); process.exit(1); });
