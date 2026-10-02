#!/usr/bin/env python3
"""テスト用: ES モジュールを1つの HTML にまとめる（ブラウザ自動テスト用。本番では使わない）

  python3 tools/bundle_test.py [出力先]

import/export を簡易変換して、1枚の index に three.min.js と一緒に埋め込む。
"""
import os
import re
import sys
import json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tmp_test', 'bundle.html')

IMPORT_RE = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'([^']+)';\s*$", re.M)
EXPORT_DECL_RE = re.compile(r'^export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)', re.M)
EXPORT_LIST_RE = re.compile(r'^export\s*\{([^}]*)\};?\s*$', re.M)


def resolve(base, rel):
    return os.path.normpath(os.path.join(os.path.dirname(base), rel)).replace(os.sep, '/')


def transform(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as fh:
        src = fh.read()
    exports = []

    def imp(m):
        names = [n.strip() for n in m.group(1).split(',') if n.strip()]
        parts = []
        for n in names:
            if ' as ' in n:
                a, b = [x.strip() for x in n.split(' as ')]
                parts.append(f'{a}: {b}')
            else:
                parts.append(n)
        dep = resolve(path, m.group(2))
        return f"const {{ {', '.join(parts)} }} = __req({json.dumps(dep)});"
    src = IMPORT_RE.sub(imp, src)

    def decl(m):
        exports.append(m.group(2))
        return f'{m.group(1)} {m.group(2)}'
    src = EXPORT_DECL_RE.sub(decl, src)

    def lst(m):
        for n in m.group(1).split(','):
            n = n.strip()
            if not n:
                continue
            if ' as ' in n:
                a, b = [x.strip() for x in n.split(' as ')]
                exports.append(f'{b}: {a}')
            else:
                exports.append(n)
        return ''
    src = EXPORT_LIST_RE.sub(lst, src)
    if re.search(r'^\s*(import|export)\s', src, re.M):
        bad = re.search(r'^\s*(import|export)\s.*$', src, re.M).group(0)
        raise SystemExit(f'unsupported syntax in {path}: {bad}')
    ret = ', '.join(exports)
    return f"__def({json.dumps(path)}, function(){{\n{src}\nreturn {{ {ret} }};\n}});\n"


def main():
    js_files = []
    for base, _d, fs in os.walk(os.path.join(ROOT, 'js')):
        for f in fs:
            if f.endswith('.js'):
                js_files.append(os.path.relpath(os.path.join(base, f), ROOT).replace(os.sep, '/'))
    parts = ["const __defs = {}, __cache = {};\n",
             "function __def(n, f) { __defs[n] = f; }\n",
             "function __req(n) { if (!(n in __cache)) { if (!__defs[n]) throw new Error('module not found: ' + n); __cache[n] = __defs[n](); } return __cache[n]; }\n"]
    for p in sorted(js_files):
        parts.append(transform(p))
    parts.append("__req('js/main.js');\n")
    bundle = ''.join(parts)
    with open(os.path.join(ROOT, 'lib', 'three.min.js'), encoding='utf-8') as fh:
        three = fh.read()
    with open(os.path.join(ROOT, 'style.css'), encoding='utf-8') as fh:
        css = fh.read()
    with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as fh:
        html = fh.read()
    html = re.sub(r'<link rel="(manifest|apple-touch-icon|icon)"[^>]*>\s*', '', html)
    html = html.replace('<link rel="stylesheet" href="style.css">', f'<style>{css}</style>')
    html = html.replace('<script src="lib/three.min.js"></script>', f'<script>{three}</script>')
    html = html.replace('<script type="module" src="js/main.js"></script>', f'<script>\n{bundle}\n</script>')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(html)
    print(f'bundle: {len(js_files)} modules, {len(html) // 1024} KB -> {OUT}')


if __name__ == '__main__':
    main()
