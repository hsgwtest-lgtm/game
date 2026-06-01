/**
 * Easing functions for animations
 */
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function easeOutBounce(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Weighted random selection
 * @param {any[]} items - Array of items
 * @param {number[]} weights - Corresponding weights
 * @returns {number} Selected index
 */
export function weightedRandom(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Format number as chip display
 */
export function formatChips(amount) {
  if (amount >= 1000000) return `¥${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `¥${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}K`;
  return `¥${amount}`;
}

/**
 * Delay helper
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Setup high-DPI canvas
 */
export function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return { ctx, width: rect.width, height: rect.height, dpr };
}

/**
 * Animate helper using requestAnimationFrame
 */
export function animate(duration, callback) {
  return new Promise(resolve => {
    const start = performance.now();
    function frame(now) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      callback(t);
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}
