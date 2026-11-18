// 0.6.9.9: years as spans, length and cast, music stats, settings kept per device. Made-up data.
// Run: node test_0699.js
const assert = require("assert");
const C = require("./core.js"), L = require("./library.js"), M = require("./music.js");

(async () => {
  // ---- years: 2010 / 2010-2020 / 2010-
  const ep = (s, e, d) => [s, e, d, ""];
  assert.strictEqual(L.span({ type: "movie", year: 2010 }), "2010");
  assert.strictEqual(L.span({ type: "show", year: 2010, ended: true, endYear: 2010 }), "2010", "began and ended the same year");
  assert.strictEqual(L.span({ type: "show", year: 2010, ended: true, endYear: 2020 }), "2010-2020");
  assert.strictEqual(L.span({ type: "show", year: 2010, ended: true, epl: [ep(1, 1, "2010-01-01"), ep(3, 8, "2014-05-01")] }), "2010-2014", "end year from the last aired episode");
  assert.strictEqual(L.span({ type: "show", year: 2010, ended: false, epl: [ep(1, 1, "2010-01-01")] }), "2010-", "still running");
  assert.strictEqual(L.span({ type: "show", year: 2010 }), "2010", "nothing known about the end: the first year only");
  assert.strictEqual(L.span({ type: "show" }), "");
  console.log("ok  release years: 2010, 2010-2020, 2010-");

  // ---- IMDb's end year is kept on series rows
  const db = new C.Store();
  const out = new Map(); C.walkTitles({ id: "tt0700050", titleText: { text: "Made Up Show" }, releaseYear: { year: 2011, endYear: 2015 }, titleType: { id: "tvSeries" } }, out);
  const row = out.get("tt0700050"); assert.strictEqual(row.end, 2015);
  db.addItems([row], "imdb", "rated"); assert.strictEqual(db.items().find(r => r.imdb === "tt0700050").end, 2015);
  db.addItems([{ imdb: "tt0700051", title: "A Film", year: 2001, medium: "Movie" }], "imdb", "rated");
  assert.ok(!("end" in db.items().find(r => r.imdb === "tt0700051")), "no empty end on other rows");
  console.log("ok  IMDb end years kept");

  // ---- length and cast from TMDB
  const calls = [];
  const http = async (m, url) => { calls.push(url);
    if (/\/find\/tt0700060/.test(url)) return { status: 200, body: JSON.stringify({ movie_results: [{ id: 501 }], tv_results: [] }) };
    if (/\/movie\/501/.test(url)) return { status: 200, body: JSON.stringify({ id: 501, runtime: 117, genres: [], credits: { cast: [{ name: "Ann Example", character: "Captain" }, { name: "Bo Example", character: "" }], crew: [{ job: "Director", name: "Cy Example" }] } }) };
    if (/\/tv\/601\/season\/1/.test(url)) return { status: 200, body: JSON.stringify({ episodes: [{ season_number: 1, episode_number: 1, air_date: "2019-01-01", name: "Pilot", runtime: 52 }, { season_number: 1, episode_number: 2, air_date: "2019-01-08", name: "Two", runtime: 44 }] }) };
    if (/\/tv\/601/.test(url)) return { status: 200, body: JSON.stringify({ id: 601, status: "Ended", first_air_date: "2019-01-01", last_air_date: "2021-03-01", episode_run_time: [48], genres: [], networks: [],
      aggregate_credits: { cast: [{ name: "Di Example", roles: [{ character: "The Doctor" }] }] }, created_by: [{ name: "Ed Example" }], seasons: [{ season_number: 1, episode_count: 2 }], external_ids: {} }) };
    return { status: 404, body: "" }; };
  const film = L.blank({ id: "m1", type: "movie", title: "A Made Up Film", year: 1979, imdb: "tt0700060" });
  assert.ok(await L.details(http, film, { tmdbKey: "k" }));
  assert.strictEqual(film.tmdb, 501, "TMDB id found from the IMDb id");
  assert.strictEqual(film.runtime, 117);
  assert.deepStrictEqual(film.cast, [["Ann Example", "Captain"], ["Bo Example", ""]]);
  assert.deepStrictEqual(film.dir, ["Cy Example"]); assert.ok(film.castAt);
  const show = L.blank({ id: "s1", type: "show", title: "A Made Up Series", year: 2019, tmdb: 601 });
  await L.details(http, show, { tmdbKey: "k" });
  assert.deepStrictEqual(show.cast, [["Di Example", "The Doctor"]]);
  assert.strictEqual(show.runtime, 48); assert.strictEqual(show.endYear, 2021); assert.strictEqual(L.span(show), "2019-2021");
  assert.deepStrictEqual(show.epl.map(x => x[4]), [52, 44], "each episode's own length");
  console.log("ok  length and cast for films, series and episodes");

  // ---- settings kept per device when the other device's copy arrives
  const a = new C.Store();
  a.set("upd_ver", "0.7.0"); a.set("seen_version", "0.6.9.9"); a.set("region", "IT");
  const other = new C.Store(); other.set("upd_ver", "0.6.9"); other.set("ota_ready", "0.6.9.5"); other.set("region", "GB"); other.set("seen_version", "0.6.9");
  a.loadData(JSON.parse(JSON.stringify(other.toJSON())));
  assert.strictEqual(a.get("region"), "GB", "shared settings come across");
  assert.strictEqual(a.get("upd_ver"), "0.7.0", "this device's update state stays");
  assert.strictEqual(a.get("seen_version"), "0.6.9.9");
  assert.strictEqual(a.get("ota_ready", ""), "", "the other device's update isn't taken");
  console.log("ok  per-device settings stay put");

  // ---- music: more numbers
  const now = Date.parse("2026-11-18T12:00:00Z"), sec = now / 1000;
  const recent = [];
  for (let d = 0; d < 60; d++) for (let k = 0; k < (d % 7) + 1; k++) recent.push({ at: sec - d * 86400 - k * 600, track: d < 10 && k === 0 ? "Loop Song" : `Song ${d}-${k}`, artist: d < 5 ? "New Artist" : "Old Artist" });
  recent.push({ at: sec - 90 * 86400, track: "Old", artist: "Older Artist" });
  recent.sort((x, y) => y.at - x.at);
  const st = M.stats({ recent, info: { playcount: 5000, since: sec - 1000 * 86400 }, spTop: { short_term: { artists: [{ name: "x", genres: ["synthpop", "indie"] }], tracks: [] } },
    top: { "1month": { artists: [{ name: "A", plays: 90 }, { name: "B", plays: 10 }] } } }, now);
  assert.strictEqual(st.weekday.reduce((p, v) => p + v, 0), recent.length);
  assert.strictEqual(st.months.length, 12);
  assert.strictEqual(st.longest, 60, "60 days in a row");
  assert.deepStrictEqual(st.newArtists, ["New Artist"], "first heard in the last 30 days");
  assert.strictEqual(st.topRepeat.track, "Loop Song"); assert.strictEqual(st.topRepeat.plays, 5);
  assert.strictEqual(st.mins30, Math.round(st.plays30 * 3.5), "3.5 minutes a play when Spotify doesn't know the length");
  assert.deepStrictEqual(st.genres.slice(0, 2), ["synthpop", "indie"]);
  assert.strictEqual(st.lifeAvg, 5); assert.strictEqual(st.top10Share, 100);
  console.log("ok  music: weekdays, months, streaks, new artists, on repeat, minutes, genres");
  console.log("0.6.9.9 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
