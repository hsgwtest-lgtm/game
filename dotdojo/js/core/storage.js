// localStorage の安全なラッパー（iOS のプライベートブラウズでも落ちないように）

const PREFIX = 'dotdojo.';

export const store = {
  get(key, def = null) {
    try {
      const s = window.localStorage.getItem(PREFIX + key);
      return s == null ? def : JSON.parse(s);
    } catch (e) { return def; }
  },
  set(key, val) {
    try { window.localStorage.setItem(PREFIX + key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  },
  remove(key) {
    try { window.localStorage.removeItem(PREFIX + key); } catch (e) { /* noop */ }
  },
  clearAll() {
    try {
      const ks = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(PREFIX)) ks.push(k);
      }
      ks.forEach(k => window.localStorage.removeItem(k));
    } catch (e) { /* noop */ }
  },
};
