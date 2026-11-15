// Headless UI test: loads index.html in Chromium at phone size with a mock window.Android
// that mimics Bridge.java (async callbacks + take()), drives the main flows and screenshots each tab.
if (!require("fs").existsSync(require("path").join(__dirname, "../legacy/assets/gc/mine.js"))) { console.log("UI TESTS SKIPPED (they replay Banta's own data, which is not in the public repo)"); process.exit(0); }
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = process.argv[2] || "/tmp/shots";
fs.mkdirSync(OUT, { recursive: true });

const mock = () => {
  const files = {};
  const results = {};
  const log = [];
  const HDR = "Position,Const,Created,Modified,Description,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors,Your Rating,Date Rated";
  const row = (c, t, type, y, genres, mins, rating, date) => `1,${c},,,,"${t}","${t}",,${type},8,${mins},${y},"${genres}",1,,,${rating},${date}`;
  const ratingsCsv = [HDR,
    row("tt0133093", "The Matrix", "movie", 1999, "Action, Sci-Fi", 136, 9, "2023-04-02"),
    row("tt0234215", "The Matrix Reloaded", "movie", 2003, "Action, Sci-Fi", 138, 7, "2023-04-09"),
    row("tt0076759", "Star Wars: Episode IV - A New Hope", "movie", 1977, "Action, Adventure", 121, 9, "2024-01-12"),
    row("tt0080684", "Star Wars: Episode V - The Empire Strikes Back", "movie", 1980, "Action, Adventure", 124, 10, "2024-01-13"),
    row("tt0436992", "Doctor Who", "tvSeries", 2005, "Adventure, Drama, Sci-Fi", 45, 9, "2022-08-01"),
    row("tt1520211", "The Walking Dead", "tvSeries", 2010, "Drama, Horror", 44, 8, "2021-10-31"),
    row("tt2433148", "The Walking Dead: Red Machete", "short", 2011, "Drama, Horror", 3, 6, "2021-11-02"),
    row("tt3235888", "Elden Ring", "videoGame", 2022, "Action, Adventure, Fantasy", 0, 10, "2025-03-01"),
    row("tt21357128", "Clair Obscur: Expedition 33", "videoGame", 2025, "Adventure, Fantasy", 0, 10, "2025-06-20"),
  ].join("\n");
  const wdList = [HDR,
    row("tt1520211", "The Walking Dead", "tvSeries", 2010, "", 44, "", ""),
    row("tt3743822", "Fear the Walking Dead", "tvSeries", 2015, "", 44, "", ""),
    row("tt9859436", "The Walking Dead: World Beyond", "tvSeries", 2020, "", 44, "", ""),
    row("tt14209004", "Tales of the Walking Dead", "tvSeries", 2022, "", 44, "", ""),
    row("tt13062500", "The Walking Dead: Dead City", "tvSeries", 2023, "", 44, "", ""),
    row("tt2433148", "The Walking Dead: Red Machete", "short", 2011, "", 3, "", ""),
    row("tt2120139", "The Walking Dead: Survival Instinct", "videoGame", 2013, "", 0, "", ""),
  ].join("\n");
  const swList = [HDR,
    row("tt0076759", "Star Wars: Episode IV - A New Hope", "movie", 1977, "", 121, "", ""),
    row("tt0080684", "Star Wars: Episode V - The Empire Strikes Back", "movie", 1980, "", 124, "", ""),
    row("tt0086190", "Star Wars: Episode VI - Return of the Jedi", "movie", 1983, "", 131, "", ""),
    row("tt0120915", "Star Wars: Episode I - The Phantom Menace", "movie", 1999, "", 136, "", ""),
    row("tt0121765", "Star Wars: Episode II - Attack of the Clones", "movie", 2002, "", 142, "", ""),
    row("tt0121766", "Star Wars: Episode III - Revenge of the Sith", "movie", 2005, "", 140, "", ""),
    row("tt0458290", "Star Wars: The Clone Wars", "tvSeries", 2008, "", 23, "", ""),
    row("tt3748528", "Rogue One: A Star Wars Story", "movie", 2016, "", 133, "", ""),
    row("tt8111088", "The Mandalorian", "tvSeries", 2019, "", 40, "", ""),
    row("tt8134476", "Star Wars Jedi: Fallen Order", "videoGame", 2019, "", 0, "", ""),
  ].join("\n");
  const json = o => JSON.stringify(o);
  const routes = (method, url, body) => {
    const u = new URL(url);
    if (u.host === "api.trakt.tv") {
      const p = u.pathname;
      if (p.endsWith("/watched/movies")) return [200, json([
        { movie: { title: "The Matrix", year: 1999, runtime: 136, ids: { trakt: 1, imdb: "tt0133093", tmdb: 603 } } },
        { movie: { title: "Rogue One", year: 2016, runtime: 133, ids: { trakt: 2, imdb: "tt3748528", tmdb: 330459 } } },
        { movie: { title: "Heat", year: 1995, ids: { trakt: 3, imdb: "tt0113277", tmdb: 949 } } }])];
      if (p.endsWith("/watched/shows")) return [200, json([
        { last_watched_at: "2024-06-01T20:00:00.000Z", show: { title: "Doctor Who", year: 2005, ids: { trakt: 4, imdb: "tt0436992", tmdb: 57243 } },
          seasons: [{ number: 1, episodes: [{ number: 1, plays: 1 }, { number: 2, plays: 1 }] }] },
        { show: { title: "Torchwood", year: 2006, ids: { trakt: 5, imdb: "tt0485301", tmdb: 1912 } } },
        { show: { title: "The Walking Dead", year: 2010, ids: { trakt: 6, imdb: "tt1520211", tmdb: 1402 } } }])];
      if (p.endsWith("/ratings")) return [200, json([
        { rated_at: "2024-05-01T10:00:00.000Z", rating: 8, type: "movie", movie: { title: "Heat", year: 1995, ids: { imdb: "tt0113277" } } },
        { rated_at: "2024-05-02T10:00:00.000Z", rating: 7, type: "movie", movie: { title: "The Matrix", year: 1999, ids: { imdb: "tt0133093" } } }])];
      if (p.endsWith("/watchlist")) return [200, json([{ type: "movie", movie: { title: "Dune: Part Two", year: 2024, ids: { imdb: "tt15239678" } } }])];
      if (p.endsWith("/lists")) return [200, json([{ name: "Series To Watch", ids: { trakt: 10842402 } }])];
      if (p.includes("/lists/10842402/items")) return [200, json([{ type: "show", show: { title: "Andor", year: 2022, ids: { imdb: "tt9253284" } } },
                                                                  { type: "show", show: { title: "The Mandalorian", year: 2019, ids: { imdb: "tt8111088" } } }])];
      if (p.includes("/users/canonkeeper/lists/whoniverse/items")) return [200, json([
        { type: "show", show: { title: "Doctor Who", year: 2005, ids: { imdb: "tt0436992" } } },
        { type: "show", show: { title: "Torchwood", year: 2006, ids: { imdb: "tt0485301" } } },
        { type: "show", show: { title: "The Sarah Jane Adventures", year: 2007, ids: { imdb: "tt0960089" } } },
        { type: "show", show: { title: "Class", year: 2016, ids: { imdb: "tt5687540" } } },
        { type: "movie", movie: { title: "Doctor Who: The Movie", year: 1996, ids: { imdb: "tt0116118" } } }])];
      return [200, "[]"];
    }
    if (u.host === "www.imdb.com") {
      if (u.pathname.includes("/user/ur11111111/ratings/export")) return [200, ratingsCsv];
      if (u.pathname.includes("/list/ls100000007/export")) return [200, wdList];
      if (u.pathname.includes("/list/ls100000008/export")) return [200, swList];
      return [404, ""];
    }
    if (u.host === "api.graphql.imdb.com") return [500, ""];
    if (u.host === "apis.justwatch.com") return [200, json({ data: { popularTitles: { edges: [{ node: { objectType: "MOVIE",
      content: { title: "Return of the Jedi", originalReleaseYear: 1983, originalReleaseDate: "1983-05-25", externalIds: { imdbId: "tt0086190", tmdbId: "1892" }, scoring: { imdbScore: 8.3, tomatoMeter: 83 } },
      offers: [{ monetizationType: "FLATRATE", presentationType: "_4K", package: { clearName: "Disney Plus" } }, { monetizationType: "BUY", presentationType: "HD", package: { clearName: "Apple TV" } }] } }] } } })];
    if (u.host === "api.themoviedb.org") {
      if (u.pathname === "/3/tv/57243") return [200, json({ name: "Doctor Who", status: "Returning Series", next_episode_to_air: { air_date: "2099-12-25", season_number: 16, episode_number: 1 },
        last_episode_to_air: { season_number: 2, episode_number: 3, air_date: "2025-05-31" }, seasons: [{ season_number: 1, episode_count: 8 }, { season_number: 2, episode_count: 8 }] })];
      if (u.pathname === "/3/tv/57243/season/16") return [200, json({ episodes: [{ air_date: "2099-12-25", season_number: 16, episode_number: 1, name: "The Return" }, { air_date: "2100-01-01", season_number: 16, episode_number: 2, name: "Episode 2" }] })];
      if (u.pathname.startsWith("/3/tv/")) return [200, json({ name: "Some show", status: "Ended", next_episode_to_air: null })];
      if (u.pathname === "/3/find/tt0086190") return [200, json({ movie_results: [{ id: 1892 }] })];
      if (u.pathname === "/3/movie/1892") return [200, json({ id: 1892, title: "Return of the Jedi", release_date: "1983-05-25", runtime: 131, genres: [{ name: "Adventure" }, { name: "Action" }],
        vote_average: 7.9, overview: "Secret plot details.", external_ids: { imdb_id: "tt0086190" }, credits: { crew: [{ job: "Director", name: "Richard Marquand" }], cast: [{ name: "Mark Hamill" }] },
        release_dates: { results: [{ iso_3166_1: "IT", release_dates: [{ type: 3, release_date: "1983-10-21T00:00:00.000Z", certification: "T" }] }] },
        "watch/providers": { results: { IT: { flatrate: [{ provider_name: "Disney Plus" }], buy: [{ provider_name: "Apple TV" }] }, US: { flatrate: [{ provider_name: "Disney Plus" }, { provider_name: "Max" }] }, GB: { free: [{ provider_name: "ITVX" }] } } } })];
      if (u.pathname.startsWith("/3/find/")) return [200, json({ tv_results: [] })];
      return [404, "{}"];
    }
    if (u.host === "generativelanguage.googleapis.com" && u.pathname.endsWith("/models")) {
      return [200, json({ models: [{ name: "models/gemini-3-flash-preview", supportedGenerationMethods: ["generateContent"] },
                                   { name: "models/gemini-3.1-flash-lite", supportedGenerationMethods: ["generateContent"] }] })];
    }
    if (u.host === "generativelanguage.googleapis.com") {
      const items = [
        { franchise: "The Matrix", title: "The Matrix", medium: "Movie", year: "1999" },
        { franchise: "The Matrix", title: "The Matrix Reloaded", medium: "Movie", year: "2003" },
        { franchise: "The Matrix", title: "The Animatrix", medium: "Special", year: "2003" },
        { franchise: "The Matrix", title: "Enter the Matrix", medium: "Video Game", year: "2003" },
        { franchise: "The Matrix", title: "The Matrix Revolutions", medium: "Movie", year: "2003" },
        { franchise: "The Matrix", title: "The Matrix Resurrections", medium: "Movie", year: "2021" },
        { franchise: "The Matrix", title: "The Matrix Awakens", medium: "Video Game", year: "2021" },
      ];
      return [200, json({ candidates: [{ content: { parts: [{ text: json(items) }] } }] })];
    }
    return [404, ""];
  };
  window.Android = {
    load: n => files[n] || "",
    save: (n, t) => { files[n] = t; return true; },
    take: id => { const r = results[id]; delete results[id]; return r || ""; },
    http: (id, method, url, headers, body) => {
      log.push(`${method} ${url}`);
      setTimeout(() => {
        const [status, text] = routes(method, url, body);
        results[id] = JSON.stringify({ status, headers: { "x-pagination-page-count": "1" }, body: text });
        window.__httpDone(id);
      }, 15);
    },
    pick: (id, multiple) => {
      setTimeout(() => {
        results[id] = JSON.stringify(window.__nextPick || []);
        window.__pickDone(id);
      }, 15);
    },
    browse: (id, url, probe, timeout) => {
      log.push(`BROWSE ${url}`);
      setTimeout(() => { results[id] = JSON.stringify({ status: 0, value: null, error: "timeout", title: "\"Just a moment\"" }); window.__httpDone(id); }, 15);
    },
    openInApp: u => log.push(`INAPP ${u}`),
    notify: (id, title, text, tab) => log.push(`NOTIFY ${title} | ${text} | ${tab}`),
    status: (title, text, pct, ongoing) => log.push(`STATUS ${title} | ${pct} | ${ongoing}`),
    clearStatus: () => log.push("STATUS clear"),
    setBackground: (on, hours) => { log.push(`BG ${on} ${hours}`); return true; },
    requestNotifications: () => log.push("PERMISSION"),
    openUrl: u => log.push(`OPEN ${u}`),
    openApp: a => log.push(`APP ${a}`),
    copy: t => log.push(`COPY ${t.split("\n").length} lines`),
    sha256url: s => "challenge_" + s.length,
    randomUrl: n => "v".repeat(n),
    version: () => "1.2",
  };
  window.__mock = { files, log, ratingsCsv };
  // pre-seed settings like a configured user
  files["canonsync.json"] = JSON.stringify({ v: 1, settings: {
    username: "ExampleUser", client_id: "YOUR_TRAKT_CLIENT_ID_PKCE", redirect: "https://trakt.tv",
    profile: "PKCE / Public Client (App 000001)", auto_sync: "1", threshold: "90", gemini_model: "gemini-2.5-flash",
    imdb_user: "ur11111111", gemini_key: "test-key", preset_v1: "1", tmdb_key: "k",
    canon_urls: "The Walking Dead | https://www.imdb.com/list/ls100000007/\nStar Wars | https://www.imdb.com/list/ls100000008/\nWhoniverse | https://trakt.tv/users/canonkeeper/lists/whoniverse",
  } });
};

