// Runs the real page probe against simulated IMDb pages in Chromium, polling it once a second like Bridge.java.
const { chromium } = require("playwright");
const assert = require("assert");
const C = require("./core.js");

function makeItems(from, to, withRating) {
  const out = [];
  for (let i = from; i < to; i++) {
    const t = { id: "tt" + String(1000000 + i), titleText: { text: "Title " + i }, releaseYear: { year: 1950 + (i % 70) },
                titleType: { id: i % 9 === 0 ? "videoGame" : i % 4 === 0 ? "tvSeries" : "movie" },
                releaseDate: { year: 1950 + (i % 70), month: 1 + (i % 12), day: 1 + (i % 28) },
                titleGenres: { genres: [{ genre: { text: "Drama" } }] }, runtime: { seconds: 6000 } };
    out.push(withRating ? { node: { title: t }, userRating: { value: 1 + (i % 10) } } : { listItem: t });
  }
  return out;
}

// mode "scroll": IntersectionObserver sentinel (list pages); mode "button": "250 more" button (ratings pages)
function pageHtml(total, mode, withRating, partialFirst) {
  const first = makeItems(0, Math.min(250, total), withRating);
  const next = JSON.stringify({ props: { pageProps: { mainColumnData: { list: { titleListItemSearch: { total, edges: first } } } } } });
  return `<!doctype html><html><head><title>My list - IMDb</title><meta name="viewport" content="width=device-width"></head><body>
<header><a href="/registration/signin">Sign in</a> <button onclick="location.href='/chart/top/'">See more</button></header>
<ul id="list">${first.map(e => { const t = e.listItem || e.node.title; return `<li style="height:120px"><a href="/title/${t.id}/">${t.titleText.text}</a></li>`; }).join("")}</ul>
<div id="sentinel" style="height:10px"></div>
${mode === "button" && total > 250 ? '<button id="more" class="ipc-see-more__button">250 more</button>' : ""}
<footer><a href="/title/tt9999999/">Trending: Some Other Show</a></footer>
<script id="__NEXT_DATA__" type="application/json">${partialFirst ? next.slice(0, Math.floor(next.length / 2)) : next}</script>
<script>
  var loaded = ${first.length}, total = ${total}, busy = false;
  function addMore() {
    if (busy || loaded >= total) return;
    busy = true;
    fetch("https://api.graphql.imdb.com/", { method: "POST", body: JSON.stringify({ after: loaded }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        var edges = j.data.list.titleListItemSearch.edges;
        edges.forEach(function (e) { var t = e.listItem || e.node.title; var li = document.createElement("li"); li.style.height = "120px";
          li.innerHTML = '<a href="/title/' + t.id + '/">' + t.titleText.text + '</a>'; document.getElementById("list").appendChild(li); });
        loaded += edges.length; busy = false;
        if (loaded >= total && document.getElementById("more")) document.getElementById("more").remove();
      });
  }
  ${mode === "scroll" ? 'new IntersectionObserver(function (es) { if (es[0].isIntersecting) addMore(); }).observe(document.getElementById("sentinel"));'
                      : 'var mb = document.getElementById("more"); if (mb) mb.addEventListener("click", addMore);'}
</script></body></html>`;
}

// IMDb's newer ratings page: GET GraphQL with variables + cursor, an Italian "Altri 250" button that works only once,
// pageInfo/total in every answer. The probe must replay the page's own request with the next cursor.
function cursorHtml(total) {
  const first = makeItems(0, 250, true);
  const nd = JSON.stringify({ props: { pageProps: { mainColumnData: { advancedTitleSearch: { total, pageInfo: { hasNextPage: true, endCursor: "c250" }, edges: first } } } } });
  return `<!doctype html><html><head><title>Le mie valutazioni - IMDb</title></head><body>
<ul id="list">${first.map(e => `<li><a href="/title/${e.node.title.id}/">${e.node.title.titleText.text}</a></li>`).join("")}</ul>
<button id="more" class="ipc-see-more__button">Altri 250</button>
<script id="__NEXT_DATA__" type="application/json">${nd}</script>
<script>
  document.getElementById("more").addEventListener("click", function () {
    this.remove();
    var v = encodeURIComponent(JSON.stringify({ first: 250, after: "c250", sort: { by: "DATE" } }));
    fetch("https://caching.graphql.imdb.com/?operationName=RatingsPage&variables=" + v + "&extensions=%7B%7D", { headers: { "content-type": "application/json" } })
      .then(function (r) { return r.json(); });
  });
</script></body></html>`;
}

async function runProbe(page, url, timeoutMs) {
  await page.goto(url, { waitUntil: "commit" });
  const probe = C.probeFor(timeoutMs);
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await page.evaluate(probe); } catch (e) { v = null; } // page may be navigating
    if (v) return { v, secs: (Date.now() - t0) / 1000 };
    if (Date.now() - t0 > timeoutMs) throw new Error("timeout");
    await page.waitForTimeout(1000);
  }
}

