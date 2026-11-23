#!/bin/bash
# One agent run (as root). usage: run_one.sh <scenario> <agent|agent_gate> <rep> <slotUser> <model>
# Arms differ ONLY in the Stop hook: agent_gate gets the cross-version behaviour gate, agent gets none. Same prompt.
ROOT=/home/claude/morphapi; id=$1; arm=$2; r=$3; user=$4; model=$5
run=$id.$arm.r$r; WS=/srv/agentcmp/ws/$run/project; ST=/srv/agentcmp/state/$run; OUT=$ROOT/out/agentcmp/$model/$run
mkdir -p $OUT; [ -s $OUT/result.json ] && exit 0
node $ROOT/tools/agentcmp/setup.mjs $id $WS $user || exit 1
node $ROOT/tools/agentcmp/prompt.mjs $id > $ST.prompt.txt; cp $ST.prompt.txt $OUT/prompt.txt
echo '{"checks":0,"blocks":0,"log":[]}' > $ST.gate.json
chown $user:$user $ST.prompt.txt; chmod 600 $ST.prompt.txt $ST.gate.json
# The gate is applied by the harness, not a Claude Code hook (this sandbox's Claude Code does not run hooks): when the
# agent finishes, the gate runs; if it reports differences, the SAME session is resumed with the gate's message as the
# next user turn (up to 5 times) - the same contract as a blocking Stop hook.
start=$(date +%s); : > $OUT/transcript.jsonl; sid=""; round=0
agent() { # $1 = prompt file, $2 = extra flags
  ( set -a; . $ROOT/.env; set +a
    export PATH=/opt/node22/bin:/usr/local/bin:/usr/bin:/bin NODE_EXTRA_CA_CERTS=/opt/agentcmp/ca.crt CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1
    timeout 1200 /usr/sbin/runuser -u $user -w ANTHROPIC_API_KEY,PATH,NODE_EXTRA_CA_CERTS,HTTPS_PROXY,https_proxy,NO_PROXY,no_proxy,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,DISABLE_AUTOUPDATER -- \
      bash -c "cd $WS && claude -p $2 --model $model --output-format stream-json --verbose --max-budget-usd 1.5 --strict-mcp-config \
        --allowedTools Read Edit MultiEdit Write Glob Grep LS Bash --disallowedTools WebFetch WebSearch Task Agent < $1" >> $OUT/transcript.jsonl 2>> $OUT/stderr.txt
    echo $? > $OUT/exit.txt ) ; }
agent $ST.prompt.txt ""
while [ $arm = agent_gate ]; do
  sid=$(grep '"type":"result"' $OUT/transcript.jsonl | tail -1 | python3 -c 'import json,sys; print(json.loads(sys.stdin.read() or "{}").get("session_id",""))')
  [ -z "$sid" ] && break
  # gate executes the agent's code: do it as the unprivileged gaterunner user, on a copy of the workspace
  G=/srv/agentcmp/gatetmp/$run; rm -rf $G; mkdir -p $G; cp -a $WS $G/project; chown -R gaterunner:gaterunner $G $ST.gate.json; chmod 700 $G
  v=$(/usr/sbin/runuser -u gaterunner -- /opt/node22/bin/node /opt/agentcmp/gate/gate.cjs $id $G/project $ST.gate.json < /dev/null); rm -rf $G
  [ -z "$v" ] && break
  echo "$v" | python3 -c 'import json,sys; print(json.load(sys.stdin)["reason"])' > $ST.feedback.txt; chown $user $ST.feedback.txt
  cp $ST.feedback.txt $OUT/gate_feedback_$((round+=1)).txt
  agent $ST.feedback.txt "--resume $sid"
done
echo $(( $(date +%s) - start )) > $OUT/seconds.txt
# lock the finished workspace away from every agent user, keep a copy of src + gate state, redact the key
chown -R root:root /srv/agentcmp/ws/$run; chmod 700 /srv/agentcmp/ws/$run
rm -rf $OUT/src; cp -r $WS/src $OUT/src; cp $ST.gate.json $OUT/gate.json
KEY=$(grep '^ANTHROPIC_API_KEY=' $ROOT/.env | cut -d= -f2- | tr -d '"'); [ -n "$KEY" ] && sed -i "s|$KEY|<REDACTED>|g" $OUT/transcript.jsonl $OUT/stderr.txt
grep '"type":"result"' $OUT/transcript.jsonl > $OUT/results.jsonl; [ -s $OUT/results.jsonl ] && tail -1 $OUT/results.jsonl > $OUT/result.json
