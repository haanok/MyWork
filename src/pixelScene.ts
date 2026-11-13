/** Vivicta Pixel map backdrop: a night valley drawn one art pixel at a time. */

interface Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

interface Ribbon {
  base: number;
  amp: number;
  len: number;
  speed: number;
  phase: number;
  colors: [string, string, string, string, string];
}

export interface PixelScene {
  draw(ctx: CanvasRenderingContext2D, time: number): void;
}

const SKY = ['#03060d', '#040912', '#050c18', '#07111f', '#0a1828', '#0d2030'];

const RIBBONS: Ribbon[] = [
  { base: 0.08, amp: 0.04, len: 0.15, speed: 0.32, phase: 2.1, colors: ['#d9ccff', '#8c76e0', '#4a3c8c', '#2c2560', '#1b1840'] },
  { base: 0.16, amp: 0.055, len: 0.22, speed: 0.46, phase: 0, colors: ['#bff7de', '#4fcf9f', '#1f7a60', '#134a3d', '#0c2e2a'] },
];

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function layer(width: number, height: number): Layer {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function paintSky(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const band = Math.ceil(height / SKY.length);
  SKY.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, i * band, width, band);
  });
  // Checker dither at each band seam so the gradient reads as stepped, not banded.
  for (let i = 1; i < SKY.length; i += 1) {
    const seam = i * band;
    ctx.fillStyle = SKY[i];
    for (let y = seam - 2; y < seam; y += 1) {
      for (let x = (y + i) & 1; x < width; x += 2) ctx.fillRect(x, y, 1, 1);
    }
  }
}

function paintMoon(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const cx = Math.round(width * 0.9);
  const cy = Math.round(height * 0.11);
  const r = Math.max(5, Math.round(Math.min(width, height) * 0.05));
  for (let dy = -r - 4; dy <= r + 4; dy += 1) {
    for (let dx = -r - 4; dx <= r + 4; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d > r + 1.5 && d <= r + 2.5) dot(ctx, cx + dx, cy + dy, '#0d2232');
      if (d > r) continue;
      const shade = dx > r * 0.3 && Math.hypot(dx + r * 0.35, dy + r * 0.15) > r * 0.95;
      dot(ctx, cx + dx, cy + dy, shade ? '#9fb4ba' : '#dfe9e6');
    }
  }
  [[-0.35, -0.2], [0.1, 0.3], [-0.1, 0.05]].forEach(([u, v]) => dot(ctx, cx + Math.round(u * r), cy + Math.round(v * r), '#b6c8ca'));
  dot(ctx, cx - Math.round(r * 0.55), cy - Math.round(r * 0.55), '#f5faf8');
}

function paintStars(ctx: CanvasRenderingContext2D, width: number, height: number, rand: () => number) {
  const skyLimit = height * 0.58;
  const count = Math.floor((width * skyLimit) / 170);
  for (let i = 0; i < count; i += 1) {
    const x = Math.floor(rand() * width);
    const y = Math.floor(rand() * skyLimit);
    const roll = rand();
    dot(ctx, x, y, roll < 0.6 ? '#3a5262' : roll < 0.85 ? '#7f99a3' : roll < 0.95 ? '#9cd3ff' : '#eaf5f3');
  }
  const twinkles: Array<[number, number, boolean]> = [];
  for (let i = 0; i < 12; i += 1) {
    twinkles.push([Math.floor(rand() * width), Math.floor(rand() * skyLimit * 0.9), i % 3 === 0]);
  }
  return twinkles;
}

function paintMountains(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const snowLine = height * 0.55;
  for (let x = 0; x < width; x += 1) {
    const peaks = 1 - Math.abs(Math.sin(x * 0.019 + 0.7));
    const roll = 0.5 * Math.sin(x * 0.021 + 1.3) + 0.3 * Math.sin(x * 0.057 + 0.4) + 0.2 * Math.sin(x * 0.13 + 2.2);
    const ridge = Math.round(height * (0.66 - 0.13 * peaks ** 1.6 - 0.025 * roll));
    ctx.fillStyle = '#0c1428';
    ctx.fillRect(x, ridge, 1, height - ridge);
    dot(ctx, x, ridge, '#1d2d4c');
    if (ridge < snowLine) {
      const cap = Math.round((snowLine - ridge) * 0.4) + 1;
      ctx.fillStyle = '#4d6684';
      ctx.fillRect(x, ridge, 1, cap);
      if ((x & 1) === 0) dot(ctx, x, ridge + cap, '#2c3f5c');
      dot(ctx, x, ridge, '#8fa9bb');
    }
  }
  for (let x = 0; x < width; x += 1) {
    const roll = 0.6 * Math.sin(x * 0.03 + 2) + 0.4 * Math.sin(x * 0.071);
    const ridge = Math.round(height * (0.76 - 0.045 * roll));
    ctx.fillStyle = '#081020';
    ctx.fillRect(x, ridge, 1, height - ridge);
    dot(ctx, x, ridge, '#13253d');
  }
}

