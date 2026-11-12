// Exports from other tracking sites: recognised, parsed and sent to the right tab.
const I = require("./imports.js");
const B = require("./books/core.js");
const assert = (c, m) => { if (!c) throw new Error(m); };

// Letterboxd ZIP: diary (with rewatches), watched, ratings, watchlist
const lb = I.detect({ name: "letterboxd-banta-2026.zip", zip: {
  "diary.csv": "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n2024-01-02,Alien,1979,https://boxd.it/a1,4.5,,,2024-01-01\n2025-10-31,Alien,1979,https://boxd.it/a2,5,Yes,,2025-10-31\n",
  "watched.csv": "Date,Name,Year,Letterboxd URI\n2024-01-02,Alien,1979,https://boxd.it/a\n2023-05-05,Heat,1995,https://boxd.it/h\n",
  "ratings.csv": "Date,Name,Year,Letterboxd URI,Rating\n2023-05-05,Heat,1995,https://boxd.it/h,4\n",
  "watchlist.csv": "Date,Name,Year,Letterboxd URI\n2026-01-01,\"Dune: Part Two\",2024,https://boxd.it/d\n" } });
assert(lb.target === "watch" && lb.kind === "Letterboxd", "Letterboxd recognised: " + lb.kind);
const alien = lb.rows.find(r => r.title === "Alien"), heat = lb.rows.find(r => r.title === "Heat"), dune = lb.rows.find(r => r.title === "Dune: Part Two");
assert(alien.watches.join() === "2024-01-01,2025-10-31" && alien.rating === 10, "diary: two dated watches, rating ×2: " + JSON.stringify(alien));
assert(heat.status === "watched" && heat.rating === 8 && heat.watches.length === 1 && heat.watches[0] === "", "watched without a diary date: " + JSON.stringify(heat));
assert(dune.status === "watchlist" && !dune.watches.length, "watchlist");

// MyAnimeList XML (anime and manga)
const mal = I.detect({ name: "animelist.xml", text: `<?xml version="1.0"?><myanimelist><myinfo><user_name>x</user_name></myinfo>
<anime><series_animedb_id>52991</series_animedb_id><series_title><![CDATA[Sousou no Frieren]]></series_title><series_type>TV</series_type><series_episodes>28</series_episodes><my_watched_episodes>12</my_watched_episodes><my_finish_date>0000-00-00</my_finish_date><my_score>9</my_score><my_status>Watching</my_status><my_times_watched>0</my_times_watched></anime>
<anime><series_title>Your Name.</series_title><series_type>Movie</series_type><my_watched_episodes>1</my_watched_episodes><my_finish_date>2019-08-08</my_finish_date><my_score>10</my_score><my_status>Completed</my_status><my_times_watched>1</my_times_watched></anime>
<manga><manga_title>Berserk</manga_title><my_status>Reading</my_status><my_score>10</my_score></manga></myanimelist>` });
assert(mal.target === "watch" && mal.rows.length === 2 && mal.books.length === 1, "MAL: anime to the library, manga to Books");
assert(mal.rows[0].type === "show" && mal.rows[0].epsWatched === 12 && mal.rows[0].status === "watching", "MAL series progress");
assert(mal.rows[1].type === "movie" && mal.rows[1].watches.length === 2 && mal.rows[1].watches[0] === "2019-08-08", "MAL film watched twice (times_watched)");
assert(mal.books[0].status === "reading" && mal.books[0].rating === 10, "manga");

// TV Time GDPR export
const tv = I.detect({ name: "tvtime.zip", zip: { "seen_episode.csv": "tv_show_name,episode_season_number,episode_number,updated_at\nThe Bear,1,1,2023-07-01 20:00:00\nThe Bear,1,2,2023-07-02 20:00:00\n", "user.csv": "id\n1\n" } });
assert(tv.target === "watch" && tv.kind === "TV Time" && tv.rows[0].eps["1:2"] === "2023-07-02", "TV Time episodes with dates");

