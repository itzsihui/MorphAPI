import json,subprocess,base64,sys,concurrent.futures as cf,re
rows=[l.rstrip('\n').split('\t') for l in open('candidates.tsv')]
def chk(r):
  lib,repo,path=r
  if 'node_modules' in path or 'example' in path.lower() or 'fixture' in path.lower(): return None
  try:
    o=subprocess.run(['curl','-sf',f'https://raw.githubusercontent.com/{repo}/HEAD/{path}'],capture_output=True,text=True,timeout=60).stdout
    p=json.loads(o)
  except Exception: return None
  t=(p.get('scripts') or {}).get('test','')
  if not t or 'no test specified' in t or 'exit 0' in t: return None
  if lib not in (p.get('dependencies') or {}): return None
  fw=next((f for f in ['vitest','jest','mocha','ava','tap','node --test','tsx --test','uvu'] if f in t or f in json.dumps(p.get('devDependencies',{}))),'other')
  return [lib,repo,path,fw,t[:80]]
with cf.ThreadPoolExecutor(12) as ex:
  for res in ex.map(chk,rows):
    if res: print('\t'.join(res),flush=True)
