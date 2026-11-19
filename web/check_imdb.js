// Saga 0.7.0: the daily check that IMDb still answers the way Saga reads it (run on GitHub every morning).
// Exit 1 only when IMDb changed something Saga depends on; IMDb turning away GitHub's servers is reported, not failed.
// Run: node check_imdb.js
const C = require("./core.js");
const http = async (method, url, o = {}) => {
  try {
    const r = await fetch(url, { method, headers: o.headers || {}, body: o.body, signal: AbortSignal.timeout(30000) });
    return { status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() };
  } catch (e) { return { status: 0, headers: {}, body: "", error: e.message }; }
};
(async () => {
  const out = [];
  let changed = false, blocked = false;
  // 1. the data service: one well-known title, with every field Saga asks for
  try {
    const d = await C.imdbGql(http, `{title(id:"tt0111161"){${C.T_FIELDS}}}`);
    const t = d && d.title;
    if (!t || !t.titleText || !t.titleText.text || !(t.releaseYear || {}).year) { changed = true; out.push("data service: the answer is missing fields Saga reads: " + JSON.stringify(t).slice(0, 200)); }
    else out.push(`data service: OK (${t.titleText.text}, ${t.releaseYear.year})`);
  } catch (e) {
    const w = C.imdbWhy(e.message);
    if (w.kind === "changed") { changed = true; out.push("data service CHANGED: " + e.message); }
    else { blocked = true; out.push(`data service: inconclusive (${w.kind}): ${e.message}`); }
  }
  // 2. a list through the data service, the shape Saga reads lists and ratings in
  try {
    const d = await C.imdbGql(http, `{chartTitles(first:5,chart:{chartType:TOP_RATED_MOVIES}){edges{node{${C.T_FIELDS}}}}}`);
    const n = (((d || {}).chartTitles || {}).edges || []).length;
    if (!n) { changed = true; out.push("lists: no titles in the answer"); } else out.push(`lists: OK (${n} titles)`);
  } catch (e) {
    const w = C.imdbWhy(e.message);
    if (w.kind === "changed") { changed = true; out.push("lists CHANGED: " + e.message); }
    else { blocked = true; out.push(`lists: inconclusive (${w.kind}): ${e.message}`); }
  }
  console.log(out.join("\n"));
  if (changed) { console.log("IMDB CHANGED: Saga's IMDb sync needs an update"); process.exit(1); }
  console.log(blocked ? "IMDB CHECK INCONCLUSIVE (no usable answer from IMDb: it turned GitHub away, or the connection failed)" : "IMDB CHECK PASSED");
})();