function paintPine(ctx: CanvasRenderingContext2D, x: number, base: number, tall: number, color: string, rim: string, rand: () => number) {
  const maxHalf = Math.max(2, Math.round(tall * 0.32));
  for (let row = 0; row < tall; row += 1) {
    const level = Math.floor(row / 4);
    const half = Math.min(maxHalf, level + Math.floor((row % 4) * 0.6));
    const y = base - tall + row;
    ctx.fillStyle = color;
    ctx.fillRect(x - half, y, half * 2 + 1, 1);
    if (half > 0 && rand() < 0.35) dot(ctx, x - half, y, rim);
  }
  dot(ctx, x, base - tall, '#1d6b55');
  ctx.fillStyle = '#02060a';
  ctx.fillRect(x, base, 1, 2);
}

function paintForest(ctx: CanvasRenderingContext2D, width: number, height: number, rand: () => number) {
  const ground = Math.round(height * 0.88);
  for (let x = Math.floor(rand() * 4); x < width; x += 3 + Math.floor(rand() * 4)) {
    paintPine(ctx, x, ground - 3 + Math.floor(rand() * 2), Math.round(height * (0.04 + rand() * 0.04)), '#06121a', '#0d2629', rand);
  }
  ctx.fillStyle = '#040a10';
  ctx.fillRect(0, ground, width, height - ground);
  for (let x = 0; x < width; x += 1) if (rand() < 0.55) dot(ctx, x, ground, '#0a1f1e');
  for (let x = Math.floor(rand() * 6); x < width; x += 5 + Math.floor(rand() * 6)) {
    paintPine(ctx, x, ground + Math.floor(rand() * 3), Math.round(height * (0.06 + rand() * 0.07)), '#030a0e', '#0b2324', rand);
  }
}

function drawRibbon(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, ribbon: Ribbon) {
  const [crest, bright, mid, low, haze] = ribbon.colors;
  for (let x = 0; x < width; x += 1) {
    const u = x / width;
    // The curtain fades out before the moon so the two never compete.
    const span = Math.min(1, Math.max(0, (u - 0.04) / 0.76));
    const envelope = Math.sin(span * Math.PI);
    if (envelope < 0.08) continue;
    const top = Math.round(height * (
      ribbon.base
      + ribbon.amp * Math.sin(u * Math.PI * 2.6 + time * ribbon.speed + ribbon.phase)
      + ribbon.amp * 0.35 * Math.sin(u * Math.PI * 6.2 - time * ribbon.speed * 1.6)
    ));
    const ray = 0.55 + 0.45 * Math.sin(x * 0.55 + time * 0.9 + ribbon.phase) * Math.sin(x * 0.17 - time * 0.4);
    const length = Math.round(height * ribbon.len * envelope * (0.45 + 0.55 * ray));
    if (length < 3) continue;
    let y = top;
    if (ray > 0.62) dot(ctx, x, y++, crest);
    const midLen = Math.round(length * 0.3);
    const lowLen = Math.round(length * 0.3);
    ctx.fillStyle = bright;
    ctx.fillRect(x, y, 1, 1);
    y += 1;
    ctx.fillStyle = mid;
    ctx.fillRect(x, y, 1, midLen);
    y += midLen;
    ctx.fillStyle = low;
    ctx.fillRect(x, y, 1, lowLen);
    y += lowLen;
    const end = top + length;
    ctx.fillStyle = haze;
    for (; y < end; y += 1) {
      const sparse = y > end - (end - y) * 0.5 ? (x + y) % 4 === 0 : ((x + y) & 1) === 0;
      if (sparse) ctx.fillRect(x, y, 1, 1);
    }
  }
}

export function createPixelScene(width: number, height: number): PixelScene {
  const rand = random(7919);
  const back = layer(width, height);
  const front = layer(width, height);
  paintSky(back.ctx, width, height);
  const twinkles = paintStars(back.ctx, width, height, rand);
  paintMoon(back.ctx, width, height);
  paintMountains(front.ctx, width, height);
  paintForest(front.ctx, width, height, rand);

  const fireflies = Array.from({ length: 7 }, () => ({
    x: Math.floor(rand() * width),
    y: Math.round(height * (0.8 + rand() * 0.1)),
    phase: rand() * Math.PI * 2,
  }));

  return {
    draw(ctx, time) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(back.canvas, 0, 0);
      twinkles.forEach(([x, y, big], i) => {
        const on = Math.sin(time * 1.7 + i * 2.3) > 0.35;
        dot(ctx, x, y, on ? '#eaf5f3' : '#3a5262');
        if (big && on) {
          ctx.fillStyle = '#9cd3ff';
          ctx.fillRect(x - 1, y, 1, 1);
          ctx.fillRect(x + 1, y, 1, 1);
          ctx.fillRect(x, y - 1, 1, 1);
          ctx.fillRect(x, y + 1, 1, 1);
        }
      });
      RIBBONS.forEach((ribbon) => drawRibbon(ctx, width, height, time, ribbon));
      ctx.drawImage(front.canvas, 0, 0);
      fireflies.forEach((fly) => {
        const glow = Math.sin(time * 1.3 + fly.phase);
        if (glow < 0.15) return;
        const x = fly.x + Math.round(3 * Math.sin(time * 0.4 + fly.phase));
        const y = fly.y + Math.round(2 * Math.sin(time * 0.7 + fly.phase * 1.3));
        if (glow > 0.75) {
          ctx.fillStyle = '#1d5f4c';
          ctx.fillRect(x - 1, y, 3, 1);
          ctx.fillRect(x, y - 1, 1, 3);
        }
        dot(ctx, x, y, '#bff7de');
      });
    },
  };
}
