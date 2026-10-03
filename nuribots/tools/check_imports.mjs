// import している名前が、相手のファイルで本当に export されているか調べる: node tools/check_imports.mjs
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) files.push(p);
  }
})(path.join(ROOT, 'js'));

const exportsOf = new Map();
function getExports(file) {
  if (exportsOf.has(file)) return exportsOf.get(file);
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // export const A = 1, B = 2;
  for (const m of src.matchAll(/export\s+(?:const|let|var)\s+([^;\n]*)/g)) {
    for (const mm of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=/g)) names.add(mm[1]);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  exportsOf.set(file, names);
  return names;
}

let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(f), m[2]);
    if (!fs.existsSync(target)) { console.log(`✗ ${path.relative(ROOT, f)}: missing file ${m[2]}`); bad++; continue; }
    const ex = getExports(target);
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const name = t.split(/\s+as\s+/)[0].trim();
      if (!ex.has(name)) { console.log(`✗ ${path.relative(ROOT, f)}: ${name} is not exported by ${m[2]}`); bad++; }
    }
  }
  for (const m of src.matchAll(/import\s+(?:[\w$]+\s*,\s*)?(?:\*\s+as\s+[\w$]+\s+)?from\s*['"]([^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(f), m[1]);
    if (!fs.existsSync(target)) { console.log(`✗ ${path.relative(ROOT, f)}: missing file ${m[1]}`); bad++; }
  }
}
console.log(bad ? `${bad} problem(s)` : `ok (${files.length} files)`);
process.exit(bad ? 1 : 0);
