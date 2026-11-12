// Books screen end to end: empty start, search and add, progress, rating, goal, BookCheck import, series with Gemini,
// price check and alert, scanner fallback, the index the Canon tab reads, and screen sizes.
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const OUT = process.argv[2] || "/tmp/shots";
const srv = http.createServer((q, r) => { const f = path.join(__dirname, decodeURIComponent(q.url.split("?")[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" }[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r); }).listen(0);
const BC = JSON.stringify({ app: "BookCheck", version: 1, exported: Date.now(), books: [
  { id: 1, title: "The Final Empire", authors: "Brandon Sanderson", status: "READ", rating: 5, pages: 541, series: "Mistborn", seriesNum: 1, finished: Date.parse("2026-02-10"), started: Date.parse("2026-01-20"), isbn13: "9780765311788" },
  { id: 2, title: "The Hero of Ages", authors: "Brandon Sanderson", status: "WANT", series: "Mistborn", seriesNum: 3, gid: "hero", targetPrice: 5 },
  { id: 3, title: "Piranesi", authors: "Susanna Clarke", status: "READING", pages: 272, currentPage: 100, isbn13: "9781526622426" }] });
const mock = (BC) => {
  const files = {}, results = {}, LS = localStorage;
  window.__log = [];
  window.__price = 7.99;
  if (!localStorage.getItem("f:features.json")) localStorage.setItem("f:features.json", "{\"gemini\":1}");
  window.Banta = { app: () => "books", read: n => LS.getItem("f:" + n) || "", write: (n, t) => { LS.setItem("f:" + n, String(t)); return true; }, remove: n => { LS.removeItem("f:" + n); return true; },
    stamp: n => (LS.getItem("f:" + n) || "").length + "", post: () => {}, take: () => "", busy: () => {}, paste: () => "", shareTo: () => true, notify: () => {}, widget: () => {} };
  const reply = url => {
    if (/googleapis.*volumes\/hero/.test(url)) return { status: 200, body: JSON.stringify({ id: "hero", saleInfo: { saleability: "FOR_SALE", retailPrice: { amount: window.__price, currencyCode: "EUR" }, listPrice: { amount: 9.99, currencyCode: "EUR" }, buyLink: "https://play.google.com/hero" } }) };
    if (/googleapis.*volumes\?q=/.test(url)) return { status: 200, body: JSON.stringify({ items: [{ id: "dune1", volumeInfo: { title: "Dune", authors: ["Frank Herbert"], pageCount: 604, publishedDate: "1965", industryIdentifiers: [{ type: "ISBN_13", identifier: "9780441013593" }] }, saleInfo: { saleability: "FOR_SALE", retailPrice: { amount: 6.99, currencyCode: "EUR" } } }] }) };
    if (/openlibrary/.test(url)) return { status: 200, body: JSON.stringify({ docs: [{ key: "/works/OL1W", title: "Dune", author_name: ["Frank Herbert"], isbn: ["9780441013593"], ratings_average: 4.3, ratings_count: 5000 }] }) };
    return { status: 404, body: "" };
  };
  window.Android = { load: n => files[n] || "", save: (n, t) => { files[n] = t; return true; }, take: id => { const r = results[id]; delete results[id]; return r || ""; },
    http: (id, m, url) => { window.__log.push("HTTP " + url); setTimeout(() => { results[id] = JSON.stringify(reply(url)); window.__httpDone(id); }, 5); },
    pick: id => setTimeout(() => { results[id] = JSON.stringify([{ name: "bookcheck-backup.json", text: BC }]); window.__pickDone(id); }, 5),
    saveAs: (id, name, text) => setTimeout(() => { window.__saved = { name, text }; results[id] = "true"; window.__saveDone(id); }, 5),
    notify: (id, t, x, tab) => window.__log.push(`NOTIFY ${t} | ${x} | ${tab}`), openUrl: u => window.__log.push("OPEN " + u), openApp: a => window.__log.push("APP " + a), copy: () => {} };
  window.__files = files;
  if (!window.Banta) window.__bantaMem = { "features.json": "{\"gemini\":1}" };
};
const ok = (c, m) => { if (!c) throw new Error(m); };
(async () => {
  const b = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"] }) // no outside network: the same result on any machine;
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(mock, BC);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(String(e)));
  await p.goto(`http://127.0.0.1:${srv.address().port}/books/index.html`);
  await p.waitForFunction(() => window.__books);
  ok(/Start your library/.test(await p.textContent("#view")), "empty start");
  ok(await p.$('#bswitch a[data-app="books"].on'), "strip shows Books");
  await p.screenshot({ path: `${OUT}/books-empty.png` });

  // search and add
  await p.click('[data-action="tab"][data-tab="find"]');
  await p.fill('[data-input="findq"]', "dune");
  await p.click('[data-action="search"]');
  await p.waitForSelector('[data-action="result"]');
  ok(/€6,99 ebook/.test(await p.textContent("#view")) && /★ 4\.3/.test(await p.textContent("#view")), "results show price and Open Library rating");
  await p.click('[data-action="result"]');
  await p.click('[data-action="addas"][data-v="reading"]');
  await p.waitForSelector(".sheet .seg2");
  await p.fill('[data-page="1"]', "302"); await p.press('[data-page="1"]', "Tab");
  ok(/Page 302 of 604 · 50%/.test(await p.textContent(".sheet")), "progress");
  await p.click('[data-action="status"][data-v="read"]');
  await p.click('[data-action="rate"][data-v="4"]');
  await p.click('[data-action="rate"][data-v="4"]'); // second tap: half star
  const dune = await p.evaluate(() => window.__books.lib.books.find(x => x.title === "Dune"));
  ok(dune.status === "read" && dune.rating === 7 && dune.finished && dune.isbn13 === "9780441013593", "read and rated: " + JSON.stringify({ s: dune.status, r: dune.rating }));
  await p.screenshot({ path: `${OUT}/books-sheet.png`, fullPage: true });
  await p.evaluate(() => { document.querySelector("#overlay").innerHTML = ""; });

  // import a BookCheck backup (merge)
  await p.click('[data-action="tab"][data-tab="more"]');
  await p.click('[data-action="import"]');
  await p.waitForSelector('[data-action="importgo"][data-v="merge"]');
  ok(/BookCheck backup/.test(await p.textContent(".sheet")), "BookCheck backup recognised");
  await p.click('[data-action="importgo"][data-v="merge"]');
  ok((await p.evaluate(() => window.__books.lib.books.length)) === 4, "4 books after import");
  await p.click('[data-action="tab"][data-tab="library"]');
  const lib = await p.textContent("#view");
  ok(/Reading now/.test(lib) && /Piranesi/.test(lib), "Reading now shows Piranesi");
  await p.click('.rcard [data-action="page"][data-d="25"]');
  ok((await p.evaluate(() => window.__books.lib.books.find(x => x.title === "Piranesi").currentPage)) === 125, "+25 pages");
  await p.screenshot({ path: `${OUT}/books-library.png`, fullPage: true });

  // goal and stats
  await p.click('[data-action="tab"][data-tab="stats"]');
  await p.click('[data-action="goal"]');
  await p.fill("#goaln", "20");
  await p.click('[data-action="goalsave"]');
  ok(/of 20/.test(await p.textContent("#view")), "goal shown");
  await p.screenshot({ path: `${OUT}/books-stats.png`, fullPage: true });

  // series: gap at #2, Gemini app fills it in
  await p.click('[data-action="tab"][data-tab="series"]');
  ok(/Mistborn/.test(await p.textContent("#view")), "series listed");
  await p.click('[data-action="gemseries"]');
  await p.waitForSelector(".bai-sheet .bai-in");
  await p.fill(".bai-in", '```json\n[{"series":"Mistborn","n":1,"title":"The Final Empire"},{"series":"Mistborn","n":2,"title":"The Well of Ascension","title_it":"Il pozzo dell\'ascensione","year":"2007"},{"series":"Mistborn","n":3,"title":"The Hero of Ages"}]\n```');
  await p.click('.bai-sheet [data-a="ok"]');
  await p.waitForSelector(".bai-sheet .bai-list");
  await p.click(".bai-item");
  await p.click('.bai-sheet [data-a="ok"]');
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => !!window.__books.lib.books.find(x => x.title === "Il pozzo dell'ascensione" && x.seriesNum === 2 && x.status === "want")), "missing series book added");
  await p.screenshot({ path: `${OUT}/books-series.png`, fullPage: true });

  // prices: Hero of Ages has a €5 target; it drops to €4.99
  await p.click('[data-action="tab"][data-tab="more"]');
  await p.evaluate(() => { window.__price = 4.99; });
  await p.click('[data-action="prices"]');
  await p.waitForFunction(() => window.__log.some(l => /^NOTIFY/.test(l)), null, { timeout: 5000 });
  ok((await p.evaluate(() => window.__log.filter(l => /^NOTIFY/.test(l)))).some(l => /Target price: The Hero of Ages \| Ebook €4,99/.test(l) && / books$/.test(l)), "price alert sent");

  // index for Canon and backup snapshot
  await p.waitForTimeout(500);
  const idx = await p.evaluate(() => JSON.parse(localStorage.getItem("f:index_books.json")));
  ok(idx.books.length === 5 && idx.reading.some(r => r.t === "Piranesi") && idx.goal.n === 20, "index for Canon: " + JSON.stringify(idx.goal));
  ok((await p.evaluate(() => JSON.parse(localStorage.getItem("f:snap_books.json")).books.length)) === 5, "snapshot for backups");

  // scanner: no camera here, so the ISBN box takes over
  await p.click('.topbar [data-action="scan"]');
  await p.waitForSelector("#isbnin");
  await p.waitForTimeout(300);
  ok(/camera isn't available|Point at the barcode/.test(await p.textContent("#scanmsg")), "scanner message");
  await p.fill("#isbnin", "978-0-441-01359-3");
  await p.click('[data-action="isbngo"]');
  await p.waitForTimeout(300);
  ok(/Dune/.test(await p.textContent(".sheet")), "ISBN opens the book already in the library");
  ok((await p.evaluate(() => window.__back())) === true && !(await p.$(".sheet")), "back closes the sheet");

  // fold widths
  for (const [w, h] of [[344, 882], [884, 1104], [915, 412]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.evaluate(() => { window.__books.ui.tab = "library"; window.__books.render(); });
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 1, `overflow at ${w}: ${over}`);
    await p.screenshot({ path: `${OUT}/books-${w}.png` });
  }
  ok(!errors.length, "page errors: " + errors.join("\n"));
  console.log("BOOKS UI TESTS PASSED");
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
