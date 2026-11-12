// Loads bg.html exactly as SyncJobService does (off-screen, Android bridge only) and checks notifications + done().
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"] }) // no outside network: the same result on any machine;
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.addInitScript(() => {
    const files = {}, results = {}, log = [];
    // saved state from the app: baseline already taken, Doctor Who watched, TMDB key set
    files["canonsync.json"] = JSON.stringify({ v: 1, settings: { tmdb_key: "k", alerts_baseline: "1", alerts_known: "{}", bg_enabled: "1" },
      items: [{ source: "trakt", kind: "watched", list_name: "", imdb: "tt0436992", tmdb: "57243", title: "Doctor Who", norm: "doctor who", year: 2005, medium: "TV Series", key: "tt0436992" }],
      exclusions: [], canon: [], specials: [], franchiseMap: [], tmdbCache: [] });
    window.Android = {
      load: n => files[n] || "", save: (n, t) => { files[n] = t; return true; },
      take: id => { const r = results[id]; delete results[id]; return r || ""; },
      http: (id, method, url) => {
        setTimeout(() => {
          const u = new URL(url);
          let body = "{}", status = 404;
          if (u.pathname === "/3/tv/57243") { status = 200; body = JSON.stringify({ name: "Doctor Who", status: "Returning Series", next_episode_to_air: { air_date: "2099-12-25", season_number: 16, episode_number: 1 } }); }
          results[id] = JSON.stringify({ status, headers: {}, body });
          window.__httpDone(id);
        }, 5);
      },
      notify: (id, title, text, tab) => log.push({ id, title, text, tab }),
      done: r => { window.__doneReport = r; },
    };
    window.__bg = { files, log };
  });
  await page.goto("file://" + path.join(__dirname, "bg.html"));
  await page.waitForFunction(() => window.__doneReport !== undefined, null, { timeout: 20000 });
  const out = await page.evaluate(() => ({ report: window.__doneReport, notes: window.__bg.log, saved: JSON.parse(window.__bg.files["canonsync.json"]).settings }));
  console.log(out.report);
  console.log("notifications:", JSON.stringify(out.notes));
  if (out.notes.length !== 1 || out.notes[0].title !== "New season of Doctor Who" || out.notes[0].text !== "Season 16 starts 25 Dec 2099.") throw new Error("expected one Doctor Who notification");
  if (!out.saved.bg_last || !out.saved.alerts_known.includes("s|tv:57243|16")) throw new Error("state not saved");
  if (errors.length) throw new Error(errors.join("\n"));
  await browser.close();
  console.log("BACKGROUND TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
