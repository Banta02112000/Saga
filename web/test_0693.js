// 0.6.9.3: the Doctor Who list as kept in a note (Samsung Notes), into the timeline. Ratings here are made up.
// Run: node test_0693.js
const assert = require("assert");
let saved = null;
global.window = { Kit: { esc: x => String(x), icon: () => "", mods: {} } };
global.Saga = { Native: { load: () => saved, save: (n, t) => { saved = t; } }, changed: () => {}, render: () => {} };
require("./dw-data.js"); require("./timeline.js");
const T = window.Kit.mods.timeline;
const note = `---------------------S0---------------------
1. The Three Paths (9)
2. Report on Term's Work ()
3. The Longest Story in the World (6)         ⤵️
                         ⤵️
Avg. 5.3 5.3 (5.9)

---------------------S1---------------------
1. An Unearthly Child (10)
2. The Daleks (7) -[Susan]
---------------------S2---------------------
53. The Chase [1-4]
25. The True and Indisputable Facts in the Matter of the Ram's
       Skull (7)
---------------------S6---------------------
86. The War Games (8) [10]
99. A Story That Is Not There (5)
`;
const P = T.parseNote(note);
assert.strictEqual(P.length, 9);
assert.deepStrictEqual(P.map(e => e.rating), [9, null, 6, 10, 7, null, 7, 8, 5]);
assert.strictEqual(P[4].title, "The Daleks", "-[Susan] dropped");
assert.strictEqual(P[6].title, "The True and Indisputable Facts in the Matter of the Ram's Skull", "a wrapped title joined");
assert.ok(P[5].part === "1-4" && P[7].part === "10" && P[7].title === "The War Games", "parts before or after the rating");
console.log("ok  note lines: sections, ratings, empty (), -[who], ⤵️, Avg., wrapped titles, parts");

saved = JSON.stringify({ works: { "thelongeststoryintheworld|short|": { done: true, rating: 4, notes: "mine" }, "reportontermswork|short|": { done: true, rating: 7 } } });
const dry = T.importNote(note, true);
assert.deepStrictEqual([dry.rated, dry.added, dry.changed, dry.same, dry.empty, dry.keptHere], [6, 5, 1, 0, 2, 1], JSON.stringify(dry));
assert.deepStrictEqual(dry.unmatched, ["S6 99. A Story That Is Not There"]);
assert.ok(!JSON.parse(saved).works["thethreepaths|short|@t1"], "a check writes nothing");
const r = T.importNote(note, false); T.reset();
const w = JSON.parse(saved).works;
assert.deepStrictEqual(w["thethreepaths|short|@t1"], { done: true, rating: 9 });
assert.deepStrictEqual(w["thelongeststoryintheworld|short|"], { done: true, rating: 6, notes: "mine" }, "the note's rating wins, your note kept");
assert.deepStrictEqual(w["reportontermswork|short|"], { done: true, rating: 7 }, "an empty () leaves Saga's mark");
assert.strictEqual(w["thewargames|tv|10"].rating, 8);
assert.strictEqual(T.importNote(note, true).same, 6, "importing again changes nothing");
assert.throws(() => T.importNote("just some text", true), /no numbered stories/);
console.log("ok  importing: the note's rating wins, empty ones and your notes kept, unknown lines listed");

const n = T.restoreMine({ works: { "thethreepaths|short|@t1": { done: true, rating: 2 }, "anunearthlychild|tv|": { done: true, rating: 3 }, "edgeofdestructionfake|tv|": { done: true, rating: 5 } } }, false); T.reset();
assert.strictEqual(n, 1); assert.strictEqual(JSON.parse(saved).works["thethreepaths|short|@t1"].rating, 9, "built-in marks only where there's none");
console.log("ok  built-in marks put back only where a story has none");
console.log("0.6.9.3 TESTS PASSED");
