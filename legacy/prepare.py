"""Builds the Games (GameCheck) and Doctor Who (DW Canon) pages for the merged app from the original pages in legacy/src:
CanonSync colours, the shared strip and theme, and the Gemini app (copy and paste) hooks. Output: legacy/assets/{gc,dw}."""
import argparse, json, os, re, shutil, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
# --out: where gc/ and dw/ go (default legacy/assets, used by the tests); --scheme: link scheme of the tab switcher;
# --blank: the shareable build, without Banta's games list, IMDb account/lists or Doctor Who ratings and progress
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(ROOT, "assets"))
ap.add_argument("--scheme", default="bantaapps")
ap.add_argument("--blank", action="store_true")
ARGS = ap.parse_args()

COMMON = {  # dark blue / grey surfaces -> CanonSync plum
}
GC = {
    "#0e0f13": "#17122A", "#15171d": "#1D1733", "#1b1e26": "#221B3B", "#242833": "#2E2650", "#262a35": "#3A3160",
    "#eceef3": "#F1ECFF", "#a3a9b8": "#A99FCB", "#6b7183": "#6F6596", "#8b7cff": "#F5B841",
    "rgba(139,124,255,.14)": "rgba(245,184,65,.14)", "rgba(139,124,255,.38)": "rgba(245,184,65,.3)",
    "#199e70": "#2BB3A4", "rgba(25,158,112,.16)": "rgba(63,211,194,.16)", "#4fd1a1": "#3FD3C2",
    "#5aa9ff": "#8FA2FF", "rgba(90,169,255,.15)": "rgba(143,162,255,.15)", "rgba(90,169,255,.14)": "rgba(143,162,255,.14)",
    "#ff6b6b": "#FF7F8E", "rgba(14,15,19,.92)": "rgba(23,18,42,.94)", "rgba(21,23,29,.96)": "rgba(34,27,59,.97)",
    "#2d3a4f": "#3A3160", "#8cc4ff": "#B9C4FF", "#9fd0ff": "#B9C4FF", "#9db4ff": "#B9C4FF", "rgba(70,120,255,.16)": "rgba(143,162,255,.16)",
}
DW = {
    "#070e1a": "#17122A", "#0c1729": "#1D1733", "#111f35": "#221B3B", "#172a46": "#2E2650", "#1f3352": "#3A3160", "#2a4570": "#4A3F78",
    "#e8eef7": "#F1ECFF", "#8699b5": "#A99FCB", "#4f8df5": "#F5B841", "#2c63b8": "#4A3F78", "#3ccf7a": "#3FD3C2", "#2fb86a": "#2BB3A4",
    "#ff5a5a": "#FF7F8E", "rgba(9,18,33,.96)": "rgba(23,18,42,.96)", "#3a74cf": "#5A4D90", "#173158": "#2E2650",
    "#0a1525": "#140F25", "#0a1626": "#140F25", "#08121f": "#120E22", "#3d5677": "#4A3F78", "#3a5f95": "#5A4D90", "#2c4468": "#4A3F78",
    "#5b9bff": "#F5B841", "#1f4f9a": "#4A3F78", "#0e2a55": "#221B3B", "#16304f": "#2E2650", "#8fbaff": "#F5B841", "#081324": "#130F24",
    "#c7d3e6": "#D9D0F5", "#b9d3ff": "#C9B6FF", "rgba(7,14,26,.85)": "rgba(20,15,37,.85)", "#4a5568": "#6F6596",
    "#1d6a41": "#1E6B63", "#2a8a57": "#2BB3A4", "#9ff0c0": "#9FF0E6", "#06210f": "#062420", "#201400": "#2A1B00",
}

def recolor(s, m):
    for a, b in m.items():
        s = re.sub(re.escape(a), b, s, flags=re.I)
    return s

def rep(s, old, new, n=1):
    c = s.count(old)
    if c != n:
        sys.exit(f"patch anchor found {c}x (want {n}): {old[:90]!r}")
    return s.replace(old, new)

