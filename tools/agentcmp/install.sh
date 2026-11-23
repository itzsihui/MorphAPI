#!/bin/bash
# Root-only setup: shared read-only toolchain + gate for the agent users; slot users agent1..agentN; baselines.
set -e; ROOT=/home/claude/morphapi; N=${1:-4}
mkdir -p /opt/agentcmp/nm/@types /opt/agentcmp/gate/baseline /srv/agentcmp/ws /srv/agentcmp/state
rm -rf /opt/agentcmp/nm/typescript /opt/agentcmp/nm/@types/node
cp -rL $ROOT/node_modules/typescript /opt/agentcmp/nm/typescript; cp -rL $ROOT/node_modules/@types/node /opt/agentcmp/nm/@types/node
cp $ROOT/scripts/crossver/{specs.cjs,record.cjs,compare.mjs} $ROOT/tools/agentcmp/gate.cjs /opt/agentcmp/gate/
cp /root/.ccr/ca-bundle.crt /opt/agentcmp/ca.crt
for id in morphpay plaid openai stripe stripe-errors auth envelope async mail hmac discriminator; do
  node $ROOT/scripts/crossver/record.cjs $id $ROOT/out/crossver_tmp/${id}__v1 v1 > /opt/agentcmp/gate/baseline/$id.json; done
chmod -R a+rX /opt/agentcmp; chmod 1733 /srv/agentcmp/state; chmod 711 /srv/agentcmp /srv/agentcmp/ws
for i in $(seq 1 $N); do id -u agent$i >/dev/null 2>&1 || useradd -m -s /bin/bash agent$i; done
chmod 700 /home/claude /root
echo installed