// generic CSVs: Simkl style, Serializd, a home-made sheet
const sk = I.detect({ name: "simkl_export.csv", text: "SIMKL_ID,Title,Type,Year,Watchlist,LastEpWatched,WatchedDate,Rating,IMDB\n1,Andor,tv,2022,completed,s2e12,2025-05-13,9,tt9253284\n2,Arrival,movie,2016,plantowatch,,,,tt2543164\n" });
assert(sk.target === "watch" && sk.kind === "Simkl", "Simkl CSV");
assert(sk.rows[0].type === "show" && sk.rows[0].imdb === "tt9253284" && sk.rows[0].lastEp.join() === "2,12" && sk.rows[1].status === "watchlist", "Simkl rows: " + JSON.stringify(sk.rows));
const sheet = I.detect({ name: "my films.csv", text: "Titolo;Anno;Voto\nLa grande bellezza;2013;9\n" });
assert(sheet.target !== "watch" || sheet.rows.length >= 0, "semicolon sheet doesn't crash");
const own = I.detect({ name: "watched.csv", text: "Title,Year,Status,Rating,Date\nPerfect Days,2023,Watched,8,2024-02-02\n" });
assert(own.target === "watch" && own.rows[0].watches[0] === "2024-02-02" && own.rows[0].rating === 8, "own CSV");

// games: HowLongToBeat, Grouvee, Backloggd-style, Steam
const hl = I.detect({ name: "HLTB_games.csv", text: "Title,Platform,Playing,Backlog,Replay,Custom,Completed,Retired,Review,Completion Date\nHades,PC,0,0,0,0,1,0,90,2021-03-04\nHollow Knight,Switch,1,0,0,0,0,0,0,\n" });
assert(hl.target === "games" && hl.rows[0].status === "done" && hl.rows[0].date === "2021-03-04" && hl.rows[0].rating === 9 && hl.rows[1].status === "playing", "HLTB");
const gv = I.detect({ name: "grouvee.csv", text: 'id,name,shelves,platforms,rating,review,dates,release_date\n1,Celeste,"{""Played"": {}}","{""PC"": {}}",5,,"[{""date_finished"": ""2020-02-02""}]",2018-01-25\n' });
assert(gv.target === "games" && gv.kind === "Grouvee" && gv.rows[0].status === "done" && gv.rows[0].date === "2020-02-02" && gv.rows[0].rating === 10 && gv.rows[0].platform === "PC", "Grouvee: " + JSON.stringify(gv.rows[0]));
const bl = I.detect({ name: "backloggd.csv", text: "Game,Platform,Status,Rating\nOuter Wilds,PC,Completed,5\nElden Ring,PS5,Playing,\n" });
assert(bl.target === "games" && bl.kind === "Backloggd" && bl.rows[0].status === "done" && bl.rows[0].rating === 10, "Backloggd-style CSV");
const st = I.detect({ name: "games.xml", text: '<?xml version="1.0"?><gamesList><steamID64>1</steamID64><games><game><appID>1145360</appID><name><![CDATA[Hades]]></name><hoursOnRecord>61.2</hoursOnRecord></game></games></gamesList>' });
assert(st.target === "games" && st.rows[0].steam === 1145360 && st.rows[0].hours === 61.2 && st.rows[0].owned === "PC (Steam)", "Steam library");
assert(I.steamProfileUrl("https://steamcommunity.com/id/banta/") === "https://steamcommunity.com/id/banta/games?tab=all&xml=1" && I.steamProfileUrl("76561197960287930").includes("/profiles/"), "Steam profile URL");
assert(I.franchiseGuess("Hades II") === "Hades" && I.franchiseGuess("Mass Effect 2: Remastered") === "Mass Effect", "franchise guess");

