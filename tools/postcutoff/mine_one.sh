#!/bin/bash
# usage: mine_one.sh <lib> <repo> <pkgpath>  (run as ROOT: clone + npm install --ignore-scripts only).
# Tests (untrusted code) run as user miner with no proxy, i.e. without network. OLD = latest of old major, then NEW.
lib=$1; repo=$2; path=$3
declare -A OLD=([i18next]=26.7.2 [markdown-it]=14.3.3 [set-cookie-parser]=3.2.3 [toml]=4.3.0) NEW=([i18next]=27.2.7 [markdown-it]=15.0.3 [set-cookie-parser]=4.0.0 [toml]=5.0.1)
R=/srv/post/mine/res/$lib/${repo//\//__}; mkdir -p $R; [ -s $R/result ] && exit 0
D=/srv/post/mine/w/${repo//\//__}.$lib; rm -rf $D
export PATH=/opt/node22/bin:/usr/bin:/bin CI=true
T() { chown -R miner $D; timeout -k 30 600 /usr/sbin/runuser -u miner -- env -i PATH=/opt/node22/bin:/usr/bin:/bin HOME=/home/miner CI=true bash -c "cd $P && npm test"; }
timeout -k 30 180 git clone -q --depth 1 https://github.com/$repo $D 2>/dev/null || { echo CLONEFAIL > $R/result; exit 0; }
P=$D/$(dirname $path); cd $P || { echo NODIR > $R/result; exit 0; }
git -C $D rev-parse HEAD > $R/commit
I="npm install --ignore-scripts --no-audit --no-fund --legacy-peer-deps --loglevel=error"
timeout -k 30 900 $I > $R/install.log 2>&1 || { echo INSTALLFAIL > $R/result; rm -rf $D; exit 0; }
timeout -k 30 300 $I --no-save $lib@${OLD[$lib]} >> $R/install.log 2>&1 || { echo OLDINSTALLFAIL > $R/result; rm -rf $D; exit 0; }
T > $R/old.log 2>&1; ro=$?; chown -R root $D
if [ $ro != 0 ]; then echo "OLDFAIL $ro" > $R/result; rm -rf $D; exit 0; fi
timeout -k 30 300 $I --no-save $lib@${NEW[$lib]} >> $R/install.log 2>&1 || { echo NEWINSTALLFAIL > $R/result; rm -rf $D; exit 0; }
T > $R/new.log 2>&1; rn=$?
echo "old=$ro new=$rn" > $R/result
[ $rn = 0 ] && rm -rf $D || rm -rf $P/node_modules   # keep the source of candidates, drop deps
