// Your own film and series library: statuses, the watch log, episodes, next episode, adopting sync data, search and details.
const L = require("./library.js");
const assert = (c, m) => { if (!c) throw new Error(m); };
let saved = null;
const lib = new L.Library({ load: () => "", save: t => { saved = t; } });

(async () => {
  // films: watched, rewatched, the counter and its dates
  const { item: m } = lib.add({ type: "movie", title: "Alien", year: 1979, tmdb: 348 }, "watchlist");
  assert(m.id === "tm:movie:348" && m.status === "watchlist", "film added");
  lib.setStatus(m, "watched", "2020-05-01");
  assert(m.watches.length === 1 && m.watches[0] === "2020-05-01", "first watch dated");
  assert(lib.logWatch(m, "2024-10-31") === 2 && lib.logWatch(m, "2022-01-01") === 3, "rewatches counted");
  assert(m.watches.join() === "2020-05-01,2022-01-01,2024-10-31", "watch log sorted");
  lib.removeWatch(m, 1);
  assert(m.watches.length === 2, "a watch removed");
  // merging the same film by IMDb ID or title doesn't duplicate
  const again = lib.add({ type: "movie", title: "Alien", year: 1979, imdb: "tt0078748" }, "watchlist");
  assert(again.existed && again.item === m && m.imdb === "tt0078748" && m.status === "watched", "merged, status kept");

  // series: episodes, next episode, catching up, rewatch
  const { item: s } = lib.add({ type: "show", title: "Severance", year: 2022, tvmaze: 44933 }, "watchlist");
  s.epl = [[1, 1, "2022-02-18", "Good News About Hell"], [1, 2, "2022-02-18", "Half Loop"], [1, 3, "2022-02-25", ""], [2, 1, "2025-01-17", "Hello, Ms. Cobel"], [2, 2, "2099-01-24", "Future"], [0, 1, "2022-01-01", "Special"]];
  assert(lib.nextEp(s, "2026-01-01").e === 1 && !lib.upNext("2026-01-01").length, "not started: the sheet offers S1 E1, Home doesn't list it");
  lib.toggleEp(s, 1, 1, "2024-01-01");
  assert(s.status === "watching", "ticking an episode starts watching");
  let n = lib.nextEp(s, "2026-01-01");
  assert(n.s === 1 && n.e === 2 && n.left === 3 && n.name === "Half Loop", "next episode after the furthest watched: " + JSON.stringify(n));
  lib.markUpTo(s, 2, 1, "2024-02-02");
  n = lib.nextEp(s, "2026-01-01");
  assert(n && n.upcoming && n.s === 2 && n.e === 2 && n.date === "2099-01-24", "caught up: next one airs later");
  assert(lib.caughtUp(s, "2026-01-01") && s.status === "watching", "caught up but still running");
  assert(!lib.upNext("2026-01-01").length, "Home 'next episode' leaves caught-up shows out");
  lib.toggleEp(s, 1, 3);
  assert(!lib.upNext("2026-01-01").length, "a gap before the furthest watched episode isn't suggested");
  lib.toggleEp(s, 1, 3, "2024-02-02");
  s.ended = true; s.epl = s.epl.filter(x => x[1] !== 2 || x[0] !== 2);
  lib.afterEps(s);
  assert(s.status === "watched" && s.watches.length === 1, "finished an ended show: one full run logged");
  assert(lib.rewatch(s, "2025-06-01") === 1 && !Object.keys(s.eps).length && s.status === "watching", "rewatch keeps the run, clears ticks");
  lib.markSeason(s, 1, true, "2025-06-02");
  assert(Object.keys(s.eps).length === 3, "season ticked (specials and future left out)");

  // recently watched mixes films and episode days
  const rec = lib.recent(10);
  assert(rec[0].date === "2025-06-02" && /S1 E1 – S1 E3 \(3\)/.test(rec[0].what), "recent: a day of episodes grouped: " + JSON.stringify(rec[0]));
  assert(rec.some(r => r.title === "Alien" && r.what === "Watch 2"), "recent: film rewatch labelled");

  // rows for the sync store, and adoption from IMDb / Trakt (once only)
  const rows = lib.dbRows();
  assert(rows.watched.some(r => r.title === "Alien" && r.imdb === "tt0078748") && rows.watched.some(r => r.medium === "TV Series"), "db rows");
  const sync = [{ source: "trakt", kind: "watched", title: "Heat", year: 1995, medium: "Movie", imdb: "tt0113277", date: "2019-03-03" },
                { source: "imdb", kind: "rated", title: "Alien", year: 1979, medium: "Movie", imdb: "tt0078748", rating: 9 },
                { source: "imdb", kind: "watchlist", title: "Dune: Part Two", year: 2024, medium: "Movie", imdb: "tt15239678" },
                { source: "imdb", kind: "watched", title: "Some Game", medium: "Video Game" }];
  assert(lib.adopt(sync) === 2, "two new titles adopted (Alien merged, game skipped)");
  assert(lib.all().find(x => x.title === "Heat").watches[0] === "2019-03-03" && m.rating === 9, "dates and ratings come along");
  lib.remove(lib.all().find(x => x.title === "Heat").id);
  assert(lib.adopt(sync) === 0 && !lib.all().some(x => x.title === "Heat"), "a removed title stays out");

  // imports merge with dated watches and episode counts
  const r = lib.merge([{ type: "movie", title: "Alien", year: 1979, watches: ["2023-03-03"], status: "watched" }, { type: "show", title: "Frieren", status: "watching", epsWatched: 5 }]);
  assert(r.added === 1 && r.updated === 1 && m.watches.includes("2023-03-03"), "import merge");
  const fr = lib.all().find(x => x.title === "Frieren");
  assert(fr.epsPending === 5, "episode count waits for the episode list");

  // search without a TMDB key: TVmaze + iTunes; with a key: TMDB
  const calls = [];
  const http = async (m, url) => {
    calls.push(url);
    if (/tvmaze.com\/search/.test(url)) return { status: 200, body: JSON.stringify([{ show: { id: 1, name: "Severance", premiered: "2022-02-18", image: { medium: "x.jpg" }, externals: { imdb: "tt11280740" }, status: "Running", network: { name: "Apple TV+" } } }]) };
    if (/itunes/.test(url)) return { status: 200, body: JSON.stringify({ results: [{ trackId: 9, trackName: "Severance (Film)", releaseDate: "2006-01-01T00:00:00Z", artworkUrl100: "a/100x100.jpg" }] }) };
    if (/tvmaze.com\/singlesearch/.test(url)) return { status: 200, body: JSON.stringify({ id: 77, premiered: "2023-09-29" }) };
    if (/tvmaze.com\/shows\/77/.test(url)) return { status: 200, body: JSON.stringify({ id: 77, name: "Frieren", premiered: "2023-09-29", status: "Ended", externals: { imdb: "tt22248376" },
      _embedded: { episodes: [1, 2, 3, 4, 5, 6, 7].map(e => ({ season: 1, number: e, airdate: `2023-10-${10 + e}`, name: "E" + e })) } }) };
    if (/themoviedb.*search\/multi/.test(url)) return { status: 200, body: JSON.stringify({ results: [{ media_type: "tv", id: 95396, name: "Scissione", original_name: "Severance", first_air_date: "2022-02-18", poster_path: "/p.jpg" }, { media_type: "person", id: 1 }] }) };
    return { status: 404, body: "" };
  };
  const keyless = await L.search(http, "Severance", { lang: "it" });
  assert(keyless.length === 2 && keyless[0].type === "show" && keyless[0].imdb === "tt11280740" && keyless[1].type === "movie", "keyless search: " + JSON.stringify(keyless.map(x => x.title)));
  assert(calls.some(u => /country=IT&lang=it_it/.test(u)), "iTunes asked for Italy in Italian");
  const tm = await L.search(http, "Severance", { tmdbKey: "abc", lang: "it" });
  assert(tm.length === 1 && tm[0].title === "Scissione" && tm[0].orig === "Severance" && tm[0].tmdb === 95396, "TMDB search in Italian");
  assert(calls.some(u => /language=it-IT/.test(u) && /api_key=abc/.test(u)), "TMDB asked in Italian");
  // details: the episode list arrives and the pending count is ticked
  assert(await L.details(http, fr, {}), "details changed");
  assert(fr.tvmaze === 77 && fr.epl.length === 7 && Object.keys(fr.eps).length === 5 && !fr.epsPending && fr.ended, "episodes from TVmaze, 5 ticked");
  assert(lib.nextEp(fr, "2026-01-01").e === 6, "next episode after import");
  // stale list for the background refresh
  fr.epChecked = Date.now() - 20 * 864e5;
  assert(L.stale(lib).some(x => x === fr), "an ended show is refreshed every two weeks");

  // persistence round-trip
  lib.save();
  const lib2 = new L.Library({ load: () => saved, save: () => {} });
  assert(lib2.all().length === lib.all().length && lib2.get(m.id).watches.length === m.watches.length && lib2.adopted["tt0113277"], "saved and loaded");
  console.log(`library: ${lib.all().length} titles, ${lib.counts().eps} episodes, ${lib.counts().rewatches} rewatches · search keyless ${keyless.length}, TMDB ${tm.length}`);
  console.log("LIBRARY TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