// books go to the Books tab, which reads them with its own importer
const gr = I.detect({ name: "goodreads_library_export.csv", text: "Book Id,Title,Author,ISBN13,My Rating,Exclusive Shelf,Date Read\n1,Dune,Frank Herbert,=\"9780441013593\",5,read,2020/01/02\n" });
assert(gr.target === "books" && gr.kind === "Goodreads", "Goodreads → Books");
const ltText = "Book Id\tTitle\tPrimary Author\tISBNs\tRating\tDate Read\tCollections\n1\tIl nome della rosa\tEco, Umberto\t9788845278655\t4.5\t2019-06-01\tYour library\n";
const lt = I.detect({ name: "librarything_banta.tsv", text: ltText });
assert(lt.target === "books" && lt.kind === "LibraryThing", "LibraryThing → Books");
const ltb = B.readImport(lt.raw, lt.name);
assert(ltb.books[0].authors[0] === "Umberto Eco" && ltb.books[0].status === "read" && ltb.books[0].rating === 9 && ltb.books[0].isbn13 === "9788845278655", "LibraryThing parsed: " + JSON.stringify(ltb.books[0]).slice(0, 200));
const libib = B.readImport("item_type,title,creators,ean_isbn13,status,began,completed,rating\nbook,Piranesi,Susanna Clarke,9781526622426,Completed,2021-01-01,2021-01-09,4\nbook,Jonathan Strange,Susanna Clarke,,Not begun,,,\n", "libib.csv");
assert(libib.kind === "Libib export" && libib.books[0].status === "read" && libib.books[1].status === "want" && libib.books[0].started > 0, "Libib");
const bw = B.readImport("title,author_text,isbn_13,start_date,finish_date,rating,shelf\nLa Storia,Elsa Morante,,2020-01-01,2020-03-01,5,read\nAnna Karenina,Lev Tolstoj,,,,,to-read\n", "bookwyrm.csv");
assert(bw.kind === "BookWyrm export" && bw.books[0].status === "read" && bw.books[1].status === "want", "BookWyrm (to-read stays want)");

// Trakt / IMDb / Refract still go to their own importers
assert(I.detect({ name: "trakt.zip", zip: { "watched-movies.json": "[]", "ratings-movies.json": "[]" } }).kind === "trakt", "Trakt ZIP routed");
assert(I.detect({ name: "ratings.csv", text: "Const,Your Rating,Date Rated,Title,Title Type,Year\ntt0078748,9,2020-01-01,Alien,movie,1979\n" }).kind === "imdb", "IMDb CSV routed");
assert(I.detect({ name: "refract.zip", zip: { "something.json": "{}" } }).kind === "refract", "unknown ZIP falls back to Refract");

// books: authors, reads
const lib = new B.Library(null);
lib.add({ title: "Piranesi", authors: ["Susanna Clarke"] }, "read");
const p = lib.books[0];
p.finished = Date.parse("2021-01-09"); p.started = Date.parse("2021-01-01");
assert(B.addRead(p, Date.parse("2016-01-01"), Date.parse("2016-02-01")) === 2, "a past read added");
assert(B.readsOf(p).map(r => new Date(r.finished).getFullYear()).join() === "2016,2021", "reads in order");
B.setStatus(p, "reading");
assert(B.readsOf(p).length === 2 && p.status === "reading", "rereading keeps both reads");
B.setStatus(p, "read", Date.parse("2026-11-01"));
assert(B.readsOf(p).length === 3, "third read");
B.removeRead(p, 2);
assert(B.readsOf(p).length === 2 && new Date(p.finished).getFullYear() === 2021, "removing the latest restores the previous");
lib.add({ title: "Jonathan Strange", authors: ["Susanna Clarke"] }, "want");
assert(B.authorsOf(lib)[0].name === "Susanna Clarke" && B.authorsOf(lib)[0].n === 2, "authors list");
const idx = B.indexFor(lib);
assert(idx.recent[0].t === "Piranesi" && idx.recent[0].n === 2, "recently read in the index");
(async () => {
  const http = async (m, url) => /openlibrary.*author=Susanna/.test(url) ? { status: 200, body: JSON.stringify({ docs: [
      { key: "/works/1", title: "Jonathan Strange & Mr Norrell", author_name: ["Susanna Clarke"], first_publish_year: 2004 },
      { key: "/works/2", title: "Piranesi", author_name: ["Susanna Clarke"], first_publish_year: 2020 },
      { key: "/works/3", title: "Piranesi", author_name: ["Susanna Clarke"], first_publish_year: 2021 },
      { key: "/works/4", title: "Someone Else", author_name: ["Arthur Clarke"], first_publish_year: 1968 }] }) } : { status: 404, body: "" };
  const w = await B.authorWorks(http, "Susanna Clarke");
  assert(w.length === 2 && w[0].published === "2004", "author's works, deduped, others' left out: " + w.map(x => x.title));
  console.log(`imports: Letterboxd ${lb.rows.length}, MAL ${mal.rows.length}+${mal.books.length}, TV Time ${tv.rows.length}, Simkl ${sk.rows.length}, HLTB ${hl.rows.length}, Grouvee ${gv.rows.length}, Steam ${st.rows.length}, LibraryThing/Libib/BookWyrm ok`);
  console.log("IMPORT TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
