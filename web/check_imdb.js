// Saga 0.7.3: the daily check that IMDb still answers the way Saga reads it. The website server on your Pi runs it once a
// day (GitHub's servers are turned away by IMDb); the phone shows a warning on Home when IMDb changed something.
// As a command: node check_imdb.js (exit 1 only when IMDb changed something Saga depends on).
"use strict";
const C = require("./core.js");
const nodeHttp = async (method, url, o = {}) => {
  try {
    const r = await fetch(url, { method, headers: o.headers || {}, body: o.body, signal: AbortSignal.timeout(30000) });
    return { status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() };
  } catch (e) { return { status: 0, headers: {}, body: "", error: e.message }; }
};
// → { state: "ok" | "changed" | "inconclusive", lines: [...] }
async function check(http = nodeHttp) {
  const lines = [];
  let changed = false, blocked = false;
  if (C.resetGql) C.resetGql(); // a refusal yesterday says nothing about today
  const probe = async (label, query, test) => {
    try {
      const d = await C.imdbGql(http, query);
      const why = test(d);
      if (why) { changed = true; lines.push(`${label}: ${why}`); } else lines.push(`${label}: OK`);
    } catch (e) {
      const w = C.imdbWhy(e.message);
      if (w.kind === "changed") { changed = true; lines.push(`${label} CHANGED: ${e.message}`); } else { blocked = true; lines.push(`${label}: inconclusive (${w.kind}): ${e.message}`); }
    }
  };
  // a well-known title with every field Saga asks for, then a list in the shape Saga reads lists and ratings in
  await probe("data service", `{title(id:"tt0111161"){${C.T_FIELDS}}}`, d => { const t = d && d.title; return !t || !t.titleText || !t.titleText.text || !(t.releaseYear || {}).year ? "the answer is missing fields Saga reads" : ""; });
  await probe("lists", `{chartTitles(first:5,chart:{chartType:TOP_RATED_MOVIES}){edges{node{${C.T_FIELDS}}}}}`, d => ((((d || {}).chartTitles || {}).edges || []).length ? "" : "no titles in the answer"));
  return { state: changed ? "changed" : blocked ? "inconclusive" : "ok", lines, at: Date.now() };
}
module.exports = { check };
if (require.main === module) check().then(r => { console.log(r.lines.join("\n")); console.log(r.state === "changed" ? "IMDB CHANGED: Saga's IMDb sync needs an update" : r.state === "ok" ? "IMDB CHECK PASSED" : "IMDB CHECK INCONCLUSIVE (no usable answer from IMDb)"); if (r.state === "changed") process.exit(1); });
