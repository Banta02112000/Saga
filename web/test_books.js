// node tests for books/core.js
const assert = require("assert");
const B = require("./books/core.js");
// draw an EAN-13 as grey pixels: quiet zone, guards, digits; scale and blur a bit
function ean13Pixels(code, scale = 3, noise = 18, reverse = false) {
  const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const G = L.map(c => c.split("").reverse().map(x => (x === "0" ? "1" : "0")).join("")), R = L.map(c => c.split("").map(x => (x === "0" ? "1" : "0")).join(""));
  const P = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"][+code[0]];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (P[i - 1] === "L" ? L : G)[+code[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[+code[i]];
  bits += "101";
  const px = [];
  for (let i = 0; i < 30; i++) px.push(230);
  for (const b of bits) for (let k = 0; k < scale; k++) px.push(b === "1" ? 30 : 225);
  for (let i = 0; i < 30; i++) px.push(230);
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = px.map((v, i) => Math.max(0, Math.min(255, (v + (px[i - 1] || v) + (px[i + 1] || v)) / 3 + (rnd() - 0.5) * noise)));
  return reverse ? out.reverse() : out;
}
(async () => {
  // ISBN helpers and barcode
  assert.ok(B.validIsbn13("9788804668237") && !B.validIsbn13("9788804668238"));
  assert.strictEqual(B.isbn10to13("0441013597"), "9780441013593");
  for (const [code, s, rev] of [["9788804668237", 3, false], ["9780441013593", 2, true], ["9781250313195", 4, false]]) assert.strictEqual(B.decodeLine(ean13Pixels(code, s, 18, rev)), code, code);
  assert.strictEqual(B.decodeLine(new Array(400).fill(200)), null);
  // series parsing
  assert.deepStrictEqual(B.parseSeries("The Well of Ascension (Mistborn, #2)"), { title: "The Well of Ascension", series: "Mistborn", num: 2 });
  assert.strictEqual(B.parseSeries("Il trono di spade vol. 3").num, 3);
  assert.strictEqual(B.parseSeries("Dune"), null);

  // library, status, progress
  let file = "";
  const lib = new B.Library({ load: () => file, save: t => { file = t; } });
  const { book } = lib.add({ title: "The Final Empire (Mistborn, #1)", authors: ["Brandon Sanderson"], pages: 500, isbn13: "9780765311788" }, "reading");
  assert.strictEqual(book.series, "Mistborn"); assert.strictEqual(book.seriesNum, 1); assert.ok(book.started);
  assert.strictEqual(lib.add({ title: "x", isbn13: "9780765311788" }).existed, true);
  B.setPage(book, 250); assert.strictEqual(B.percent(book), 50);
  B.setPage(book, 600); assert.strictEqual(book.status, "read"); assert.ok(book.finished);
  B.setStatus(book, "reading"); assert.strictEqual(book.reads.length, 1, "reread keeps history"); assert.strictEqual(book.currentPage, 0);
  lib.save();
  assert.strictEqual(new B.Library({ load: () => file, save: () => {} }).books.length, 1, "saved and loaded");

  // imports: BookCheck backup, Goodreads, StoryGraph; merge keeps your data
  const bc = JSON.stringify({ app: "BookCheck", version: 1, exported: 1, books: [
    { id: 1, title: "Dune", authors: "Frank Herbert", status: "READ", rating: 5, pages: 600, finished: Date.parse("2025-03-01"), started: Date.parse("2025-02-01"), isbn13: "9780441013593", priceHistory: [{ t: 1, src: "IBS", p: 12.5 }], lowestPrice: 12.5, targetPrice: 9 },
    { id: 2, title: "Dune Messiah", authors: "Frank Herbert", status: "WANT", series: "Dune", seriesNum: 2 }] });
  const imp = B.readImport(bc);
  assert.strictEqual(imp.kind, "BookCheck backup");
  assert.strictEqual(imp.books[0].rating, 10); assert.deepStrictEqual(imp.books[0].authors, ["Frank Herbert"]);
  assert.deepStrictEqual(B.applyImport(lib, imp), { added: 2, updated: 0 });
  const gr = 'Book Id,Title,Author,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Exclusive Shelf,My Review\n1,"Dune (Dune, #1)",Frank Herbert,,"=""0441013597""","=""9780441013593""",4,4.27,Ace,Paperback,604,2005,1965,2025/03/01,2024/12/01,"sci-fi, read",read,Great\n2,Project Hail Mary,Andy Weir,,"=""""","=""9780593135204""",0,4.5,Ballantine,Kindle Edition,476,2021,2021,,2025/01/05,to-read,to-read,\n';
  const g = B.readImport(gr, "goodreads_library_export.csv");
  assert.strictEqual(g.kind, "Goodreads export"); assert.strictEqual(g.books[0].title, "Dune"); assert.strictEqual(g.books[1].format, "Ebook");
  const r2 = B.applyImport(lib, g);
  assert.deepStrictEqual(r2, { added: 1, updated: 1 }, JSON.stringify(r2)); // Dune already there (by ISBN): only empty fields filled
  assert.strictEqual(lib.find({ isbn13: "9780441013593" }).rating, 10, "your rating kept");
  const sg = B.readImport("Title,Authors,Contributors,ISBN/UID,Format,Read Status,Date Added,Last Date Read,Dates Read,Read Count,Moods,Pace,Character- or Plot-Driven?,Strong Character Development?,Loveable Characters?,Diverse Characters?,Flawed Characters?,Star Rating,Review,Content Warnings,Content Warning Description,Tags,Owned?\nPiranesi,Susanna Clarke,,9781526622426,digital,read,2024/05/01,2024/05/20,,1,,,,,,,,4.5,,,,fantasy,No\n");
  assert.strictEqual(sg.kind, "StoryGraph export"); assert.strictEqual(sg.books[0].rating, 9); assert.strictEqual(sg.books[0].format, "Ebook");
  assert.throws(() => B.readImport("a,b\n1,2"), /Didn't recognise/);

  // series with a gap, and Gemini completing it
  lib.add({ title: "The Hero of Ages (Mistborn, #3)", authors: ["Brandon Sanderson"] }, "want");
  const ser = B.seriesList(lib).find(s => s.name === "Mistborn");
  assert.deepStrictEqual(ser.missing.map(m => m.n), [2]);
  const missing = B.parseSeriesAnswer(lib, '```json\n[{"series":"Mistborn","n":1,"title":"The Final Empire"},{"series":"Mistborn","n":2,"title":"The Well of Ascension","title_it":"Il pozzo dell\'ascensione","year":"2007"},{"series":"Mistborn","n":3,"title":"The Hero of Ages"},{"series":"Mistborn","n":4,"title":"The Alloy of Law"}]\n```', [ser]);
  assert.deepStrictEqual(missing.map(m => m.n), [2, 4]);
  assert.strictEqual(missing[0].title, "Il pozzo dell'ascensione");
  assert.deepStrictEqual(B.seriesList(lib).find(s => s.name === "Mistborn").missing.map(m => m.n + ":" + m.title), ["2:The Well of Ascension", "4:The Alloy of Law"]);

  // stats and goal pace
  lib.goal = { year: 2025, n: 12 };
  const st = B.stats(lib, 2025, Date.parse("2025-07-01"));
  assert.strictEqual(st.readYear, 1); assert.strictEqual(st.months[2], 1); assert.ok(st.pace && st.pace.ahead < 0 && !st.pace.reached);
  assert.strictEqual(st.topAuthors[0][0], "Frank Herbert");

  // price check: drop and target notifications, history kept
  const want = lib.find({ title: "Dune Messiah", authors: ["Frank Herbert"] });
  Object.assign(want, { gid: "g1", gbPrice: 9.99, targetPrice: 6 });
  let price = 5.49;
  const http = async (m, url) => /volumes\/g1/.test(url) ? { status: 200, body: JSON.stringify({ id: "g1", saleInfo: { saleability: "FOR_SALE", retailPrice: { amount: price, currencyCode: "EUR" }, listPrice: { amount: 9.99, currencyCode: "EUR" }, buyLink: "https://play.google.com/x" } }) } : { status: 404, body: "" };
  const notes = await B.priceCheck(lib, http, { minAgeMs: 0 });
  assert.strictEqual(notes.length, 1); assert.ok(/Target price: Dune Messiah/.test(notes[0].title) && /€5,49/.test(notes[0].text), notes[0].text);
  assert.strictEqual(want.lowestPrice, 5.49); assert.strictEqual(want.priceHistory.length, 1);
  assert.deepStrictEqual(await B.priceCheck(lib, http, { minAgeMs: 0 }), [], "same price: no repeat");

  // search: Google Books + Open Library merged
  const sh = async (m, url) => {
    if (/googleapis/.test(url)) return { status: 200, body: JSON.stringify({ items: [{ id: "abc", volumeInfo: { title: "Piranesi", authors: ["Susanna Clarke"], industryIdentifiers: [{ type: "ISBN_13", identifier: "9781526622426" }], imageLinks: { thumbnail: "http://books.google.com/x&edge=curl" } }, saleInfo: { saleability: "FOR_SALE", retailPrice: { amount: 7.99, currencyCode: "EUR" } } }] }) };
    return { status: 200, body: JSON.stringify({ docs: [{ key: "/works/OL1W", title: "Piranesi", author_name: ["Susanna Clarke"], isbn: ["9781526622426"], number_of_pages_median: 272, ratings_average: 4.2, ratings_count: 900 }, { key: "/works/OL2W", title: "Jonathan Strange & Mr Norrell", author_name: ["Susanna Clarke"] }] }) };
  };
  const res = await B.search(sh, "susanna clarke");
  assert.strictEqual(res.length, 2); assert.strictEqual(res[0].pages, 272); assert.strictEqual(res[0].gbPrice, 7.99); assert.ok(/^https:/.test(res[0].cover) && !/edge/.test(res[0].cover));
  // Gemini suggestions skip what you have
  assert.deepStrictEqual(B.suggestionBooks(lib, B.parseJson('[{"title":"Dune","author":"Frank Herbert"},{"title":"Children of Time","author":"Adrian Tchaikovsky","why":"Big ideas"}]')).map(b => b.title), ["Children of Time"]);
  const idx = B.indexFor(lib);
  assert.ok(idx.books.length >= 4 && Array.isArray(idx.reading));
  console.log("BOOKS TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
