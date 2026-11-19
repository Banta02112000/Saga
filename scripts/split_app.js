// Moves one block of web/app.js into its own file, as a part that gets everything it uses from the app through an
// explicit object (A). Every reference is found by real scope analysis (acorn + eslint-scope), so nothing is renamed
// by accident. Run (needs acorn and eslint-scope, e.g. NODE_PATH=/tmp/acorn/node_modules):
//   node scripts/split_app.js <startMarker> <endMarker> <partName> <outFile> "<header comment>"
// The block runs from the line containing startMarker up to (not including) the line containing endMarker.
"use strict";
const fs = require("fs"), path = require("path");
const acorn = require("acorn"), escope = require("eslint-scope");
const [startMark, endMark, part, outFile, header] = process.argv.slice(2);
const APP = path.join(__dirname, "..", "web", "app.js");
const src = fs.readFileSync(APP, "utf8");
const lineStart = mark => { const i = src.indexOf(mark); if (i < 0) throw new Error("marker not found: " + mark); if (src.indexOf(mark, i + 1) >= 0) throw new Error("marker not unique: " + mark); return src.lastIndexOf("\n", i) + 1; };
const S = lineStart(startMark), En = lineStart(endMark);
if (En <= S) throw new Error("end before start");
const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: "script", ranges: true });
const sm = escope.analyze(ast, { ecmaVersion: 2022, sourceType: "script" });
// the app's own scope: the outermost function (the IIFE around everything)
const appFn = sm.scopes.find(s => s.type === "function" && s.upper && s.upper.type === "global");
const inBlock = n => n.range[0] >= S && n.range[1] <= En;
const moved = new Map(), deps = new Map(); // name → { kind, assignedInBlock }
for (const v of appFn.variables) {
  if (v.name === "arguments") continue;
  const defs = v.defs; if (!defs.length) continue;
  const d = defs[0], declNode = d.node;
  if (inBlock(d.name)) {
    // declared in the block: does the rest of the app use it?
    const outside = v.references.filter(r => !inBlock(r.identifier));
    const kind = d.type === "FunctionName" ? "function" : (d.parent && d.parent.kind) || d.type;
    moved.set(v.name, { kind, outside, refs: v.references, writesOutside: outside.some(r => r.isWrite()) });
  } else {
    const inside = v.references.filter(r => inBlock(r.identifier));
    if (inside.length) deps.set(v.name, { kind: d.type === "FunctionName" ? "function" : (d.parent && d.parent.kind) || d.type, inside, writes: inside.some(r => r.isWrite()) });
  }
}
// top-level statements of the block: only declarations and assignments that don't run anything else at load
const body = appFn.block.body.body;
const top = body.filter(st => st.range[0] >= S && st.range[1] <= En);
const straddle = body.filter(st => st.range[0] < En && st.range[1] > S && !(st.range[0] >= S && st.range[1] <= En));
if (straddle.length) throw new Error("a statement crosses the block's edge at " + straddle.map(s => s.range[0]).join(","));
const eager = top.filter(st => !(st.type === "FunctionDeclaration" || st.type === "VariableDeclaration" || (st.type === "ExpressionStatement" && st.expression.type === "AssignmentExpression" && /^window\./.test(src.slice(st.expression.left.range[0], st.expression.left.range[1])))));
if (eager.length) console.warn("statements in the block that run at load (left as they are, check them):\n" + eager.map(s => "  " + src.slice(s.range[0], Math.min(s.range[1], s.range[0] + 100))).join("\n"));
for (const [n, m] of moved) if (m.writesOutside) throw new Error(`${n} is assigned outside the block: can't move it`);
// rewrite the block: references to the app's names → A.name
const edits = [];
for (const [n, d] of deps) for (const r of d.inside) {
  const id = r.identifier;
  // another part's handle (P_x) is a function that starts it on first use
  edits.push([id.range[0], id.range[1], /^P_/.test(n) ? `A.${n}()` : "A." + n, id]);
}
// shorthand properties { db } → { db: A.db }
const parents = new Map();
(function walk(node, parent) { if (!node || typeof node.type !== "string") return; parents.set(node, parent); for (const k of Object.keys(node)) { const v = node[k]; if (Array.isArray(v)) v.forEach(c => walk(c, node)); else if (v && typeof v.type === "string") walk(v, node); } })(ast, null);
let block = src.slice(S, En);
edits.sort((a, b) => b[0] - a[0]);
for (const [a, b, txt, id] of edits) {
  const p = parents.get(id);
  const rep = p && p.type === "Property" && p.shorthand && p.value === id ? `${id.name}: ${txt}` : txt;
  block = block.slice(0, a - S) + rep + block.slice(b - S);
}
const exported = [...moved.keys()].filter(n => moved.get(n).outside.length);
const getters = [...deps.entries()].map(([n, d]) => d.writes ? `get ${n}() { return ${n}; }, set ${n}(v) { ${n} = v; }` : `get ${n}() { return ${n}; }`);
const out = `${header ? header.split("\\n").map(l => "// " + l).join("\n") + "\n" : ""}// A part of app.js, in its own file: it gets what it uses from the rest of the app through A, and gives back what
// the app uses (made by scripts/split_app.js; the names it uses are listed in app.js where it's put together).
(function (root) {
  "use strict";
  (root.SagaParts = root.SagaParts || {}).${part} = function (A) {
${block.replace(/\n$/, "")}
    return { ${exported.join(", ")} };
  };
})(typeof window !== "undefined" ? window : this);
`;
fs.writeFileSync(path.join(__dirname, "..", "web", outFile), out);
// in app.js: the block becomes the part's wiring; the app's other uses of moved names go through it
const P = "P_" + part;
const MARK = `  // ---- ${outFile} (moved out of this file in 0.7.0): wired up at the top of the app; it starts here, where it used to be\n  ${P}();\n`;
let rest = src.slice(0, S) + MARK + src.slice(En);
// uses of moved non-function names elsewhere → P_part.name (functions get a wrapper, so they stay hoisted)
const outEdits = [];
for (const n of exported) { const m = moved.get(n); if (m.kind === "function") continue; for (const r of m.outside) outEdits.push(r.identifier); }
outEdits.sort((a, b) => b.range[0] - a.range[0]);
for (const id of outEdits) {
  const shift = id.range[0] >= En ? -(En - S) + MARK.length : 0;
  const a = id.range[0] + shift, b = id.range[1] + shift, p = parents.get(id);
  const rep = p && p.type === "Property" && p.shorthand && p.value === id ? `${id.name}: ${P}().${id.name}` : `${P}().${id.name}`;
  rest = rest.slice(0, a) + rep + rest.slice(b);
}
const wrappers = exported.filter(n => moved.get(n).kind === "function").map(n => `  function ${n}(...a) { return ${P}().${n}(...a); }`).join("\n");
// started on first use (or where the block used to be), so what it reads from the app at start already exists
const wiring = `  // ${outFile}: what it uses from here, and what it gives back
  let ${P}$ = null;
  function ${P}() { return ${P}$ || (${P}$ = SagaParts.${part}(A_${part})); }
  const A_${part} = ({
    ${getters.join(",\n    ")}
  });
${wrappers}
`;
// right after the app's "use strict" at the top
const us = rest.indexOf('"use strict";');
const at = rest.indexOf("\n", us) + 1;
rest = rest.slice(0, at) + wiring + rest.slice(at);
fs.writeFileSync(APP, rest);
console.log(`moved ${En - S} characters to web/${outFile}: ${moved.size} names (${exported.length} used elsewhere), ${deps.size} names taken from the app`);
