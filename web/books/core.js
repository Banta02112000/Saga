/* Books tab logic (no DOM): the library, Google Books / Open Library lookups, series, stats and reading goal,
   ebook prices and alerts, imports (BookCheck backup, Goodreads, StoryGraph), Gemini prompts, and the EAN-13
   barcode decoder used by the scanner. Runs in the Books screen, in the background check and in node tests. */
(function (root) {
  "use strict";
  const DAY = 864e5;
  const GB = "https://www.googleapis.com/books/v1/volumes";
  const OL = "https://openlibrary.org";
  const UA = { "User-Agent": "Saga/0.6.9 (+https://github.com/Banta02112000/Saga)", Accept: "application/json" };
  const STATUSES = ["reading", "paused", "want", "read", "dnf"];
  const STATUS_LABEL = { reading: "Reading", paused: "Paused", want: "Want to read", read: "Read", dnf: "Did not finish" };
  const FORMATS = ["Paper", "Ebook", "Audio"];

  // ------------------------------------------------------------------ text helpers
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  const clean = s => String(s == null ? "" : s).trim();
  const isoDay = t => (t ? new Date(t).toISOString().slice(0, 10) : "");
  const listOf = v => (Array.isArray(v) ? v : String(v || "").split(/\s*[,;]\s*/)).map(clean).filter(Boolean);

  function isbnDigits(s) { return String(s || "").replace(/[\s-]/g, "").toUpperCase(); }
  function validIsbn13(s) {
    s = isbnDigits(s);
    if (!/^\d{13}$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += +s[i] * (i % 2 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === +s[12];
  }
  function validIsbn10(s) {
    s = isbnDigits(s);
    if (!/^\d{9}[\dX]$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : +s[i]) * (10 - i);
    return sum % 11 === 0;
  }
  function isbn10to13(s) {
    s = isbnDigits(s);
    if (!validIsbn10(s)) return null;
    const core = "978" + s.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += +core[i] * (i % 2 ? 3 : 1);
    return core + ((10 - (sum % 10)) % 10);
  }
  const bookIsbn = b => b.isbn13 || isbn10to13(b.isbn10) || b.isbn10 || "";

  // "Mistborn #2", "Il nome della rosa (Vol. 1)", "Dune (Dune Chronicles, #1)"
  function parseSeries(title) {
    const t = clean(title);
    let m = t.match(/\(([^()]+?),?\s*#(\d+(?:\.\d+)?)\)\s*$/);
    if (m) return { title: t.slice(0, m.index).trim(), series: m[1].trim(), num: parseFloat(m[2]) };
    m = t.match(/^(.*?)\s*[,(;:]?\s*(?:#|vol\.?|volume|book|libro|tomo|n\.)\s*(\d+(?:\.\d+)?)\)?\s*$/i);
    if (m && m[1].length > 1) return { title: t, series: m[1].replace(/[\s,;:(\-]+$/, ""), num: parseFloat(m[2]) };
    return null;
  }

  // ------------------------------------------------------------------ store
  function newId() { return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function blankBook(o) {
    return Object.assign({ id: newId(), gid: "", olKey: "", isbn13: "", isbn10: "", title: "", subtitle: "", authors: [], publisher: "", published: "",
      description: "", categories: [], cover: "", language: "", format: "Paper", series: "", seriesNum: null, pages: 0, currentPage: 0,
      status: "want", rating: 0, avgRating: 0, ratingsCount: 0, ratingSource: "", added: Date.now(), started: 0, finished: 0, notes: "",
      shelves: [], location: "", reads: [], log: [], gbPrice: null, gbListPrice: null, gbCurrency: "", gbBuyLink: "", lowestPrice: null,
      lowestSource: "", targetPrice: null, pricePaid: null, priceChecked: 0, priceHistory: [] }, o || {});
  }

  class Library {
    constructor(persist) {
      this.persist = persist || null;
      this.books = [];
      this.goal = { year: new Date().getFullYear(), n: 0, pages: 0 };
      this.settings = { region: "IT", alerts: 1, dropPct: 10 };
      this.ver = 0;
      if (persist) { try { const raw = persist.load(); if (raw) this.fromJSON(JSON.parse(raw)); } catch (e) { /* unreadable file: start empty */ } }
    }
    fromJSON(j) {
      this.books = (j.books || []).map(b => blankBook(b));
      if (j.goal) this.goal = Object.assign(this.goal, j.goal);
      if (j.settings) this.settings = Object.assign(this.settings, j.settings);
    }
    toJSON() { return { app: "books", v: 1, books: this.books, goal: this.goal, settings: this.settings }; }
    save() { this.ver++; if (this.persist) { if (this.persist.saveLazy) this.persist.saveLazy(); else this.persist.save(JSON.stringify(this.toJSON())); } }
    get(id) { return this.books.find(b => b.id === id) || null; }
    // Same book already in the library: by ISBN, Google/Open Library id, or title + first author.
    find(b) {
      const i13 = bookIsbn(b), t = norm(b.title), a = norm((b.authors || [])[0]);
      return this.books.find(x => (i13 && bookIsbn(x) === i13) || (b.gid && x.gid === b.gid) || (b.olKey && x.olKey === b.olKey)
        || (t && norm(x.title) === t && (!a || !x.authors.length || norm(x.authors[0]) === a))) || null;
    }
    add(b, status) {
      const have = this.find(b);
      if (have) return { book: have, existed: true };
      const nb = blankBook(Object.assign({}, b, { id: newId(), added: Date.now() }));
      if (!nb.series) { const p = parseSeries(nb.title); if (p) { nb.series = p.series; nb.seriesNum = p.num; } }
      setStatus(nb, status || nb.status || "want");
      this.books.unshift(nb);
      this.save();
      return { book: nb, existed: false };
    }
    remove(id) { this.books = this.books.filter(b => b.id !== id); this.save(); }
  }

  // Status changes keep dates and the reread history consistent.
  function setStatus(b, st, now = Date.now()) {
    const prev = b.status;
    b.status = st;
    if (st === "reading" && !b.started) b.started = now;
    if (st === "reading" && prev === "read") { // reread
      b.reads = (b.reads || []).concat([{ started: b.started, finished: b.finished }]);
      b.started = now; b.finished = 0; b.currentPage = 0;
    }
    if (st === "read") { if (!b.finished) b.finished = now; if (!b.started) b.started = b.finished; if (b.pages) b.currentPage = b.pages; }
    if (st === "want") { b.started = 0; b.finished = 0; b.currentPage = 0; }
    if (st === "dnf" && !b.finished) b.finished = now;
    return b;
  }
  function setPage(b, page, now = Date.now()) {
    page = Math.max(0, Math.round(+page || 0));
    if (b.pages) page = Math.min(page, b.pages);
    if (b.status === "want") setStatus(b, "reading", now);
    if (page !== b.currentPage) b.log = (b.log || []).concat([{ t: now, p: page }]).slice(-400);
    b.currentPage = page;
    if (b.pages && page >= b.pages && b.status === "reading") setStatus(b, "read", now);
    return b;
  }
  const percent = b => (b.status === "read" ? 100 : b.manga && b.chapters ? Math.min(100, Math.round((b.chapter || 0) / b.chapters * 100)) : b.pages ? Math.min(100, Math.round((b.currentPage || 0) / b.pages * 100)) : 0);
  // manga: marked as such, a manga category or format, or one of the Italian manga publishers
  const MANGA_PUB = /star comics|j-?pop|planet manga|dynit|gp manga|goen|flashbook|edizioni bd|hikari|magic press|kodansha|shueisha|shogakukan|viz media|yen press|seven seas|kana|glénat manga|pika/i;
  const isManga = b => !!(b.manga || /manga|manhwa|manhua/i.test([b.format, ...(b.categories || [])].join(" ")) || MANGA_PUB.test(b.publisher || ""));
  function fromJikanManga(d) {
    const name = a => String(a || "").includes(",") ? a.split(/\s*,\s*/).reverse().join(" ") : a;
    return blankBook({ title: d.title_english || d.title, subtitle: d.title_english && d.title !== d.title_english ? d.title : "", authors: (d.authors || []).map(a => name(a.name)), manga: true, mal: d.mal_id,
      chapters: d.chapters || 0, volumes: d.volumes || 0, cover: ((d.images || {}).jpg || {}).large_image_url || "", description: d.synopsis || "", categories: ["Manga"].concat((d.genres || []).map(g => g.name)),
      published: String(((d.published || {}).from) || "").slice(0, 10), format: "Manga", ongoing: /publishing/i.test(d.status || "") });
  }
  async function searchManga(http, q) {
    const r = await http("GET", `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(String(q).trim())}&limit=24&sfw=true`, { headers: { Accept: "application/json" } });
    if (r.status !== 200) throw new Error(`MyAnimeList: HTTP ${r.status || r.error || "error"}`);
    return ((JSON.parse(r.body || "{}").data) || []).map(fromJikanManga);
  }
  function setChapter(b, ch, vol, now = Date.now()) {
    const c = Math.max(0, parseInt(ch, 10) || 0);
    if (c !== (b.chapter || 0)) b.log = (b.log || []).concat([{ t: now, c }]).slice(-400); // 0.5.8: chapters read show in the Diary
    b.chapter = c;
    if (vol != null && vol !== "") b.volume = Math.max(0, parseInt(vol, 10) || 0);
    if (b.chapter && b.status === "want") { b.status = "reading"; if (!b.started) b.started = Date.now(); }
    if (b.chapters && b.chapter >= b.chapters && !b.ongoing && b.status !== "read") setStatus(b, "read");
    return b;
  }

  // ------------------------------------------------------------------ lookups
  function fromGoogle(v) {
    const i = v.volumeInfo || {}, s = v.saleInfo || {};
    const ids = {};
    for (const x of i.industryIdentifiers || []) ids[x.type] = x.identifier;
    const img = (i.imageLinks || {});
    const b = { gid: v.id || "", title: clean(i.title), subtitle: clean(i.subtitle), authors: listOf(i.authors), publisher: clean(i.publisher),
      published: clean(i.publishedDate), description: clean(i.description).replace(/<[^>]+>/g, ""), categories: listOf(i.categories),
      cover: String(img.thumbnail || img.smallThumbnail || "").replace(/^http:/, "https:").replace(/&edge=curl/, ""), language: clean(i.language),
      pages: +i.pageCount || 0, isbn13: ids.ISBN_13 || "", isbn10: ids.ISBN_10 || "", avgRating: +i.averageRating || 0, ratingsCount: +i.ratingsCount || 0,
      ratingSource: i.averageRating ? "Google Books" : "" };
    const p = priceFrom(s);
    if (p) Object.assign(b, p);
    const ps = parseSeries(b.title);
    if (ps) { b.series = ps.series; b.seriesNum = ps.num; }
    return b;
  }
  function priceFrom(s) {
    if (!s || s.saleability !== "FOR_SALE" && s.saleability !== "FREE") return null;
    const r = s.retailPrice || {}, l = s.listPrice || {};
    if (s.saleability === "FREE") return { gbPrice: 0, gbListPrice: 0, gbCurrency: "EUR", gbBuyLink: s.buyLink || "" };
    return { gbPrice: r.amount != null ? +r.amount : null, gbListPrice: l.amount != null ? +l.amount : null, gbCurrency: r.currencyCode || l.currencyCode || "", gbBuyLink: s.buyLink || "" };
  }
  function fromOpenLibrary(d) {
    const b = { olKey: d.key || "", title: clean(d.title), subtitle: clean(d.subtitle), authors: listOf(d.author_name), publisher: listOf(d.publisher)[0] || "",
      published: d.first_publish_year ? String(d.first_publish_year) : "", categories: listOf((d.subject || []).slice(0, 4)), language: listOf(d.language)[0] || "",
      pages: +d.number_of_pages_median || 0, cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : "",
      avgRating: +d.ratings_average || 0, ratingsCount: +d.ratings_count || 0, ratingSource: d.ratings_average ? "Open Library" : "" };
    const isbns = d.isbn || [];
    b.isbn13 = isbns.find(x => /^97[89]\d{10}$/.test(x)) || "";
    b.isbn10 = isbns.find(x => /^\d{9}[\dX]$/.test(x)) || "";
    return b;
  }

  async function getJson(http, url) {
    const r = await http("GET", url, { headers: UA });
    if (r.status !== 200) throw new Error(`HTTP ${r.status || "error"}${r.error ? ": " + r.error : ""}`);
    try { return JSON.parse(r.body); } catch (e) { throw new Error("Unexpected answer from " + url.split("/")[2]); }
  }

  // Google Books first (Italian catalogue and prices), Open Library fills in what's missing. Duplicates merged.
  async function search(http, q, region = "IT") {
    q = clean(q);
    if (!q) return [];
    const isbn = isbnDigits(q);
    const byIsbn = validIsbn13(isbn) || validIsbn10(isbn);
    const out = [], errors = [];
    try {
      const j = await getJson(http, `${GB}?q=${encodeURIComponent(byIsbn ? "isbn:" + isbn : q)}&maxResults=30&printType=books&country=${region}`);
      for (const v of j.items || []) out.push(fromGoogle(v));
    } catch (e) { errors.push("Google Books: " + e.message); }
    try {
      const j = await getJson(http, `${OL}/search.json?${byIsbn ? "isbn=" + isbn : "q=" + encodeURIComponent(q)}&limit=25&fields=key,title,subtitle,author_name,first_publish_year,isbn,number_of_pages_median,cover_i,subject,ratings_average,ratings_count,publisher,language`);
      for (const d of j.docs || []) {
        const b = fromOpenLibrary(d);
        const dup = out.find(x => (b.isbn13 && x.isbn13 === b.isbn13) || (norm(x.title) === norm(b.title) && norm(x.authors[0]) === norm(b.authors[0])));
        if (dup) { // fill gaps from Open Library
          for (const k of ["olKey", "pages", "cover", "published"]) if (!dup[k] && b[k]) dup[k] = b[k];
          if (!dup.avgRating && b.avgRating) Object.assign(dup, { avgRating: b.avgRating, ratingsCount: b.ratingsCount, ratingSource: b.ratingSource });
        } else out.push(b);
      }
    } catch (e) { errors.push("Open Library: " + e.message); }
    if (!out.length && errors.length === 2) throw new Error(errors.join(" · "));
    if (byIsbn) for (const b of out) if (!b.isbn13 && !b.isbn10) b.isbn13 = isbn.length === 13 ? isbn : isbn10to13(isbn) || "";
    return out;
  }

  // Current Google Play Books price (ebook) for one book. Returns {price, list, currency, link} or null.
  async function ebookPrice(http, b, region = "IT") {
    let v = null;
    if (b.gid) { try { v = await getJson(http, `${GB}/${encodeURIComponent(b.gid)}?country=${region}`); } catch (e) { v = null; } }
    if (!v && bookIsbn(b)) { try { const j = await getJson(http, `${GB}?q=isbn:${bookIsbn(b)}&country=${region}`); v = (j.items || [])[0] || null; } catch (e) { v = null; } }
    if (!v) return null;
    if (!b.gid && v.id) b.gid = v.id;
    const p = priceFrom(v.saleInfo);
    return p ? { price: p.gbPrice, list: p.gbListPrice, currency: p.gbCurrency, link: p.gbBuyLink } : { price: null };
  }

  function logPrice(b, src, p, t = Date.now()) {
    p = Math.round(+p * 100) / 100;
    if (!(p >= 0)) return b;
    b.priceHistory = (b.priceHistory || []).concat([{ t, src, p }]).slice(-60);
    if (b.lowestPrice == null || p < b.lowestPrice) { b.lowestPrice = p; b.lowestSource = src; }
    return b;
  }

  // Checks ebook prices for wanted books (oldest check first). Returns notifications for drops and targets reached.
  async function priceCheck(lib, http, opts = {}) {
    const budget = opts.budget || 40, now = opts.now || Date.now(), minAge = opts.minAgeMs == null ? 10 * 3600e3 : opts.minAgeMs;
    const want = lib.books.filter(b => b.status === "want" && (b.gid || bookIsbn(b)) && now - (b.priceChecked || 0) > minAge)
      .sort((a, b) => (a.priceChecked || 0) - (b.priceChecked || 0)).slice(0, budget);
    const notes = [];
    for (const b of want) {
      const before = b.gbPrice;
      let r = null;
      try { r = await ebookPrice(http, b, lib.settings.region || "IT"); } catch (e) { r = null; }
      b.priceChecked = now;
      if (!r || r.price == null) continue;
      Object.assign(b, { gbPrice: r.price, gbListPrice: r.list, gbCurrency: r.currency || "EUR", gbBuyLink: r.link || b.gbBuyLink });
      if (before == null || r.price !== before) logPrice(b, "Google Play Books", r.price, now);
      const hitTarget = b.targetPrice != null && r.price <= b.targetPrice && !(before != null && before <= b.targetPrice);
      const drop = before != null && r.price < before && (before - r.price) / before * 100 >= (lib.settings.dropPct || 10);
      if (hitTarget || drop) notes.push({ id: hashId("bp" + b.id + r.price), title: `${hitTarget ? "Target price" : "Price drop"}: ${b.title}`,
        text: `Ebook ${eur(r.price)} on Google Play Books${before != null ? ` (was ${eur(before)})` : ""}${hitTarget ? ` · your target ${eur(b.targetPrice)}` : ""}.`, tab: "books" });
    }
    if (want.length) lib.save();
    return notes.length > 4 ? [{ id: hashId("bpm" + notes.map(n => n.id).join()), title: `${notes.length} ebook price drops`, text: notes.map(n => n.title.replace(/^[^:]+: /, "")).slice(0, 6).join(", ") + ".", tab: "books" }] : notes;
  }
  const eur = p => (p == null ? "–" : "€" + (+p).toFixed(2).replace(".", ","));
  function hashId(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 2000000000; }

  // Stores without a price API: opened as searches by ISBN (or title).
  function storeLinks(b) {
    const q = encodeURIComponent(bookIsbn(b) || `${b.title} ${(b.authors || [])[0] || ""}`.trim());
    return [["Amazon.it", `https://www.amazon.it/s?k=${q}&i=stripbooks`], ["IBS", `https://www.ibs.it/search/?ts=as&query=${q}`],
      ["laFeltrinelli", `https://www.lafeltrinelli.it/search/?query=${q}`], ["Kobo", `https://www.kobo.com/it/it/search?query=${q}`],
      ["Libraccio (new & used)", `https://www.libraccio.it/src/?xy=${q}`], ["AbeBooks (used)", `https://www.abebooks.it/servlet/SearchResults?kn=${q}`],
      ["eBay (used)", `https://www.ebay.it/sch/i.html?_nkw=${q}`], ["Vinted (used)", `https://www.vinted.it/catalog?search_text=${q}`],
      ["Compare (Google Shopping)", `https://www.google.com/search?tbm=shop&q=${q}`]];
  }

  // ------------------------------------------------------------------ series
  function seriesList(lib) {
    const by = new Map();
    for (const b of lib.books) {
      if (!b.series) continue;
      const k = norm(b.series);
      if (!by.has(k)) by.set(k, { name: b.series, books: [], planned: [] });
      by.get(k).books.push(b);
    }
    const known = lib.settings.seriesKnown || {};
    const out = [];
    for (const [k, s] of by) {
      s.books.sort((a, b) => (a.seriesNum || 999) - (b.seriesNum || 999));
      const nums = s.books.map(b => b.seriesNum).filter(n => n != null && Math.floor(n) === n);
      const max = Math.max(0, ...nums, ...(known[k] || []).map(x => x.n || 0));
      s.missing = [];
      for (let n = 1; n <= max; n++) if (!nums.includes(n)) { const kn = (known[k] || []).find(x => x.n === n); s.missing.push({ n, title: kn ? kn.title : "" }); }
      s.read = s.books.filter(b => b.status === "read").length;
      s.total = Math.max(s.books.length + s.missing.length, max);
      const next = s.books.find(b => b.status !== "read" && b.status !== "dnf");
      s.next = next || null;
      s.nextMissing = !next && s.missing.length ? s.missing[0] : null;
      out.push(s);
    }
    return out.sort((a, b) => (b.books.some(x => x.status === "reading") - a.books.some(x => x.status === "reading")) || (b.read / b.total) - (a.read / a.total) || a.name.localeCompare(b.name));
  }

  // ------------------------------------------------------------------ stats and goal
  function stats(lib, year = new Date().getFullYear(), now = Date.now()) {
    const read = lib.books.filter(b => b.status === "read" && b.finished);
    const inYear = read.filter(b => new Date(b.finished).getFullYear() === year);
    const months = Array(12).fill(0), monthPages = Array(12).fill(0);
    for (const b of inYear) { const m = new Date(b.finished).getMonth(); months[m]++; monthPages[m] += b.pages || 0; }
    const years = {};
    for (const b of read) { const y = new Date(b.finished).getFullYear(); years[y] = (years[y] || 0) + 1; }
    const durations = read.filter(b => b.started && b.finished >= b.started).map(b => ({ b, days: Math.max(1, Math.round((b.finished - b.started) / DAY)) }));
    const tally = (arr, f) => { const m = {}; for (const b of arr) for (const k of f(b)) m[k] = (m[k] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6); };
    const rated = read.filter(b => b.rating);
    const pagesYear = inYear.reduce((n, b) => n + (b.pages || 0), 0);
    // pages read this year also counts progress in books still being read
    const progressPages = lib.books.filter(b => b.status === "reading").reduce((n, b) => n + logPagesIn(b, year), 0);
    const goal = lib.goal && lib.goal.year === year ? lib.goal : { n: 0 };
    const start = new Date(year, 0, 1).getTime(), end = new Date(year + 1, 0, 1).getTime();
    const frac = Math.min(1, Math.max(0, (now - start) / (end - start)));
    const daysLeft = Math.max(0, Math.ceil((end - now) / DAY));
    let pace = null;
    if (goal.n) {
      const expected = goal.n * frac, diff = inYear.length - expected, left = Math.max(0, goal.n - inYear.length);
      pace = { expected, ahead: diff, left, perWeek: daysLeft ? left / (daysLeft / 7) : left, reached: inYear.length >= goal.n, daysLeft,
               pagesPerDay: daysLeft && left ? (left * (avg(read.map(b => b.pages).filter(Boolean)) || 300)) / daysLeft : 0 };
    }
    return { year, readYear: inYear.length, pagesYear: pagesYear + progressPages, months, monthPages, years, totalRead: read.length,
      reading: lib.books.filter(b => b.status === "reading").length, want: lib.books.filter(b => b.status === "want").length,
      avgRating: rated.length ? avg(rated.map(b => b.rating)) / 2 : 0, avgPages: Math.round(avg(read.map(b => b.pages).filter(Boolean)) || 0),
      daysPerBook: durations.length ? Math.round(avg(durations.map(d => d.days))) : 0,
      fastest: durations.slice().sort((a, b) => a.days - b.days)[0] || null, longest: read.filter(b => b.pages).sort((a, b) => b.pages - a.pages)[0] || null,
      topAuthors: tally(read, b => b.authors.slice(0, 1)), topGenres: tally(read, b => b.categories.slice(0, 2)), goal: goal.n || 0, pace,
      spent: lib.books.reduce((n, b) => n + (+b.pricePaid || 0), 0) };
  }
  const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  // 0.5.9: books, manga and light novels apart and together (light novel: marked so, or a light-novel category or format)
  const isLN = b => /light ?novel/i.test([b.format, ...(b.categories || [])].join(" ")) || !!b.ln;
  const formatOf = b => (isLN(b) ? "ln" : isManga(b) ? "manga" : "book");
  function formatStats(lib, year = new Date().getFullYear()) {
    const out = {};
    for (const [k, label] of [["book", "Books"], ["manga", "Manga"], ["ln", "Light novels"], ["all", "All"]]) {
      const bs = lib.books.filter(b => k === "all" || formatOf(b) === k);
      if (!bs.length && k !== "all") continue;
      const read = bs.filter(b => b.status === "read"), rated = bs.filter(b => b.rating > 0);
      const hist = Array(10).fill(0); for (const b of rated) hist[Math.min(10, Math.max(1, Math.round(b.rating))) - 1]++;
      out[k] = { label, n: bs.length, read: read.length, reading: bs.filter(b => b.status === "reading").length, paused: bs.filter(b => b.status === "paused").length,
        want: bs.filter(b => b.status === "want").length, dnf: bs.filter(b => b.status === "dnf" || b.status === "dropped").length,
        done: bs.length ? Math.round((100 * read.length) / bs.length) : 0, pages: read.reduce((a, b) => a + (b.pages || 0), 0) + bs.filter(b => b.status === "reading").reduce((a, b) => a + (b.currentPage || 0), 0),
        chapters: bs.reduce((a, b) => a + (b.chapter || 0), 0), volumes: bs.reduce((a, b) => a + (b.volume || 0), 0),
        avg: rated.length ? Math.round(avg(rated.map(b => b.rating)) * 10) / 10 : null, rated: rated.length, hist,
        readYear: read.filter(b => b.finished && new Date(b.finished).getFullYear() === year).length };
    }
    return out;
  }
  function logPagesIn(b, year) {
    let pages = 0, prev = 0;
    for (const e of b.log || []) { if (new Date(e.t).getFullYear() === year) pages += Math.max(0, e.p - prev); prev = e.p; }
    return pages;
  }

  // ------------------------------------------------------------------ imports
  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", q = false;
    text = String(text || "").replace(/^\uFEFF/, "");
    const first = text.split("\n", 1)[0];
    const sep = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? "\t" : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
      else if (ch === '"' && field === "") q = true;
      else if (ch === sep) { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch !== "\r") field += ch;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).filter(r => r.some(x => x.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
  }
  const dateMs = s => { s = clean(s).replace(/\//g, "-"); if (!s) return 0; const t = Date.parse(s.length === 10 ? s + "T12:00:00" : s); return isNaN(t) ? 0 : t; };
  const stripIsbn = s => clean(s).replace(/^="?|"$/g, "").replace(/[^0-9X]/gi, "");

  // Recognises what a picked file is and turns it into books. → {kind, books:[], goal?}
  function readImport(text, name = "") {
    const t = String(text || "").replace(/^﻿/, "").trim();
    if (t[0] === "{") {
      let j; try { j = JSON.parse(t); } catch (e) { throw new Error("That file isn't valid JSON."); }
      if (j.app === "BookCheck" && Array.isArray(j.books)) return { kind: "BookCheck backup", books: j.books.map(fromBookCheck) };
      if (j.app === "books" && Array.isArray(j.books)) return { kind: "Books backup", books: j.books.map(b => blankBook(b)), goal: j.goal, settings: j.settings };
      if (j && !Array.isArray(j) && Object.values(j).slice(0, 3).length && Object.values(j).slice(0, 3).every(v => v && typeof v === "object" && "title" in v))
        return { kind: "LibraryThing", books: Object.values(j).map(fromLibraryThingJson) };
      if (j.app === "canonsync-all" && j.books) { const inner = typeof j.books === "string" ? JSON.parse(j.books) : j.books; return { kind: "CanonSync backup (books)", books: (inner.books || []).map(b => blankBook(b)), goal: inner.goal, settings: inner.settings }; }
      throw new Error("That JSON isn't a BookCheck or Books backup.");
    }
    const rows = parseCsv(t);
    if (!rows.length) throw new Error("That file is empty.");
    const cols = Object.keys(rows[0]);
    if (cols.includes("Exclusive Shelf") || cols.includes("My Rating") && cols.includes("Bookshelves")) return { kind: "Goodreads export", books: rows.map(fromGoodreads) };
    if (cols.includes("Read Status") || cols.includes("ISBN/UID")) return { kind: "StoryGraph export", books: rows.map(fromStoryGraph) };
    const g = genericBooks(rows);
    if (g) return g;
    throw new Error(`Didn't recognise ${name || "this file"}. Supported: BookCheck or Books backups, Goodreads, StoryGraph, LibraryThing, Libib and BookWyrm exports, or any CSV with Title and Author columns.`);
  }
  function fromBookCheck(o) {
    const st = { READ: "read", READING: "reading", WANT: "want", DNF: "dnf" }[String(o.status || "WANT").toUpperCase()] || "want";
    const r = +o.rating || 0;
    return blankBook({ gid: o.gid || "", olKey: o.olKey || "", isbn13: o.isbn13 || "", isbn10: o.isbn10 || "", title: clean(o.title), subtitle: clean(o.subtitle),
      authors: listOf(o.authors), publisher: clean(o.publisher), published: clean(o.published), description: clean(o.description), categories: listOf(o.categories),
      cover: clean(o.cover), language: clean(o.language), format: o.format || "Paper", series: clean(o.series), seriesNum: o.seriesNum ? +o.seriesNum : null,
      pages: +o.pages || 0, currentPage: +o.currentPage || 0, status: st, rating: r > 5 ? Math.min(10, r) : r * 2, avgRating: +o.avgRating || 0, ratingsCount: +o.ratingsCount || 0,
      ratingSource: o.ratingSource || "", added: +o.added || Date.now(), started: +o.started || 0, finished: +o.finished || 0, notes: clean(o.notes),
      gbPrice: o.gbPrice > 0 ? +o.gbPrice : null, gbListPrice: o.gbListPrice > 0 ? +o.gbListPrice : null, lowestPrice: o.lowestPrice > 0 ? +o.lowestPrice : null,
      targetPrice: o.targetPrice > 0 ? +o.targetPrice : null, pricePaid: o.pricePaid > 0 ? +o.pricePaid : null, gbCurrency: o.gbCurrency || "", gbBuyLink: o.gbBuyLink || "",
      lowestSource: o.lowestSource || "", priceChecked: +o.priceChecked || 0, priceHistory: Array.isArray(o.priceHistory) ? o.priceHistory : [] });
  }
  function fromGoodreads(r) {
    const shelf = (r["Exclusive Shelf"] || "").toLowerCase();
    const st = shelf === "read" ? "read" : shelf === "currently-reading" ? "reading" : /dnf|did-not-finish|abandon/.test(shelf) ? "dnf" : "want";
    const finished = dateMs(r["Date Read"]), added = dateMs(r["Date Added"]) || Date.now();
    const b = blankBook({ title: clean(r.Title), authors: listOf([r.Author].concat(listOf(r["Additional Authors"]))), isbn13: stripIsbn(r.ISBN13), isbn10: stripIsbn(r.ISBN),
      rating: (+r["My Rating"] || 0) * 2, pages: +r["Number of Pages"] || 0, publisher: clean(r.Publisher), published: clean(r["Original Publication Year"] || r["Year Published"]),
      avgRating: +r["Average Rating"] || 0, ratingSource: r["Average Rating"] ? "Goodreads" : "", status: st, added, finished: st === "read" ? finished || added : 0,
      started: st === "read" ? finished || added : st === "reading" ? added : 0, notes: clean(r["My Review"] || r["Private Notes"]),
      shelves: listOf(r.Bookshelves).filter(s => !["read", "currently-reading", "to-read"].includes(s)), format: /ebook|kindle/i.test(r.Binding || "") ? "Ebook" : /audio/i.test(r.Binding || "") ? "Audio" : "Paper" });
    const p = parseSeries(b.title); if (p) { b.series = p.series; b.seriesNum = p.num; b.title = p.title; }
    return b;
  }
  function fromStoryGraph(r) {
    const s = (r["Read Status"] || "").toLowerCase();
    const st = s === "read" ? "read" : s === "currently-reading" ? "reading" : s === "did-not-finish" ? "dnf" : "want";
    const finished = dateMs(r["Last Date Read"]), added = dateMs(r["Date Added"]) || Date.now();
    const isbn = stripIsbn(r["ISBN/UID"]);
    return blankBook({ title: clean(r.Title), authors: listOf(r.Authors), isbn13: isbn.length === 13 ? isbn : "", isbn10: isbn.length === 10 ? isbn : "",
      rating: Math.round((+r["Star Rating"] || 0) * 2), status: st, added, finished: st === "read" ? finished || added : 0, started: st === "read" ? finished || added : st === "reading" ? added : 0,
      format: /digital|ebook/i.test(r.Format || "") ? "Ebook" : /audio/i.test(r.Format || "") ? "Audio" : "Paper", notes: clean(r.Review), shelves: listOf(r.Tags) });
  }
  // LibraryThing (TSV or JSON), Libib, BookWyrm or any CSV with a title and an author column
  const pickCol = (cols, names) => { const k = x => String(x).toLowerCase().replace(/[^a-z0-9]/g, ""); for (const n of names) { const c = cols.find(x => k(x) === k(n)); if (c) return c; } return null; };
  function genericBooks(rows) {
    if (!rows.length) return null;
    const cols = Object.keys(rows[0]);
    const tc = pickCol(cols, ["Title", "title", "Book Title", "Titolo"]);
    const ac = pickCol(cols, ["Primary Author", "Author", "Authors", "author_text", "creators", "Autore", "Author (Last, First)"]);
    if (!tc || !ac) return null;
    const ic = pickCol(cols, ["ISBN", "ISBNs", "ean_isbn13", "isbn_13", "ISBN13", "upc_isbn10", "isbn_10"]);
    const sc = pickCol(cols, ["status", "Status", "shelf", "Shelf", "Collections", "Exclusive Shelf", "Read Status"]);
    const rc = pickCol(cols, ["Rating", "rating", "My Rating", "Stars"]);
    const fc = pickCol(cols, ["Date Read", "completed", "finish_date", "Date Finished", "Finished", "Date Ended", "shelf_date"]);
    const bc = pickCol(cols, ["Date Started", "began", "start_date", "Started"]);
    const pc = pickCol(cols, ["Page Count", "Pages", "length", "Number of Pages"]);
    const pub = pickCol(cols, ["Publication", "publisher", "Publisher"]);
    const yc = pickCol(cols, ["Date", "publish_date", "Publication Date", "Year", "Original Publication Year"]);
    const kind = cols.includes("ean_isbn13") ? "Libib export" : cols.includes("author_text") ? "BookWyrm export" : cols.includes("Primary Author") ? "LibraryThing export" : "Books CSV";
    const books = rows.filter(r => r[tc]).map(r => {
      const s = String(r[sc] || "").toLowerCase();
      const finished = dateMs(String(r[fc] || "").split(/[;,]/)[0]), started = dateMs(r[bc]);
      const st = /dnf|abandon|did not|stopped/.test(s) ? "dnf" : /to.?read|want|wish|tbr|plan/.test(s) ? "want" : /reading|progress|current/.test(s) ? "reading" : /^read$|completed|finished|\bread\b/.test(s) || finished ? "read" : "want";
      const isb = stripIsbn(String(r[ic] || "").split(/[,;\s]+/)[0]);
      let rating = parseFloat(String(r[rc] || "").replace(",", ".")) || 0;
      if (rating <= 5) rating *= 2;
      const auth = String(r[ac] || "");
      const authors = /,/.test(auth) && kind === "LibraryThing export" && !/;/.test(auth) ? [auth.split(/\s*,\s*/).reverse().join(" ")] : listOf(auth.replace(/\s*;\s*/g, ","));
      const b = blankBook({ title: clean(r[tc]), authors, isbn13: isb.length === 13 ? isb : "", isbn10: isb.length === 10 ? isb : "", status: st, rating: Math.round(Math.min(10, rating)),
        finished: st === "read" || st === "dnf" ? finished || 0 : 0, started: started || (st === "read" ? finished : 0), pages: parseInt(r[pc], 10) || 0, publisher: clean(r[pub]), published: clean(r[yc]).slice(0, 10) });
      const p = parseSeries(b.title); if (p) { b.series = p.series; b.seriesNum = p.num; }
      return b;
    });
    return books.length ? { kind, books } : null;
  }
  function fromLibraryThingJson(o) {
    const isb = stripIsbn(Array.isArray(o.isbn) ? o.isbn[0] : typeof o.isbn === "object" && o.isbn ? Object.values(o.isbn)[0] : o.isbn || "");
    const fin = dateMs(o.datefinished || o.dateread || ""), st = fin ? "read" : /currently/i.test(JSON.stringify(o.collections || "")) ? "reading" : /read but unowned|^read$/i.test(String(o.collections || "")) ? "read" : "want";
    const a = o.primaryauthor || (Array.isArray(o.authors) && o.authors[0] && (o.authors[0].fl || o.authors[0].lf)) || "";
    return blankBook({ title: clean(o.title), authors: listOf(String(a).includes(",") ? String(a).split(/\s*,\s*/).reverse().join(" ") : a), isbn13: isb.length === 13 ? isb : "", isbn10: isb.length === 10 ? isb : "",
      rating: Math.round((+o.rating || 0) * 2), status: st, finished: fin, pages: parseInt(o.pages, 10) || 0, publisher: clean(o.publication), published: clean(o.date) });
  }
  // Every work by an author: Open Library (oldest first), with Google Books filling in when it finds nothing.
  async function authorWorks(http, name, region = "IT") {
    name = clean(name);
    if (!name) return [];
    const out = [];
    try {
      const j = await getJson(http, `${OL}/search.json?author=${encodeURIComponent(name)}&sort=old&limit=100&fields=key,title,subtitle,author_name,first_publish_year,isbn,number_of_pages_median,cover_i,subject,ratings_average,ratings_count,publisher,language`);
      const seen = new Set();
      for (const d of j.docs || []) {
        if (!(d.author_name || []).some(a => norm(a) === norm(name) || norm(a).includes(norm(name)) || norm(name).includes(norm(a)))) continue;
        const b = fromOpenLibrary(d);
        const k = norm(b.title);
        if (!k || seen.has(k)) continue;
        seen.add(k); out.push(b);
      }
    } catch (e) { /* try Google Books */ }
    if (out.length < 3) {
      try {
        const j = await getJson(http, `${GB}?q=${encodeURIComponent(`inauthor:"${name}"`)}&maxResults=40&printType=books&orderBy=relevance&country=${region}`);
        for (const v of j.items || []) { const b = fromGoogle(v); if (!out.some(x => norm(x.title) === norm(b.title))) out.push(b); }
      } catch (e) { if (!out.length) throw e; }
    }
    return out.sort((a, b) => (parseInt(a.published, 10) || 9999) - (parseInt(b.published, 10) || 9999));
  }
  // Every finished read of a book, oldest first: earlier reads plus the current one. [{started, finished, current}]
  function readsOf(b) {
    const list = (b.reads || []).map(r => ({ started: r.started || 0, finished: r.finished || 0 }));
    if (b.status === "read" && b.finished) list.push({ started: b.started || 0, finished: b.finished, current: true });
    return list.sort((x, y) => (x.finished || 0) - (y.finished || 0));
  }
  function addRead(b, started, finished) {
    b.reads = (b.reads || []).concat([{ started: started || 0, finished: finished || 0 }]).sort((x, y) => (x.finished || 0) - (y.finished || 0));
    if (b.status === "want") { b.status = "read"; const last = b.reads.pop(); b.started = last.started; b.finished = last.finished; }
    return readsOf(b).length;
  }
  function removeRead(b, i) {
    const list = readsOf(b), r = list[i];
    if (!r) return;
    if (r.current) { const prev = (b.reads || []).pop(); if (prev) { b.started = prev.started; b.finished = prev.finished; } else { b.status = "want"; b.started = 0; b.finished = 0; b.currentPage = 0; } }
    else { const k = (b.reads || []).findIndex(x => (x.finished || 0) === (r.finished || 0) && (x.started || 0) === (r.started || 0)); if (k >= 0) b.reads.splice(k, 1); }
  }
  function authorsOf(lib) {
    const m = new Map();
    for (const b of lib.books) for (const a of b.authors.slice(0, 2)) { const k = norm(a); if (!k) continue; const x = m.get(k) || { name: a, n: 0, read: 0 }; x.n++; if (b.status === "read") x.read++; m.set(k, x); }
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }

  // merge: books already there keep your data and only fill empty fields; replace: the library becomes the import.
  function applyImport(lib, imp, mode = "merge") {
    let added = 0, updated = 0;
    if (mode === "replace") { lib.books = imp.books.map(b => blankBook(b)); added = lib.books.length; }
    else for (const b of imp.books) {
      const have = lib.find(b);
      if (!have) { lib.books.push(blankBook(Object.assign({}, b, { id: newId() }))); added++; continue; }
      let ch = false;
      for (const [k, v] of Object.entries(b)) {
        if (k === "id") continue;
        const cur = have[k];
        const empty = cur == null || cur === "" || cur === 0 || (Array.isArray(cur) && !cur.length);
        if (empty && v != null && v !== "" && v !== 0 && !(Array.isArray(v) && !v.length)) { have[k] = v; ch = true; }
      }
      if (b.status === "read" && have.status !== "read") { have.status = "read"; have.finished = have.finished || b.finished; ch = true; }
      if (ch) updated++;
    }
    if (imp.goal && (mode === "replace" || !lib.goal.n)) lib.goal = Object.assign(lib.goal, imp.goal);
    if (imp.settings && mode === "replace") lib.settings = Object.assign(lib.settings, imp.settings);
    lib.save();
    return { added, updated };
  }

  // ------------------------------------------------------------------ Gemini prompts (API or the Gemini app)
  const line = (b, i) => `${i + 1}. ${b.title}${b.authors[0] ? " — " + b.authors[0] : ""}${b.series ? ` [${b.series}${b.seriesNum != null ? " #" + b.seriesNum : ""}]` : ""}${b.status === "read" ? " (read" + (b.rating ? `, ${b.rating / 2}★` : "") + ")" : b.status === "reading" ? " (reading)" : ""}`;
  function seriesPrompt(series) {
    return `For each book series below, list EVERY book in the series in reading order, including books announced but not yet out (today is ${isoDay(Date.now())}).
Use the original series numbering; novellas get decimal numbers like 2.5. Use Google Search where unsure. Titles as published in English, plus the Italian title if one exists.
Reply with one \`\`\`json code block and nothing else: [{"series": "exact series name from the heading", "n": 1, "title": "...", "title_it": "... or null", "year": "YYYY", "status": "published|announced"}]

${series.map(s => `## ${s.name}\nI have: ${s.books.map(b => `#${b.seriesNum != null ? b.seriesNum : "?"} ${b.title}`).join("; ")}`).join("\n\n")}`;
  }
  function parseSeriesAnswer(lib, text, series) {
    const rows = parseJson(text);
    if (!Array.isArray(rows)) throw new Error("That answer has no JSON list in it.");
    const names = new Map(series.map(s => [norm(s.name), s.name]));
    const known = lib.settings.seriesKnown = lib.settings.seriesKnown || {};
    const out = [];
    for (const r of rows) {
      const name = names.get(norm(r.series || "")) || (series.length === 1 ? series[0].name : null);
      if (!name || !r.title) continue;
      const k = norm(name), n = parseFloat(r.n);
      (known[k] = (known[k] || []).filter(x => x.n !== n)).push({ n, title: clean(r.title), year: r.year || "", status: r.status || "" });
      const s = series.find(x => x.name === name);
      const have = s.books.some(b => b.seriesNum === n || norm(b.title) === norm(r.title) || (r.title_it && norm(b.title) === norm(r.title_it)));
      if (!have) out.push({ series: name, n, title: clean(r.title_it || r.title), titleEn: clean(r.title), year: r.year || "", announced: r.status === "announced" });
    }
    for (const k of Object.keys(known)) known[k].sort((a, b) => a.n - b.n);
    lib.save();
    return out;
  }
  function nextPrompt(lib) {
    const read = lib.books.filter(b => b.status === "read").sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.finished - a.finished).slice(0, 60);
    const have = lib.books.map(b => b.title).slice(0, 300);
    return `Recommend 12 books for me to read next, based on what I've read and how I rated it (★ out of 5).
Mix: continue series and authors I liked, plus similar books I haven't heard of. Prefer books available in Italy (in Italian or English).
Don't suggest anything already in my library. Use Google Search to check they exist and for recent releases.
Reply with one \`\`\`json code block and nothing else: [{"title": "...", "author": "...", "year": "YYYY", "why": "one short sentence tied to my reading", "series": "name or null", "n": null}]

WHAT I'VE READ:
${read.map(line).join("\n")}

ALREADY IN MY LIBRARY (don't suggest): ${have.join("; ")}`;
  }
  function newsPrompt(lib) {
    const authors = {};
    for (const b of lib.books) if (b.status === "read" && b.rating >= 7 || b.status === "reading") for (const a of b.authors.slice(0, 1)) authors[a] = (authors[a] || 0) + 1;
    const series = seriesList(lib).filter(s => s.read).map(s => s.name);
    return `Today is ${isoDay(Date.now())}. Find books by these authors, or in these series, published in the last 12 months or officially announced, that are NOT in my library.
Use Google Search and publishers' announcements, including Italian editions.
Reply with one \`\`\`json code block and nothing else: [{"title": "...", "author": "...", "date": "YYYY-MM-DD or YYYY", "series": "name or null", "n": null, "status": "published|announced", "why": "author or series it matches"}]
Use [] if nothing new.

AUTHORS: ${Object.keys(authors).sort((a, b) => authors[b] - authors[a]).slice(0, 40).join("; ")}
SERIES: ${series.slice(0, 40).join("; ")}
IN MY LIBRARY: ${lib.books.map(b => b.title).slice(0, 400).join("; ")}`;
  }
  function parseJson(text) {
    const t = String(text || "");
    const tries = [];
    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (m) tries.push(m[1]);
    tries.push(t);
    for (const s of tries) {
      try { return JSON.parse(s.trim()); } catch (e) { /* try the brackets */ }
      const a = s.indexOf("["), z = s.lastIndexOf("]");
      if (a >= 0 && z > a) { try { return JSON.parse(s.slice(a, z + 1)); } catch (e) { /* next */ } }
    }
    return null;
  }
  // Gemini suggestions → books to add as "Want to read" (not yet looked up; the sheet looks them up when opened)
  function suggestionBooks(lib, rows) {
    return (Array.isArray(rows) ? rows : []).filter(r => r && r.title).map(r => blankBook({ title: clean(r.title), authors: listOf(r.author), published: clean(r.year || r.date),
      series: clean(r.series || ""), seriesNum: r.n != null && r.n !== "" ? parseFloat(r.n) : null, notes: r.why ? "Suggested: " + clean(r.why) : "", status: "want", announced: r.status === "announced" }))
      .filter(b => !lib.find(b));
  }

  // ------------------------------------------------------------------ index for the other tabs
  function indexFor(lib) {
    const recent = [];
    for (const b of lib.books) { const r = readsOf(b); if (r.length && r[r.length - 1].finished) recent.push({ id: b.id, t: b.title, a: b.authors[0] || "", date: isoDay(r[r.length - 1].finished), n: r.length }); }
    recent.sort((x, y) => y.date.localeCompare(x.date));
    return { ts: Date.now(), recent: recent.slice(0, 20), books: lib.books.map(b => ({ id: b.id, t: b.title, a: b.authors[0] || "", s: b.status, se: b.series || "", n: b.seriesNum, d: b.status === "read" ? 1 : 0 })),
      reading: lib.books.filter(b => b.status === "reading").map(b => ({ id: b.id, t: b.title, a: b.authors[0] || "", pct: percent(b) })),
      next: seriesList(lib).filter(s => s.next && s.next.status === "want" && s.read).slice(0, 5).map(s => ({ id: s.next.id, t: s.next.title, se: s.name })),
      goal: (() => { const st = stats(lib); return st.goal ? { n: st.goal, done: st.readYear } : null; })() };
  }

  // ------------------------------------------------------------------ EAN-13 barcode decoder
  // Reads one line of grey values (0-255) across a barcode and returns the 13 digits, or null. Tries both
  // directions and a range of thresholds; the check digit must match.
  const L_CODES = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const G_CODES = L_CODES.map(c => c.split("").reverse().map(x => (x === "0" ? "1" : "0")).join(""));
  const R_CODES = L_CODES.map(c => c.split("").map(x => (x === "0" ? "1" : "0")).join(""));
  const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
  const PATTERNS = (() => { // widths for each digit pattern (4 runs)
    const runs = code => { const out = []; let c = code[0], n = 0; for (const ch of code) { if (ch === c) n++; else { out.push(n); c = ch; n = 1; } } out.push(n); return out; };
    return { L: L_CODES.map(runs), G: G_CODES.map(runs), R: R_CODES.map(runs) };
  })();
  function bestDigit(w, sets) {
    const sum = w[0] + w[1] + w[2] + w[3];
    let best = null, err = 1e9;
    for (const [set, list] of sets) for (let d = 0; d < 10; d++) {
      const p = list[d];
      let e = 0;
      for (let i = 0; i < 4; i++) e += Math.abs(w[i] / sum * 7 - p[i]);
      if (e < err) { err = e; best = { d, set }; }
    }
    return err < 1.6 ? best : null;
  }
  function decodeRuns(runs) {
    // runs: alternating widths starting with a bar. Look for the start guard (1,1,1) followed by 59 runs.
    for (let s = 0; s + 59 <= runs.length; s += 2) {
      const unit = (runs[s] + runs[s + 1] + runs[s + 2]) / 3;
      if (!unit || Math.max(runs[s], runs[s + 1], runs[s + 2]) > unit * 1.8) continue;
      let i = s + 3, digits = [], parity = "", ok = true;
      for (let k = 0; k < 6 && ok; k++, i += 4) {
        const r = bestDigit(runs.slice(i, i + 4), [["L", PATTERNS.L], ["G", PATTERNS.G]]);
        if (!r) ok = false; else { digits.push(r.d); parity += r.set; }
      }
      if (!ok) continue;
      i += 5; // middle guard
      for (let k = 0; k < 6 && ok; k++, i += 4) {
        const r = bestDigit(runs.slice(i, i + 4), [["R", PATTERNS.R]]);
        if (!r) ok = false; else digits.push(r.d);
      }
      if (!ok) continue;
      const first = PARITY.indexOf(parity);
      if (first < 0) continue;
      const code = String(first) + digits.join("");
      if (validIsbn13(code) || checkEan(code)) return code;
    }
    return null;
  }
  function checkEan(code) { let sum = 0; for (let i = 0; i < 12; i++) sum += +code[i] * (i % 2 ? 3 : 1); return (10 - (sum % 10)) % 10 === +code[12]; }
  function decodeLine(gray) {
    const n = gray.length;
    if (n < 95) return null;
    let min = 255, max = 0;
    for (let i = 0; i < n; i++) { if (gray[i] < min) min = gray[i]; if (gray[i] > max) max = gray[i]; }
    if (max - min < 40) return null;
    for (const f of [0.5, 0.42, 0.58, 0.35, 0.65]) {
      const th = min + (max - min) * f;
      for (const dir of [1, -1]) {
        const runs = [];
        let i = dir > 0 ? 0 : n - 1;
        while (i >= 0 && i < n && gray[i] >= th) i += dir; // skip quiet zone (white)
        let dark = true, len = 0;
        for (; i >= 0 && i < n; i += dir) {
          const isDark = gray[i] < th;
          if (isDark === dark) len++; else { runs.push(len); dark = isDark; len = 1; }
        }
        runs.push(len);
        const code = decodeRuns(runs);
        if (code) return code;
      }
    }
    return null;
  }

  const API = { isManga, isLN, formatOf, formatStats, fromJikanManga, searchManga, setChapter, STATUSES, STATUS_LABEL, FORMATS, norm, isbnDigits, validIsbn13, validIsbn10, isbn10to13, bookIsbn, parseSeries, blankBook, Library, setStatus, setPage, percent,
    fromGoogle, fromOpenLibrary, priceFrom, search, ebookPrice, logPrice, priceCheck, storeLinks, seriesList, stats, readImport, applyImport, parseCsv,
    genericBooks, authorWorks, readsOf, addRead, removeRead, authorsOf, seriesPrompt, parseSeriesAnswer, nextPrompt, newsPrompt, parseJson, suggestionBooks, indexFor, decodeLine, eur, hashId, isoDay };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.BooksCore = API;
})(typeof window !== "undefined" ? window : globalThis);
