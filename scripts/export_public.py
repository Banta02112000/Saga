"""Builds the public copy of this source tree (for the GitHub repo) with none of Banta's personal data.

Leaves out: build outputs, third-party build tools (tools/), signing keys, private/, and the files that carry her
games list, Doctor Who marks and account carry-over. Strips her games list and Doctor Who ratings from the two
original legacy pages, and replaces every personal identifier listed in private/redactions.json (account ids,
list ids, API client ids, keys) with a neutral placeholder. Refuses to finish if anything personal is left.

Usage: python3 scripts/export_public.py OUTDIR      (OUTDIR's .git, if any, is kept)"""
import json, os, re, shutil, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
out = os.path.abspath(sys.argv[1])
red_path = os.path.join(ROOT, 'private/redactions.json')
if not os.path.exists(red_path): sys.exit('private/redactions.json is missing: refusing to export without it')
RED = json.load(open(red_path))
pats = open(os.path.join(ROOT, 'private/leak_patterns.txt')).read().strip() if os.path.exists(os.path.join(ROOT, 'private/leak_patterns.txt')) else ''
SKIP_DIRS = {'public_extras', 'app', 'out', 'classes', 'dexout', 'tools', 'private', 'node_modules', '.git', '__pycache__', 'keychk'}
SKIP_FILES = {'web/gc-mine.js', 'web/dw-mine.js', 'legacy/assets/gc/mine.js', 'legacy/assets/dw/mine.js'}
SKIP_EXT = ('.jks', '.keystore', '.apk', '.idsig', '.pyc')
TEXT_EXT = ('.js', '.html', '.css', '.py', '.sh', '.json', '.md', '.txt', '.xml', '.yml', '.java', '.smali', '.svg')

# clear OUTDIR except its .git
os.makedirs(out, exist_ok=True)
for n in os.listdir(out):
    if n == '.git': continue
    p = os.path.join(out, n)
    shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)

def clean_text(rel, s):
    if rel in ('legacy/src/gc/index.html',):
        i = s.index('const D='); j = s.index('\n', i)
        s = s[:i] + 'const D=[];' + s[j:]  # her games list
        s = re.sub(r'MY_LISTS=\[[^\]]*\]', 'MY_LISTS=[]', s)
    if rel == 'legacy/src/dw/data.js':  # her Doctor Who ratings, ticks and notes
        a = s.index('{'); z = s.rindex('}')
        d = json.loads(s[a:z + 1])
        for w in d['works'].values():
            w['rating'] = None; w['done'] = False
        for g in d['groups']:
            for t in g['tabs']:
                for it in t['items']:
                    it.pop('next', None); it.pop('raw', None)
        s = s[:a] + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + s[z + 1:]
    for k in sorted(RED, key=len, reverse=True):
        s = s.replace(k, RED[k])
    return s

n = 0
for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for f in files:
        src = os.path.join(root, f); rel = os.path.relpath(src, ROOT).replace(os.sep, '/')
        if rel in SKIP_FILES or f.endswith(SKIP_EXT): continue
        dst = os.path.join(out, rel); os.makedirs(os.path.dirname(dst), exist_ok=True)
        if f.endswith(TEXT_EXT):
            open(dst, 'w', encoding='utf-8').write(clean_text(rel, open(src, encoding='utf-8').read()))
        else:
            shutil.copy2(src, dst)
        n += 1

# repo files: README, .gitignore, CI workflow
EX = os.path.join(ROOT, 'scripts/public_extras')
for root, dirs, files in os.walk(EX):
    for f in files:
        src = os.path.join(root, f); dst = os.path.join(out, os.path.relpath(src, EX))
        os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy2(src, dst); n += 1

# nothing personal may be left
bad = []
needles = list(RED.keys())
rx = re.compile(pats) if pats else None
for root, dirs, files in os.walk(out):
    dirs[:] = [d for d in dirs if d != '.git']
    for f in files:
        p = os.path.join(root, f)
        try: t = open(p, encoding='utf-8').read()
        except Exception: continue
        if any(k in t for k in needles) or (rx and rx.search(t)): bad.append(os.path.relpath(p, out))
if bad: sys.exit('PERSONAL DATA LEFT IN THE PUBLIC COPY: ' + ', '.join(bad))
print(f'exported {n} files to {out}: no personal data found')
