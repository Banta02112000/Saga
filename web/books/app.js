/* Books tab screen: Library, Find, Series, Stats and More, the book sheet and the barcode scanner. */
(function () {
  "use strict";
  const B = window.BooksCore;
  const A = window.Android || null;
  const SH = window.BantaShell ? BantaShell.shared : null;
  const feat = k => (window.BantaShell && BantaShell.feature ? BantaShell.feature(k) : true);
  const $ = q => document.querySelector(q);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => Number(n || 0).toLocaleString("en-GB");
  const DAY = 864e5;

  // ------------------------------------------------------------------ bridge
  const pending = new Map();
  let seq = 0;
  const take = id => { try { return A.take(id); } catch (e) { return ""; } };
  window.__httpDone = id => { const cb = pending.get(id); pending.delete(id); let r; try { r = JSON.parse(take(id)); } catch (e) { r = { status: 0, body: "", error: String(e) }; } if (cb) cb(r); };
  window.__pickDone = id => { const cb = pending.get(id); pending.delete(id); let r; try { r = JSON.parse(take(id) || "[]"); } catch (e) { r = []; } if (cb) cb(r); };
  window.__saveDone = id => { const cb = pending.get(id); pending.delete(id); if (cb) cb(take(id) === "true"); };
  const http = (method, url, opt = {}) => new Promise(res => {
    if (!A || !A.http) return res({ status: 0, body: "", error: "offline" });
    const id = "h" + (++seq);
    pending.set(id, res);
    A.http(id, method, url, Object.entries(opt.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n"), opt.body || "");
  });
  const pick = () => new Promise(res => { if (!A || !A.pick) return res([]); const id = "p" + (++seq); pending.set(id, res); A.pick(id, false); });
  const saveAs = (name, text) => new Promise(res => { if (!A || !A.saveAs) return res(false); const id = "s" + (++seq); pending.set(id, res); A.saveAs(id, name, text); });
  const openUrl = u => { try { A.openUrl(u); } catch (e) { window.open(u, "_blank"); } };
  const notify = (n) => { try { A.notify(n.id, n.title, n.text, "books"); } catch (e) { /* not on Android */ } };

  const lib = new B.Library(A && A.load ? { load: () => A.load("books.json"), save: t => A.save("books.json", t) } : null);
  const ui = { tab: (location.hash || "").slice(1) || "library", filter: "all", q: "", sort: "recent", find: "", results: null, busy: "", year: new Date().getFullYear() };
  if (!["library", "find", "series", "stats", "more"].includes(ui.tab)) ui.tab = "library";
  if (lib.books.some(b => b.status === "reading")) ui.filter = "reading";

  const ICON = {
    library: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8 1-3.9 15.4-3.8-1z"/>',
    find: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    series: '<path d="M5 4h10v16H5zM9 4v16M18 6v14"/>',
    stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    chev: '<path d="m9 6 6 6-6 6"/>', plus: '<path d="M12 5v14M5 12h14"/>', scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>', copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  };
  const icon = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ""}</svg>`;

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 3200);
  }

  // ------------------------------------------------------------------ pieces
  const initials = t => String(t || "?").split(/\s+/).slice(0, 3).map(w => w[0] || "").join("").toUpperCase();
  function cover(b, big) {
    const cls = "cover" + (big ? " big" : "");
    if (b.cover) return `<img class="${cls}" loading="lazy" src="${esc(b.cover)}" alt="" onerror="this.outerHTML='<div class=&quot;${cls} ph&quot;>${esc(initials(b.title)).replace(/'/g, "")}</div>'">`;
    return `<div class="${cls} ph" aria-hidden="true">${esc(initials(b.title))}</div>`;
  }
  const stars = r => (r ? "★".repeat(Math.floor(r / 2)) + (r % 2 ? "½" : "") : "");
  const daysAgo = t => { const d = Math.round((Date.now() - t) / DAY); return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
  function subline(b) {
    const bits = [];
    if (b.series) bits.push(`${b.series}${b.seriesNum != null ? " #" + b.seriesNum : ""}`);
    if (b.status === "read") bits.push(b.finished ? "read " + daysAgo(b.finished) : "read");
    if (b.status === "dnf") bits.push("did not finish");
    if (b.rating) bits.push(stars(b.rating));
    return bits.join(" · ");
  }
  function priceBadge(b) {
    if (!feat("bookPrices") || b.status !== "want" || b.gbPrice == null) return "";
    const good = b.targetPrice != null && b.gbPrice <= b.targetPrice;
    return `<span class="pbadge"${good ? ' style="color:var(--ok)"' : ""}>${b.gbPrice === 0 ? "Free" : B.eur(b.gbPrice)} ebook</span>`;
  }
  function row(b) {
    const pct = B.percent(b);
    return `<div class="item" data-action="book" data-id="${esc(b.id)}">${cover(b)}
      <div class="grow body"><div class="ttl"><b>${esc(b.title)}</b></div>
        <div class="sub"><span class="muted ellipsis">${esc(b.authors.join(", ") || "Unknown author")}</span></div>
        <div class="sub">${priceBadge(b)}<span class="muted small ellipsis">${esc(subline(b))}</span></div>
        ${b.status === "reading" ? `<div class="prog"><i style="width:${pct}%"></i></div>` : ""}
      </div></div>`;
  }

  // ------------------------------------------------------------------ Library
  function renderLibrary() {
    const reading = lib.books.filter(b => b.status === "reading");
    const counts = { all: lib.books.length };
    for (const s of B.STATUSES) counts[s] = lib.books.filter(b => b.status === s).length;
    let list = lib.books.filter(b => ui.filter === "all" || ui.filter === "authors" || b.status === ui.filter);
    const q = B.norm(ui.q);
    if (q) list = list.filter(b => B.norm([b.title, b.subtitle, b.authors.join(" "), b.series, b.categories.join(" "), (b.shelves || []).join(" ")].join(" ")).includes(q));
    const SORT = { recent: (a, b) => (b.finished || b.started || b.added) - (a.finished || a.started || a.added), title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => (a.authors[0] || "").localeCompare(b.authors[0] || "") || (a.seriesNum || 0) - (b.seriesNum || 0), rating: (a, b) => (b.rating || 0) - (a.rating || 0),
      price: (a, b) => (a.gbPrice == null ? 1e9 : a.gbPrice) - (b.gbPrice == null ? 1e9 : b.gbPrice) };
    list.sort(SORT[ui.sort] || SORT.recent);
    const st = B.stats(lib);
    if (!lib.books.length) {
      return `<section class="hero"><div class="kicker">Your reading, tracked</div><h1>Start your library</h1>
        <p class="muted">Search by title, author or ISBN, scan a book's barcode, or bring your books over from BookCheck, Goodreads or StoryGraph.</p>
        <div class="row wrap"><button class="btn primary" data-action="tab" data-tab="find">${icon("find")}Find a book</button>
        <button class="btn" data-action="scan">${icon("scan")}Scan</button><button class="btn" data-action="tab" data-tab="more">Import</button></div></section>`;
    }
    return `${reading.length ? `<section><div class="sechead"><h2>Reading now</h2>${st.goal ? `<span class="small muted">${st.readYear}/${st.goal} this year</span>` : ""}</div>
        <div class="reading">${reading.map(b => `<div class="rcard" data-action="book" data-id="${esc(b.id)}">${cover(b)}<div class="grow">
          <div class="t">${esc(b.title)}</div><div class="small muted">${esc(b.authors[0] || "")}</div>
          <div class="prog"><i style="width:${B.percent(b)}%"></i></div>
          <div class="row" style="margin-top:8px"><span class="small muted grow">${b.pages ? `p. ${b.currentPage}/${b.pages}` : "Set pages"}</span>
            <button class="btn" data-action="page" data-id="${esc(b.id)}" data-d="10">+10</button><button class="btn" data-action="page" data-id="${esc(b.id)}" data-d="25">+25</button></div>
        </div></div>`).join("")}</div></section>` : ""}
      <section>
        <div class="chips" role="group" aria-label="Filter">${[["all", "All"], ["reading", "Reading"], ["want", "Want"], ["read", "Read"], ["dnf", "DNF"]].map(([k, l]) =>
          `<button class="chip" data-action="filter" data-v="${k}" aria-pressed="${ui.filter === k}">${l} <span class="muted">${counts[k] || 0}</span></button>`).join("")}
          <button class="chip" data-action="filter" data-v="authors" aria-pressed="${ui.filter === "authors"}">Authors <span class="muted">${B.authorsOf(lib).length}</span></button></div>
        ${ui.filter === "authors" ? `<div style="margin-top:10px">${B.authorsOf(lib).filter(a => !q || B.norm(a.name).includes(q)).slice(0, 300).map(a => `<div class="item" data-action="author" data-a="${esc(a.name)}"><div class="cover ph" aria-hidden="true">${esc(initials(a.name))}</div>
          <div class="grow body"><div class="ttl"><b>${esc(a.name)}</b></div><div class="sub"><span class="muted small">${a.n} book${a.n === 1 ? "" : "s"} · ${a.read} read</span></div></div>${icon("chev")}</div>`).join("")}</div>` : ""}
        <div class="row" style="margin:12px 0 4px"><input class="inp grow" data-input="libq" placeholder="Filter by title, author, series, genre" value="${esc(ui.q)}">
          <select class="inp" style="width:auto" data-change="sort">${[["recent", "Recent"], ["title", "Title"], ["author", "Author"], ["rating", "Rating"], ["price", "Price"]].map(([k, l]) => `<option value="${k}" ${ui.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <p class="small muted" style="margin:4px 0" ${ui.filter === "authors" ? "hidden" : ""}>${fmt(list.length)} book${list.length === 1 ? "" : "s"}</p>
        <div id="booklist" ${ui.filter === "authors" ? "hidden" : ""}>${list.slice(0, 400).map(row).join("") || `<p class="empty">Nothing matches.</p>`}</div>
      </section>`;
  }

  // ------------------------------------------------------------------ Find
  function renderFind() {
    const res = ui.results;
    return `<section><h2>Find a book</h2>
        <div class="row"><input class="inp grow" data-input="findq" placeholder="Title, author or ISBN" value="${esc(ui.find)}" enterkeyhint="search">
          <button class="btn primary" data-action="search" ${ui.busy ? "disabled" : ""}>${icon("find")}Search</button></div>
        <div class="row wrap" style="margin-top:8px"><button class="btn" data-action="scan">${icon("scan")}Scan a barcode</button>
          <button class="btn quiet" data-action="manual">Add by hand</button></div>
        ${ui.busy ? `<p class="small muted">${esc(ui.busy)}</p>` : ""}
        ${res ? (res.length ? `<p class="small muted">${res.length} result${res.length === 1 ? "" : "s"} · Google Books + Open Library</p>${res.map((b, i) => {
          const have = lib.find(b);
          return `<div class="item" data-action="${have ? "book" : "result"}" data-id="${have ? esc(have.id) : ""}" data-i="${i}">${cover(b)}
            <div class="grow body"><div class="ttl"><b>${esc(b.title)}</b></div>
              <div class="sub"><span class="muted ellipsis">${esc([b.authors.join(", "), b.published.slice(0, 4), b.pages ? b.pages + " p" : ""].filter(Boolean).join(" · "))}</span></div>
              <div class="sub">${have ? `<span class="pbadge">In library · ${esc(B.STATUS_LABEL[have.status])}</span>` : b.gbPrice != null ? `<span class="pbadge">${b.gbPrice === 0 ? "Free" : B.eur(b.gbPrice)} ebook</span>` : ""}${b.avgRating ? `<span class="muted small">★ ${b.avgRating.toFixed(1)}</span>` : ""}</div>
            </div>${have ? "" : `<button class="seen" data-action="quickadd" data-i="${i}" aria-label="Add ${esc(b.title)}">${icon("plus")}</button>`}</div>`;
        }).join("")}` : `<p class="empty">No results. Try fewer words, or the ISBN on the back.</p>`) : ""}
      </section>
      ${feat("gemini") ? `<section><div class="sechead"><h2>${icon("spark")} Ideas from Gemini</h2><span class="pbadge">${geminiKey() ? "API key" : "Gemini app"}</span></div>
        <div class="tools">
          ${tool("next", "What to read next", "12 picks from what you've read and how you rated it")}
          ${tool("news", "New from your authors and series", "Recently published or announced, including Italian editions")}
        </div></section>` : ""}`;
  }
  const tool = (k, title, sub) => `<button class="tool" data-action="gem" data-k="${k}" ${ui.busy ? "disabled" : ""}><span class="tool-ic">${icon("spark")}</span><span class="grow"><b>${title}</b><small>${sub}</small></span>${icon("chev")}</button>`;

  // ------------------------------------------------------------------ Series
  function renderSeries() {
    const list = B.seriesList(lib);
    if (!list.length) return `<section><h2>Series</h2><p class="empty"><b>No series yet</b>Series are picked up from titles like “(Mistborn, #2)”. You can also set one on any book: open it › Edit details.</p></section>`;
    return `<section><div class="sechead"><h2>Series</h2>${feat("gemini") ? `<button class="btn small" data-action="gemseries" ${ui.busy ? "disabled" : ""}>${icon("spark")}Complete with Gemini</button>` : ""}</div>
      <p class="small muted" style="margin-top:0">■ read · ■ reading · ■ want · □ not in your library. Gemini fills in the books you're missing from each series.</p>
      ${list.map(s => `<div class="serow" data-action="seriesopen" data-s="${esc(s.name)}"><div class="row"><b class="grow">${esc(s.name)}</b><span class="small muted">${s.read}/${s.total} read</span></div>
        <div class="dots">${s.books.map(b => `<span class="${b.status}" title="${esc(b.title)}">${b.seriesNum != null ? esc(b.seriesNum) : "?"}</span>`).concat(s.missing.map(m => `<span title="${esc(m.title || "missing")}">${m.n}</span>`))
          .sort((a, b) => parseFloat(a.replace(/^.*?>/, "")) - parseFloat(b.replace(/^.*?>/, ""))).join("")}</div>
        ${s.next ? `<div class="small muted" style="margin-top:6px">Next: ${esc(s.next.title)}</div>` : s.nextMissing ? `<div class="small muted" style="margin-top:6px">Next: #${s.nextMissing.n}${s.nextMissing.title ? " " + esc(s.nextMissing.title) : ""} (not in your library)</div>` : ""}
      </div>`).join("")}</section>`;
  }

  // ------------------------------------------------------------------ Stats
  function renderStats() {
    const st = B.stats(lib, ui.year);
    const max = Math.max(1, ...st.months);
    const years = Object.keys(st.years).map(Number).concat([new Date().getFullYear()]).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a);
    const p = st.pace;
    return `<section><div class="sechead"><h2>Stats</h2><select class="inp" style="width:auto" data-change="year">${years.map(y => `<option ${y === ui.year ? "selected" : ""}>${y}</option>`).join("")}</select></div>
        <div class="kpis">
          <div><div class="big">${st.readYear}</div><small>books read in ${ui.year}</small></div>
          <div><div class="big">${fmt(st.pagesYear)}</div><small>pages</small></div>
          <div><div class="big">${st.avgRating ? st.avgRating.toFixed(1) + "★" : "–"}</div><small>your average rating</small></div>
          <div><div class="big">${st.daysPerBook || "–"}</div><small>days per book</small></div>
        </div></section>
      <section><div class="sechead"><h2>Reading goal ${ui.year}</h2><button class="btn small" data-action="goal">${st.goal ? "Change" : "Set a goal"}</button></div>
        ${st.goal ? `<div class="prog" style="height:10px"><i style="width:${Math.min(100, st.readYear / st.goal * 100)}%"></i></div>
          <p class="small" style="margin:8px 0 0">${p.reached ? "Goal reached!" : `${st.readYear} of ${st.goal} · ${p.ahead >= 0.5 ? `${Math.round(p.ahead)} ahead of schedule` : p.ahead <= -0.5 ? `${Math.round(-p.ahead)} behind schedule` : "right on schedule"} · ${p.left} to go, about ${p.perWeek.toFixed(1)} a week${p.pagesPerDay ? ` (≈${Math.round(p.pagesPerDay)} pages a day)` : ""}`}</p>`
          : `<p class="small muted">No goal for ${ui.year} yet.</p>`}</section>
      <section><h2>Books per month</h2><div class="months">${st.months.map((n, i) => `<div><span>${n || ""}</span><i style="height:${n / max * 80}%"></i><span>${"JFMAMJJASOND"[i]}</span></div>`).join("")}</div></section>
      <section><h2>All time</h2><div class="kv">
        <dt>Books read</dt><dd>${st.totalRead}</dd><dt>Reading now</dt><dd>${st.reading}</dd><dt>Want to read</dt><dd>${st.want}</dd>
        <dt>Average length</dt><dd>${st.avgPages ? st.avgPages + " pages" : "–"}</dd>
        ${st.fastest ? `<dt>Fastest</dt><dd>${esc(st.fastest.b.title)} (${st.fastest.days} day${st.fastest.days === 1 ? "" : "s"})</dd>` : ""}
        ${st.longest ? `<dt>Longest</dt><dd>${esc(st.longest.title)} (${st.longest.pages} pages)</dd>` : ""}
        ${st.spent ? `<dt>Spent</dt><dd>${B.eur(st.spent)}</dd>` : ""}
        ${Object.keys(st.years).length ? `<dt>By year</dt><dd>${Object.entries(st.years).sort((a, b) => b[0] - a[0]).map(([y, n]) => `${y}: ${n}`).join(" · ")}</dd>` : ""}
      </div></section>
      ${st.topAuthors.length ? `<section><h2>Top authors</h2><div class="bars">${bars(st.topAuthors)}</div></section>` : ""}
      ${st.topGenres.length ? `<section><h2>Top genres</h2><div class="bars">${bars(st.topGenres)}</div></section>` : ""}`;
  }
  const bars = list => { const m = Math.max(1, ...list.map(x => x[1])); return list.map(([k, n]) => `<span class="ellipsis">${esc(k)}</span><span class="track"><i style="width:${n / m * 100}%;background:var(--action)"></i></span><span class="v">${n}</span>`).join(""); };

  // ------------------------------------------------------------------ More
  function renderMore() {
    const s = lib.settings;
    return `<section><h2>Prices</h2>
        <label class="switch"><input type="checkbox" data-set="alerts" ${s.alerts ? "checked" : ""} ${feat("bookPrices") ? "" : "disabled"}><span>Ebook price alerts<small class="muted" style="display:block">About twice a day, checks Google Play Books prices of your Want-to-read books and notifies you when one drops by ${s.dropPct || 10}% or reaches your target.</small></span></label>
        <div class="row" style="margin-top:8px"><span class="grow small muted">Smallest drop worth a notification</span><input class="inp" style="width:80px" type="number" min="1" max="90" data-set="dropPct" value="${s.dropPct || 10}"> %</div>
        <div class="row" style="margin-top:8px"><button class="btn" data-action="prices" ${ui.busy ? "disabled" : ""}>${icon("bell")}Check prices now</button><span class="small muted">${esc(ui.busy)}</span></div>
      </section>
      <section><h2>Bring your books</h2>
        <p class="small muted" style="margin-top:0">A BookCheck backup (BookCheck › Backup › Export), a Goodreads export (goodreads.com › My Books › Import and export) or a StoryGraph export. Books you already have keep your data; only empty fields are filled in.</p>
        <button class="btn" data-action="import">Import a file</button></section>
      <section><h2>Backup</h2>
        <p class="small muted" style="margin-top:0">Canon › Settings › Backup saves every tab at once, books included. This saves only your books.</p>
        <div class="row wrap"><button class="btn" data-action="export">Save books backup</button><button class="btn quiet" data-action="restorefile">Restore from a file</button></div></section>
      <section><h2>Where the data comes from</h2>
        <p class="small muted" style="margin:0">Google Books (search, covers, ebook prices for Italy) and Open Library (search, community ratings, page counts). Amazon.it, IBS, laFeltrinelli, Kobo, Libraccio, AbeBooks, eBay and Vinted have no public price API: they open as searches, and “Log a price” keeps track of what you find there. Goodreads and StoryGraph have no public API: use their exports.</p></section>`;
  }

  // ------------------------------------------------------------------ book sheet
  function sheet(html) { $("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`; }
  const closeSheet = () => { $("#overlay").innerHTML = ""; };
  let sheetId = null, editing = false;

  function openBook(id, edit) {
    const b = lib.get(id);
    if (!b) return;
    sheetId = id; editing = !!edit;
    const pct = B.percent(b);
    const day = t => (t ? new Date(t).toISOString().slice(0, 10) : "");
    const ser = b.series ? B.seriesList(lib).find(s => B.norm(s.name) === B.norm(b.series)) : null;
    const linksHtml = B.storeLinks(b).map(([n, u]) => `<button class="sheetbtn" data-action="url" data-url="${esc(u)}">${icon("open")}${esc(n)}</button>`).join("");
    if (editing) {
      sheet(`<h3>Edit details</h3><div class="stack">
        ${[["title", "Title"], ["subtitle", "Subtitle"], ["authors", "Authors (comma separated)"], ["series", "Series name"], ["seriesNum", "Number in series"], ["pages", "Pages"],
           ["isbn13", "ISBN"], ["publisher", "Publisher"], ["published", "Published"], ["categories", "Genres (comma separated)"], ["shelves", "Your shelves (comma separated)"], ["location", "Where it is (shelf, lent to…)"], ["cover", "Cover image link"]]
          .map(([k, l]) => `<label><span class="lbl">${l}</span><input class="inp" data-edit="${k}" value="${esc(Array.isArray(b[k]) ? b[k].join(", ") : b[k] == null ? "" : b[k])}"></label>`).join("")}
        <label><span class="lbl">Format</span><select class="inp" data-edit="format">${B.FORMATS.map(f => `<option ${b.format === f ? "selected" : ""}>${f}</option>`).join("")}</select></label>
        <div class="row"><button class="btn" data-action="book" data-id="${esc(b.id)}">Cancel</button><button class="btn primary grow" data-action="saveedit">Save</button></div></div>`);
      return;
    }
    sheet(`<div class="sheethead">${cover(b, true)}<div class="grow"><h3 style="margin-bottom:2px">${esc(b.title)}</h3>
        ${b.subtitle ? `<p class="small muted" style="margin:0 0 4px">${esc(b.subtitle)}</p>` : ""}
        <p class="small" style="margin:0">${b.authors.length ? b.authors.map(a => `<button class="linkbtn" data-action="author" data-a="${esc(a)}">${esc(a)}</button>`).join(", ") : "Unknown author"}</p>
        ${b.series ? `<button class="btn quiet small" style="padding:0;min-height:30px" data-action="seriesopen" data-s="${esc(b.series)}">${b.seriesNum != null ? "#" + esc(b.seriesNum) + " in " : ""}${esc(b.series)}${ser ? ` · ${ser.read}/${ser.total} read` : ""} ›</button>` : ""}
        <p class="small muted" style="margin:4px 0 0">${esc([b.published, b.pages ? b.pages + " pages" : "", b.format, b.avgRating ? `★ ${b.avgRating.toFixed(1)} (${fmt(b.ratingsCount)}, ${b.ratingSource})` : ""].filter(Boolean).join(" · "))}</p></div></div>
      <div class="seg2" style="margin:12px 0">${B.STATUSES.map(s => `<button data-action="status" data-v="${s}" aria-pressed="${b.status === s}">${{ reading: "Reading", want: "Want", read: "Read", dnf: "DNF" }[s]}</button>`).join("")}</div>
      ${b.status === "read" || b.status === "dnf" || b.rating ? `<div class="row"><span class="small muted grow">Your rating</span><span class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-action="rate" data-v="${i}" class="${b.rating >= i * 2 ? "on" : b.rating === i * 2 - 1 ? "half" : ""}" aria-label="${i} stars">★</button>`).join("")}</span></div>` : ""}
      ${b.status === "reading" || b.status === "read" ? `<div style="margin:10px 0"><div class="row"><span class="small muted grow">${b.pages ? `Page ${b.currentPage} of ${b.pages} · ${pct}%` : "Progress"}</span>
          <input class="inp" style="width:90px" type="number" inputmode="numeric" data-page="1" value="${b.currentPage || ""}" placeholder="page">
          <button class="btn" data-action="page" data-id="${esc(b.id)}" data-d="10">+10</button></div><div class="prog"><i style="width:${pct}%"></i></div></div>` : ""}
      <div class="grid2" style="margin:8px 0">
        <label><span class="lbl">Started</span><input class="inp" type="date" data-date="started" value="${day(b.started)}"></label>
        <label><span class="lbl">Finished</span><input class="inp" type="date" data-date="finished" value="${day(b.finished)}"></label></div>
      ${readsHtml(b)}
      <label><span class="lbl">Notes</span><textarea class="inp" data-notes="1" placeholder="Thoughts, quotes, who recommended it…">${esc(b.notes)}</textarea></label>
      ${feat("bookPrices") ? `<h4>Prices</h4>
        <div class="kv"><dt>Google Play Books</dt><dd>${b.gbPrice == null ? "not checked" : `<span class="price ${b.targetPrice != null && b.gbPrice <= b.targetPrice ? "good" : ""}">${b.gbPrice === 0 ? "Free" : B.eur(b.gbPrice)}</span>${b.gbListPrice && b.gbListPrice > b.gbPrice ? ` <s class="muted">${B.eur(b.gbListPrice)}</s>` : ""}${b.priceChecked ? ` <span class="muted small">· ${daysAgo(b.priceChecked)}</span>` : ""}`}</dd>
          ${b.lowestPrice != null ? `<dt>Lowest seen</dt><dd>${B.eur(b.lowestPrice)} <span class="muted small">${esc(b.lowestSource)}</span></dd>` : ""}
          ${b.pricePaid != null ? `<dt>You paid</dt><dd>${B.eur(b.pricePaid)}</dd>` : ""}</div>
        <div class="grid2" style="margin-top:8px">
          <label><span class="lbl">Alert me at or below €</span><input class="inp" inputmode="decimal" data-money="targetPrice" value="${b.targetPrice != null ? b.targetPrice : ""}" placeholder="any drop"></label>
          <label><span class="lbl">I paid €</span><input class="inp" inputmode="decimal" data-money="pricePaid" value="${b.pricePaid != null ? b.pricePaid : ""}"></label></div>
        <div class="row wrap" style="margin-top:8px"><button class="btn small" data-action="checkprice">Check price now</button><button class="btn small" data-action="logprice">Log a price I found</button>
          ${b.gbBuyLink ? `<button class="btn small quiet" data-action="url" data-url="${esc(b.gbBuyLink)}">Open in Play Books ›</button>` : ""}</div>
        ${(b.priceHistory || []).length ? `<details class="report"><summary>Price history (${b.priceHistory.length})</summary>${b.priceHistory.slice().reverse().slice(0, 20).map(h => `<div class="small">${new Date(h.t).toLocaleDateString("en-GB")} · ${B.eur(h.p)} · ${esc(h.src)}</div>`).join("")}</details>` : ""}
        <details class="report"><summary>Look in other stores</summary>${linksHtml}</details>` : ""}
      ${b.description ? `<details class="report"><summary>Description (may contain spoilers)</summary><p class="small">${esc(b.description)}</p></details>` : ""}
      <div style="margin-top:10px">
        <button class="sheetbtn" data-action="edit">${icon("more")}Edit details</button>
        ${!b.pages || !b.cover ? `<button class="sheetbtn" data-action="refresh">${icon("find")}Fill in missing details</button>` : ""}
        <button class="sheetbtn" data-action="url" data-url="${esc(b.olKey ? "https://openlibrary.org" + b.olKey : "https://www.google.com/search?q=" + encodeURIComponent(b.title + " " + (b.authors[0] || "")))}">${icon("open")}${b.olKey ? "Open Library page" : "Search the web"}</button>
        <button class="sheetbtn" data-action="remove">${icon("trash")}Remove from library</button></div>`);
  }

  function readsHtml(b) {
    const list = B.readsOf(b), today = new Date().toISOString().slice(0, 10);
    const d = t => (t ? new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "?");
    return `<div class="reads"><div class="row"><b class="grow">Reads</b><span class="small muted">${list.length ? `${list.length}×` : "none finished yet"}</span></div>
      ${list.map((r, i) => `<div class="row small"><span class="grow">${i + 1}. ${r.started && r.started !== r.finished ? `${esc(d(r.started))} – ` : ""}${esc(d(r.finished))}${r.current ? " · latest" : ""}</span><button class="btn quiet small" data-action="unread" data-i="${i}" aria-label="Remove this read">✕</button></div>`).join("")}
      <details${ui.addRead ? " open" : ""}><summary class="small" data-action="addreadopen">Add a read (a past one, or another time through)</summary>
        <div class="grid2" style="margin-top:6px"><label><span class="lbl">Started</span><input class="inp" type="date" id="rdS" max="${today}"></label>
        <label><span class="lbl">Finished</span><input class="inp" type="date" id="rdF" value="${today}" max="${today}"></label></div>
        <button class="btn small" data-action="addread" style="margin-top:6px">Add this read</button></details>
      ${b.status === "read" ? `<button class="btn quiet small" data-action="status" data-v="reading" style="margin-top:4px">Start reading it again</button>` : ""}</div>`;
  }

  // ------------------------------------------------------------------ authors: your books by them, then everything they wrote
  async function openAuthor(name) {
    ui.author = name;
    const mine = lib.books.filter(b => b.authors.some(a => B.norm(a) === B.norm(name)));
    const render2 = (works, err) => {
      const have = w => lib.find(w);
      sheet(`<div class="kicker">Author</div><h3>${esc(name)}</h3>
        <p class="small muted">${mine.length} in your library · ${mine.filter(b => b.status === "read").length} read</p>
        ${mine.sort((a, b) => (parseInt(a.published, 10) || 9999) - (parseInt(b.published, 10) || 9999)).map(row).join("")}
        <h4>All books by ${esc(name)}</h4>
        ${works === null ? `<p class="small muted">Looking them up…</p>` : err ? `<p class="small muted">${esc(err)}</p>` :
          works.filter(w => !have(w)).map((w, i) => `<div class="item" data-action="awork" data-i="${works.indexOf(w)}">${cover(w)}<div class="grow body"><div class="ttl"><b>${esc(w.title)}</b></div>
            <div class="sub"><span class="muted small">${esc([w.published, w.pages ? w.pages + " pages" : ""].filter(Boolean).join(" · "))}</span></div></div>
            <button class="seen" data-action="aworkadd" data-i="${works.indexOf(w)}" aria-label="Add ${esc(w.title)} to Want to read">${icon("plus")}</button></div>`).join("") || `<p class="small muted">You have everything we could find.</p>`}
        <p class="small muted">From Open Library${works && works.length && works.some(w => w.gid) ? " and Google Books" : ""}. Editions are merged by title.</p>`);
    };
    render2(null);
    if (!ui.authorWorks || ui.authorWorks.name !== name) {
      try { ui.authorWorks = { name, list: await B.authorWorks(http, name, lib.settings.region || "IT") }; }
      catch (e) { if (ui.author === name) render2([], "Couldn't look up their books: " + e.message); return; }
    }
    if (ui.author === name && $(".sheet")) render2(ui.authorWorks.list);
  }

  function editSave() {
    const b = lib.get(sheetId); if (!b) return;
    document.querySelectorAll("[data-edit]").forEach(el => {
      const k = el.dataset.edit, v = el.value.trim();
      if (["authors", "categories", "shelves"].includes(k)) b[k] = v.split(/\s*,\s*/).filter(Boolean);
      else if (k === "pages") b.pages = Math.max(0, parseInt(v, 10) || 0);
      else if (k === "seriesNum") b.seriesNum = v === "" ? null : parseFloat(v.replace(",", "."));
      else if (k === "isbn13") { const d = B.isbnDigits(v); b.isbn13 = d.length === 10 ? B.isbn10to13(d) || "" : d; if (d.length === 10) b.isbn10 = d; }
      else b[k] = v;
    });
    if (!b.title) b.title = "Untitled";
    lib.save(); toast("Saved"); openBook(b.id); render();
  }

  // ------------------------------------------------------------------ actions
  async function doSearch(q) {
    ui.find = q = String(q || "").trim();
    if (!q) return;
    ui.busy = "Searching…"; ui.results = null; ui.tab = "find"; render();
    try { ui.results = await B.search(http, q, lib.settings.region || "IT"); }
    catch (e) { ui.results = []; toast("Search failed: " + e.message); }
    ui.busy = ""; render();
  }
  function addBook(b, status) {
    const r = lib.add(b, status);
    toast(r.existed ? "Already in your library" : `Added to ${B.STATUS_LABEL[r.book.status]}`);
    publish(); render();
    return r.book;
  }
  function chooseStatus(b) {
    sheet(`<div class="sheethead">${cover(b, true)}<div class="grow"><h3>${esc(b.title)}</h3><p class="small">${esc(b.authors.join(", "))}</p>
      <p class="small muted">${esc([b.published, b.pages ? b.pages + " pages" : "", b.publisher].filter(Boolean).join(" · "))}</p></div></div>
      <p class="small muted">Add to your library as</p>
      ${B.STATUSES.map(s => `<button class="sheetbtn" data-action="addas" data-v="${s}">${icon("plus")}${B.STATUS_LABEL[s]}</button>`).join("")}
      ${b.description ? `<details class="report"><summary>Description (may contain spoilers)</summary><p class="small">${esc(b.description)}</p></details>` : ""}`);
    chooseStatus.b = b;
  }
  async function fillIn(b) {
    toast("Looking it up…");
    try {
      const res = await B.search(http, B.bookIsbn(b) || `${b.title} ${b.authors[0] || ""}`, lib.settings.region || "IT");
      const m = res.find(x => (B.bookIsbn(b) && B.bookIsbn(x) === B.bookIsbn(b)) || B.norm(x.title) === B.norm(b.title)) || res[0];
      if (!m) return toast("Nothing found to fill in");
      let n = 0;
      for (const [k, v] of Object.entries(m)) { const cur = b[k]; if ((cur == null || cur === "" || cur === 0 || (Array.isArray(cur) && !cur.length)) && v != null && v !== "" && v !== 0 && !(Array.isArray(v) && !v.length)) { b[k] = v; n++; } }
      lib.save(); toast(n ? `${n} detail${n === 1 ? "" : "s"} filled in` : "Nothing new found"); openBook(b.id); render();
    } catch (e) { toast("Lookup failed: " + e.message); }
  }
  async function checkOne(b) {
    toast("Checking Google Play Books…");
    const r = await B.ebookPrice(http, b, lib.settings.region || "IT").catch(() => null);
    b.priceChecked = Date.now();
    if (r && r.price != null) { Object.assign(b, { gbPrice: r.price, gbListPrice: r.list, gbCurrency: r.currency, gbBuyLink: r.link || b.gbBuyLink }); B.logPrice(b, "Google Play Books", r.price); toast(`Ebook ${B.eur(r.price)}`); }
    else toast("Not on sale as an ebook on Google Play Books");
    lib.save(); openBook(b.id); render();
  }
  async function checkAll() {
    ui.busy = "Checking prices…"; render();
    const notes = await B.priceCheck(lib, http, { minAgeMs: 0, budget: 80 }).catch(e => { toast(e.message); return []; });
    notes.forEach(notify);
    ui.busy = ""; toast(notes.length ? `${notes.length} price drop${notes.length === 1 ? "" : "s"}` : "No drops on your wishlist"); render();
  }

  async function importFile() {
    const files = await pick();
    const f = files && files[0];
    if (!f) return;
    if (f.error) return toast("Couldn't read the file: " + f.error);
    const text = f.text || Object.values(f.zip || {})[0] || "";
    let imp;
    try { imp = B.readImport(text, f.name); } catch (e) { return toast(e.message); }
    sheet(`<h3>${esc(imp.kind)}</h3><p>${imp.books.length} book${imp.books.length === 1 ? "" : "s"} in ${esc(f.name || "the file")}.</p>
      <p class="small muted">Merge keeps everything you have and adds the rest. Replace makes your library exactly this file.</p>
      <button class="sheetbtn" data-action="importgo" data-v="merge">${icon("plus")}Merge with my library</button>
      ${lib.books.length ? `<button class="sheetbtn" data-action="importgo" data-v="replace">${icon("trash")}Replace my library (${lib.books.length} books)</button>` : ""}`);
    importFile.imp = imp;
  }

  // ------------------------------------------------------------------ Gemini
  function geminiKey() {
    try { const s = JSON.parse(A.load("canonsync.json") || "{}").settings || {}; return s.gemini_key ? { key: s.gemini_key, model: s.gemini_model_used || "gemini-flash-latest" } : null; } catch (e) { return null; }
  }
  async function askGemini(prompt, title, note) {
    const k = geminiKey();
    if (k) {
      try {
        const r = await http("POST", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(k.model)}:generateContent?key=${encodeURIComponent(k.key)}`,
          { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }) });
        if (r.status === 200) {
          const j = JSON.parse(r.body);
          const t = (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map(p => p.text || "").join("");
          if (B.parseJson(t)) return t;
        }
        toast("The Gemini API didn't answer: continuing in the Gemini app");
      } catch (e) { toast("The Gemini API failed: continuing in the Gemini app"); }
    }
    return BantaAI.ask({ title, note, prompt, expect: "json" });
  }
  async function gemRun(kind) {
    ui.busy = "Waiting for Gemini…"; render();
    try {
      let prompt, title;
      if (kind === "next") { prompt = B.nextPrompt(lib); title = "What to read next"; }
      else { prompt = B.newsPrompt(lib); title = "New from your authors and series"; }
      if (!lib.books.some(b => b.status === "read" || b.status === "reading")) { ui.busy = ""; render(); return toast("Mark a few books as read first, so Gemini knows your taste."); }
      const text = await askGemini(prompt, title, kind === "next" ? "Based on your ratings" : "Authors and series you've read");
      const books = B.suggestionBooks(lib, B.parseJson(text));
      ui.busy = ""; render();
      const ids = await BantaAI.review({ title: books.length ? `${books.length} suggestion${books.length === 1 ? "" : "s"}` : "Nothing new", note: "Ticked books are added to Want to read. Open one later to fill in cover and details.",
        items: books.map((b, i) => ({ id: String(i), title: b.title, sub: [b.authors.join(", "), b.published, b.series ? `${b.series}${b.seriesNum != null ? " #" + b.seriesNum : ""}` : "", b.notes.replace(/^Suggested: /, "")].filter(Boolean).join(" · "),
          tag: b.announced ? "Announced" : "", tagClass: "new", checked: kind === "news" })), ok: "Add to Want to read", empty: "Gemini found nothing that isn't already in your library." });
      ids.forEach(i => lib.add(books[+i], "want"));
      if (ids.length) { toast(`${ids.length} added`); publish(); render(); }
    } catch (e) { if (!e.cancelled) toast(e.message); }
    ui.busy = ""; render();
  }
  async function gemSeries(only) {
    const series = B.seriesList(lib).filter(s => !only || s.name === only).slice(0, 25);
    if (!series.length) return;
    ui.busy = "Waiting for Gemini…"; render();
    try {
      const text = await askGemini(B.seriesPrompt(series), "Complete your series", series.map(s => s.name).slice(0, 6).join(", ") + (series.length > 6 ? "…" : ""));
      const missing = B.parseSeriesAnswer(lib, text, series);
      ui.busy = ""; render();
      const ids = await BantaAI.review({ title: missing.length ? `${missing.length} book${missing.length === 1 ? "" : "s"} you don't have` : "Your series are complete", items: missing.map((m, i) => ({ id: String(i),
        title: m.title, sub: `${m.series} #${m.n}${m.year ? " · " + m.year : ""}${m.titleEn && m.titleEn !== m.title ? " · " + m.titleEn : ""}`, tag: m.announced ? "Announced" : "", tagClass: "new", checked: false })),
        note: "The series view now shows the gaps. Tick the ones to add to Want to read.", ok: "Add to Want to read", empty: "Every book in these series is in your library." });
      for (const i of ids) { const m = missing[+i]; lib.add({ title: m.title, series: m.series, seriesNum: m.n, published: m.year, authors: (series.find(s => s.name === m.series).books[0] || { authors: [] }).authors.slice(0, 1) }, "want"); }
      if (ids.length) toast(`${ids.length} added`);
      publish();
    } catch (e) { if (!e.cancelled) toast(e.message); }
    ui.busy = ""; render();
  }

  // ------------------------------------------------------------------ scanner
  let stream = null, scanTimer = null;
  async function scan() {
    $("#overlay").innerHTML = `<div class="scanner"><video playsinline muted></video><div class="aim"></div><div class="bar">
      <div class="msg" id="scanmsg">Point at the barcode on the back cover</div>
      <div class="row"><input class="inp grow" id="isbnin" inputmode="numeric" placeholder="…or type the ISBN"><button class="btn primary" data-action="isbngo">Find</button></div>
      <button class="btn block" data-action="scanstop">Close</button></div></div>`;
    const msg = $("#scanmsg");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) { msg.textContent = "The camera isn't available. Type the ISBN instead."; return; }
    const video = $(".scanner video");
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay blocked: frames still arrive */ }
    let detector = null;
    try { if ("BarcodeDetector" in window) detector = new BarcodeDetector({ formats: ["ean_13"] }); } catch (e) { detector = null; }
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    const tick = async () => {
      if (!stream) return;
      let code = null;
      try {
        if (detector) { const r = await detector.detect(video); code = (r.find(x => /^97[89]\d{10}$/.test(x.rawValue)) || {}).rawValue || null; }
        if (!code && video.videoWidth) {
          const w = Math.min(1000, video.videoWidth), h = Math.round(video.videoHeight * w / video.videoWidth);
          canvas.width = w; canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          for (const f of [0.5, 0.44, 0.56, 0.4, 0.6]) {
            const y = Math.round(h * f), d = ctx.getImageData(0, y, w, 1).data, g = new Array(w);
            for (let i = 0; i < w; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
            const c = B.decodeLine(g);
            if (c && /^97[89]/.test(c)) { code = c; break; }
          }
        }
      } catch (e) { /* next frame */ }
      if (code) { stopScan(); if (navigator.vibrate) navigator.vibrate(60); lookupIsbn(code); return; }
      scanTimer = setTimeout(tick, detector ? 150 : 220);
    };
    tick();
  }
  function stopScan() { clearTimeout(scanTimer); if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } closeSheet(); }
  async function lookupIsbn(isbn) {
    isbn = B.isbnDigits(isbn);
    if (!(B.validIsbn13(isbn) || B.validIsbn10(isbn))) return toast("That's not a book ISBN (978/979…)");
    const have = lib.find({ isbn13: isbn.length === 13 ? isbn : B.isbn10to13(isbn), isbn10: isbn.length === 10 ? isbn : "" });
    if (have) { toast("Already in your library"); return openBook(have.id); }
    toast("Looking up ISBN " + isbn);
    try {
      const res = await B.search(http, isbn, lib.settings.region || "IT");
      if (!res.length) { ui.find = isbn; ui.results = []; ui.tab = "find"; render(); return toast("No book found for ISBN " + isbn + ". Try searching by title."); }
      chooseStatus(res[0]);
    } catch (e) { toast("Lookup failed: " + e.message); }
  }

  // ------------------------------------------------------------------ shared with the other tabs
  function publish() {
    if (!SH) return;
    try {
      SH.write("index_books.json", JSON.stringify(B.indexFor(lib)));
      SH.write("snap_books.json", JSON.stringify(lib.toJSON()));
    } catch (e) { /* best-effort */ }
  }
  function applyRestore() {
    if (!SH) return;
    const t = SH.read("restore_books.json");
    if (!t) return;
    SH.remove("restore_books.json");
    try { const imp = B.readImport(t); B.applyImport(lib, imp, "replace"); toast(`Books restored: ${lib.books.length}`); publish(); render(); }
    catch (e) { toast("Books restore failed: " + e.message); }
  }
  function takeImport() {
    if (!SH) return;
    const t = SH.read("import_books.json");
    if (!t) return;
    SH.remove("import_books.json");
    try {
      const j = JSON.parse(t);
      const imp = j.rows ? { kind: j.kind, books: j.rows.map(r => Object.assign({}, r, { finished: r.finished ? Date.parse(r.finished + "T12:00:00") : 0, started: r.started ? Date.parse(r.started + "T12:00:00") : 0 })) } : B.readImport(j.raw, j.name);
      const r = B.applyImport(lib, imp, "merge");
      publish(); render(); toast(`${imp.kind}: ${r.added} added${r.updated ? `, ${r.updated} updated` : ""}`);
    } catch (e) { toast("Books import failed: " + e.message); }
  }
  if (SH) SH.onMessage(m => { if (m.importFile) takeImport(); if (m.open) { const b = lib.get(m.open); if (b) openBook(b.id); } });

  // ------------------------------------------------------------------ render and events
  const TABS = [["library", "Library"], ["find", "Find"], ["series", "Series"], ["stats", "Stats"], ["more", "More"]];
  const RENDER = { library: renderLibrary, find: renderFind, series: renderSeries, stats: renderStats, more: renderMore };
  function render() {
    const active = document.activeElement, keep = active && active.dataset && active.dataset.input ? active.dataset.input : null;
    $("#view").dataset.tab = ui.tab;
    $("#view").innerHTML = RENDER[ui.tab]();
    $("#tabs").innerHTML = TABS.map(([k, l]) => `<button data-action="tab" data-tab="${k}" ${ui.tab === k ? 'aria-current="page"' : ""}>${icon(k)}<span>${l}</span></button>`).join("");
    if (keep) { const el = document.querySelector(`[data-input="${keep}"]`); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
  }

  document.addEventListener("click", e => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    if (a === "dismiss" && e.target !== el) return; // taps inside the sheet
    const b = sheetId ? lib.get(sheetId) : null;
    switch (a) {
      case "tab": ui.tab = el.dataset.tab; closeSheet(); render(); scrollTo(0, 0); break;
      case "dismiss": closeSheet(); break;
      case "filter": ui.filter = el.dataset.v; render(); break;
      case "book": e.stopPropagation(); openBook(el.dataset.id); break;
      case "result": chooseStatus(ui.results[+el.dataset.i]); break;
      case "quickadd": e.stopPropagation(); addBook(ui.results[+el.dataset.i], "want"); break;
      case "addas": { const nb = addBook(chooseStatus.b, el.dataset.v); openBook(nb.id); break; }
      case "search": doSearch($('[data-input="findq"]').value); break;
      case "manual": { const nb = lib.add({ title: ui.find || "New book" }, "want").book; openBook(nb.id, true); break; }
      case "page": { e.stopPropagation(); const x = lib.get(el.dataset.id); if (!x) break; B.setPage(x, (x.currentPage || 0) + (+el.dataset.d)); lib.save(); publish(); if (x.status === "read") toast(`Finished ${x.title}!`); if (sheetId === x.id && $(".sheet")) openBook(x.id); render(); break; }
      case "status": if (b) { B.setStatus(b, el.dataset.v); lib.save(); publish(); openBook(b.id); render(); } break;
      case "rate": if (b) { const v = +el.dataset.v * 2; b.rating = b.rating === v ? v - 1 : b.rating === v - 1 ? 0 : v; lib.save(); openBook(b.id); render(); } break;
      case "edit": if (b) openBook(b.id, true); break;
      case "saveedit": editSave(); break;
      case "refresh": if (b) fillIn(b); break;
      case "remove": if (b && confirmTwice(el, "Tap again to remove")) { lib.remove(b.id); closeSheet(); publish(); render(); toast("Removed"); } break;
      case "url": openUrl(el.dataset.url); break;
      case "checkprice": if (b) checkOne(b); break;
      case "logprice": if (b) logPriceSheet(b); break;
      case "logsave": if (b) { const src = $("#lpsrc").value.trim() || "Store", p = parseFloat($("#lpval").value.replace(",", ".")); if (p >= 0) { B.logPrice(b, src, p); lib.save(); toast("Logged"); } openBook(b.id); } break;
      case "seriesopen": ui.tab = "library"; ui.filter = "all"; ui.q = el.dataset.s; ui.sort = "author"; closeSheet(); render(); break;
      case "gemseries": gemSeries(); break;
      case "gem": gemRun(el.dataset.k); break;
      case "goal": goalSheet(); break;
      case "goalsave": { const n = parseInt($("#goaln").value, 10) || 0; lib.goal = { year: ui.year, n }; lib.save(); publish(); closeSheet(); render(); break; }
      case "prices": checkAll(); break;
      case "import": case "restorefile": importFile(); break;
      case "importgo": { const r = B.applyImport(lib, importFile.imp, el.dataset.v); closeSheet(); publish(); render(); toast(`${r.added} added${r.updated ? `, ${r.updated} updated` : ""}`); break; }
      case "export": saveAs(`books-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(lib.toJSON())).then(ok => toast(ok ? "Backup saved" : "Not saved")); break;
      case "scan": scan(); break;
      case "author": e.stopPropagation(); openAuthor(el.dataset.a); break;
      case "aworkadd": { e.stopPropagation(); const w = ui.authorWorks && ui.authorWorks.list[+el.dataset.i]; if (w) { addBook(w, "want"); openAuthor(ui.author); } break; }
      case "awork": { const w = ui.authorWorks && ui.authorWorks.list[+el.dataset.i]; if (w) chooseStatus(w); break; }
      case "addreadopen": ui.addRead = !ui.addRead; break;
      case "addread": if (b) { const st = $("#rdS").value, fi = $("#rdF").value; if (!fi) { toast("Pick the day you finished it"); break; } const n = B.addRead(b, st ? Date.parse(st + "T12:00:00") : 0, Date.parse(fi + "T12:00:00")); ui.addRead = false; lib.save(); publish(); toast(`Read ${n}×`); openBook(b.id); render(); } break;
      case "unread": if (b) { B.removeRead(b, +el.dataset.i); lib.save(); publish(); openBook(b.id); render(); } break;
      case "scanstop": stopScan(); break;
      case "isbngo": { const v = $("#isbnin").value; stopScan(); lookupIsbn(v); break; }
    }
  });
  const confirmTwice = (el, msg) => { if (el.dataset.armed) return true; el.dataset.armed = "1"; el.lastChild.textContent = msg; return false; };
  function logPriceSheet(b) {
    sheet(`<h3>Log a price</h3><p class="small muted">Something you saw on Amazon.it, IBS, Libraccio, in a shop… It's kept in the price history and counts for the lowest price.</p>
      <div class="stack"><label><span class="lbl">Where</span><input class="inp" id="lpsrc" placeholder="e.g. Amazon.it, IBS, Libraccio (used)"></label>
      <label><span class="lbl">Price €</span><input class="inp" id="lpval" inputmode="decimal"></label>
      <div class="row"><button class="btn" data-action="book" data-id="${esc(b.id)}">Cancel</button><button class="btn primary grow" data-action="logsave">Save</button></div></div>`);
  }
  function goalSheet() {
    const g = lib.goal && lib.goal.year === ui.year ? lib.goal.n : 0;
    sheet(`<h3>Reading goal ${ui.year}</h3><label><span class="lbl">Books to read this year</span><input class="inp" id="goaln" type="number" min="0" value="${g || ""}"></label>
      <div class="row" style="margin-top:10px"><button class="btn" data-action="dismiss">Cancel</button><button class="btn primary grow" data-action="goalsave">Save</button></div>`);
  }
  document.addEventListener("input", e => {
    const el = e.target;
    if (el.dataset.input === "libq") { ui.q = el.value; clearTimeout(render.t); render.t = setTimeout(render, 160); }
    if (el.dataset.input === "findq") ui.find = el.value;
  });
  document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset && e.target.dataset.input === "findq") doSearch(e.target.value); if (e.key === "Enter" && e.target.id === "isbnin") { const v = e.target.value; stopScan(); lookupIsbn(v); } });
  document.addEventListener("change", e => {
    const el = e.target, b = sheetId ? lib.get(sheetId) : null;
    if (el.dataset.change === "sort") { ui.sort = el.value; render(); }
    if (el.dataset.change === "year") { ui.year = +el.value; render(); }
    if (el.dataset.set) { lib.settings[el.dataset.set] = el.type === "checkbox" ? (el.checked ? 1 : 0) : Math.max(1, Math.min(90, +el.value || 10)); lib.save(); }
    if (!b) return;
    if (el.dataset.page) { B.setPage(b, el.value); lib.save(); publish(); openBook(b.id); render(); }
    if (el.dataset.date) { b[el.dataset.date] = el.value ? Date.parse(el.value + "T12:00:00") : 0; lib.save(); render(); }
    if (el.dataset.notes) { b.notes = el.value; lib.save(); }
    if (el.dataset.money) { const v = el.value.trim() === "" ? null : parseFloat(el.value.replace(",", ".")); b[el.dataset.money] = v != null && v >= 0 ? v : null; lib.save(); toast(el.dataset.money === "targetPrice" ? (v != null ? `You'll be notified at ${B.eur(v)} or less` : "Alert at any drop") : "Saved"); }
  });

  window.__back = () => {
    if (stream) { stopScan(); return true; }
    if ($("#overlay").innerHTML) { closeSheet(); return true; }
    if (ui.tab !== "library") { ui.tab = "library"; render(); return true; }
    return false;
  };
  window.__resumed = () => { if (!$("#overlay").innerHTML) render(); };
  window.__openTab = t => { if (RENDER[t]) { ui.tab = t; render(); } };
  window.__books = { lib, ui, render, openBook, publish, applyRestore, lookupIsbn };

  render();
  applyRestore();
  takeImport();
  setTimeout(publish, 400);
})();
