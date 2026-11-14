// tests/harness.js — 依存なしの小さなテスト実行器
//   test(名前, 関数) で登録し、run() で順に実行する。失敗の数を返す

const tests = [];
export function test(name, fn) {
  tests.push({ name, fn });
}
export function section(name) {
  tests.push({ section: name });
}

export class AssertionError extends Error {}
export function assert(cond, msg = '条件が成り立たない') {
  if (!cond) throw new AssertionError(msg);
}
export function eq(a, b, msg = '') {
  if (a !== b) throw new AssertionError(`${msg} 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`);
}
export function near(a, b, tol, msg = '') {
  if (!(Math.abs(a - b) <= tol)) throw new AssertionError(`${msg} 期待 ${b}±${tol} / 実際 ${a}`);
}
export function deepEq(a, b, msg = '') {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    let i = 0;
    while (i < sa.length && sa[i] === sb[i]) i++;
    throw new AssertionError(`${msg} 内容がちがう（${i}文字目付近: …${sa.slice(Math.max(0, i - 40), i + 40)}… / …${sb.slice(Math.max(0, i - 40), i + 40)}…）`);
  }
}

export async function run({ filter = '' } = {}) {
  let pass = 0;
  let fail = 0;
  const failures = [];
  const t0 = performance.now();
  for (const t of tests) {
    if (t.section) {
      console.log(`\n■ ${t.section}`);
      continue;
    }
    if (filter && !t.name.includes(filter)) continue;
    const s = performance.now();
    try {
      await t.fn();
      pass++;
      console.log(`  ✔ ${t.name} (${(performance.now() - s).toFixed(0)}ms)`);
    } catch (e) {
      fail++;
      failures.push({ name: t.name, error: e });
      console.log(`  ✘ ${t.name}\n      ${e && e.message ? e.message : e}`);
      if (!(e instanceof AssertionError) && e && e.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
    }
  }
  console.log(`\n結果: ${pass} 件成功 / ${fail} 件失敗（${((performance.now() - t0) / 1000).toFixed(1)}秒）`);
  tests.length = 0;
  return { pass, fail, failures };
}
