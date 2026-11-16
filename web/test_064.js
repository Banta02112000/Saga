// 0.6.4: a games spreadsheet (.xlsx or .csv) into Games. Made-up rows in the same layout as a real games list.
// Run: node test_064.js
const assert = require("assert");
const G = require("./games.js");

// an .xlsx as the file picker hands it over: the XML parts of the ZIP
const ss = ["Title", "OG Release Date", "OG Platform", "Remake Name", "Remake Release Date", "Remake Platform", "Owned Platform", "HLTB", "HLTB Bundle", "Rating", "Franchise", "Multiverse", "Next",
  "Night Runner", "SNES", "N/A", "RetroArch", "Runner", "Arcadia", "X", "Night Runner", "Sega Genesis", "Sky & Sea", "PC", "Sky &amp; Sea Remastered", "Épée Legends", "Status", "Done", "Sky"];
const S = s => ss.indexOf(s);
const sharedXml = `<?xml version="1.0"?><sst xmlns="x" count="${ss.length}">${ss.map(t => t === "Épée Legends" ? `<si><r><t>Épée </t></r><r><t xml:space="preserve">Legends</t></r></si>` : `<si><t>${t === "Sky & Sea" ? "Sky &amp; Sea" : t}</t></si>`).join("")}</sst>`;
const c = (ref, v, t) => v === null ? "" : t === "s" ? `<c r="${ref}" t="s"><v>${S(v)}</v></c>` : `<c r="${ref}"><v>${v}</v></c>`;
const row = (n, cells) => `<row r="${n}">${cells.join("")}</row>`;
const sheetXml = `<?xml version="1.0"?><worksheet><sheetData>
${row(1, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"].map((L, i) => c(L + 1, ss[i], "s")).concat([`<c r="N1" t="s"><v>${S("Status")}</v></c>`]))}
${row(2, [c("A2", "Night Runner", "s"), c("B2", 33445), c("C2", "SNES", "s"), c("D2", "N/A", "s"), c("E2", 33445), c("F2", "SNES", "s"), c("G2", "RetroArch", "s"), c("H2", 2.5), c("I2", "N/A", "s"), c("J2", 6.3), c("K2", "Runner", "s"), c("L2", "Arcadia", "s"), c("M2", "X", "s")])}
${row(3, [c("A3", "Night Runner", "s"), c("B3", 33445), c("C3", "Sega Genesis", "s"), c("D3", "N/A", "s"), c("E3", 33445), c("F3", "Sega Genesis", "s"), c("G3", "N/A", "s"), c("H3", "N/A", "s"), c("J3", "N/A", "s"), c("K3", "Runner", "s"), c("L3", "Arcadia", "s")])}
${row(4, [c("A4", "Sky & Sea", "s"), c("B4", 34001), c("C4", "PC", "s"), c("D4", "Sky &amp; Sea Remastered", "s"), c("E4", 36000), c("F4", "PC", "s"), c("H4", 27.5), c("I4", 40), c("J4", 8), c("K4", "Sky", "s"), `<c r="N4" t="s"><v>${S("Done")}</v></c>`])}
${row(5, [c("A5", "Épée Legends", "s"), `<c r="B5" t="inlineStr"><is><t>TBA</t></is></c>`, c("C5", "PC", "s"), c("K5", "Épée", "s")])}
${row(6, [])}
</sheetData></worksheet>`;
const zip = { "xl/workbook.xml": "<workbook/>", "xl/sharedStrings.xml": sharedXml, "xl/worksheets/sheet1.xml": sheetXml, "xl/styles.xml": "<styleSheet/>" };

const rows = G.readXlsx(zip);
assert.deepStrictEqual(rows[0].slice(0, 3), ["Title", "OG Release Date", "OG Platform"]);
assert.strictEqual(rows[1][1], 33445); assert.strictEqual(rows[2][8], null, "a skipped cell stays empty");
assert.strictEqual(rows[4][0], "Épée Legends", "rich text and accents"); assert.strictEqual(rows[4][1], "TBA", "inline text");
assert.strictEqual(G.sheetDate(33445), "1991-07-26", "Excel day numbers become dates");
assert.throws(() => G.readXlsx({ "word/document.xml": "" }), /not an Excel file/);
console.log("ok  .xlsx read: shared and inline text, entities, rich text, gaps");

