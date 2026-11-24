#!/bin/bash
# prepare broken state; judge untouched (must FAIL); judge with reference fix (must PASS)
export CASES_ROOT=/srv/bbc/repo/BBCBench/cases CACHE_ROOT=/srv/bbc/cache; C=$1; W=/srv/bbc/work/$C; F=$W.fix
[ -s /srv/bbc/valid/$C ] && exit 0; rm -rf $W $F; mkdir -p $W
cd /srv/bbc/hh
if ! timeout 1500 bash prepare.sh $C $W > /srv/bbc/valid/$C.prep.log 2>&1; then echo "PREPFAIL" > /srv/bbc/valid/$C; exit 0; fi
b=$(timeout 1200 bash judge.sh $C $W 2>&1 | tail -1 | awk '{print $1}')
cp -a $W $F.tmp; mv $F.tmp $F; (cd $F/src && patch -p1 -s < $CASES_ROOT/$C/reference_fix.patch) || { echo "PATCHFAIL $b" > /srv/bbc/valid/$C; exit 0; }
f=$(timeout 1200 bash judge.sh $C $F 2>&1 | tail -1 | awk '{print $1}')
rm -rf $F; echo "broken=$b fixed=$f" > /srv/bbc/valid/$C
