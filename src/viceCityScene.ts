/** Vice theme map backdrop: a 3D one-point perspective neon metropolis canyon with converging skyscrapers, rain-slicked avenue reflections, and distant light trails. */

export interface ViceCityScene {
  draw(ctx: CanvasRenderingContext2D, time: number): void;
}

interface Beacon {
  x: number;
  y: number;
  phase: number;
  color: [number, number, number];
}

interface TrafficStreak {
  lane: number;
  speed: number;
  phase: number;
  toward: boolean;
  color: [number, number, number];
}

interface AvenueReflection {
  xTop: number;
  xBot: number;
  wTop: number;
  wBot: number;
  color: [number, number, number];
  alpha: number;
  phase: number;
}

function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NEON_COLORS: Array<[number, number, number]> = [
  [0, 240, 255],    // electric cyan
  [255, 42, 157],   // hot vice magenta
  [185, 117, 255],  // ultraviolet
];

/** Project a 3D world point onto the 2D viewport using one-point perspective.
 *  World units are normalized so x, y, z ~ O(1) fill the viewport cleanly at any aspect ratio.
 */
function makeProjector(width: number, height: number, vx: number, vy: number) {
  const focal = Math.min(width, height) * 0.88;
  const camY = 0.46;
  return (x: number, y: number, z: number): [number, number] => {
    const inv = focal / Math.max(0.25, z);
    return [vx + x * inv, vy - (y - camY) * inv];
  };
}

