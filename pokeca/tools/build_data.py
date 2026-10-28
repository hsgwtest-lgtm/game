"""Build a Japanese Pokémon card index from tcgdex/cards-database (data-asia),
parsing the TS object literals as text (no code execution)."""
import json, os, re, sys, datetime

ROOT, OUT = sys.argv[1], sys.argv[2]
os.makedirs(os.path.join(OUT, 'sets'), exist_ok=True)


class P:
    def __init__(self, s):
        self.s, self.i = s, 0

    def ws(self):
        s = self.s
        while self.i < len(s):
            c = s[self.i]
            if c in ' \t\r\n':
                self.i += 1
            elif s.startswith('//', self.i):
                j = s.find('\n', self.i)
                self.i = len(s) if j < 0 else j
            elif s.startswith('/*', self.i):
                self.i = s.find('*/', self.i) + 2
            else:
                break

    def val(self):
        self.ws()
        c = self.s[self.i]
        if c == '{':
            return self.obj()
        if c == '[':
            return self.arr()
        if c in '"\'`':
            return self.string()
        m = re.compile(r'-?\d+(\.\d+)?').match(self.s, self.i)
        if m:
            self.i = m.end()
            return float(m.group()) if m.group(1) else int(m.group())
        m = re.compile(r'[A-Za-z_$][\w$.]*').match(self.s, self.i)
        self.i = m.end()
        w = m.group()
        return {'true': True, 'false': False, 'null': None, 'undefined': None}.get(w, '$ref:' + w)

    def string(self):
        q = self.s[self.i]
        self.i += 1
        out = []
        while True:
            c = self.s[self.i]
            if c == '\\':
                n = self.s[self.i + 1]
                out.append({'n': '\n', 't': '\t'}.get(n, n))
                self.i += 2
            elif c == q:
                self.i += 1
                return ''.join(out)
            else:
                out.append(c)
                self.i += 1

    def key(self):
        self.ws()
        if self.s[self.i] in '"\'`':
            return self.string()
        m = re.compile(r'[\w$-]+').match(self.s, self.i)
        self.i = m.end()
        return m.group()

    def obj(self):
        self.i += 1
        o = {}
        while True:
            self.ws()
            if self.s[self.i] == '}':
                self.i += 1
                return o
            if self.s.startswith('...', self.i):  # spread: skip
                self.i += 3
                self.val()
            else:
                k = self.key()
                self.ws()
                if self.s[self.i] == ':':
                    self.i += 1
                    o[k] = self.val()
                else:
                    o[k] = '$ref:' + k  # shorthand
            self.ws()
            if self.s[self.i] == ',':
                self.i += 1

    def arr(self):
        self.i += 1
        a = []
        while True:
            self.ws()
            if self.s[self.i] == ']':
                self.i += 1
                return a
            a.append(self.val())
            self.ws()
            if self.s[self.i] == ',':
                self.i += 1


def load(path):
    s = open(path, encoding='utf-8').read()
    m = re.search(r'const\s+\w+\s*(:\s*\w+)?\s*=\s*\{', s)
    if not m:
        return None
    p = P(s)
    p.i = m.end() - 1
    return p.obj()


def ja(o):
    return o.get('ja') if isinstance(o, dict) else None


sets, total, fails = [], 0, 0
for serie_id in sorted(os.listdir(ROOT)):
    sdir = os.path.join(ROOT, serie_id)
    if not os.path.isdir(sdir) or not os.path.exists(sdir + '.ts'):
        continue
    serie = load(sdir + '.ts') or {}
    for sf in sorted(os.listdir(sdir)):
        if not sf.endswith('.ts'):
            continue
        set_id = sf[:-3]
        cdir = os.path.join(sdir, set_id)
        try:
            st = load(os.path.join(sdir, sf))
        except Exception as e:
            print('set fail', set_id, e); continue
        if not st or not ja(st.get('name')) or not os.path.isdir(cdir):
            continue
        cards = []
        for cf in os.listdir(cdir):
            if not cf.endswith('.ts'):
                continue
            try:
                c = load(os.path.join(cdir, cf))
            except Exception as e:
                fails += 1; continue
            if not c or not ja(c.get('name')):
                continue
            d = {'id': cf[:-3], 'n': ja(c['name'])}
            for src, dst in [('rarity', 'r'), ('category', 'c'), ('hp', 'hp'), ('types', 't'), ('stage', 'st'),
                             ('suffix', 'sx'), ('illustrator', 'il'), ('regulationMark', 'rm'), ('retreat', 're'),
                             ('trainerType', 'tt'), ('energyType', 'et'), ('weaknesses', 'wk'), ('resistances', 'rs')]:
                v = c.get(src)
                if v not in (None, '', []):
                    d[dst] = v
            if ja(c.get('evolveFrom')): d['ev'] = ja(c['evolveFrom'])
            if ja(c.get('effect')): d['ef'] = ja(c['effect'])
            ab = [{'ty': a.get('type'), 'n': ja(a.get('name')), 'e': ja(a.get('effect'))}
                  for a in c.get('abilities') or [] if isinstance(a, dict) and ja(a.get('name'))]
            if ab: d['ab'] = ab
            at = [{k: v for k, v in {'co': a.get('cost'), 'n': ja(a.get('name')), 'd': a.get('damage'),
                                      'e': ja(a.get('effect'))}.items() if v not in (None, '', [])}
                  for a in c.get('attacks') or [] if isinstance(a, dict) and ja(a.get('name'))]
            if at: d['at'] = at
            cards.append(d)
        if not cards:
            continue
        def nk(x):
            m = re.match(r'(\d+)', x['id'])
            return (int(m.group(1)) if m else 10**9, x['id'])
        cards.sort(key=nk)
        json.dump({'id': set_id, 'cards': cards}, open(os.path.join(OUT, 'sets', set_id + '.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, separators=(',', ':'))
        total += len(cards)
        rd = st.get('releaseDate')
        rd = ja(rd) or (rd if isinstance(rd, str) else '')
        sets.append({'id': set_id, 's': serie_id, 'sn': ja(serie.get('name')) or serie_id, 'n': ja(st['name']),
                     'o': (st.get('cardCount') or {}).get('official') or 0, 'd': rd or '',
                     'c': [[x['id'], x['n']] for x in cards]})

sets.sort(key=lambda x: x['d'], reverse=True)
json.dump({'built': datetime.date.today().isoformat(), 'sets': sets},
          open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print('sets', len(sets), 'cards', total, 'fails', fails)
