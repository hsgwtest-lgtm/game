const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

export { SUITS, RANKS };

export function createDeck(numDecks = 1) {
  const deck = [];
  for (let d = 0; d < numDecks; d++)
    for (const suit of SUITS)
      for (const rank of RANKS)
        deck.push({ suit, rank });
  return shuffle(deck);
}

export function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function drawCard(ctx, card, x, y, w, h, faceUp = true) {
  const r = 8;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = faceUp ? '#fdf8f0' : '#1a3a6a';
  ctx.fill();
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (faceUp) {
    const isRed = card.suit === '♥' || card.suit === '♦';
    ctx.fillStyle = isRed ? '#c0392b' : '#1a1a2e';
    ctx.font = `bold ${w * 0.25}px 'Crimson Pro', serif`;
    ctx.fillText(card.rank, x + 6, y + w * 0.28);
    ctx.font = `${w * 0.22}px serif`;
    ctx.fillText(card.suit, x + 6, y + w * 0.48);
    ctx.font = `${w * 0.45}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText(card.suit, x + w / 2, y + h * 0.65);
    ctx.textAlign = 'left';
  } else {
    ctx.strokeStyle = '#4a6a9a';
    ctx.lineWidth = 1;
    for (let i = -h; i < w + h; i += 8) {
      ctx.beginPath();
      ctx.moveTo(x + i, y);
      ctx.lineTo(x + i - h, y + h);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export { roundRect };
