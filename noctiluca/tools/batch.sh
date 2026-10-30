#!/bin/bash
# 進化の実験をまとめて回す（開発用）: tools/batch.sh outdir "stage=maze&gens=40" "stage=signal&gens=40" ...
OUT=$1; shift
mkdir -p "$OUT"
cd "$(dirname "$0")/.."
for a in "$@"; do
  name=$(echo "$a" | tr '&=,{}":' '_______' | cut -c1-80)
  LIVE=1 node tools/run.mjs "tools/evotest.html?$a" 3000 > "$OUT/$name.log" 2>&1
done
echo ALLDONE > "$OUT/done.txt"