(async () => {
  const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"] }) // no outside network: the same result on any machine;
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(() => { window.__bantaMem = { "features.json": "{\"gemini\":1}" }; });
  await page.addInitScript(mock);
  await page.goto("file://" + path.join(__dirname, "index.html"));

  // Auto-sync on first launch should run by itself
  await page.waitForFunction(() => !window.__app.ui.job && window.__app.db.get("last_sync"), null, { timeout: 15000 });
  const report = await page.evaluate(() => window.__app.ui.report);
  console.log("SYNC REPORT\n" + report);
  if (report.includes("FAIL")) throw new Error("sync had failures");
  await page.screenshot({ path: `${OUT}/1-home.png`, fullPage: true });

  // Mark the hero item as seen -> next item changes
  const canonCap = () => page.evaluate(() => { const h = [...document.querySelectorAll(".sechead h2")].find(x => /Next in your canon/.test(x.textContent)); return h ? h.closest("section").querySelector(".tile .cap").textContent : ""; });
  const before = await canonCap();
  await page.evaluate(() => { const h = [...document.querySelectorAll(".sechead h2")].find(x => /Next in your canon/.test(x.textContent)); h.closest("section").querySelector(".tile .poster").click(); });
  await page.click(".sheet [data-action=seen]");
  const after = await canonCap();
  console.log(`hero: "${before}" -> "${after}"`);
  if (before === after) throw new Error("mark as seen did not advance");

  // Gemini scan from Missing tab
  await page.evaluate(() => __app.go("missing"));
  // (the older one-step API scan has no button any more; it still seeds this test's canon)
  await page.evaluate(() => { const b = document.createElement("button"); b.dataset.action = "gemini"; document.body.appendChild(b); b.click(); b.remove(); });
  await page.waitForFunction(() => !window.__app.ui.job, null, { timeout: 20000 });
  // Release order is the default view
  await page.screenshot({ path: `${OUT}/3b-release.png`, fullPage: true });
  const rel = await page.textContent("#missingList");
  if (!rel.includes("Up next") || !/2003/.test(rel)) throw new Error("release view missing Up next / year groups");
  const upNextTitles = await page.$$eval("#missingList .item", els => els.filter(e => e.querySelector(".tag")).map(e => e.querySelector(".ttl b").textContent));
  console.log("up next in release view:", upNextTitles.join(" | "));
  await page.click('[data-action=nextonly]');
  const onlyNext = await page.$$eval("#missingList .item", els => els.length);
  if (onlyNext !== upNextTitles.length) throw new Error("Up next only filter broken");
  await page.click('[data-action=nextonly]');
  await page.click('[data-action=mview][data-v=franchise]');
  await page.click('.fr [data-f="The Matrix"]');
  await page.screenshot({ path: `${OUT}/3-missing.png`, fullPage: true });
  await page.fill('[data-input=missingQ]', "jedi");
  await page.waitForTimeout(300);
  const filtered = await page.textContent("#missingList");
  if (!filtered.includes("Fallen Order") || filtered.includes("Animatrix")) throw new Error("search filter broken");
  await page.fill('[data-input=missingQ]', "");
  await page.waitForTimeout(300);
  await page.click('[data-action=copy]');

  // Stats
  await page.evaluate(() => __app.go("library")); await page.click('[data-action=tab][data-tab=stats]');
  await page.screenshot({ path: `${OUT}/2-stats.png`, fullPage: true });

  // Compare
  await page.evaluate(() => __app.go("library")); await page.click('[data-action=tab][data-tab=stats]'); await page.click('[data-action=tab][data-tab=compare]');
  await page.screenshot({ path: `${OUT}/4-compare.png`, fullPage: true });
  await page.click('[data-v=games]');
  const games = await page.textContent("#cmpList");
  if (!games.includes("Elden Ring")) throw new Error("games ledger missing Elden Ring");

  // Settings + back button
  await page.evaluate(() => (__app.ui.setGroup = "*", __app.go("settings")));
  await page.screenshot({ path: `${OUT}/5-settings.png`, fullPage: true });
  await page.fill('[data-setting=imdb_lists]', "https://www.imdb.com/list/ls100000008/");
  await page.evaluate(() => __app.go("home"));
  const saved = await page.evaluate(() => window.__app.db.get("imdb_lists"));
  if (!saved.includes("ls100000008")) throw new Error("setting not saved on tab change");
  await page.evaluate(() => __app.go("library")); await page.click('[data-action=tab][data-tab=stats]');
  const handled = await page.evaluate(() => window.__back());
  const tab = await page.evaluate(() => window.__app.ui.sec);
  const exitOnHome = await page.evaluate(() => window.__back());
  if (!handled || tab !== "home" || exitOnHome) throw new Error("back handling broken");

  // Not canon from the Missing tab: the entry disappears and is listed in Settings with Undo
  await page.evaluate(() => __app.go("missing"));
  await page.click('[data-action=mview][data-v=release]');
  const victim = await page.$eval('#missingList .item .ttl b', b => b.textContent);
  await page.click('#missingList .item');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/10-sheet.png` });
  await page.click('.sheet [data-action=notcanon]');
  if (await page.$(".sheet")) throw new Error("sheet should close after an action");
  if ((await page.textContent("#missingList")).includes(victim)) throw new Error("not-canon entry still listed");
  await page.evaluate(() => (__app.ui.setGroup = "*", __app.go("settings")));
  if (!(await page.textContent("#view")).includes(victim)) throw new Error("not-canon entry not shown in Settings");
  await page.click('[data-action=uncanon]');
  await page.evaluate(() => __app.go("missing"));
  if (!(await page.textContent("#missingList")).includes(victim)) throw new Error("undo did not restore the entry");
  console.log("not canon + undo: OK (" + victim + ")");

  // Upcoming tab: episodes from TMDB after Refresh shows
  await page.evaluate(() => __app.go("upcoming"));
  await page.click('[data-action=refreshshows]');
  await page.waitForFunction(() => !window.__app.ui.job, null, { timeout: 15000 });
  const up = await page.textContent("#view");
  if (!/Doctor Who/.test(up) || !/S16 E1/.test(up) || !/S16 E2/.test(up)) throw new Error("Upcoming tab missing episodes:\n" + up.slice(0, 400));
  const refreshMsg = await page.evaluate(() => window.__app.ui.status);
  if (!/TMDB: [1-9]\d* shows checked/.test(refreshMsg)) throw new Error("Refresh shows should recheck: " + refreshMsg);
  await page.screenshot({ path: `${OUT}/9-upcoming.png`, fullPage: true });
  // one app now: the bottom bar switches sections
  await page.evaluate(() => __app.go("games")); if (await page.$('nav#tabs [data-sec="timeline"]')) throw new Error("Doctor Who should start hidden");
  await page.evaluate(() => __app.go("books")); await page.evaluate(() => __app.go("home"));
  console.log("upcoming tab: OK");

  // Details sheet: dates, streaming with resolution (Disney+ 4K first), info, synopsis behind a spoiler fold
  await page.evaluate(() => __app.go("missing"));
  await page.click('[data-action=mview][data-v=release]');
  const jedi = await page.$('#missingList .item:has-text("Return of the Jedi")');
  await jedi.click();
  await page.waitForSelector('#details .offer', { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/11-details.png` });
  const det = await page.textContent('#details');
  for (const want of ["Cinema (IT)", "21 Oct 1983", "Original release", "Disney+", "Included", "4K", "Directed by Richard Marquand", "IMDb 8.3", "Rotten Tomatoes 83%", "Synopsis (may contain spoilers)", "Worldwide with a VPN", "Streams in 3 countries"]) {
    if (!det.includes(want)) throw new Error(`details missing "${want}":\n${det}`);
  }
  if (await page.isVisible('#details details p')) throw new Error("synopsis must stay folded");
  await page.evaluate(() => window.__back());
  await page.evaluate(() => __app.go("home")); await page.evaluate(() => __app.go("missing"));
  if (!(await page.textContent('#missingList')).includes("Disney+ 4K")) throw new Error("row badge missing after details load");
  console.log("details sheet + streaming badge: OK");

  // Compare: ratings per platform + Ratings differ
  await page.evaluate(() => __app.go("library")); await page.click('[data-action=tab][data-tab=stats]'); await page.click('[data-action=tab][data-tab=compare]');
  await page.click('[data-action=view][data-v=ratings]');
  const rd = await page.textContent('#cmpList');
  if (!/The Matrix/.test(rd) || !/IMDb ★9/.test(rd) || !/Trakt ★7/.test(rd)) throw new Error("ratings differ view:\n" + rd);
  await page.click('[data-action=view][data-v=imdb]');
  const io = await page.textContent('#cmpList');
  if (!/IMDb ★10/.test(io) || !/Trakt: not logged/.test(io)) throw new Error("IMDb-only chips:\n" + io.replace(/\s+/g, " "));
  console.log("platform ratings in Compare: OK");

  // Gemini is the main (free) scan; key test shows Google's answer in Settings
  await page.evaluate(() => __app.go("missing"));
  const steps = await page.$$eval('[data-action="mv"][data-via="auto"]', els => els.map(e => e.dataset.k).join(","));
  if (!steps.startsWith("group,expand")) throw new Error("multiverse steps should use the API key: " + steps);
  await page.evaluate(() => (__app.ui.setGroup = "*", __app.go("settings")));
  await page.click('[data-action=testgemini]');
  await page.waitForFunction(() => !window.__app.ui.job, null, { timeout: 15000 });
  const gt = await page.evaluate(() => window.__app.db.get("gemini_test"));
  if (!/^OK: gemini-3-flash-preview answered/.test(gt)) throw new Error("key test: " + gt);
  if (!(await page.textContent("#view")).includes("OK: gemini-3-flash-preview")) throw new Error("key test result not shown");
  console.log("gemini key test: OK");

  // Sync status notification: ongoing while running, final result afterwards
  const st = await page.evaluate(() => window.__mock.log.filter(l => l.startsWith("STATUS Sync")));
  if (!st.length || !/in progress \| \d+ \| true/.test(st[0]) || !/^STATUS Sync finished \| -1 \| false$/.test(st[st.length - 1])) throw new Error("status notifications: " + st.join(" / "));
  console.log("sync status notification: OK (" + st.length + " updates)");

  // Continue watching: Doctor Who watched to S1E2, aired up to S2E3 -> next S1E3, 9 to watch
  await page.evaluate(() => __app.go("upcoming"));
  await page.click('[data-action=refreshshows]');
  await page.waitForFunction(() => !window.__app.ui.job, null, { timeout: 15000 });
  await page.evaluate(() => __app.go("home"));
  const home = await page.textContent("#view");
  if (!/Continue/.test(home) || !/S1 E3/.test(home)) throw new Error("continue watching missing:\n" + home.slice(0, 600));
  await page.evaluate(() => __app.go("upcoming"));
  await page.click('[data-action=upfilter][data-v=towatch]');
  if (!/S1 E3/.test(await page.textContent("#view"))) throw new Error("To watch view empty");
  console.log("continue watching: OK");

  // Include my lists shows listed canon entries, tagged
  await page.evaluate(() => __app.go("missing"));
  await page.click('[data-action=mview][data-v=release]');
  const n0 = await page.$$eval("#missingList .item", e => e.length);
  await page.click('[data-action=showlisted]');
  const n1 = await page.$$eval("#missingList .item", e => e.length);
  const tags = await page.$$eval("#missingList .tag", e => e.map(x => x.textContent));
  if (!(n1 > n0) || !tags.includes("On your list")) throw new Error(`include my lists: ${n0} -> ${n1}, tags ${tags}`);
  await page.click('[data-action=showlisted]');
  console.log(`include my lists: OK (${n0} -> ${n1})`);

  // Hide from the calendar: row button hides the whole show; Home calendar can be hidden
  await page.evaluate(() => __app.go("upcoming"));
  await page.click('[data-action=upfilter][data-v=all]');
  await page.click('.item [data-action=uphide]');
  if (/Doctor Who/.test(await page.textContent("#view").then(x => x.split("hidden")[1] || ""))) throw new Error("hidden show still listed");
  if (!(await page.textContent("#view")).includes("1 hidden")) throw new Error("hidden counter missing");
  await page.evaluate(() => (__app.ui.setGroup = "*", __app.go("settings")));
  if (!(await page.textContent("#view")).includes("Hidden from Upcoming")) throw new Error("hidden list not in Settings");
  await page.click('[data-action=upshow]');
  // Home "Coming up" can be switched off in Settings
  await page.evaluate(() => { __app.go("home"); __app.db.set("home_calendar", "0"); __app.render(); });
  { const hs = await page.evaluate(() => [__app.db.get("home_calendar"), __app.ui.sec, ...[...document.querySelectorAll("#view .sechead h2")].map(h => h.textContent)]); if (hs.includes("Coming up")) throw new Error("Home calendar not hidden " + hs); }
  await page.evaluate(() => { __app.db.set("home_calendar", "1"); });

  // Retry failed: only the failed source runs again and its line in the report is replaced
  await page.evaluate(() => __app.go("sync"));
  await page.evaluate(() => { const a = window.__app; a.db.set("last_failed", JSON.stringify(["Canon: Whoniverse"]));
    a.ui.report = a.ui.report.replace("OK  Canon: Whoniverse", "FAIL Canon: Whoniverse: couldn't reach IMDb after 3 tries (x) and"); a.render(); });
  await page.click('[data-action=retryfailed]');
  await page.waitForFunction(() => !window.__app.ui.job, null, { timeout: 15000 });
  const rep2 = await page.evaluate(() => window.__app.ui.report);
  if (!/OK  Canon: Whoniverse: 5 canon entries/.test(rep2) || /FAIL/.test(rep2) || !/OK  Trakt account/.test(rep2)) throw new Error("retry failed broken:\n" + rep2);
  if (await page.$('[data-action=retryfailed]')) throw new Error("retry button should disappear when nothing failed");
  console.log("retry failed: OK");

  // Background scheduling + permission on first launch
  const bgLog = await page.evaluate(() => window.__mock.log.filter(l => l.startsWith("BG") || l === "PERMISSION"));
  console.log("startup:", bgLog.join(" | "));
  if (!bgLog.includes("BG true 12") || !bgLog.includes("PERMISSION")) throw new Error("background job not scheduled / permission not requested");

  // Check now: first run records a baseline (no notifications), Coming up shows the premiere
  await page.evaluate(() => (__app.ui.setGroup = "*", __app.go("settings")));
  await page.click('[data-action=bgnow]');
  await page.waitForFunction(() => !window.__app.ui.job, null, { timeout: 20000 });
  await page.screenshot({ path: `${OUT}/7-notifications.png`, fullPage: true });
  if (!(await page.textContent("#view")).includes("Notifications: 0")) throw new Error("baseline run should not notify");
  await page.evaluate(() => __app.go("home"));
  const coming = await page.textContent("#view");
  if (!coming.includes("Coming up") && require("fs").existsSync(require("path").join(__dirname, "../legacy/assets/gc/mine.js"))) throw new Error("Home calendar missing");
  await page.evaluate(() => __app.go("upcoming"));
  if (!(await page.textContent("#view")).includes("Doctor Who")) throw new Error("Upcoming missing the premiere");
  await page.evaluate(() => __app.go("home"));
  await page.screenshot({ path: `${OUT}/8-coming-up.png` });
  // turning background checks off cancels the job
  await page.evaluate(() => (__app.ui.setGroup = "*", __app.go("settings")));
  await page.click('[data-setting=bg_enabled]');
  await page.selectOption('[data-setting=bg_hours]', "6");
  const bg2 = await page.evaluate(() => window.__mock.log.filter(l => l.startsWith("BG")).slice(-2));
  if (bg2[0] !== "BG false 12" || bg2[1] !== "BG false 6") throw new Error("toggle/frequency not applied: " + bg2);
  await page.click('[data-setting=bg_enabled]');
  // notification tap opens the Missing tab
  await page.evaluate(() => window.__openTab("missing"));
  if ((await page.evaluate(() => window.__app.ui.tab)) !== "missing") throw new Error("__openTab broken");

  // IMDb sign-in opens the in-app browser; closing it comes back with a hint
  await page.evaluate(() => (__app.ui.setGroup = "*", __app.go("settings")));
  await page.click('[data-action=imdbsignin]');
  const inapp = await page.evaluate(() => window.__mock.log.filter(l => l.startsWith("INAPP")));
  if (!inapp.length || !inapp[0].includes("imdb.com/registration/signin")) throw new Error("IMDb sign-in did not open: " + inapp);
  await page.evaluate(() => window.__browserClosed());
  if (!(await page.textContent("#view")).includes("Sign-in page was opened")) throw new Error("sign-in state not shown");
  const browsedN = await page.evaluate(() => window.__mock.log.filter(l => l.startsWith("BROWSE")).length);
  console.log("pages tried in hidden browser before HTTP fallback:", browsedN);
  if (!browsedN) throw new Error("IMDb sync did not try the in-app browser");
  await page.evaluate(() => __app.go("sync"));
  await page.click('details.report summary');
  await page.click('[data-action=copydiag]');

  // Import a Trakt ZIP through the picker
  await page.evaluate(() => { window.__nextPick = [{ name: "trakt-export-banta2000.zip", zip: {
    "watched-history-27.json": JSON.stringify([{ type: "movie", movie: { title: "Alien", year: 1979, ids: { imdb: "tt0078748" } } }]) } }]; });
  await page.evaluate(() => (__app.ui.setGroup = "*", __app.go("settings")));
  await page.click('[data-action=import][data-kind=trakt]');
  await page.waitForFunction(() => !window.__app.ui.job && window.__app.db.items("trakt").some(i => i.title === "Alien"), null, { timeout: 10000 });

  // Clear data dialog
  await page.evaluate(() => (__app.ui.setGroup = "*", __app.go("settings")));
  await page.click('[data-action=clear]');
  await page.screenshot({ path: `${OUT}/6-dialog.png` });
  await page.evaluate(() => window.__back());
  if (await page.$(".dialog")) throw new Error("back did not close dialog");

  // Gemini app (copy and paste): verify the missing list, then new announcements, then a scan that's stopped
  {
    const missingN = () => page.evaluate(() => Core.canonStatus(window.__app.db).filter(c => !c.have).length);
    await page.evaluate(() => { window.__app.ui.job = null; });
    await page.evaluate(() => __app.go("missing"));
    await page.waitForSelector('[data-action="gapp"][data-k="verify"]');
    await page.screenshot({ path: `${OUT}/12-gapp-tools.png`, fullPage: true });
    const before = await missingN();
    await page.click('[data-action="gapp"][data-k="verify"]');
    await page.waitForSelector(".bai-sheet .bai-in");
    await page.click('.bai-sheet [data-a="gem"]');
    await page.waitForTimeout(500);
    const opened = await page.evaluate(() => window.__mock.log.filter(l => l.includes("gemini.google.com")).length);
    if (!opened) throw new Error("Gemini app was not opened");
    await page.click('.bai-sheet [data-a="show"]');
    const prompt = await page.$eval(".bai-prompt", el => el.value);
    const lines = prompt.split(/LINES[^\n]*:\n/)[1].trim().split("\n");
    if (lines.length < 2) throw new Error("verify prompt has too few lines: " + lines.length);
    await page.screenshot({ path: `${OUT}/13-gapp-ask.png` });
    // a bad paste is caught before closing
    await page.fill(".bai-in", "Sure! Here you go.");
    await page.click('.bai-sheet [data-a="ok"]');
    if (!(await page.$eval(".bai-err", el => el.textContent)).includes("doesn’t look like")) throw new Error("bad paste not caught");
    const answer = "1 | X | - | - | recap film\n2 | K | 2031-05-04 | - | date\nEND";
    await page.fill(".bai-in", answer);
    await page.click('.bai-sheet [data-a="ok"]');
    await page.waitForSelector(".bai-sheet .bai-list");
    const rv = await page.$$eval(".bai-item", els => els.length);
    if (rv !== 2) throw new Error("expected 2 suggestions, got " + rv);
    await page.screenshot({ path: `${OUT}/14-gapp-review.png` });
    await page.click('.bai-sheet [data-a="ok"]');
    // more batches may follow: stop them
    for (let i = 0; i < 20 && await page.$(".bai-sheet"); i++) {
      if (await page.$('.bai-sheet [data-a="stop"]')) await page.click('.bai-sheet [data-a="stop"]');
      else await page.click('.bai-sheet [data-a="no"]');
      await page.waitForTimeout(100);
    }
    await page.waitForFunction(() => !window.__app.ui.job, null, { timeout: 5000 });
    const after = await missingN();
    if (after !== before - 1) throw new Error(`verify should hide one entry: ${before} -> ${after}`);
    const dated = await page.evaluate(l => window.__app.db.canon().filter(c => c.date === "2031-05-04").length, lines[1]);
    if (!dated) throw new Error("verify date not applied");
    console.log(`gemini app verify: ${before} -> ${after} missing, ${dated} dated`);

    // news: one new title, one already known
    await page.click('[data-action="gapp"][data-k="news"]');
    await page.waitForSelector(".bai-sheet .bai-in");
    await page.click('.bai-sheet [data-a="show"]');
    const np = await page.$eval(".bai-prompt", el => el.value);
    const fr = (np.match(/^## (.+)$/m) || [])[1];
    if (!fr) throw new Error("news prompt has no franchises");
    const known = (np.split("## " + fr + "\n")[1].match(/^(.+?) \(/m) || [])[1];
    await page.fill(".bai-in", `# ${fr}\nBrand New Sequel Zeta | F | 2032 | 2032-02-02\n${known} | F | 2000 | -`);
    await page.click('.bai-sheet [data-a="ok"]');
    await page.waitForSelector(".bai-sheet .bai-list");
    if (await page.$$eval(".bai-item", els => els.length) !== 1) throw new Error("news should offer only the new title");
    await page.click('.bai-sheet [data-a="ok"]');
    for (let i = 0; i < 20 && await page.$(".bai-sheet"); i++) { await page.click('.bai-sheet [data-a="stop"], .bai-sheet [data-a="no"]'); await page.waitForTimeout(100); }
    await page.waitForFunction(() => !window.__app.ui.job, null, { timeout: 5000 });
    if (!(await page.evaluate(() => window.__app.db.canon().some(c => c.title === "Brand New Sequel Zeta" && c.origin === "gemini")))) throw new Error("news entry not added");
    console.log("gemini app news: added 1, skipped known '" + known + "'");

    // multiverse step 1 then step 2 through the Gemini app
    await page.click('[data-action="mv"][data-k="group"][data-via="app"]');
    await page.waitForSelector(".bai-sheet .bai-in");
    await page.click('.bai-sheet [data-a="show"]');
    const gp = await page.$eval(".bai-prompt", e => e.value);
    const tl = gp.split(/TITLES \(n\. Title[^\n]*\n/)[1].trim().split("\n");
    const mvOf = l => /Star Wars/.test(l) ? "Star Wars" : /Matrix|Animatrix/.test(l) ? "The Matrix" : /Walking Dead/.test(l) ? "The Walking Dead Universe" : /Doctor Who|Sarah Jane|Torchwood|Class/.test(l) ? "Whoniverse" : null;
    await page.fill(".bai-in", tl.map((l, i) => mvOf(l) ? `${i + 1} | ${mvOf(l)} | ${mvOf(l)}` : `${i + 1} | -`).join("\n") + "\n= The Walking Dead | The Walking Dead Universe");
    await page.click('.bai-sheet [data-a="ok"]');
    while (await page.$(".bai-sheet")) { await page.click('.bai-sheet [data-a="stop"]'); await page.waitForTimeout(100); }
    await page.waitForFunction(() => !window.__app.ui.job, null, { timeout: 5000 });
    const mvs = await page.evaluate(() => Core.multiverses(window.__app.db).map(g => g.name));
    if (!mvs.includes("Whoniverse") || !mvs.includes("Star Wars")) throw new Error("grouping: " + mvs);
    await page.click('[data-action="mv"][data-k="expand"][data-via="app"]');
    await page.waitForSelector(".bai-sheet .bai-in");
    await page.click('.bai-sheet [data-a="show"]');
    const ep = await page.$eval(".bai-prompt", e => e.value);
    if (!/## Star Wars/.test(ep)) throw new Error("expand prompt: " + ep.slice(0, 300));
    await page.fill(".bai-in", JSON.stringify([{ multiverse: "Star Wars", franchise: "Andor", title: "Andor Season Zeta", medium: "TV Series", year: "2033" }]));
    await page.click('.bai-sheet [data-a="ok"]');
    while (await page.$(".bai-sheet")) { await page.click('.bai-sheet [data-a="stop"]'); await page.waitForTimeout(100); }
    await page.waitForFunction(() => !window.__app.ui.job, null, { timeout: 5000 });
    const sub = await page.evaluate(() => (Core.canonStatus(window.__app.db).find(c => c.title === "Andor Season Zeta") || {}).sub);
    if (sub !== "Andor") throw new Error("expand result sub: " + sub);
    const twd = await page.evaluate(() => Core.canonStatus(window.__app.db).filter(c => /Walking Dead/.test(c.title)).map(c => c.franchise));
    if (!twd.length || twd.some(f => f !== "The Walking Dead Universe")) throw new Error("alias not applied: " + twd);
    await page.click('[data-action="mvlist"]');
    await page.screenshot({ path: `${OUT}/15-multiverse.png`, fullPage: true });
    console.log(`multiverses: ${mvs.join(", ")}; expand added Andor Season Zeta`);
  }

  // Adaptive layout: cover screen, unfolded inner screen, landscape phone
  for (const [name, w, h] of [["cover", 344, 882], ["unfolded", 884, 1104], ["landscape", 915, 412], ["tablet", 1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    for (const tab of ["home", "missing"]) {
      await page.evaluate(t => window.__app.go(t), tab);
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const nav = document.querySelector("nav.tabs").getBoundingClientRect(), main = document.querySelector("main").getBoundingClientRect(), top = document.querySelector(".topbar").getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - innerWidth, navW: nav.width, navH: nav.height, mainL: main.left, topTop: top.top };
      });
      if (m.overflow > 1) throw new Error(`${name}/${tab}: horizontal overflow ${m.overflow}px`);
      // 0.5.9: the rail from 680 px (the Fold's inner screen), with names (200 px) from 1024 px
      if (w >= 680 && !(m.navW < (w >= 1024 ? 210 : 120) && m.mainL >= m.navW - 1)) throw new Error(`${name}/${tab}: no rail ${JSON.stringify(m)}`);
      if (w < 680 && h > 540 && m.navW < Math.min(w, 640) - 40) throw new Error(`${name}/${tab}: bottom nav expected ${JSON.stringify(m)}`);
      await page.screenshot({ path: `${OUT}/fold-${name}-${tab}.png` });
    }
  }
  await page.setViewportSize({ width: 412, height: 915 });
  console.log("adaptive layouts ok");

  // Persistence: data saved through the bridge
  await page.evaluate(() => window.__app.db.flush());
  const stored = await page.evaluate(() => JSON.parse(window.__mock.files["canonsync.json"]).items.length);
  console.log("persisted items:", stored);
  console.log("bridge log sample:", (await page.evaluate(() => window.__mock.log.filter(l => l.startsWith("OPEN") || l.startsWith("COPY")))).join(" | "));

  // Empty-state screenshot
  const p2 = await ctx.newPage();
  p2.on("pageerror", e => errors.push(String(e)));
  await p2.addInitScript(() => { window.Android = { load: () => "", save: () => true, take: () => "", http: () => {}, pick: () => {}, openUrl: () => {}, copy: () => {}, sha256url: () => "", randomUrl: () => "", version: () => "1.2" }; });
  await p2.goto("file://" + path.join(__dirname, "index.html") + "?empty");
  await p2.evaluate(() => { window.__app.db.set("auto_sync", "0"); window.__app.ui.job = null; window.__app.render(); });
  await p2.screenshot({ path: `${OUT}/0-empty.png` });
  // a clean install starts empty: no sources, accounts or keys filled in
  const preset = await p2.evaluate(() => ({ t: window.__app.db.get("tmdb_key") || "", u: window.__app.db.get("imdb_user") || "", l: window.__app.db.get("imdb_lists") || "", n: window.__app.db.get("username") || "", g: window.__app.db.get("gemini_key") || "" }));
  if (Object.values(preset).some(Boolean)) throw new Error("clean install isn't empty: " + JSON.stringify(preset));
  console.log("clean install: empty settings");

  if (errors.length) throw new Error("JS errors: " + errors.join("\n"));
  console.log("UI TESTS PASSED");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
