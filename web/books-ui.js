/* Books screens on the shared base: cover grid with filters, authors, series, find (search, ISBN, barcode scanner),
   the book page (status, rating, progress, reads with dates, price alerts, stores) and reading stats with a goal. */
(function () {
  "use strict";
  const B = window.BooksCore, K = window.Kit, esc = K.esc;
  const ui = { f: "all", q: "", sort: "recent", view: "shelf", lim: 120, res: null, busy: false, sq: "", open: null, author: null, works: null };
  const lib = () => Saga.books;
  const save = () => { lib().save(); Saga.changed("books"); };
  const L = () => Saga.lang();
  const posterOf = b => K.poster({ key: "book:" + b.id, title: b.title, img: (b.cover || "").replace(/^http:/, "https:"), kind: "book",
    badge: b.status === "reading" ? (B.isManga(b) && b.chapter ? `Ch. ${b.chapter}` : `${B.percent(b)}%`) : b.series && b.seriesNum ? `#${b.seriesNum}` : "", badgeAcc: b.status === "reading",
    badgeR: B.readsOf(b).length > 1 ? `${B.readsOf(b).length}×` : "", progress: b.status === "reading" ? B.percent(b) / 100 : null, done: b.status === "read",
    attrs: `data-action="bopen" data-id="${esc(b.id)}"` });
  const tileOf = b => `<div class="tile">${posterOf(b)}<div class="cap">${esc(b.title)}</div><div class="cap2">${esc(b.authors[0] || "")}</div></div>`;

  function render() {
    const lb = lib();
    if (ui.res || ui.busy) return renderFind();
    if (!lb.books.length) {
      return `<div class="empty2"><div class="kicker">Books</div><h2>Your reading, all in one place</h2>
        <p>Search by title, author or ISBN, scan a barcode, or bring your books from Goodreads, StoryGraph, LibraryThing, Libib, BookWyrm or BookCheck.</p>
        <div class="row wrap" style="justify-content:center"><button class="btn primary" data-action="bfind">${K.icon("missing")}Find a book</button>
        <button class="btn" data-action="bscan">${K.icon("scan")}Scan</button><button class="btn" data-action="go" data-sec="settings" data-scroll="importhub">${K.icon("upload")}Import</button></div></div>`;
    }
    const reading = lb.books.filter(b => b.status === "reading" && !B.isManga(b));
    const tabs = [["shelf", "Shelf"], ["manga", "Manga"], ["authors", "Authors"], ["series", "Series"], ["stats", "Stats"]];
    let body = "";
    if (ui.view === "shelf") body = strip() + renderShelf(false);
    else if (ui.view === "manga") body = strip() + renderShelf(true);
    else if (ui.view === "authors") body = renderAuthors();
    else if (ui.view === "series") body = renderSeries();
    else body = renderStats() + formatCards();
    return `${reading.length && ui.view === "shelf" && ui.f === "all" && !ui.q ? `<section>${K.head("Reading now", "", reading.length)}${K.rail(reading.map(tileOf))}</section>` : ""}
      <div class="subnav">${tabs.map(([k, l]) => `<button data-action="bview" data-v="${k}" ${ui.view === k ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</div>${body}`;
  }
  function renderShelf(manga) {
    const lb = lib(), q = B.norm(ui.q);
    const pool = lb.books.filter(b => B.isManga(b) === manga);
    if (manga && !pool.length) return `<div class="toolbar"><input type="search" data-input="bsq" data-bsq="1" data-manga="1" value="${esc(ui.sq)}" placeholder="Search manga on MyAnimeList" autocomplete="off" enterkeyhint="search"><button class="btn primary" data-action="bsearch" data-manga="1" aria-label="Search">${K.icon("missing")}</button></div>
      <div class="empty2"><div class="kicker">Manga</div><h2>Your manga, separately</h2><p>Search MyAnimeList above, track chapters and volumes, or import your MyAnimeList manga list. Books from Star Comics, J-POP, Planet Manga and other manga publishers land here by themselves.</p></div>`;
    const counts = { all: pool.length }; for (const b of pool) counts[b.status] = (counts[b.status] || 0) + 1;
    let list = pool.filter(b => (ui.f === "all" || b.status === ui.f) && (!q || B.norm([b.title, b.authors.join(" "), b.series, b.categories.join(" ")].join(" ")).includes(q)));
    const by = { recent: (a, b) => Math.max(b.finished || 0, b.started || 0, b.added || 0) - Math.max(a.finished || 0, a.started || 0, a.added || 0), title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => (a.authors[0] || "").localeCompare(b.authors[0] || "") || (a.series || "").localeCompare(b.series || "") || (a.seriesNum || 0) - (b.seriesNum || 0), rating: (a, b) => b.rating - a.rating };
    list = list.sort(by[ui.sort] || by.recent);
    return `<div class="toolbar"><input type="search" data-input="bq" data-bq="1" value="${esc(ui.q)}" placeholder="Filter by title, author, series, genre" autocomplete="off">
        <select data-bsort="1" aria-label="Sort">${[["recent", "Recent"], ["title", "Title"], ["author", "Author"], ["rating", "Rating"]].map(([k, l]) => `<option value="${k}" ${ui.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <button class="iconbtn" data-action="bfind" ${manga ? 'data-manga="1"' : ""} aria-label="${manga ? "Find a manga" : "Find a book"}">${K.icon("plus")}</button></div>
      <div class="chips" style="margin-bottom:14px">${[["all", "All"], ["reading", "Reading"], ["paused", "Paused"], ["want", "Want to read"], ["read", "Read"], ["dnf", "Did not finish"]].map(([k, l]) => `<button class="chip" data-action="bfilter" data-v="${k}" aria-pressed="${ui.f === k}">${l} <span class="muted">${counts[k] || 0}</span></button>`).join("")}</div>
      ${list.length ? K.grid(list.slice(0, ui.lim).map(tileOf)) : `<p class="muted">Nothing matches.</p>`}
      ${list.length > ui.lim ? `<button class="btn block" style="margin-top:16px" data-action="bmore">Show more (${list.length - ui.lim})</button>` : ""}`;
  }
  function renderAuthors() {
    const q = B.norm(ui.q);
    const list = B.authorsOf(lib()).filter(a => !q || B.norm(a.name).includes(q));
    return `<div class="toolbar"><input type="search" data-input="bq" data-bq="1" value="${esc(ui.q)}" placeholder="Filter authors" autocomplete="off"></div>
      <div class="listcard">${list.slice(0, 300).map(a => `<div class="item" data-action="bauthor" data-a="${esc(a.name)}"><span class="xic books">${esc(a.name.split(/\s+/).map(w => w[0]).slice(0, 2).join(""))}</span>
        <div class="grow"><b>${esc(a.name)}</b><div class="small muted">${a.n} book${a.n === 1 ? "" : "s"} · ${a.read} read</div></div>${K.icon("chev")}</div>`).join("") || `<p class="muted">No authors yet.</p>`}</div>`;
  }
  function renderSeries() {
    const list = B.seriesList(lib());
    if (!list.length) return `<p class="muted">No series yet. Series are picked up from titles like “(Mistborn, #2)”, or set one on any book: open it › Edit details.</p>`;
    return list.map(s => `<section>${K.head(s.name, "", `${s.read}/${s.total}`)}${K.rail(s.books.map(tileOf).concat(s.missing.map(m => `<div class="tile">${K.poster({ title: m.title || `${s.name} #${m.n}`, kind: "book", badge: `#${m.n} missing`, attrs: `data-action="bfindq" data-q="${esc(m.title || s.name + " " + m.n)}"` })}<div class="cap">${esc(m.title || "Not in your library")}</div></div>`)))}</section>`).join("");
  }
  // a line of the main numbers (0.5.9)
  function strip() {
    const f = B.formatStats(lib()), a = f.all;
    return `<div class="sstrip"><div><b>${a.read}</b><span>read</span></div><div><b>${a.reading}</b><span>reading</span></div><div><b>${a.done}%</b><span>done</span></div>
      ${a.pages ? `<div><b>${a.pages.toLocaleString()}</b><span>pages</span></div>` : ""}${a.chapters ? `<div><b>${a.chapters.toLocaleString()}</b><span>chapters</span></div>` : ""}<div><b>${a.avg != null ? "★ " + a.avg : "–"}</b><span>average</span></div></div>`;
  }
  function formatCards() {
    const f = B.formatStats(lib());
    return `<div class="statgrid" style="margin-top:20px">${Object.entries(f).map(([k, x]) => `<section class="card" style="padding:14px"><div class="kicker">${esc(x.label)}</div>
      <div class="sstrip" style="flex-wrap:wrap">${[["read", x.read], ["reading", x.reading], ["paused", x.paused], ["want", x.want], ["DNF", x.dnf], ["done", x.done + "%"]].map(([l, n]) => `<div><b>${n}</b><span>${l}</span></div>`).join("")}</div>
      <p class="small">${x.pages.toLocaleString()} pages${x.chapters ? ` · ${x.chapters.toLocaleString()} chapters` : ""}${x.volumes ? ` · ${x.volumes} volumes` : ""} · ${x.rated} rated, average <b>★ ${x.avg != null ? x.avg : "–"}</b> · ${x.readYear} this year</p>
      ${x.rated >= 3 ? `<div class="hist">${x.hist.map(n => `<i style="height:${Math.round((100 * n) / Math.max(1, ...x.hist))}%" title="${n}"></i>`).join("")}</div><div class="histl">${x.hist.map((_, i) => `<span>${i + 1}</span>`).join("")}</div>` : ""}</section>`).join("")}</div>`;
  }
  function renderStats() {
    const lb = lib(), s = B.stats(lb), max = Math.max(1, ...s.months);
    const MON = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    return `<section><div class="kicker">${s.year}</div><div class="bigstat">${s.readYear}</div><div class="muted">books read${s.goal ? ` of ${s.goal}` : ""} · ${s.pagesYear.toLocaleString()} pages</div>
        ${s.pace ? `<p class="small" style="margin-top:8px">${s.pace.reached ? "Goal reached." : s.pace.ahead >= 0 ? `${s.pace.ahead.toFixed(1)} books ahead of pace.` : `${(-s.pace.ahead).toFixed(1)} books behind: about ${s.pace.perWeek.toFixed(1)} a week to catch up.`}</p>` : ""}
        <div class="row" style="margin-top:10px"><label class="field grow" style="margin:0"><span>Goal for ${s.year}</span><input type="number" inputmode="numeric" data-bgoal="1" value="${s.goal || ""}" placeholder="books"></label></div></section>
      <section class="card"><div class="months">${s.months.map(n => `<i style="height:${Math.round(n / max * 100)}%" title="${n}"></i>`).join("")}</div><div class="months" style="height:auto">${MON.map(m => `<span>${m}</span>`).join("")}</div></section>
      <div class="stat3"><div><b>${s.totalRead}</b><span>read in all</span></div><div><b>${s.daysPerBook || "–"}</b><span>days per book</span></div><div><b>${s.avgRating ? s.avgRating.toFixed(1) : "–"}</b><span>average stars</span></div></div>
      ${s.topAuthors.length ? `<section style="margin-top:20px">${K.head("Most read authors")}<div class="listcard">${s.topAuthors.map(([a, n]) => `<div class="item" data-action="bauthor" data-a="${esc(a)}"><div class="grow">${esc(a)}</div><b>${n}</b></div>`).join("")}</div></section>` : ""}`;
  }
  function renderFind() {
    return `<div class="toolbar"><input type="search" data-input="bsq" data-bsq="1" value="${esc(ui.sq)}" placeholder="${ui.mangaSearch ? "Search manga on MyAnimeList" : "Title, author or ISBN"}" autocomplete="off" enterkeyhint="search">
        <button class="btn primary" data-action="bsearch" aria-label="Search">${K.icon("missing")}</button><button class="iconbtn" data-action="bscan" aria-label="Scan a barcode">${K.icon("scan")}</button></div>
      <div class="sechead"><h2>${ui.busy ? "Searching…" : ui.res && ui.res.length ? `${ui.res.length} found` : "Find a book"}</h2><button class="btn quiet small" data-action="bfindclose">Back</button></div>
      ${ui.busy ? "" : K.grid((ui.res || []).map((r, i) => `<div class="tile">${K.poster({ title: r.title, img: (r.cover || "").replace(/^http:/, "https:"), kind: "book", badge: lib().find(r) ? "In your books" : "", attrs: `data-action="bpeek" data-i="${i}"` })}<div class="cap">${esc(r.title)}</div><div class="cap2">${esc((r.authors || [])[0] || "")}${r.published ? " · " + esc(String(r.published).slice(0, 4)) : ""}</div></div>`))}
      <button class="btn block" style="margin-top:16px" data-action="bmanual">${K.icon("plus")}Add a book by hand</button>`;
  }
  async function find() {
    const q = String(ui.sq || "").trim();
    if (q.length < 2) return K.toast("Type at least two letters");
    ui.busy = true; ui.res = []; Saga.render();
    try { ui.res = ui.mangaSearch ? await B.searchManga(Saga.http, q) : await B.search(Saga.http, q, lib().settings.region || "IT"); } catch (e) { ui.res = []; K.toast(`Search failed: ${e.message}`); }
    ui.busy = false; Saga.render();
  }

  function sheetHtml(b) {
    const reads = B.readsOf(b), t = new Date().toISOString().slice(0, 10), Lg = L();
    const d = x => K.when(x, Lg);
    const facts = [["Pages", b.pages || ""], ["Published", [b.publisher, b.published].filter(Boolean).join(", ")], ["Series", b.series ? `${b.series}${b.seriesNum ? " #" + b.seriesNum : ""}` : ""],
      ["ISBN", B.bookIsbn(b)], ["Format", b.format], ["Genres", b.categories.slice(0, 4).join(", ")], ["Where", b.location]].filter(x => x[1]);
    return `${K.sheetHero({ title: b.title, img: (b.cover || "").replace(/^http:/, "https:"), kind: "book" }, `<div class="small">${b.authors.map(a => `<button class="linkbtn" data-action="bauthor" data-a="${esc(a)}">${esc(a)}</button>`).join(", ") || "Unknown author"}</div>`)}
      <div class="seg2" style="grid-template-columns:repeat(5,1fr);margin:6px 0 12px">${[["want", "Want"], ["reading", "Reading"], ["paused", "Paused"], ["read", "Read"], ["dnf", "DNF"]].map(([s, l]) => `<button data-action="bst" data-v="${s}" aria-pressed="${b.status === s}">${l}</button>`).join("")}</div>
      <div class="row" style="margin-bottom:8px"><span class="small muted grow">Your rating</span>${K.stars(b.rating, "brate")}</div>
      ${B.isManga(b) && b.status !== "read" ? `<div class="nextbox"><div class="grow"><div class="kicker">Chapter</div><b>${b.chapter || 0}${b.chapters ? ` of ${b.chapters}` : ""}</b><div class="small muted">${b.volumes ? `${b.volume || 0} of ${b.volumes} volumes` : b.ongoing ? "still publishing" : ""}</div></div>
        <input type="number" inputmode="numeric" data-bch="1" value="${b.chapter || ""}" placeholder="ch." style="width:72px"><input type="number" inputmode="numeric" data-bvol="1" value="${b.volume || ""}" placeholder="vol." style="width:64px">
        <button class="btn primary" data-action="bch" aria-label="One more chapter">+1</button></div>` : ""}
      ${b.status === "reading" && !B.isManga(b) ? `<div class="nextbox"><div class="grow"><div class="kicker">Progress</div><b>${B.percent(b)}%</b><div class="small muted">page ${b.currentPage || 0}${b.pages ? ` of ${b.pages}` : ""}</div></div>
        <input type="number" inputmode="numeric" data-bpage="1" value="${b.currentPage || ""}" placeholder="page" style="width:96px"></div>` : ""}
      <h4>Reads <span class="muted small">${reads.length ? `· ${reads.length}×` : ""}</span></h4>
      ${reads.map((r, i) => `<div class="logrow"><span class="grow">${i + 1}. ${r.started && r.started !== r.finished ? `${esc(d(r.started))} – ` : ""}${esc(d(r.finished))}</span><button class="btn quiet small" data-action="bunread" data-i="${i}" aria-label="Remove this read">✕</button></div>`).join("") || `<p class="small muted">Not finished yet.</p>`}
      <details class="report"${ui.addRead ? " open" : ""}><summary>Add a read (a past one, or another time through)</summary>
        <div class="row" style="margin-top:8px"><label class="field grow" style="margin:0"><span>Started</span><input type="date" id="rdS" max="${t}"></label><label class="field grow" style="margin:0"><span>Finished</span><input type="date" id="rdF" value="${t}" max="${t}"></label></div>
        <button class="btn small" data-action="baddread" style="margin-top:8px">Add this read</button></details>
      ${b.status === "read" ? `<button class="sheetbtn" data-action="bst" data-v="reading">${K.icon("sync")}Start reading it again</button>` : ""}
      ${Saga.feat("bookPrices") && b.status !== "read" ? `<h4>Ebook price</h4><div class="nextbox"><div class="grow">${b.gbPrice != null ? `<b>${esc(B.eur(b.gbPrice))}</b>${b.gbListPrice && b.gbListPrice > b.gbPrice ? ` <s class="small muted">${esc(B.eur(b.gbListPrice))}</s>` : ""}<div class="small muted">Google Play Books${b.lowestPrice != null ? ` · lowest seen ${esc(B.eur(b.lowestPrice))}` : ""}</div>` : `<span class="small muted">Not checked yet.</span>`}</div>
        <button class="btn small" data-action="bprice">Check</button></div>
        <label class="field"><span>Alert me at or below (€)</span><input type="number" inputmode="decimal" step="0.01" data-btarget="1" value="${b.targetPrice != null ? b.targetPrice : ""}" placeholder="any drop"></label>` : ""}
      ${facts.length ? `<h4>Details</h4><div class="listcard">${facts.map(([k, v]) => `<div class="row small" style="min-height:38px;border-bottom:1px solid var(--line)"><span class="muted" style="width:36%">${esc(k)}</span><span class="grow">${esc(v)}</span></div>`).join("")}</div>` : ""}
      ${b.description ? `<details class="report"><summary>Description (may contain spoilers)</summary><p class="small">${esc(b.description)}</p></details>` : ""}
      <label class="field" style="margin-top:12px"><span>Notes</span><textarea rows="2" data-bnotes="1" placeholder="Thoughts, quotes, who recommended it…">${esc(b.notes)}</textarea></label>
      ${B.storeLinks(b).length ? "<h4>Where to get it</h4>" : ""}${B.storeLinks(b).map(([n, u]) => `<button class="sheetbtn" data-action="open" data-url="${esc(u)}">${K.icon("open")}${esc(n)}</button>`).join("")}
      <div style="margin-top:8px"><button class="sheetbtn" data-action="mlistadd" data-k="book:${esc(b.id)}">${K.icon("plus")}Add to a list</button><button class="sheetbtn" data-action="bsync1">${K.icon("sync")}Sync this book (missing details, cover, price)</button><button class="sheetbtn" data-action="bedit">${K.icon("edit")}Edit details</button><button class="sheetbtn" data-action="bremove">${K.icon("notcanon")}Remove from your books</button></div>`;
  }
  function open(id) { const b = lib().get(id); if (!b) return; ui.open = id; Saga.sheet(sheetHtml(b), "bsheet", id); }
  function editHtml(b, isNew) {
    const f = (k, l, v, type) => `<label class="field"><span>${l}</span><input ${type ? `type="${type}"` : ""} id="be_${k}" value="${esc(v == null ? "" : v)}"></label>`;
    return `<h3>${isNew ? "Add a book" : "Edit details"}</h3>${f("title", "Title", b.title)}${f("authors", "Authors (comma separated)", b.authors.join(", "))}${f("series", "Series", b.series)}
      ${f("seriesNum", "Number in series", b.seriesNum, "number")}${f("pages", "Pages", b.pages || "", "number")}${f("isbn", "ISBN", B.bookIsbn(b))}${f("published", "Published", b.published)}
      ${f("location", "Where it is (shelf, lent to…)", b.location)}${f("cover", "Cover image link", b.cover)}
      <div class="row" style="margin-top:12px"><button class="btn quiet grow" data-action="close">Cancel</button><button class="btn primary grow" data-action="bsave" data-id="${esc(isNew ? "" : b.id)}">Save</button></div>`;
  }
  async function openAuthor(name) {
    ui.author = name;
    const mine = lib().books.filter(b => b.authors.some(a => B.norm(a) === B.norm(name)));
    const draw = (works, err) => Saga.sheet(`<div class="kicker">Author</div><h3 style="font:800 26px/1.1 var(--display);margin:6px 0">${esc(name)}</h3>
      <p class="small muted">${mine.length} in your library · ${mine.filter(b => b.status === "read").length} read</p>${mine.length ? K.rail(mine.map(tileOf)) : ""}
      <h4>All books by ${esc(name)}</h4>${works === null ? `<p class="small muted">Looking them up…</p>` : err ? `<p class="small muted">${esc(err)}</p>` :
        (works.filter(w => !lib().find(w)).map(w => `<div class="item"><div class="grow"><b>${esc(w.title)}</b><div class="small muted">${esc([w.published, w.pages ? w.pages + " pages" : ""].filter(Boolean).join(" · "))}</div></div>
          <button class="seen" data-action="bworkadd" data-i="${works.indexOf(w)}" aria-label="Add ${esc(w.title)} to Want to read">${K.icon("plus")}</button></div>`).join("") || `<p class="small muted">You have everything we could find.</p>`)}
      <p class="small muted">From Open Library. Editions are merged by title.</p>`, "author");
    draw(null);
    if (!ui.works || ui.works.name !== name) {
      try { ui.works = { name, list: await B.authorWorks(Saga.http, name, lib().settings.region || "IT") }; }
      catch (e) { if (ui.author === name) draw([], "Couldn't look up their books: " + e.message); return; }
    }
    if (ui.author === name) draw(ui.works.list);
  }
  // barcode scanner: BarcodeDetector where the system has it, otherwise our own EAN-13 reader on camera frames
  let stream = null, scanTimer = null;
  async function scan() {
    Saga.sheet(`<div class="scanner"><video playsinline muted style="width:100%;border-radius:18px;background:#000;aspect-ratio:4/3;object-fit:cover"></video>
      <p class="small muted" id="scanmsg">Point at the barcode on the back cover</p>
      <div class="row"><input class="grow" id="isbnin" inputmode="numeric" placeholder="…or type the ISBN"><button class="btn primary" data-action="bisbn">Find</button></div></div>`, "scan");
    const msg = document.getElementById("scanmsg");
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
    catch (e) { msg.textContent = "The camera isn't available. Type the ISBN instead."; return; }
    const video = document.querySelector(".scanner video");
    if (!video) return stopScan();
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* frames still arrive */ }
    let detector = null;
    try { if ("BarcodeDetector" in window) detector = new BarcodeDetector({ formats: ["ean_13"] }); } catch (e) { detector = null; }
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    const tick = async () => {
      if (!stream || !document.querySelector(".scanner video")) return stopScan();
      let code = null;
      try {
        if (detector) { const r = await detector.detect(video); code = (r.find(x => /^97[89]\d{10}$/.test(x.rawValue)) || {}).rawValue || null; }
        if (!code && video.videoWidth) {
          const w = Math.min(1000, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth);
          canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
          for (const f of [0.5, 0.44, 0.56, 0.4, 0.6]) {
            const y = Math.round(h * f), dd = ctx.getImageData(0, y, w, 1).data, g = new Array(w);
            for (let i = 0; i < w; i++) g[i] = dd[i * 4] * 0.3 + dd[i * 4 + 1] * 0.59 + dd[i * 4 + 2] * 0.11;
            const c = B.decodeLine(g);
            if (c && /^97[89]/.test(c)) { code = c; break; }
          }
        }
      } catch (e) { /* next frame */ }
      if (code) { stopScan(); if (navigator.vibrate) navigator.vibrate(60); isbn(code); return; }
      scanTimer = setTimeout(tick, detector ? 150 : 220);
    };
    tick();
  }
  function stopScan() { clearTimeout(scanTimer); if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }
  async function isbn(code) {
    code = B.isbnDigits(code);
    if (!(B.validIsbn13(code) || B.validIsbn10(code))) return K.toast("That's not a book ISBN (978/979…)");
    const have = lib().find({ isbn13: code.length === 13 ? code : B.isbn10to13(code), isbn10: code.length === 10 ? code : "" });
    if (have) { K.toast("Already in your books"); return open(have.id); }
    ui.sq = code; Saga.close(); await find();
    if (ui.res && ui.res.length === 1) act("bpeek", { dataset: { i: "0" } });
  }
  function act(a, el) {
    const lb = lib(), b = ui.open ? lb.get(ui.open) : null;
    const reopen = () => { save(); if (b) open(b.id); Saga.render(); };
    switch (a) {
      case "bopen": open(el.dataset.id); return true;
      case "bview": ui.view = el.dataset.v; ui.q = ""; Saga.render(); return true;
      case "bfilter": ui.f = el.dataset.v; ui.lim = 120; Saga.render(); return true;
      case "bmore": ui.lim += 120; Saga.render(); return true;
      case "bfind": ui.mangaSearch = !!el.dataset.manga; ui.res = []; Saga.render(); setTimeout(() => { const i = document.querySelector("[data-bsq]"); if (i) i.focus(); }, 30); return true;
      case "bfindq": ui.sq = el.dataset.q; Saga.close(); find(); return true;
      case "bsearch": { const i = document.querySelector("[data-bsq]"); if (i) ui.sq = i.value; if (el.dataset && el.dataset.manga) ui.mangaSearch = true; find(); return true; }
      case "bch": if (b) { B.setChapter(b, (b.chapter || 0) + 1); save(); open(b.id); Saga.render(); } return true;
      case "bfindclose": ui.mangaSearch = false; ui.res = null; ui.busy = false; Saga.render(); return true;
      case "bscan": scan(); return true;
      case "bisbn": isbn((document.getElementById("isbnin") || {}).value); return true;
      case "bmanual": Saga.sheet(editHtml(B.blankBook({ title: ui.sq && !/^\d+$/.test(ui.sq) ? ui.sq : "" }), true)); return true;
      case "bpeek": { const r = (ui.res || [])[+el.dataset.i]; if (!r) return true; const have = lb.find(r); if (have) { open(have.id); return true; }
        Saga.sheet(`${K.sheetHero({ title: r.title, img: (r.cover || "").replace(/^http:/, "https:"), kind: "book" }, `<div class="small muted">${esc((r.authors || []).join(", "))}</div>`)}
          ${r.description ? `<p class="small">${esc(r.description.length > 320 ? r.description.slice(0, 320) + "…" : r.description)}</p>` : ""}
          <p class="small muted">Add to your books as</p>${[["want", "Want to read"], ["reading", "Reading"], ["read", "Read"]].map(([s, l]) => `<button class="sheetbtn" data-action="baddas" data-i="${el.dataset.i}" data-v="${s}">${K.icon("plus")}${l}</button>`).join("")}`);
        return true; }
      case "baddas": { const r = ui.res[+el.dataset.i]; if (!r) return true; const { book } = lb.add(r, el.dataset.v); save(); K.toast(`Added ${book.title}`); open(book.id); Saga.render(); return true; }
      case "bauthor": openAuthor(el.dataset.a); return true;
      case "bworkadd": { const w = ui.works && ui.works.list[+el.dataset.i]; if (w) { lb.add(w, "want"); save(); K.toast(`Added ${w.title}`); openAuthor(ui.author); } return true; }
      case "bsave": {
        const v = k => ((document.getElementById("be_" + k) || {}).value || "").trim();
        if (!v("title")) { K.toast("The title is needed"); return true; }
        const isb = B.isbnDigits(v("isbn"));
        const data = { title: v("title"), authors: v("authors").split(",").map(x => x.trim()).filter(Boolean), series: v("series"), seriesNum: parseFloat(v("seriesNum")) || null, pages: parseInt(v("pages"), 10) || 0,
          published: v("published"), location: v("location"), cover: v("cover"), isbn13: isb.length === 13 ? isb : "", isbn10: isb.length === 10 ? isb : "" };
        let x;
        if (el.dataset.id) { x = lb.get(el.dataset.id); Object.assign(x, data); } else x = lb.add(data, "want").book;
        save(); ui.res = null; open(x.id); Saga.render(); return true; }
    }
    if (!b) return false;
    switch (a) {
      case "bst": B.setStatus(b, el.dataset.v); reopen(); return true;
      case "brate": { const v = +el.dataset.v * 2; b.rating = b.rating === v ? v - 1 : b.rating === v - 1 ? 0 : v; reopen(); return true; }
      case "baddread": { const st = (document.getElementById("rdS") || {}).value, fi = (document.getElementById("rdF") || {}).value; if (!fi) { K.toast("Pick the day you finished it"); return true; }
        const n = B.addRead(b, st ? Date.parse(st + "T12:00:00") : 0, Date.parse(fi + "T12:00:00")); K.toast(`Read ${n}×`); reopen(); return true; }
      case "bunread": B.removeRead(b, +el.dataset.i); reopen(); return true;
      case "bsync1": (async () => {
        K.toast(`Syncing ${b.title}…`); const said = [];
        try {
          const res = await B.search(Saga.http, b.isbn || `${b.title} ${(b.authors || [])[0] || b.author || ""}`, lb.settings.region || "IT");
          const nt = B.norm ? B.norm(b.title) : String(b.title).toLowerCase();
          const r = res.find(x => (b.isbn && x.isbn === b.isbn) || (B.norm ? B.norm(x.title) : String(x.title).toLowerCase()) === nt);
          if (r) { let n = 0; for (const k of Object.keys(r)) { const v = r[k], cur = b[k]; if (k !== "id" && k !== "status" && v != null && v !== "" && !(Array.isArray(v) && !v.length) && (cur == null || cur === "" || cur === 0 || (Array.isArray(cur) && !cur.length))) { b[k] = v; n++; } } said.push(n ? `${n} details filled in` : "details already complete"); }
          else said.push("no match found online");
        } catch (e) { said.push(e.message); }
        try { await B.priceCheck({ books: [b], settings: lb.settings, save: () => {} }, Saga.http, { force: true }); said.push("price checked"); } catch (e) { said.push("Price: " + e.message); }
        save(); reopen(); K.toast(`${b.title}: ${said.join("; ")}`);
      })(); return true;
      case "bprice": (async () => { try { await B.priceCheck({ books: [b], settings: lb.settings, save: () => {} }, Saga.http, { force: true }); } catch (e) { K.toast(e.message); } reopen(); })(); return true;
      case "bedit": Saga.sheet(editHtml(b)); return true;
      case "bremove": if (el.dataset.sure) { lb.remove(b.id); Saga.changed("books"); Saga.close(); ui.open = null;
        K.toast(`Removed ${b.title}`, () => { if (!lb.get(b.id)) { lb.books.push(b); lb.save(); } Saga.changed("books"); Saga.render(); K.toast("Undone"); }); Saga.render(); } else { el.dataset.sure = "1"; el.lastChild.textContent = "Tap again to remove"; } return true;
    }
    return false;
  }
  function change(el) {
    const b = ui.open ? lib().get(ui.open) : null;
    if (el.dataset.bsort) { ui.sort = el.value; Saga.render(); return true; }
    if (el.dataset.bgoal) { const lb = lib(); lb.goal = { year: new Date().getFullYear(), n: parseInt(el.value, 10) || 0 }; save(); Saga.render(); return true; }
    if (!b) return false;
    if (el.dataset.bnotes) { b.notes = el.value.trim(); save(); return true; }
    if (el.dataset.bch || el.dataset.bvol) { B.setChapter(b, el.dataset.bch ? el.value : b.chapter, el.dataset.bvol ? el.value : null); save(); open(b.id); Saga.render(); return true; }
    if (el.dataset.bpage) { B.setPage(b, el.value); save(); open(b.id); Saga.render(); return true; }
    if (el.dataset.btarget) { const v = parseFloat(String(el.value).replace(",", ".")); b.targetPrice = isFinite(v) ? v : null; save(); return true; }
    return false;
  }
  function input(el) { if (el.dataset.bq) { ui.q = el.value; ui.lim = 120; return true; } if (el.dataset.bsq) ui.sq = el.value; return false; }
  function enter(el) { if (el.dataset.bsq) { ui.sq = el.value; if (el.dataset.manga) ui.mangaSearch = true; find(); return true; } if (el.id === "isbnin") { isbn(el.value); return true; } return false; }
  K.mods.books = { title: "Books", render, act, change, input, enter, open, ui, tileOf, posterOf, stopScan };
})();
