import { Chips } from './chips.js';
import { resumeAudio, chipBet } from './audio.js';
import { formatNumber } from './utils.js';

// Splash screen
const splash = document.getElementById('splash');
const lobby = document.getElementById('lobby');

setTimeout(() => {
  splash.classList.add('fade-out');
  lobby.style.display = '';
  setTimeout(() => splash.remove(), 800);
}, 1800);

// Balance display
const balanceDisplay = document.getElementById('balanceDisplay');
function refreshBalance() {
  balanceDisplay.textContent = formatNumber(Chips.balance);
}
refreshBalance();
Chips.onChange(refreshBalance);

// Reset button
document.getElementById('resetBtn').addEventListener('click', () => {
  Chips.reset();
  refreshBalance();
});

// Game navigation
document.querySelectorAll('.game-card').forEach(card => {
  card.addEventListener('click', () => {
    resumeAudio();
    chipBet();
    const game = card.dataset.game;
    location.href = `games/${game}/${game}.html`;
  });
});

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