(async () => {
  const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost"] }) // no outside network: the same result on any machine;
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true });
  const page = await ctx.newPage();
  const navs = [];
  page.on("framenavigated", f => { if (f === page.mainFrame()) navs.push(f.url()); });
  let cfg = {};
  await page.route("https://www.imdb.com/**", route => {
    const u = route.request().url();
    if (u.includes("/chart/top")) return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Top 250</title>" });
    return route.fulfill({ status: 200, contentType: "text/html", body: pageHtml(cfg.total, cfg.mode, cfg.rating, cfg.partial) });
  });
  await page.route("https://api.graphql.imdb.com/**", async route => {
    const after = JSON.parse(route.request().postData()).after;
    await new Promise(r => setTimeout(r, cfg.latency || 300)); // network latency
    const edges = makeItems(after, Math.min(after + 250, cfg.total), cfg.rating);
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ data: { list: { titleListItemSearch: { edges } } } }) });
  });

  await page.route("https://caching.graphql.imdb.com/**", async route => {
    const v = JSON.parse(new URL(route.request().url()).searchParams.get("variables"));
    const from = +String(v.after).slice(1), to = Math.min(from + v.first, cfg.total);
    await new Promise(r => setTimeout(r, 200));
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ data: { advancedTitleSearch: { total: cfg.total, pageInfo: { hasNextPage: to < cfg.total, endCursor: "c" + to }, edges: makeItems(from, to, true) } } }) });
  });
  await page.route("https://www.imdb.com/user/p.cursor/**", route => route.fulfill({ status: 200, contentType: "text/html", body: cursorHtml(cfg.total) }));

  // 0) 5.1.1: ratings page that only loads more through its own cursor requests (1,940 ratings)
  cfg = { total: 1940 };
  let r0 = await runProbe(page, "https://www.imdb.com/user/p.cursor/ratings/", 300000);
  let res0 = JSON.parse(r0.v);
  console.log(`cursor ratings: ${res0.items.filter(x => x.r).length} rated of ${res0.total}, capped ${res0.capped}, ${r0.secs.toFixed(0)}s`);
  assert.strictEqual(res0.items.filter(x => x.r).length, 1940);
  assert.strictEqual(res0.total, 1940);
  assert.strictEqual(res0.capped, false);

  // 1) list with infinite scroll: 1,130 titles
  cfg = { total: 1130, mode: "scroll", rating: false };
  let r = await runProbe(page, "https://www.imdb.com/list/ls100000015/", 180000);
  let res = JSON.parse(r.v);
  const items = res.items.filter(x => x.t).map(x => x);
  console.log(`scroll list: ${items.length} titles, ${res.loads} extra loads, ${r.secs.toFixed(0)}s`);
  assert.strictEqual(items.filter(x => /^Title /.test(x.t)).length, 1130);
  assert.ok(navs.every(u => !u.includes("/chart/top")), "probe clicked an unrelated 'See more' button");

  // 2) ratings page with a "250 more" button: 760 ratings, values preserved
  cfg = { total: 760, mode: "button", rating: true };
  r = await runProbe(page, "https://www.imdb.com/user/p.exampleuser00000000000000000/ratings/", 330000);
  res = JSON.parse(r.v);
  const rated = res.items.filter(x => x.r);
  console.log(`ratings (button): ${rated.length} rated, ${res.loads} extra loads, ${r.secs.toFixed(0)}s`);
  assert.strictEqual(rated.length, 760);
  assert.strictEqual(rated.find(x => x.i === "tt1000013").r, 4);

  // 2b) slow phone network: each "load more" takes 6.5 s, longer than the 4-poll quiet window
  cfg = { total: 800, mode: "scroll", rating: false, latency: 6500 };
  r = await runProbe(page, "https://www.imdb.com/list/ls100000013/", 180000);
  res = JSON.parse(r.v);
  console.log(`slow network: ${res.items.length} titles, ${res.loads} extra loads, ${r.secs.toFixed(0)}s`);
  assert.strictEqual(res.items.filter(x => /^Title /.test(x.t)).length, 800);

  // 3) short list: finishes quickly without extra loads
  cfg = { total: 40, mode: "scroll", rating: false };
  r = await runProbe(page, "https://www.imdb.com/list/ls100000004/", 180000);
  res = JSON.parse(r.v);
  assert.strictEqual(res.items.length, 40);
  assert.ok(r.secs < 12, `short list too slow: ${r.secs}s`);
  console.log(`short list: ${res.items.length} titles in ${r.secs.toFixed(0)}s`);

  // 4) truncated page data is never returned (waits instead)
  cfg = { total: 40, mode: "scroll", rating: false, partial: true };
  await page.goto("https://www.imdb.com/list/ls100000010/");
  for (let i = 0; i < 3; i++) assert.strictEqual(await page.evaluate(C.probeFor(180000)), null);
  console.log("truncated page data: probe keeps waiting (no broken JSON)");

  // 4b) a failed page load (connection reset) is reported at once, not after the timeout
  await page.route("https://www.imdb.com/list/ls100000011/**", route => route.abort("connectionreset"));
  try { await page.goto("https://www.imdb.com/list/ls100000011/"); } catch (e) { /* expected */ }
  const t0 = Date.now();
  let neterr = null;
  for (let i = 0; i < 10 && !neterr; i++) { // polled like Bridge.java does
    try { neterr = await page.evaluate(C.probeFor(180000)); } catch (e) { /* page still switching to the error page */ }
    if (!neterr) await page.waitForTimeout(300);
  }
  console.log(`failed load: probe says ${JSON.stringify(neterr)} after ${Date.now() - t0} ms (url ${page.url()})`);
  assert.ok(/^NETERR:/.test(neterr), "chrome-error page must be reported immediately");
  await page.unroute("https://www.imdb.com/list/ls100000011/**");

  // 5) end to end through core.browseTitles with the probe executed in the page
  cfg = { total: 300, mode: "scroll", rating: false };
  const http = async () => ({ status: 404, headers: {}, body: "" });
  http.browse = async (url, probe, timeout) => {
    try { await page.goto(url, { waitUntil: "commit" }); } catch (e) { /* failed load: WebView shows chrome-error page */ }
    const t0 = Date.now();
    for (;;) {
      let v = null;
      try { v = await page.evaluate(probe); } catch (e) { v = null; }
      if (v) return { status: 200, value: v };
      if (Date.now() - t0 > timeout) return { status: 0, error: "timeout" };
      await page.waitForTimeout(1000);
    }
  };
  // first two loads fail like on the phone, the third works
  let fails = 2;
  await page.route("https://www.imdb.com/list/ls100000015/", route => (fails-- > 0 ? route.abort("connectionreset") : route.fallback()));
  C.CONFIG.retryDelayMs = 200;
  const [list, route] = await C.imdbList(http, "https://www.imdb.com/list/ls100000015/?ref_=x");
  assert.ok(fails < 0, "the failed loads were retried");
  assert.strictEqual(list.filter(i => /^Title /.test(i.title)).length, 300);
  const sample = list.find(i => i.imdb === "tt1000009");
  assert.deepStrictEqual([sample.medium, sample.date, sample.runtime], ["Video Game", "1959-10-10", 100]);
  console.log(`core.imdbList: ${list.length} titles via ${route}`);

  // 5.4.1: a short list whose page also carries someone's ratings count must not look incomplete,
  // and a long list with no working button is paged through IMDb's API from inside the page
  const listPage = (n, total, next) => `<!doctype html><html><head><title>List</title></head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { side: { ratings: { total: 10795, edges: makeItems(5000, 5003, true) } },
    mainColumnData: { list: { titleListItemSearch: { total, pageInfo: { hasNextPage: !!next, endCursor: next || null }, edges: makeItems(0, n, false) } } } } } })}</script></body></html>`;
  await page.route("https://www.imdb.com/list/ls900/**", r => r.fulfill({ status: 200, contentType: "text/html", body: listPage(9, 9, null) }));
  await page.route("https://www.imdb.com/list/ls901/**", r => r.fulfill({ status: 200, contentType: "text/html", body: listPage(250, 600, "c250") }));
  await page.route("https://api.graphql.imdb.com/**", async route => {
    const b = JSON.parse(route.request().postData() || "{}"), from = +String(b.variables.after).slice(1), to = Math.min(from + 250, 600);
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "https://www.imdb.com", "access-control-allow-credentials": "true" },
      body: JSON.stringify({ data: { list: { titleListItemSearch: { total: 600, pageInfo: { hasNextPage: to < 600, endCursor: "c" + to }, edges: makeItems(from, to, false) } } } }) });
  });
  let rs = JSON.parse((await runProbe(page, "https://www.imdb.com/list/ls900/", 120000)).v);
  console.log(`short list: ${rs.items.length} titles, total ${rs.total}, capped ${rs.capped}`);
  assert.ok(rs.total === 9 && rs.capped === false && rs.items.length >= 9);
  let rl = JSON.parse((await runProbe(page, "https://www.imdb.com/list/ls901/", 120000)).v);
  console.log(`long list paged by API: ${rl.items.length} titles of ${rl.total}, capped ${rl.capped} ${rl.dbg}`);
  assert.ok(rl.items.length >= 600 && rl.capped === false, JSON.stringify([rl.items.length, rl.dbg]));
  await browser.close();
  console.log("PROBE TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
