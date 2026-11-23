#!/bin/bash
# One real-repo agent run (as root). usage: run_real.sh <agent|agent_gate> <rep> <slotUser> <model>
# Task: octokit-webhooks-probot. Arms differ only in the behaviour gate (applied by the harness: when the agent
# finishes, the gate runs as gaterunner on a copy; on differences the SAME session resumes with the gate's message).
ROOT=/home/claude/morphapi; T=/opt/rb/probot; arm=$1; r=$2; user=$3; model=$4
run=probot.$arm.r$r; WS=/srv/agentcmp/ws/$run/project; ST=/srv/agentcmp/state/$run; OUT=$ROOT/out/realcmp/$model/$run
mkdir -p $OUT; [ -s $OUT/result.json ] && exit 0
rm -rf /srv/agentcmp/ws/$run; mkdir -p $WS; cp -a $T/template/. $WS/; ln -s $T/node_modules $WS/node_modules
chown -R $user:$user /srv/agentcmp/ws/$run; chmod 700 /srv/agentcmp/ws/$run
cat > $ST.prompt.txt <<PROMPT
This is the source of probot (a framework for GitHub Apps). Its dependency \`@octokit/webhooks\` has been upgraded from v7 to v9 (package.json and node_modules already updated: 9.8.4 is installed). Update probot's code for v9.

Requirements:
- \`npx tsc --noEmit -p tsconfig.json\` must pass.
- The test suite (\`npx jest\`) must pass; update tests where the upgrade requires it.
- probot's behaviour for apps built on it must stay the same.
- Do not install or upgrade packages. Avoid \`any\` casts and \`@ts-ignore\` / \`@ts-expect-error\` where a typed solution exists.

Migration notes for @octokit/webhooks v7 -> v9:
----------------------------------------------------------------
$(cat $T/guide.md)
----------------------------------------------------------------
PROMPT
cp $ST.prompt.txt $OUT/prompt.txt; echo '{"checks":0,"blocks":0,"log":[]}' > $ST.gate.json
chown $user:$user $ST.prompt.txt; chmod 600 $ST.prompt.txt $ST.gate.json
start=$(date +%s); : > $OUT/transcript.jsonl
agent() { ( set -a; . $ROOT/.env; set +a
  export PATH=/opt/node22/bin:/usr/local/bin:/usr/bin:/bin NODE_EXTRA_CA_CERTS=/opt/agentcmp/ca.crt CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1
  timeout 2400 /usr/sbin/runuser -u $user -w ANTHROPIC_API_KEY,PATH,NODE_EXTRA_CA_CERTS,HTTPS_PROXY,https_proxy,NO_PROXY,no_proxy,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,DISABLE_AUTOUPDATER -- \
    bash -c "cd $WS && claude -p $2 --model $model --output-format stream-json --verbose --max-budget-usd 4 --strict-mcp-config \
      --allowedTools Read Edit MultiEdit Write Glob Grep LS Bash --disallowedTools WebFetch WebSearch Task Agent < $1" >> $OUT/transcript.jsonl 2>> $OUT/stderr.txt
  echo $? > $OUT/exit.txt ) ; }
agent $ST.prompt.txt ""; round=0
while [ $arm = agent_gate ]; do
  sid=$(grep '"type":"result"' $OUT/transcript.jsonl | tail -1 | python3 -c 'import json,sys; print(json.loads(sys.stdin.read() or "{}").get("session_id",""))')
  [ -z "$sid" ] && break
  G=/srv/agentcmp/gatetmp/$run; rm -rf $G; mkdir -p $G/project; (cd $WS && tar --exclude=./node_modules -cf - .) | tar -xf - -C $G/project; ln -s $T/node_modules $G/project/node_modules
  chown -R gaterunner:gaterunner $G $ST.gate.json; chmod 700 $G
  v=$(/usr/sbin/runuser -u gaterunner -- /opt/node22/bin/node $T/gate/gate_real.cjs $T/gate $G/project $ST.gate.json < /dev/null); rm -rf $G
  [ -z "$v" ] && break
  echo "$v" | python3 -c 'import json,sys; print(json.load(sys.stdin)["reason"])' > $ST.feedback.txt; chown $user $ST.feedback.txt
  cp $ST.feedback.txt $OUT/gate_feedback_$((round+=1)).txt
  agent $ST.feedback.txt "--resume $sid"
done
echo $(( $(date +%s) - start )) > $OUT/seconds.txt
chown -R root:root /srv/agentcmp/ws/$run; chmod 700 /srv/agentcmp/ws/$run
rm -rf $OUT/final; mkdir -p $OUT/final; (cd $WS && tar --exclude=./node_modules --exclude=./lib -cf - src test) | tar -xf - -C $OUT/final; cp $ST.gate.json $OUT/gate.json
KEY=$(grep '^ANTHROPIC_API_KEY=' $ROOT/.env | cut -d= -f2- | tr -d '"'); [ -n "$KEY" ] && sed -i "s|$KEY|<REDACTED>|g" $OUT/transcript.jsonl $OUT/stderr.txt
grep '"type":"result"' $OUT/transcript.jsonl > $OUT/results.jsonl; [ -s $OUT/results.jsonl ] && tail -1 $OUT/results.jsonl > $OUT/result.json
