#!/bin/bash
# CA re-run, third model: gpt-4o-mini, same 4 arms x 3 runs x 11 scenarios as ca_runs.sh.
cd /home/claude/itzsihui/morphapi
set -a; . /root/.mkeys/env; set +a; export PATH=/opt/node22/bin:$PATH NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1
OUT=out/ca_ast; model=gpt-4o-mini
for r in 1 2 3; do
 for arm in arm_ast arm0_llm_only ast_no_gate ast_no_impact; do
  for id in morphpay plaid openai stripe auth envelope async mail stripe-errors discriminator hmac; do
   dst=$OUT/$id.$arm.$model.r$r.json; [ -s $dst ] && continue
   rm -f out/pipeline/$id.$arm.mini.json; timeout 900 node scripts/morph-run.mjs $id --arm $arm --model mini > $OUT/$id.$arm.$model.r$r.log 2>&1
   cp out/pipeline/$id.$arm.mini.json $dst 2>/dev/null
   echo "r$r $arm $(tail -1 $OUT/$id.$arm.$model.r$r.log | cut -c1-140)"
  done
 done
done
echo ALLDONE
