// Image sources in order with fallbacks; anime from MyAnimeList (search, episodes); manga (search, chapters, detection).
const I = require("./images.js"), L = require("./library.js"), B = require("./books/core.js");
const assert = (c, m) => { if (!c) throw new Error(m); };
const J = o => ({ status: 200, body: JSON.stringify(o) });
(async () => {
  const seen = [];
  const http = async (m, url) => {
    seen.push(url);
    if (/themoviedb.*find\/tt1/.test(url)) return J({ movie_results: [{ poster_path: "/p.jpg" }] });
    if (/themoviedb/.test(url)) return J({ results: [] });
    if (/suggestion\/x\/tt2/.test(url)) return J({ d: [{ id: "tt2", i: { imageUrl: "https://m.media-amazon.com/images/M/x._V1_.jpg" } }] });
    if (/suggestion\/x\//.test(url)) return J({ d: [] });
    if (/suggestion\/o\/obscure/.test(url)) return J({ d: [{ id: "tt9", l: "Obscure Film", y: 1980, q: "feature", i: { imageUrl: "https://m.media-amazon.com/images/M/o._V1_SX300.jpg" } }] });
    if (/suggestion\//.test(url)) return J({ d: [] });
    if (/itunes/.test(url)) return J({ results: [] });
    if (/en\.wikipedia.*Rare%20Game%20\(video%20game\)/.test(url)) return J({ query: { pages: { 1: { title: "Rare Game (video game)", thumbnail: { source: "https://upload.wikimedia.org/rare.jpg" } } } } });
    if (/wikipedia/.test(url)) return J({ query: { pages: {} } });
    if (/storesearch/.test(url)) return J({ items: [] });
    if (/googleapis.*isbn%3A9780000000001/.test(url)) return J({ items: [] });
    if (/covers\.openlibrary\.org\/b\/isbn\/9780000000001/.test(url)) return { status: 200, body: "JPEG" };
    if (/jikan.*\/anime\?q=Frieren/.test(url)) return J({ data: [{ mal_id: 52991, title: "Sousou no Frieren", title_english: "Frieren: Beyond Journey's End", titles: [{ title: "Frieren" }], type: "TV", episodes: 28, status: "Finished Airing", year: 2023, images: { jpg: { large_image_url: "https://cdn.myanimelist.net/f.jpg" } }, genres: [{ name: "Fantasy" }] }] });
    if (/jikan.*\/anime\/52991\/episodes\?page=1/.test(url)) return J({ data: Array.from({ length: 100 }, (_, i) => ({ mal_id: i + 1, title: "Ep " + (i + 1), aired: "2023-10-01T00:00:00+00:00" })), pagination: { has_next_page: true } });
    if (/jikan.*\/anime\/52991\/episodes\?page=2/.test(url)) return J({ data: [{ mal_id: 101, title: "Ep 101", aired: null }], pagination: { has_next_page: false } });
    if (/jikan.*\/anime\/52991$/.test(url)) return J({ data: { mal_id: 52991, title: "Sousou no Frieren", type: "TV", episodes: 28, status: "Finished Airing", images: { jpg: { large_image_url: "https://cdn.myanimelist.net/f.jpg" } } } });
    if (/jikan.*\/manga\?q=/.test(url)) return J({ data: [{ mal_id: 13, title: "One Piece", type: "Manga", chapters: null, volumes: null, status: "Publishing", authors: [{ name: "Oda, Eiichiro" }], images: { jpg: { large_image_url: "https://cdn.myanimelist.net/op.jpg" } }, published: { from: "1997-07-22T00:00:00+00:00" } }] });
    return { status: 404, body: "" };
  };
  // films: TMDB first, then IMDb by id, then IMDb search by title; skip moves on
  assert((await I.find(http, { kind: "movie", title: "A", imdb: "tt1" }, { tmdbKey: "k" })).src === "tmdb", "TMDB first");
  const r2 = await I.find(http, { kind: "movie", title: "B", imdb: "tt2" }, { tmdbKey: "k" });
  assert(r2.src === "imdbId" && /_V1_UX400_\.jpg$/.test(r2.url), "IMDb by id, resized: " + JSON.stringify(r2));
  assert((await I.find(http, { kind: "movie", title: "Obscure Film", year: 1980 }, {})).src === "imdbSearch", "IMDb search by title and year");
  assert((await I.find(http, { kind: "movie", title: "A", imdb: "tt1" }, { tmdbKey: "k", skip: ["tmdb"] })) === null, "nothing left after a broken TMDB picture");
  // games: Steam, IMDb, then Wikipedia "(video game)"
  const g = await I.find(http, { kind: "game", title: "Rare Game" }, {});
  assert(g && g.src === "wikipedia" && /rare\.jpg/.test(g.url), "Wikipedia for games: " + JSON.stringify(g));
  assert((await I.find(http, { kind: "game", title: "X", steam: 10 }, {})).src === "steam" && (await I.find(http, { kind: "game", title: "X", steam: 10 }, { skip: ["steam", "imdbId", "imdbSearch", "wikipedia"] })).src === "steamHeader", "Steam cover, then Steam header");
  // books: Google, then Open Library cover by ISBN
  assert((await I.find(http, { kind: "book", title: "Q", isbn: "9780000000001" }, {})).src === "openLibrary", "Open Library cover");
  // anime: MyAnimeList
  assert((await I.find(http, { kind: "anime", title: "Frieren" }, {})).src === "jikanAnime", "MyAnimeList picture");

  // anime search and episodes
  const res = await L.searchAnime(http, "Frieren");
  assert(res[0].mal === 52991 && res[0].anime && res[0].title === "Frieren: Beyond Journey's End" && res[0].orig === "Sousou no Frieren" && res[0].type === "show", "anime search: " + JSON.stringify(res[0]));
  const lib = new L.Library(null);
  const { item } = lib.add(res[0], "watching");
  assert(item.id === "mal:show:52991", "MyAnimeList id");
  await L.details(http, item, {});
  assert(item.epl.length === 101 && item.epl[100][1] === 101 && item.epl[0][2] === "2023-10-01" && item.ended, "all episode pages: " + item.epl.length);
  lib.toggleEp(item, 1, 1);
  assert(lib.nextEp(item, "2026-01-01").e === 2, "next anime episode");
  // TMDB / TVmaze recognise anime
  assert(L.fromTmdb({ id: 1, name: "X", original_language: "ja", genre_ids: [16, 10759], media_type: "tv" }).anime && !L.fromTmdb({ id: 2, title: "Y", original_language: "en", genre_ids: [16] }).anime, "TMDB anime");
  assert(L.fromTvmaze({ id: 1, name: "Z", genres: ["Anime", "Action"] }).anime, "TVmaze anime");

  // manga
  const m = (await B.searchManga(http, "One Piece"))[0];
  assert(m.manga && m.authors[0] === "Eiichiro Oda" && m.ongoing && m.mal === 13 && m.format === "Manga", "manga search: " + JSON.stringify(m).slice(0, 200));
  const bl = new B.Library(null);
  const { book } = bl.add(m, "want");
  B.setChapter(book, 1100, 107);
  assert(book.status === "reading" && book.chapter === 1100 && book.volume === 107, "chapters start reading");
  const done = B.blankBook({ title: "Short", manga: true, chapters: 10 }); B.setChapter(done, 10);
  assert(done.status === "read" && B.percent(done) === 100, "last chapter finishes a completed manga");
  assert(B.isManga(B.blankBook({ title: "Berserk 1", publisher: "Panini Planet Manga" })) && B.isManga(B.blankBook({ title: "X", publisher: "Star Comics" })) && !B.isManga(B.blankBook({ title: "Dune", publisher: "Fanucci" })), "manga publishers recognised");
  console.log("MEDIA TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
