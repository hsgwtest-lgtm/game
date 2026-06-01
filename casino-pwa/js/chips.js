// Chip balance management — shared across all games via localStorage
export const Chips = {
  get balance() {
    return parseInt(localStorage.getItem('casino_balance') || '10000', 10);
  },
  set balance(val) {
    localStorage.setItem('casino_balance', String(Math.max(0, val)));
  },
  add(amount) {
    this.balance = this.balance + amount;
    this._notify();
  },
  subtract(amount) {
    this.balance = this.balance - amount;
    this._notify();
  },
  reset() {
    this.balance = 10000;
    this._notify();
  },
  _listeners: [],
  onChange(fn) {
    this._listeners.push(fn);
  },
  _notify() {
    for (const fn of this._listeners) fn(this.balance);
  }
};
