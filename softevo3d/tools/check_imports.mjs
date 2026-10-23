// モジュールの import/export がつながっているかを Node で確かめる: node tools/check_imports.mjs
// （ブラウザ専用の処理で実行時エラーになるのは無視し、リンク時の SyntaxError だけを報告）
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) files.push(p);
  }
})(path.join(root, 'js'));

globalThis.window = globalThis.window || { THREE: undefined, addEventListener() {}, location: { search: '' } };
let bad = 0;
for (const f of files) {
  try {
    await import(pathToFileURL(f).href);
  } catch (e) {
    if (e instanceof SyntaxError) { bad++; console.log('NG', path.relative(root, f), '-', e.message); }
  }
}
console.log(bad ? `${bad} file(s) with link/syntax errors` : `OK: ${files.length} modules link correctly`);
process.exit(bad ? 1 : 0);
