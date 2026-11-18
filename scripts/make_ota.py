# Screen update (0.6.9.5): the app's pages and scripts from the PUBLIC copy, in one gzipped JSON, signed with Saga's
# update key (private/ota_key.pem, never published). The app checks the signature before using any of it.
# Usage: make_ota.py PUBLIC_DIR   → writes PUBLIC_DIR/update/{bundle.gz,bundle.sig,manifest.json}
import sys, os, re, json, gzip, base64, hashlib, subprocess, tempfile
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.join(here, '..')
pub = sys.argv[1]
SHELL = 1  # must match Ota.SHELL in the Android code this bundle needs
key = os.path.join(root, 'private', 'ota_key.pem')
if not os.path.exists(key): sys.exit('no update key (private/ota_key.pem)')
build = open(os.path.join(root, 'build.sh')).read()
line = next(l for l in build.splitlines() if l.startswith('cp web/index.html'))
names = [t[len('web/'):] for t in line.split()[1:] if t.startswith('web/')]
files = {}
def add(rel, path):
    with open(path, 'rb') as f: files[rel] = base64.b64encode(f.read()).decode()
for n in names: add(n, os.path.join(pub, 'web', n))
for n in sorted(os.listdir(os.path.join(pub, 'web', 'shared'))):
    if n.endswith(('.js', '.css')): add('shared/' + n, os.path.join(pub, 'web', 'shared', n))
for n in ('index.html', 'app.js', 'core.js', 'books.css'): add('books/' + n, os.path.join(pub, 'web', 'books', n))
add('dw-data.js', os.path.join(pub, 'legacy', 'assets', 'dw', 'data.js'))
for bad in ('preset.js', 'gc-mine.js', 'dw-mine.js'): assert bad not in files, bad
app = open(os.path.join(pub, 'web', 'app.js'), encoding='utf-8').read()
version = re.search(r'const VERSION = "([\d.]+)"', app).group(1)
raw = json.dumps({'version': version, 'shell': SHELL, 'files': files}, separators=(',', ':')).encode()
gz = gzip.compress(raw, 9, mtime=0)
out = os.path.join(pub, 'update'); os.makedirs(out, exist_ok=True)
open(os.path.join(out, 'bundle.gz'), 'wb').write(gz)
with tempfile.NamedTemporaryFile(delete=False) as t: t.write(gz); tmp = t.name
sig = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', key, tmp], check=True, capture_output=True).stdout
os.remove(tmp)
open(os.path.join(out, 'bundle.sig'), 'w').write(base64.b64encode(sig).decode() + '\n')
# check it the way the app does
pubkey = subprocess.run(['openssl', 'ec', '-in', key, '-pubout'], check=True, capture_output=True).stdout
with tempfile.NamedTemporaryFile(delete=False) as a, tempfile.NamedTemporaryFile(delete=False) as b, tempfile.NamedTemporaryFile(delete=False) as c:
    a.write(gz); b.write(sig); c.write(pubkey)
ok = subprocess.run(['openssl', 'dgst', '-sha256', '-verify', c.name, '-signature', b.name, a.name], capture_output=True).returncode == 0
for x in (a.name, b.name, c.name): os.remove(x)
if not ok: sys.exit('signature check failed')
json.dump({'version': version, 'shell': SHELL, 'bundle': 'bundle.gz', 'sig': 'bundle.sig', 'size': len(gz), 'sha256': hashlib.sha256(gz).hexdigest(), 'files': len(files)},
          open(os.path.join(out, 'manifest.json'), 'w'), indent=1)
print(f'update {version}: {len(files)} files, {len(gz) // 1024} KB, signed and checked')
