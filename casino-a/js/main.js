import { Chips } from './chips.js';
import { createAudioContext, resumeAudio } from './audio.js';
import { formatChips } from './utils.js';

function updateBalance() {
  const el = document.getElementById('balance');
  if (el) el.textContent = formatChips(Chips.balance);
}

document.addEventListener('DOMContentLoaded', () => {
  updateBalance();

  document.getElementById('resetBtn')?.addEventListener('click', () => {
    Chips.reset();
    updateBalance();
  });

  // Initialize audio context on first interaction for iOS
  document.addEventListener('touchstart', () => {
    createAudioContext();
    resumeAudio();
  }, { once: true });
});

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