def head(s, app, nav_js):
    inj = (f'<link rel="stylesheet" href="../shared/theme.css"><link rel="stylesheet" href="../shared/{app}-theme.css">'
           f'<script src="../shared/shell.js"></script><script src="../shared/i18n-it.js"></script><script src="../shared/i18n.js"></script>'
           f'<script>BantaShell.strip("{ {"gc": "games", "dw": "dw"}[app] }", function (app) {{ {nav_js} }});</script>')
    return rep(s, "</head>", inj + "</head>")

def games():
    s = open(os.path.join(ROOT, "src/gc/index.html"), encoding="utf-8").read()
    s = recolor(s, GC)
    # copy-and-paste mode now targets the Gemini app; automatic mode falls back to it when the API fails
    s = rep(s, "let MAN=null;\nfunction manualAI(prompt,label){", "let MAN=null;\nfunction manualAI_old(prompt,label){")
    s = rep(s, "async function claude({prompt,search=0,label='Ask Claude'}){\n  if(AI.mode==='claude')return manualAI(prompt,label);\n  return gemini(prompt,search);\n}",
            """function manualAI(prompt,label,warn){
  MAN={};if(CL.running){CL.label='Waiting for your Gemini answer';aiPill();if(curView==='vAi')renderAi()}
  return BantaAI.ask({title:(!label||/Claude/.test(label))?'Ask Gemini':label,warn:warn||'',expect:'any',
    validate:v=>{const r=parseReply(v);return(!r.json&&!r.text)?'Nothing to import: paste Gemini’s whole answer.':null},
    prompt:`${SYS}\\n\\nUse Google Search for this. Reply in the user's language.\\n\\n${prompt}`})
   .then(v=>{MAN=null;const r=parseReply(v);countUse(false);return Object.assign(r,{cites:[]})},
         e=>{MAN=null;if(e&&e.cancelled){CL.stop=true;throw new Error('Stopped')}throw e});
}
async function claude({prompt,search=0,label='Ask Gemini'}){
  if(AI.mode==='claude'||!(AI.gkey||'').trim())return manualAI(prompt,label,AI.mode==='claude'?'':'No Gemini API key saved, so this runs in the Gemini app.');
  try{return await gemini(prompt,search)}catch(e){
    if(CL.stop)throw e;const m=String(e&&e.message||e);
    toast('Gemini API failed: continuing in the Gemini app');
    return manualAI(prompt,label,'The Gemini API failed ('+m.slice(0,140)+'), so this step continues in the Gemini app.');
  }
}""")
    s = rep(s, "const aiReady=()=>AI.mode==='claude'||!!(AI.gkey||'').trim();", "const aiReady=()=>true;")
    s = rep(s, "label:'Ask Claude'", "label:'Ask Gemini'")
    s = rep(s, ">Claude app · copy &amp; paste</button>", ">Gemini app · copy &amp; paste</button>")
    s = rep(s, "Uses your Claude Pro plan, nothing extra. Each action prepares a prompt with your list: copy it into the Claude app, then paste Claude's reply back and GameCheck imports the suggestions. Best for big checks; for one-tap checks use Gemini.",
            "Uses your Gemini app (Gemini Pro, with Google Search), no API key. Each action prepares a prompt with your list: paste it into Gemini, then paste Gemini’s answer back and GameCheck imports the suggestions. Automatic mode also switches to this whenever the API fails.")
    s = rep(s, "'Paste it in the sheet when Claude is done'", "'Paste Gemini’s answer in the sheet when it’s done'")
    s = rep(s, "Ask ${AI.mode==='claude'?'Claude':'Gemini'}", "Ask Gemini")
    s = rep(s, "sync or verify with Claude.", "sync or verify with Gemini.")
    # multiverse tools, PC store box, subscription tags (shared/gc-ext.js)
    s = rep(s, "  if(g.hid)tags.push('<span class=\"tag\">Hidden</span>');", "  if(g.hid)tags.push('<span class=\"tag\">Hidden</span>');\n  if(window.GCX)GCX.tags(g,tags);")
    s = rep(s, "  ${groups.length?`<div class=\"sec\"><h3>Suggestions", "  ${window.GCX?GCX.aiHtml():''}\n  ${groups.length?`<div class=\"sec\"><h3>Suggestions")
    s = rep(s, "    const showPrice=NA(g.ow)&&!done[id];", "    if(window.GCX)lk+=GCX.storeHtml(g,lv);\n    const showPrice=NA(g.ow)&&!done[id];")
    # Save data is never overwritten by what ships in the app: the games list lives in this phone's storage
    # ("gc_base"). A clean install starts empty. Banta's own build also carries her original list (gc/mine.js),
    # used once, and only when this phone already has her Games data from an earlier version.
    i = s.index("const D="); j = s.index("\n", i)
    mine_list = s[i + 8:j].rstrip(";")
    s = s[:i] + ("const D=(function(){try{var b=localStorage.getItem('gc_base');if(b)return JSON.parse(b)}catch(e){}"
                 "if(window.GC_MINE&&localStorage.getItem('gc_mine')==='1'){try{localStorage.setItem('gc_base',JSON.stringify(window.GC_MINE))}catch(e){}return window.GC_MINE}return[]})();") + s[j:]
    m = re.search(r"MY_LISTS=(\[[^\]]*\])", s)
    mine_lists = m.group(1)
    s = s[:m.start()] + "MY_LISTS=[]" + s[m.end():]
    s = rep(s, "imdbUser:'p.exampleuser00000000000000000',imdbUr:'ur00000001',imdbUrFor:'p.exampleuser00000000000000000',", "imdbUser:'',imdbUr:'',imdbUrFor:'',")
    s = rep(s, "hltbDone:{comp:1,playing:1,backlog:1,replay:1,retired:1,custom:1},", "hltbDone:{comp:1,playing:1,backlog:1,replay:1,retired:1,custom:1},")
    s = rep(s, "L('set',{}));", "(localStorage.getItem('gc_mine')==='1'&&window.GC_MINE_SET)||{},L('set',{}));")
    # an empty list needs a start, not "No games match"
    s = rep(s, "$('list').innerHTML=VIEW.length?'':`<div class=\"empty\">No games match.<br><br><button class=\"btn\" id=\"clr\">Clear filters</button></div>`;\n  if(!VIEW.length){",
            "$('list').innerHTML=VIEW.length?'':!all().length?`<div class=\"empty\"><b>No games yet</b><br><br>Tap + to add a game, or open AI › Multiverses and let Gemini list every game in a series you like.</div>`:`<div class=\"empty\">No games match.<br><br><button class=\"btn\" id=\"clr\">Clear filters</button></div>`;\n  if(!VIEW.length&&all().length){")
    for leak in ["p.exampleuser00000000000000000", "ur00000001", "ls100000015"]:
        if leak in s: sys.exit("Games page still contains " + leak)
    # decided once per phone, before the page writes anything: is there Games data from an earlier version?
    marker = ("<script>try{if(localStorage.getItem('gc_mine')===null){var had=0;for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);"
              "if(/^(gc_)?(set|done|ov|ex|live|ai|cq|sugg|block)$/.test(k)){had=1;break}}localStorage.setItem('gc_mine',had?'1':'0')}}catch(e){}</script>")
    s = rep(s, "</head>", marker + ('<script src="mine.js"></script>' if not ARGS.blank else "") + "</head>")
    s = head(s, "gc", 'Android.openUrl("%s://open/" + app);' % ARGS.scheme)
    s = rep(s, "</head>", '<script src="../shared/gc-ext.js"></script></head>')
    out = os.path.join(ARGS.out, "gc"); os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(s)
    mine = os.path.join(out, "mine.js")
    if ARGS.blank:
        if os.path.exists(mine): os.remove(mine)
    else:
        open(mine, "w", encoding="utf-8").write("/* Banta's games list and accounts: used only to carry over her existing Games data. */\nwindow.GC_MINE=" + mine_list +
            ";\nwindow.GC_MINE_SET={imdbUser:'p.exampleuser00000000000000000',imdbUr:'ur00000001',imdbUrFor:'p.exampleuser00000000000000000',imdbLists:" + mine_lists + "};\n")

