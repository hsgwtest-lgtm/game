export const Chips = {
  get balance() { return parseInt(localStorage.getItem('casino_balance') || '10000'); },
  add(amount)   { localStorage.setItem('casino_balance', this.balance + amount); },
  subtract(amount) { localStorage.setItem('casino_balance', this.balance - amount); },
  reset()       { localStorage.setItem('casino_balance', '10000'); }
};
