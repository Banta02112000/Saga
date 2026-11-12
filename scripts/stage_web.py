# Puts the Doctor Who timeline data next to the app page, and (own edition only) the files that carry Banta's old
# Games and Doctor Who data over on first start. Usage: stage_web.py OUTDIR [--blank]
import sys, os, re, json, shutil
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.join(here, '..')
out = sys.argv[1]; blank = '--blank' in sys.argv
os.makedirs(out, exist_ok=True)
shutil.copy(os.path.join(root, 'legacy/assets/dw/data.js'), os.path.join(out, 'dw-data.js'))
for f in ('gc-mine.js', 'dw-mine.js'):
    p = os.path.join(out, f)
    if os.path.exists(p): os.remove(p)
if not blank and os.path.exists(os.path.join(root, 'legacy/assets/gc/mine.js')):
    shutil.copy(os.path.join(root, 'legacy/assets/gc/mine.js'), os.path.join(out, 'gc-mine.js'))
if not blank and os.path.exists(os.path.join(root, 'legacy/assets/dw/mine.js')):
    s = open(os.path.join(root, 'legacy/assets/dw/mine.js')).read()
    m = re.search(r'var M=(\{.*?\});window\.DW_MINE=M', s, re.S)
    if not m: sys.exit('dw mine.js: data not found')
    json.loads(m.group(1))
    open(os.path.join(out, 'dw-mine.js'), 'w').write('/* Banta\'s Doctor Who ratings and marks: moved once into the timeline. */\nwindow.DW_MINE=' + m.group(1) + ';\n')
print('staged', out, 'blank' if blank else 'own')