export function createViceCityScene(width: number, height: number): ViceCityScene {
  const rand = seededRandom(Math.round(width * 17 + height * 11) ^ 0x4b1d2e3f);
  const vx = width * 0.5;
  const vy = height * 0.62;
  const project = makeProjector(width, height, vx, vy);

  const cityCanvas = document.createElement('canvas');
  cityCanvas.width = width;
  cityCanvas.height = height;
  const c = cityCanvas.getContext('2d')!;

  const beacons: Beacon[] = [];
  const reflections: AvenueReflection[] = [];

  // 1. Distant downtown skyline cluster right behind the vanishing point.
  {
    const spanW = width * 0.46;
    let x = vx - spanW * 0.5;
    while (x < vx + spanW * 0.5) {
      const w = Math.round(12 + rand() * 24);
      const distFromCenter = Math.abs((x + w * 0.5 - vx) / (spanW * 0.5));
      const h = Math.round(height * (0.05 + (1 - distFromCenter * 0.4) * (0.05 + rand() * 0.13)));
      const top = Math.round(vy - h);

      const g = c.createLinearGradient(0, top, 0, vy);
      g.addColorStop(0, '#1b0f38');
      g.addColorStop(1, '#0b0618');
      c.fillStyle = g;
      c.fillRect(x, top, w, vy - top + 2);

      const [ar, ag, ab] = NEON_COLORS[Math.floor(rand() * NEON_COLORS.length)];
      if (rand() > 0.35) {
        c.fillStyle = `rgba(${ar}, ${ag}, ${ab}, 0.55)`;
        c.fillRect(x, top, w, 1.5);
      }

      for (let wy = top + 6; wy < vy - 4; wy += 6) {
        if (rand() > 0.45) continue;
        for (let wx = x + 3; wx < x + w - 4; wx += 5) {
          if (rand() > 0.35) continue;
          c.fillStyle = rand() > 0.5 ? 'rgba(0, 240, 255, 0.28)' : 'rgba(255, 42, 157, 0.28)';
          c.fillRect(wx, wy, 2, 2);
        }
      }

      x += w + Math.round(rand() * 4 - 1);
    }
  }

  // 2. Rain-slicked 3D perspective boulevard floor (from horizon vy to bottom).
  const roadHalfW = 0.44;
  {
    const floorGrad = c.createLinearGradient(0, vy, 0, height);
    floorGrad.addColorStop(0, '#160a2a');
    floorGrad.addColorStop(0.28, '#0b0618');
    floorGrad.addColorStop(1, '#05030b');
    c.fillStyle = floorGrad;
    c.fillRect(0, vy, width, height - vy);

    const laneXs = [-roadHalfW, -roadHalfW * 0.62, -roadHalfW * 0.26, 0, roadHalfW * 0.26, roadHalfW * 0.62, roadHalfW];
    laneXs.forEach((lx, idx) => {
      const [xNear, yNear] = project(lx, 0, 0.72);
      const [xFar, yFar] = project(lx, 0, 14.0);
      const isCurb = idx === 0 || idx === laneXs.length - 1;
      const isCenter = idx === 3;
      c.strokeStyle = isCurb
        ? 'rgba(0, 240, 255, 0.58)'
        : isCenter
          ? 'rgba(255, 42, 157, 0.48)'
          : 'rgba(185, 117, 255, 0.22)';
      c.lineWidth = isCurb ? 2.4 : isCenter ? 1.6 : 1.1;
      c.beginPath();
      c.moveTo(xFar, yFar);
      c.lineTo(xNear, yNear);
      c.stroke();
    });

    for (let z = 0.95; z <= 11; z *= 1.32) {
      const [lx, ly] = project(-roadHalfW, 0, z);
      const [rx] = project(roadHalfW, 0, z);
      const fade = Math.max(0.05, 0.28 * (1 - z / 12));
      c.strokeStyle = `rgba(0, 240, 255, ${fade})`;
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(lx, ly);
      c.lineTo(rx, ly);
      c.stroke();
    }
  }

  // 3. Draw 3D extruded skyscrapers along both sides of the boulevard (back-to-front painter's order).
  const depthSlots: number[] = [];
  for (let z = 8.4; z >= 1.1; z -= 0.72) {
    depthSlots.push(z);
  }

  const drawBuilding3D = (side: -1 | 1, zNear: number, zDepth: number, bWidth: number, bHeight: number, colorIdx: number) => {
    const zFar = zNear + zDepth;
    const xInner = side * (roadHalfW + 0.03 + rand() * 0.08);
    const xOuter = xInner + side * bWidth;

    const accent = NEON_COLORS[colorIdx % NEON_COLORS.length];
    const [ar, ag, ab] = accent;
    const depthFade = Math.min(1, Math.max(0.32, 1 - (zNear - 1.1) / 9.2));

    const inBotNear = project(xInner, 0, zNear);
    const inTopNear = project(xInner, bHeight, zNear);
    const outBotNear = project(xOuter, 0, zNear);
    const outTopNear = project(xOuter, bHeight, zNear);
    const inBotFar = project(xInner, 0, zFar);
    const inTopFar = project(xInner, bHeight, zFar);

    // Side wall facing the boulevard (angled sharply in 3D perspective toward the vanishing point).
    const sideGrad = c.createLinearGradient(inTopNear[0], inTopNear[1], inBotFar[0], inBotFar[1]);
    sideGrad.addColorStop(0, `rgb(${Math.round(20 + ar * 0.11)}, ${Math.round(12 + ag * 0.07)}, ${Math.round(42 + ab * 0.12)})`);
    sideGrad.addColorStop(0.55, '#0e0922');
    sideGrad.addColorStop(1, '#070513');
    c.fillStyle = sideGrad;
    c.beginPath();
    c.moveTo(inBotNear[0], inBotNear[1]);
    c.lineTo(inTopNear[0], inTopNear[1]);
    c.lineTo(inTopFar[0], inTopFar[1]);
    c.lineTo(inBotFar[0], inBotFar[1]);
    c.closePath();
    c.fill();

    // Perspective-converging lit window bands on the boulevard-facing 3D wall.
    const floors = Math.max(5, Math.min(20, Math.floor(bHeight * 9)));
    for (let f = 1; f < floors; f += 1) {
      if (rand() > 0.62) continue;
      const t = f / floors;
      const yFloor = bHeight * (1 - t);
      const yBand = Math.max(0.025, bHeight * 0.024);

      const segs = rand() > 0.45 ? 2 : 1;
      for (let s = 0; s < segs; s += 1) {
        const z0 = zNear + zDepth * (0.08 + s * 0.44 + rand() * 0.12);
        const z1 = Math.min(zFar - zDepth * 0.08, z0 + zDepth * (0.2 + rand() * 0.24));
        if (z1 <= z0) continue;
        const p0 = project(xInner, yFloor, z0);
        const p1 = project(xInner, yFloor, z1);
        const p2 = project(xInner, yFloor - yBand, z1);
        const p3 = project(xInner, yFloor - yBand, z0);

        const winRoll = rand();
        const winAlpha = (0.3 + rand() * 0.42) * depthFade;
        c.fillStyle = winRoll < 0.52
          ? `rgba(${ar}, ${ag}, ${ab}, ${winAlpha})`
          : winRoll < 0.8
            ? `rgba(245, 238, 255, ${winAlpha * 0.78})`
            : `rgba(255, 42, 157, ${winAlpha})`;
        c.beginPath();
        c.moveTo(p0[0], p0[1]);
        c.lineTo(p1[0], p1[1]);
        c.lineTo(p2[0], p2[1]);
        c.lineTo(p3[0], p3[1]);
        c.closePath();
        c.fill();
      }
    }

    // Sleek vertical neon sign blade on select 3D street-facing walls.
    if (rand() > 0.42 && zNear < 6.5) {
      const signZ0 = zNear + zDepth * 0.18;
      const signZ1 = zNear + zDepth * 0.34;
      const signTop = bHeight * (0.64 + rand() * 0.24);
      const signBot = signTop - bHeight * (0.24 + rand() * 0.22);
      const q0 = project(xInner, signTop, signZ0);
      const q1 = project(xInner, signTop, signZ1);
      const q2 = project(xInner, signBot, signZ1);
      const q3 = project(xInner, signBot, signZ0);
      c.fillStyle = `rgba(${ar}, ${ag}, ${ab}, ${0.65 * depthFade})`;
      c.beginPath();
      c.moveTo(q0[0], q0[1]);
      c.lineTo(q1[0], q1[1]);
      c.lineTo(q2[0], q2[1]);
      c.lineTo(q3[0], q3[1]);
      c.closePath();
      c.fill();
    }

    // Front face (darker shadowed face for strong 3D volume contrast).
    const frontGrad = c.createLinearGradient(0, inTopNear[1], 0, inBotNear[1]);
    frontGrad.addColorStop(0, '#0a0718');
    frontGrad.addColorStop(1, '#04020a');
    c.fillStyle = frontGrad;
    c.beginPath();
    c.moveTo(inBotNear[0], inBotNear[1]);
    c.lineTo(inTopNear[0], inTopNear[1]);
    c.lineTo(outTopNear[0], outTopNear[1]);
    c.lineTo(outBotNear[0], outBotNear[1]);
    c.closePath();
    c.fill();

    // Subtle horizontal window slits on the front face.
    const frontRows = Math.max(4, Math.min(18, Math.floor(bHeight * 8)));
    for (let f = 1; f < frontRows; f += 1) {
      if (rand() > 0.42) continue;
      const yF = bHeight * (1 - f / frontRows);
      const a0 = project(xInner + side * bWidth * 0.1, yF, zNear);
      const a1 = project(xInner + side * bWidth * (0.42 + rand() * 0.44), yF, zNear);
      c.strokeStyle = `rgba(${ar}, ${ag}, ${ab}, ${0.32 * depthFade})`;
      c.lineWidth = Math.max(1.5, 3.2 * depthFade);
      c.beginPath();
      c.moveTo(a0[0], a0[1]);
      c.lineTo(a1[0], a1[1]);
      c.stroke();
    }

    // Crisp 3D neon architectural edge trims (rooftop + leading vertical corner).
    c.strokeStyle = `rgba(${ar}, ${ag}, ${ab}, ${0.92 * depthFade})`;
    c.lineWidth = Math.max(1.4, 2.8 * depthFade);
    c.beginPath();
    c.moveTo(inTopFar[0], inTopFar[1]);
    c.lineTo(inTopNear[0], inTopNear[1]);
    c.lineTo(outTopNear[0], outTopNear[1]);
    c.stroke();

    const edgeGrad = c.createLinearGradient(inTopNear[0], inTopNear[1], inBotNear[0], inBotNear[1]);
    edgeGrad.addColorStop(0, `rgba(${ar}, ${ag}, ${ab}, ${0.95 * depthFade})`);
    edgeGrad.addColorStop(0.7, `rgba(${ar}, ${ag}, ${ab}, ${0.42 * depthFade})`);
    edgeGrad.addColorStop(1, `rgba(${ar}, ${ag}, ${ab}, 0.06)`);
    c.strokeStyle = edgeGrad;
    c.lineWidth = Math.max(1.2, 2.4 * depthFade);
    c.beginPath();
    c.moveTo(inTopNear[0], inTopNear[1]);
    c.lineTo(inBotNear[0], inBotNear[1]);
    c.stroke();

    if (bHeight > 1.35 && rand() > 0.35) {
      const tip = project(xInner + side * bWidth * 0.2, bHeight + 0.28, zNear + zDepth * 0.18);
      const base = project(xInner + side * bWidth * 0.2, bHeight, zNear + zDepth * 0.18);
      c.strokeStyle = 'rgba(210, 195, 250, 0.4)';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(base[0], base[1]);
      c.lineTo(tip[0], tip[1]);
      c.stroke();
      beacons.push({
        x: tip[0],
        y: tip[1],
        phase: rand() * Math.PI * 2,
        color: accent,
      });
    }

    if (zNear < 6.5) {
      const streetEdgeNear = project(side * (roadHalfW * 0.8), 0, zNear);
      const streetEdgeFar = project(side * (roadHalfW * 0.8), 0, zFar);
      reflections.push({
        xTop: streetEdgeFar[0],
        xBot: streetEdgeNear[0],
        wTop: Math.max(8, Math.abs(inBotFar[0] - streetEdgeFar[0]) * 1.4),
        wBot: Math.max(24, Math.abs(inBotNear[0] - streetEdgeNear[0]) * 1.8),
        color: accent,
        alpha: (0.18 + rand() * 0.12) * depthFade,
        phase: rand() * Math.PI * 2,
      });
    }
  };

  depthSlots.forEach((z, idx) => {
    const zDepth = 0.56 + rand() * 0.16;
    const leftHeight = 1.05 + rand() * 1.15 + (z < 2.8 ? 0.35 : 0);
    const rightHeight = 1.1 + rand() * 1.15 + (z < 2.8 ? 0.38 : 0);
    const leftWidth = 0.65 + rand() * 0.55;
    const rightWidth = 0.65 + rand() * 0.55;

    const leftColor = idx % 3 === 0 ? 0 : idx % 3 === 1 ? 2 : 0;
    const rightColor = idx % 3 === 0 ? 1 : idx % 3 === 1 ? 1 : 2;

    drawBuilding3D(-1, z, zDepth, leftWidth, leftHeight, leftColor);
    drawBuilding3D(1, z, zDepth, rightWidth, rightHeight, rightColor);
  });

  // Distant perspective neon traffic light trails gliding smoothly along the avenue.
  const traffic: TrafficStreak[] = Array.from({ length: 14 }, (_, i) => {
    const toward = i % 2 === 0;
    const lane = toward ? -0.35 - rand() * 0.42 : 0.35 + rand() * 0.42;
    return {
      lane,
      speed: 0.08 + rand() * 0.09,
      phase: rand(),
      toward,
      color: toward ? [0, 240, 255] : [255, 42, 157],
    };
  });

  const draw = (ctx: CanvasRenderingContext2D, time: number) => {
    ctx.clearRect(0, 0, width, height);

    // 1. Atmospheric Vice City sunset-midnight glow behind the vanishing point.
    ctx.globalCompositeOperation = 'lighter';
    const skyGlows = [
      { cx: vx - width * 0.12, cy: vy * 0.92, r: width * 0.46, color: [0, 240, 255] as [number, number, number], alpha: 0.24, drift: 0.12, phase: 0.3 },
      { cx: vx + width * 0.14, cy: vy * 0.96, r: width * 0.5, color: [255, 42, 157] as [number, number, number], alpha: 0.3, drift: -0.1, phase: 1.9 },
      { cx: vx, cy: vy * 0.78, r: width * 0.44, color: [185, 117, 255] as [number, number, number], alpha: 0.2, drift: 0.08, phase: 3.7 },
    ];
    for (const g of skyGlows) {
      const gx = g.cx + Math.sin(time * g.drift + g.phase) * width * 0.03;
      const gy = g.cy + Math.cos(time * g.drift * 0.7 + g.phase) * height * 0.02;
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, g.r);
      const [r, gr, b] = g.color;
      grad.addColorStop(0, `rgba(${r}, ${gr}, ${b}, ${g.alpha})`);
      grad.addColorStop(0.5, `rgba(${r}, ${gr}, ${b}, ${g.alpha * 0.35})`);
      grad.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Cached 3D skyscraper canyon & perspective boulevard.
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(cityCanvas, 0, 0);

    // 3. Shimmering neon boulevard reflections.
    ctx.globalCompositeOperation = 'lighter';
    for (const ref of reflections) {
      const shimmer = 0.75 + 0.25 * Math.sin(time * 0.8 + ref.phase);
      const [r, g, b] = ref.color;
      const grad = ctx.createLinearGradient(0, vy, 0, height);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${ref.alpha * shimmer})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(ref.xTop - ref.wTop * 0.5, vy + 2);
      ctx.lineTo(ref.xTop + ref.wTop * 0.5, vy + 2);
      ctx.lineTo(ref.xBot + ref.wBot * 0.5, height);
      ctx.lineTo(ref.xBot - ref.wBot * 0.5, height);
      ctx.closePath();
      ctx.fill();
    }

    // 4. Smooth receding / approaching neon light trails on the boulevard.
    for (const car of traffic) {
      const raw = (car.phase + time * car.speed) % 1;
      const progress = car.toward ? raw : 1 - raw;
      const zHead = 0.8 + Math.pow(1 - progress, 2.2) * 11;
      const zTail = zHead + (car.toward ? 0.45 : -0.45) * (0.5 + zHead * 0.14);
      if (zHead < 0.75 || zTail < 0.75) continue;

      const lx = car.lane * roadHalfW * 0.78;
      const head = project(lx, 0.02, zHead);
      const tail = project(lx, 0.02, zTail);
      const [r, g, b] = car.color;
      const alpha = Math.min(0.82, Math.max(0.1, (1 - zHead / 12) * 0.9));

      const grad = ctx.createLinearGradient(tail[0], tail[1], head[0], head[1]);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${alpha})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1.4, 4.6 * (1 - zHead / 13));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tail[0], tail[1]);
      ctx.lineTo(head[0], head[1]);
      ctx.stroke();
    }

    // 5. Breathing rooftop antenna beacons.
    for (const beacon of beacons) {
      const glow = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(time * 1.5 + beacon.phase));
      const [r, g, b] = beacon.color;
      const halo = ctx.createRadialGradient(beacon.x, beacon.y, 0, beacon.x, beacon.y, 10);
      halo.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.9 * glow})`);
      halo.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, ${0.32 * glow})`);
      halo.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(beacon.x, beacon.y, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  };

  return { draw };
}
