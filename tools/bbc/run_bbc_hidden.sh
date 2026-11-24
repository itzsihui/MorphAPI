#!/bin/bash
# HIDDEN-ORACLE variant: the failing test files and _FAILING.txt are removed from the workspace; the agent is only
# told which library was upgraded. The judge restores the reference tests as usual.
# One BBCBench (JavaScript, lockfile) case for a plain Claude Code agent. usage: run_bbc.sh <case> <rep> <user> <model>
# Workspace = BBCBench's prepared broken state (src/ with node_modules at v_new, run_tests.sh, _FAILING.txt). The
# judge records (.judge/) are moved out of the agent's reach and restored for BBCBench's own judge.sh afterwards.
ROOT=/home/claude/morphapi; C=$1; r=$2; user=$3; model=$4
export CASES_ROOT=/srv/bbc/repo/BBCBench/cases CACHE_ROOT=/srv/bbc/cache
run=bbch.$C.r$r; P=/srv/agentcmp/ws/$run; WS=$P/w; OUT=$ROOT/out/bbc_hidden/$model/$run; HOLD=/srv/bbc/hold/$run
mkdir -p $OUT /srv/bbc/hold; [ -s $OUT/judge.txt ] && exit 0
rm -rf $P $HOLD; mkdir -p $P; cp -a /srv/bbc/work/$C $WS; mv $WS/.judge $HOLD
sed -i "s|/srv/bbc/work/$C|$WS|g" $WS/run_tests.sh
rm -f $WS/_FAILING.txt
# remove every file BBCBench's own judge classifies as a test (evalscope.py); the judge restores them before judging
git -C $WS/src ls-files > /tmp/$run.files; python3 /srv/bbc/hh/evalscope.py /tmp/$run.files | awk -F'\t' '$1=="test"{print $2}' > $OUT/hidden_files.txt
while read -r f; do [ -n "$f" ] && rm -f "$WS/src/$f"; done < $OUT/hidden_files.txt; rm -f $WS/run_tests.sh /tmp/$run.files
chown -R $user:$user $P; chmod 700 $P
M=$CASES_ROOT/$C/meta.json; LIB=$(python3 -c "import json;print(json.load(open('$M'))['lib'])"); VO=$(python3 -c "import json;print(json.load(open('$M'))['v_old'])"); VN=$(python3 -c "import json;print(json.load(open('$M'))['v_new'])")
cat > $OUT/prompt.txt <<PROMPT
This project's dependency \`$LIB\` has been upgraded from $VO to $VN. The project is in src/ (dependencies are installed in src/node_modules, with $LIB at $VN).

Update the project's own code for $LIB $VN so that the project behaves exactly as it did with $VO.
- The project's test suite is not included in this workspace.
- Do not downgrade, remove or replace $LIB, and do not change package.json, lockfiles or anything in node_modules.
- Edits to test files are discarded when your work is judged.
PROMPT
cp $OUT/prompt.txt $P/prompt.txt; chown $user $P/prompt.txt
start=$(date +%s)
( set -a; . $ROOT/.env; set +a
  export PATH=/opt/node22/bin:/usr/local/bin:/usr/bin:/bin NODE_EXTRA_CA_CERTS=/opt/agentcmp/ca.crt CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1
  timeout 2400 /usr/sbin/runuser -u $user -w ANTHROPIC_API_KEY,PATH,NODE_EXTRA_CA_CERTS,HTTPS_PROXY,https_proxy,NO_PROXY,no_proxy,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,DISABLE_AUTOUPDATER -- \
    bash -c "cd $WS && claude -p --model $model --output-format stream-json --verbose --max-budget-usd 3 --strict-mcp-config \
      --allowedTools Read Edit MultiEdit Write Glob Grep LS Bash --disallowedTools WebFetch WebSearch Task Agent < $P/prompt.txt" > $OUT/transcript.jsonl 2> $OUT/stderr.txt
  echo $? > $OUT/exit.txt )
echo $(( $(date +%s) - start )) > $OUT/seconds.txt
chown -R root:root $P; chmod 700 $P; rm -rf $WS/.judge; mv $HOLD $WS/.judge
cd /srv/bbc/hh && timeout 1500 bash judge.sh $C $WS > $OUT/judge_full.txt 2>&1; tail -1 $OUT/judge_full.txt | awk '{print $1}' > $OUT/judge.txt
cp $WS/.judge/agent.patch $OUT/agent.patch 2>/dev/null
KEY=$(grep '^ANTHROPIC_API_KEY=' $ROOT/.env | cut -d= -f2- | tr -d '"'); [ -n "$KEY" ] && sed -i "s|$KEY|<REDACTED>|g" $OUT/transcript.jsonl $OUT/stderr.txt
grep '"type":"result"' $OUT/transcript.jsonl > $OUT/results.jsonl
