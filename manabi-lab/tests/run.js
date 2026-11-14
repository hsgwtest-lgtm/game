// tests/run.js — テストをまとめて実行する
//   node tests/run.js            … 単体テスト＋ベンチマーク（結果を tests/results.json に保存）
//   node tests/run.js --unit     … 単体テスト＋PWAの外側の点検だけ
//   node tests/run.js --bench    … ベンチマークだけ
import { run } from './harness.js';
import { registerUnitTests } from './unit.test.js';
import { registerBenchTests } from './bench.test.js';
import { registerShellTests } from './shell.test.js';

const args = new Set(process.argv.slice(2));
const onlyUnit = args.has('--unit');
const onlyBench = args.has('--bench');

console.log('学習くらべラボ — テスト');
let fail = 0;
if (!onlyBench) {
  registerUnitTests();
  registerShellTests();
  const r = await run();
  fail += r.fail;
}
if (!onlyUnit) {
  registerBenchTests();
  const r = await run();
  fail += r.fail;
}
if (fail) {
  console.log(`\n失敗したテストがあります（${fail}件）`);
  process.exit(1);
}
console.log('\nすべて成功しました');
