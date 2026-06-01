// Shared utilities for all games

// Standard 52-card deck
const SUITS = ['♥', '♦', '♣', '♠'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

export function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  return parseInt(card.rank, 10);
}

export function baccaratValue(card) {
  if (card.rank === 'A') return 1;
  if (['10', 'J', 'Q', 'K'].includes(card.rank)) return 0;
  return parseInt(card.rank, 10);
}

export function dragonTigerValue(card) {
  const order = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return order.indexOf(card.rank);
}

export function isRed(suit) {
  return suit === '♥' || suit === '♦';
}

// Three.js card texture generator
export function createCardTexture(THREE, suit, rank) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 358;
  const ctx = canvas.getContext('2d');

  // White background with rounded corners
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 256, 358);

  // Border
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, 248, 350);

  // Suit color
  const color = isRed(suit) ? '#c0392b' : '#1a1a2e';
  ctx.fillStyle = color;

  // Top-left rank & suit
  ctx.font = 'bold 40px serif';
  ctx.fillText(rank, 16, 50);
  ctx.font = '36px serif';
  ctx.fillText(suit, 18, 88);

  // Center suit
  ctx.font = '100px serif';
  ctx.textAlign = 'center';
  ctx.fillText(suit, 128, 210);

  // Bottom-right (inverted)
  ctx.save();
  ctx.translate(256, 358);
  ctx.rotate(Math.PI);
  ctx.textAlign = 'left';
  ctx.font = 'bold 40px serif';
  ctx.fillText(rank, 16, 50);
  ctx.font = '36px serif';
  ctx.fillText(suit, 18, 88);
  ctx.restore();

  return new THREE.CanvasTexture(canvas);
}

// Card back texture
export function createCardBackTexture(THREE) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 358;
  const ctx = canvas.getContext('2d');

  // Deep blue/red pattern
  ctx.fillStyle = '#1a1a6e';
  ctx.fillRect(0, 0, 256, 358);

  // Diamond pattern
  ctx.strokeStyle = '#c9a84c';
  ctx.lineWidth = 1;
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 28; j++) {
      const x = i * 14 + 5;
      const y = j * 14 + 5;
      ctx.beginPath();
      ctx.moveTo(x + 7, y);
      ctx.lineTo(x + 14, y + 7);
      ctx.lineTo(x + 7, y + 14);
      ctx.lineTo(x, y + 7);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // Border
  ctx.strokeStyle = '#c9a84c';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 244, 346);

  return new THREE.CanvasTexture(canvas);
}

// Animate value with easing
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// Format number with commas
export function formatNumber(n) {
  return n.toLocaleString();
}

// Dispose Three.js resources
export function disposeScene(scene, renderer) {
  scene.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      } else {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    }
  });
  renderer.dispose();
}

// Update balance display element
export function updateBalanceDisplay(el, balance) {
  if (el) el.textContent = `💰 ${formatNumber(balance)}`;
}
