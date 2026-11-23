#!/bin/bash
# Score one probot run (as root, after ALL runs finished: jest caches go under /root). usage: score_probot.sh <runOutDir>
# Judge: developers' hidden tests from 4b3ae0e (13 suites; e2e and logging-middleware excluded: they fail on the
# developers' own fix in this environment) run on the run's src/; tsc on src; suppressions added in src vs start;
# the agent's own test suite; and the behaviour driver (for agreement only).
D=$(realpath $1); T=/opt/rb/probot; S=/root/rbscore/$(basename $(dirname $D))__$(basename $D); HID=/root/rbtmp/devtest
rm -rf $S; mkdir -p $S; cp -a $T/template/. $S/; ln -s $T/node_modules $S/node_modules; rm -rf $S/src; cp -a $D/final/src $S/src
tscErr=$(cd $S && npx tsc --noEmit -p tsconfig.json --pretty false 2>&1 | grep -c 'error TS')
own=$(cd $S && rm -rf test && cp -a $D/final/test test && timeout 900 npx jest --ci --json --outputFile=$S.own.json --cacheDirectory /root/jestcache --testPathIgnorePatterns e2e logging-middleware >/dev/null 2>&1; python3 -c 'import json,sys
try: j=json.load(open(sys.argv[1])); print(str(j["numPassedTestSuites"])+"/"+str(j["numTotalTestSuites"])+" suites, "+str(j["numFailedTests"])+" failed tests")
except Exception as e: print("error")' $S.own.json)
hid=$(cd $S && rm -rf test && cp -a $HID test && timeout 900 npx jest --ci --json --outputFile=$S.hid.json --cacheDirectory /root/jestcache --testPathIgnorePatterns e2e logging-middleware >/dev/null 2>&1; python3 -c 'import json,sys
try:
  j=json.load(open(sys.argv[1])); fails=[r["name"].split("/test/")[-1]+": "+"; ".join(a["fullName"][:60] for a in r["assertionResults"] if a["status"]=="failed")[:200] or r["name"].split("/test/")[-1]+": "+r.get("message","")[:120].replace("\n"," ") for r in j["testResults"] if r["status"]!="passed"]
  print(json.dumps({"suites":str(j["numPassedTestSuites"])+"/"+str(j["numTotalTestSuites"]),"tests_failed":j["numFailedTests"],"tests_total":j["numTotalTests"],"failing":fails}))
except Exception as e: print(json.dumps({"error":str(e)}))' $S.hid.json)
supp=$(python3 - "$T/template/src" "$S/src" <<'EOF'
import sys,os,re
pat=re.compile(r'\bas any\b|:\s*any\b|@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable')
def lines(root):
  out={}
  for d,_,fs in os.walk(root):
    for f in fs:
      if f.endswith('.ts'): p=os.path.join(d,f); out[os.path.relpath(p,root)]=open(p).read().split('\n')
  return out
a=lines(sys.argv[1]); b=lines(sys.argv[2]); n=0
for f,ls in b.items():
  old=set(l.strip() for l in a.get(f,[]))
  n+=sum(1 for l in ls if pat.search(l) and l.strip() not in old)
print(n)
EOF
)
rm -rf $S/test; cp -a $T/template/test $S/test
drv=$(timeout 300 node /opt/rb/probot/gate/probot_driver.js $S 2>/dev/null > $S.trace.json; COMPARE_MJS=/opt/rb/probot/gate/compare.mjs node /home/claude/morphapi/tools/realgate/compare_traces.mjs /opt/rb/probot/gate/baseline.json $S.trace.json 2>/dev/null | python3 -c 'import json,sys
try: f=json.load(sys.stdin); print(json.dumps([x["kind"]+":"+x.get("call","") for x in f]))
except Exception as e: print("[\"error\"]")')
python3 - <<EOF
import json,os
D="$D"; rs=[json.loads(l) for l in open(D+"/results.jsonl")] if os.path.exists(D+"/results.jsonl") else []
g=json.load(open(D+"/gate.json")) if os.path.exists(D+"/gate.json") else {}
row={"run":os.path.basename(D),"tscErrors":int("$tscErr"),"hidden":json.loads('''$hid'''),"ownTests":"$own","suppressionsAdded":int("$supp" or 0),
 "driverFindings":json.loads('''$drv'''),"cost":sum(r.get("total_cost_usd") or 0 for r in rs),"invocations":len(rs),
 "turns":sum(r.get("num_turns") or 0 for r in rs),"secs":int(open(D+"/seconds.txt").read()) if os.path.exists(D+"/seconds.txt") else None,
 "gateChecks":g.get("checks"),"gateBlocks":g.get("blocks"),"stopReasons":[r.get("subtype") for r in rs]}
print(json.dumps(row))
EOF
