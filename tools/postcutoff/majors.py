import json,sys,urllib.request,re,concurrent.futures as cf,urllib.parse,os
names=open('/srv/post/pop.txt').read().split()
def get(n):
  try:
    with urllib.request.urlopen('https://registry.npmjs.org/'+urllib.parse.quote(n,safe='@'),timeout=60) as r: d=json.load(r)
  except Exception as e: return None
  t=d.get('time',{}); out=[]
  vs=[v for v in t if re.fullmatch(r'\d+\.\d+\.\d+',v)]
  majors={}
  for v in vs:
    M=int(v.split('.')[0]); majors.setdefault(M,[]).append((t[v],v))
  for M,l in majors.items():
    first=min(l)
    if first[0]>='2026-07-01' and (M-1) in majors: out.append((n,M,first[1],first[0][:10],max(majors[M-1])[1]))
  return out
with cf.ThreadPoolExecutor(24) as ex:
  for res in ex.map(get,names):
    for r in res or []: print('\t'.join(map(str,r)),flush=True)