def doctor():
    s = open(os.path.join(ROOT, "src/dw/index.html"), encoding="utf-8").read()
    s = recolor(s, DW)
    s = rep(s, '<button class="btn sm" id="syncTab">⟳ Sync new stories</button>',
            '<button class="btn sm" id="syncTab">⟳ Sync new stories</button><button class="btn sm" data-dwx="menu">✦ Gemini</button>')
    s = rep(s, '<button class="btn" id="mCov">🖼 Find missing covers</button>',
            '<button class="btn" data-dwx="menu">✦ Gemini: find missing, verify order</button>\n  <button class="btn" id="mCov">🖼 Find missing covers</button>')
    s = rep(s, '  h+=`<div class="two"><div class="panel"><h3>Continue</h3>',
            '  h+=(window.DWX?DWX.panel():"");\n  h+=`<div class="two"><div class="panel"><h3>Continue</h3>')
    if not ARGS.blank:
        marker = ("<script>try{if(localStorage.getItem('dwcanon.mine')===null)localStorage.setItem('dwcanon.mine',localStorage.getItem('dwcanon.v1')?'1':'0')}catch(e){}</script>")
        s = rep(s, '<script src="data.js"></script>', marker + '<script src="data.js"></script><script src="mine.js"></script>')
    s = head(s, "dw", 'Android.open("%s://open/" + app);' % ARGS.scheme)
    s = rep(s, "</head>", '<script src="../shared/dw-ext.js"></script></head>')  # before DW Canon's first render
    out = os.path.join(ARGS.out, "dw"); os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(s)
    # the timelines are reference data from the TARDIS wiki; ratings, "done" and "next" marks are Banta's own
    src = open(os.path.join(ROOT, "src/dw/data.js"), encoding="utf-8").read()
    a = src.index("{"); z = src.rindex("}")
    data = json.loads(src[a:z + 1])
    overlay = {"works": {k: {"rating": w.get("rating"), "done": w.get("done")} for k, w in data["works"].items() if w.get("rating") is not None or w.get("done")},
               "items": {it["id"]: {"next": it.get("next"), "raw": it.get("raw")} for g in data["groups"] for t in g["tabs"] for it in t["items"] if it.get("next") or it.get("raw")}}
    mine = os.path.join(out, "mine.js")
    if ARGS.blank:
        if os.path.exists(mine): os.remove(mine)
    else:
        open(mine, "w", encoding="utf-8").write("/* Banta's Doctor Who ratings, ticks and marks: applied only to her existing Doctor Who data. */\n"
            "(function(){try{if(localStorage.getItem('dwcanon.mine')!=='1'||!window.DW_DATA)return;var M=" + json.dumps(overlay, ensure_ascii=False, separators=(",", ":")) + ";"
            "window.DW_MINE=M;var D=window.DW_DATA;for(var k in M.works){if(D.works[k]){D.works[k].rating=M.works[k].rating;D.works[k].done=M.works[k].done}}"
            "D.groups.forEach(function(g){g.tabs.forEach(function(t){t.items.forEach(function(it){var o=M.items[it.id];if(o){it.next=o.next;it.raw=o.raw}})})})}catch(e){}})();\n")
    for w in data["works"].values():
        w["rating"] = None; w["done"] = False
    for g in data["groups"]:
        for t in g["tabs"]:
            for it in t["items"]:
                it["next"] = False
                w = data["works"].get(it["k"])
                it["raw"] = w["title"] if w else re.sub(r"\s*\(\d+(\.\d+)?\)|[⤵️✅❌⭐]+", "", it.get("raw") or "").strip()
    open(os.path.join(out, "data.js"), "w", encoding="utf-8").write(src[:a] + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + src[z + 1:])

if __name__ == "__main__":
    games(); doctor(); print("prepared gc + dw" + (" (blank)" if ARGS.blank else ""))