const L = new G.Games();
const r1 = G.fromSheet(L, rows);
assert.deepStrictEqual(r1, { added: 4, updated: 0, same: 0, skipped: 0, rows: 4 });
const nr = L.games.filter(g => g.title === "Night Runner");
assert.strictEqual(nr.length, 2, "the same game on two consoles stays two entries");
const snes = nr.find(g => g.platform === "SNES"), gen = nr.find(g => g.platform === "Sega Genesis");
assert.ok(snes.date === "1991-07-26" && snes.owned === "RetroArch" && snes.hours === 2.5 && snes.hoursRemake === null && snes.imdbR === 6.3 && snes.franchise === "Runner" && snes.multiverse === "Arcadia" && snes.next === true && snes.remake === null, JSON.stringify(snes));
assert.ok(gen.owned === "" && gen.hours === null && gen.imdbR === null && gen.next === false, "N/A cells are empty: " + JSON.stringify(gen));
const sky = L.games.find(g => g.title === "Sky & Sea");
assert.deepStrictEqual(sky.remake, { title: "Sky & Sea Remastered", date: G.sheetDate(36000), platform: "PC" });
assert.ok(sky.hoursRemake === 40 && sky.status === "done" && sky.plays.length === 0 && sky.multiverse === "Sky", "Status column, multiverse from franchise: " + JSON.stringify(sky));
const ep = L.games.find(g => g.title === "Épée Legends");
assert.ok(ep.date === "" && ep.dateText === "" && ep.status === "backlog", JSON.stringify(ep));
console.log("ok  rows become games: dates, N/A, remakes, HLTB, IMDb rating, franchise, Next");

// importing again: your progress kept, the list's own columns updated
snes.status = "done"; snes.rating = 9; snes.plays = ["2020-02-02"]; snes.notes = "mine";
rows[1][7] = 3; // HLTB changed in the list
const r2 = G.fromSheet(L, rows);
assert.deepStrictEqual([r2.added, r2.updated, r2.same], [0, 1, 3]);
assert.ok(snes.hours === 3 && snes.status === "done" && snes.rating === 9 && snes.plays[0] === "2020-02-02" && snes.notes === "mine", JSON.stringify(snes));
assert.strictEqual(L.games.length, 4);
// a game you removed stays removed
L.remove(ep.id);
const r3 = G.fromSheet(L, rows);
assert.strictEqual(r3.skipped, 1); assert.ok(!L.games.some(g => g.title === "Épée Legends"));
// a game you added by hand earlier (no platform) is matched, not doubled
const L2 = new G.Games(); L2.add({ title: "Sky & Sea", date: "1993-02-01" }, "playing");
const r4 = G.fromSheet(L2, rows);
assert.strictEqual(L2.games.filter(g => g.title === "Sky & Sea").length, 1, "matched by title and year");
assert.strictEqual(L2.games.find(g => g.title === "Sky & Sea").status, "playing", "your status kept");
assert.strictEqual(r4.added, 3);
console.log("ok  importing again keeps your status, rating, plays, notes and removals");

// the same columns as CSV rows
const csvRows = [["Title", "OG Platform", "HLTB", "Franchise", "Next"], ["Csv Quest", "PS2", "12", "Quest", "x"]];
const L3 = new G.Games(); G.fromSheet(L3, csvRows);
assert.ok(L3.games[0].hours === 12 && L3.games[0].next && L3.games[0].platform === "PS2");
assert.throws(() => G.fromSheet(new G.Games(), [["Foo", "Bar"], ["a", "b"]]), /no Title column/);
console.log("ok  CSV rows with the same columns");
console.log("0.6.4 TESTS PASSED");
