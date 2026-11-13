/* Saga activity history (roadmap Phase 1, first step): one dated list of everything you watched, played and read,
   built from the separate stores (films and series, games, books, Doctor Who) through one adapter. Stats, the
   diary and "Recently" all read from it, so they can't disagree. Nothing is stored twice: the list is rebuilt
   from the stores when asked. */
(function (root) {
  "use strict";
  const day = d => {
    if (!d) return "";
    if (typeof d === "number") return new Date(d).toISOString().slice(0, 10);
    const s = String(d).slice(0, 10);
    return /^\d{4}-\d\d-\d\d$/.test(s) ? s : "";
  };
  // events: { d: "YYYY-MM-DD", kind: film|rewatch|episode|game|book|story, t, sub, mins, rating, key, bulk, img, id, app }
  function build(src) {
    const out = [];
    const push = e => { if (e.d) out.push(e); };
    if (src.library) for (const it of src.library.all()) {
      if (it.type === "movie") (it.watches || []).forEach((d, i) => push({ d: day(d), kind: i ? "rewatch" : "film", t: it.title, sub: it.year ? String(it.year) : "", mins: it.runtime || 110, rating: it.rating || 0, key: "lib:" + it.id, id: it.id, app: "watch", img: it.poster }));
      else for (const [k, d] of Object.entries(it.eps || {})) {
        const [s, e] = k.split(":");
        push({ d: day(d), kind: "episode", t: it.title, sub: `S${s} E${e}`, mins: it.runtime || 45, rating: it.rating || 0, key: "lib:" + it.id, id: it.id, app: "watch", img: it.poster, bulk: !!(it.bulk && it.bulk[k]), s: +s, e: +e });
      }
    }
    if (src.games) for (const g of src.games.visible()) (g.plays || []).forEach((d, i) => push({ d: day(d), kind: "game", t: g.title, sub: i ? `finished again (${i + 1}×)` : "finished", hours: g.hours || 0, rating: g.rating || 0, key: "game:" + g.id, id: g.id, app: "games", img: g.cover || (g.steam && src.gameCover ? src.gameCover(g.steam) : "") }));
    if (src.books) for (const b of src.books.books) (src.readsOf ? src.readsOf(b) : []).forEach((r, i) => push({ d: day(r.finished), kind: "book", t: b.title, sub: `${(b.authors || [])[0] || b.author || ""}${i ? ` · read ${i + 1}×` : ""}`, pages: b.pages || 0, rating: b.rating || 0, key: "book:" + b.id, id: b.id, app: "books", img: (b.cover || "").replace(/^http:/, "https:") }));
    // 0.5.8: play sessions and reading progress (pages or chapters read that day)
    if (src.games) for (const g of src.games.visible()) for (const x of g.sessions || []) push({ d: day(x.d), kind: "session", t: g.title, sub: `played ${x.mins >= 60 ? `${Math.round(x.mins / 6) / 10} h` : `${x.mins} min`}${x.note ? ` · ${x.note}` : ""}`, mins: x.mins, key: "game:" + g.id, id: g.id, app: "games", img: g.cover || "" });
    if (src.books) for (const b of src.books.books) {
      const byDay = new Map(); let prevP = 0, prevC = 0;
      for (const x of (b.log || []).slice().sort((a, c) => (a.t || 0) - (c.t || 0))) {
        const d = day(x.t); if (!d) continue;
        const o = byDay.get(d) || { pages: 0, chapters: 0, to: 0, toC: 0 };
        if (x.p != null) { o.pages += Math.max(0, x.p - prevP); prevP = x.p; o.to = x.p; }
        if (x.c != null) { o.chapters += Math.max(0, x.c - prevC); prevC = x.c; o.toC = x.c; }
        byDay.set(d, o);
      }
      for (const [d, o] of byDay) if (o.pages || o.chapters) push({ d, kind: "reading", t: b.title, sub: o.chapters ? `${o.chapters} chapter${o.chapters === 1 ? "" : "s"} (to ch. ${o.toC})` : `${o.pages} pages (to p. ${o.to})`, pages: o.pages, chapters: o.chapters, key: "book:" + b.id, id: b.id, app: "books", img: (b.cover || "").replace(/^http:/, "https:") });
    }
    if (src.stories) for (const x of src.stories) push({ d: day(x.date), kind: "story", t: x.t, sub: "Doctor Who", key: "dw:" + x.k, id: x.k, app: "dw" });
    return out.sort((a, b) => b.d.localeCompare(a.d) || (b.e || 0) - (a.e || 0));
  }
  // what a year adds up to; episodes ticked in bulk (no real date) are left out and counted apart
  function year(events, y) {
    const ys = String(y), m = Array(12).fill(0);
    const c = { year: y, months: m, films: 0, episodes: 0, bulkEps: 0, rewatches: 0, minutes: 0, games: 0, gameHours: 0, books: 0, pages: 0, stories: 0, sessionMins: 0, readPages: 0, readChapters: 0 };
    const top = new Map();
    for (const e of events) {
      if (!e.d.startsWith(ys)) continue;
      if (e.bulk) { c.bulkEps++; continue; }
      m[+e.d.slice(5, 7) - 1]++;
      if (e.kind === "film" || e.kind === "rewatch") { c.films++; if (e.kind === "rewatch") c.rewatches++; c.minutes += e.mins || 0; }
      else if (e.kind === "episode") { c.episodes++; c.minutes += e.mins || 0; }
      else if (e.kind === "game") { c.games++; c.gameHours += e.hours || 0; }
      else if (e.kind === "book") { c.books++; c.pages += e.pages || 0; }
      else if (e.kind === "story") c.stories++;
      else if (e.kind === "session") { c.sessionMins += e.mins || 0; }
      else if (e.kind === "reading") { c.readPages += e.pages || 0; c.readChapters += e.chapters || 0; }
      if (e.rating >= 8 && !top.has(e.key)) top.set(e.key, e);
    }
    c.hours = Math.round(c.minutes / 60); c.gameHours = Math.round(c.gameHours); c.playedHours = Math.round(c.sessionMins / 60);
    c.top = [...top.values()].sort((a, b) => b.rating - a.rating).slice(0, 20);
    return c;
  }
  // a day's many episodes of one series become one line ("S1 E1–E6")
  function grouped(events) {
    const out = [];
    for (const e of events) {
      const last = out[out.length - 1];
      if (last && e.kind === "episode" && last.kind === "episode" && last.key === e.key && last.d === e.d) { last.n++; last.lo = e; continue; }
      out.push(Object.assign({}, e, { n: 1, lo: e }));
    }
    for (const g of out) if (g.n > 1) g.sub = g.lo.s === g.s ? `S${g.s} E${g.lo.e}–E${g.e} (${g.n} episodes)` : `${g.n} episodes, S${g.lo.s} E${g.lo.e} to S${g.s} E${g.e}`;
    return out;
  }
  const API = { build, year, grouped, day };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.Activity = API;
})(typeof window !== "undefined" ? window : this);
