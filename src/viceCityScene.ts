/** Vice theme map backdrop: a wide 3D one-point perspective neon metropolis with multi-row extruded skyscrapers, architectural glass grids, rain-slicked avenue reflections, and gliding light trails. */

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
 *  Focal length scales with viewport width so the 3D boulevard fills widescreen displays cleanly.
 */
function makeProjector(width: number, height: number, vx: number, vy: number) {
  const focal = Math.max(height * 0.85, width * 0.58);
  const camY = 0.42;
  return (x: number, y: number, z: number): [number, number] => {
    const inv = focal / Math.max(0.25, z);
    return [vx + x * inv, vy - (y - camY) * inv];
  };
}

export function createViceCityScene(width: number, height: number): ViceCityScene {
  const rand = seededRandom(Math.round(width * 17 + height * 11) ^ 0x4b1d2e3f);
  const vx = width * 0.5;
  const vy = height * 0.64;
  const project = makeProjector(width, height, vx, vy);

  const cityCanvas = document.createElement('canvas');
  cityCanvas.width = width;
  cityCanvas.height = height;
  const c = cityCanvas.getContext('2d')!;

  const beacons: Beacon[] = [];
  const reflections: AvenueReflection[] = [];

  // 0. Subtle high-altitude night stars above the skyline.
  {
    const starCount = Math.min(90, Math.max(35, Math.round((width * vy) / 8500)));
    for (let i = 0; i < starCount; i += 1) {
      const sx = rand() * width;
      const sy = rand() * vy * 0.72;
      const alpha = (0.14 + rand() * 0.35) * (1 - sy / (vy * 0.8));
      c.fillStyle = rand() > 0.75 ? `rgba(180, 245, 255, ${alpha})` : `rgba(240, 232, 255, ${alpha})`;
      c.fillRect(sx, sy, rand() > 0.8 ? 1.5 : 1, rand() > 0.8 ? 1.5 : 1);
    }
  }

  // 1. Wide distant downtown skyline spanning across the horizon behind the 3D avenue.
  {
    let x = -10;
    while (x < width + 10) {
      const w = Math.round(16 + rand() * 34);
      const u = (x + w * 0.5) / width;
      const centerDip = 0.62 + 0.55 * Math.abs(u - 0.5) * 2;
      const h = Math.round(height * (0.06 + rand() * 0.16) * centerDip);
      const top = Math.round(vy - h);

      const g = c.createLinearGradient(0, top, 0, vy);
      g.addColorStop(0, '#190e34');
      g.addColorStop(1, '#0a0616');
      c.fillStyle = g;
      c.fillRect(x, top, w, vy - top + 2);

      const [ar, ag, ab] = NEON_COLORS[Math.floor(rand() * NEON_COLORS.length)];
      if (rand() > 0.4) {
        c.fillStyle = `rgba(${ar}, ${ag}, ${ab}, 0.42)`;
        c.fillRect(x, top, w, 1);
      }

      // Fine distant skyline window dots.
      for (let wy = top + 5; wy < vy - 4; wy += 5) {
        if (rand() > 0.48) continue;
        for (let wx = x + 3; wx < x + w - 3; wx += 4) {
          if (rand() > 0.25) continue;
          c.fillStyle = rand() > 0.5 ? 'rgba(0, 240, 255, 0.24)' : 'rgba(255, 42, 157, 0.22)';
          c.fillRect(wx, wy, 1.5, 1.5);
        }
      }

      x += w + Math.round(rand() * 6 - 1);
    }
  }

  // 2. Rain-slicked 3D perspective boulevard floor (from horizon vy to bottom).
  const roadHalfW = 0.46;
  {
    const floorGrad = c.createLinearGradient(0, vy, 0, height);
    floorGrad.addColorStop(0, '#160b2b');
    floorGrad.addColorStop(0.25, '#0b0618');
    floorGrad.addColorStop(1, '#04020a');
    c.fillStyle = floorGrad;
    c.fillRect(0, vy, width, height - vy);

    const laneXs = [-roadHalfW, -roadHalfW * 0.64, -roadHalfW * 0.28, 0, roadHalfW * 0.28, roadHalfW * 0.64, roadHalfW];
    laneXs.forEach((lx, idx) => {
      const [xNear, yNear] = project(lx, 0, 0.68);
      const [xFar, yFar] = project(lx, 0, 15.0);
      const isCurb = idx === 0 || idx === laneXs.length - 1;
      const isCenter = idx === 3;
      c.strokeStyle = isCurb
        ? 'rgba(0, 240, 255, 0.55)'
        : isCenter
          ? 'rgba(255, 42, 157, 0.46)'
          : 'rgba(185, 117, 255, 0.2)';
      c.lineWidth = isCurb ? 2 : isCenter ? 1.4 : 1;
      c.beginPath();
      c.moveTo(xFar, yFar);
      c.lineTo(xNear, yNear);
      c.stroke();
    });

    for (let z = 0.9; z <= 12; z *= 1.32) {
      const [lx, ly] = project(-roadHalfW, 0, z);
      const [rx] = project(roadHalfW, 0, z);
      const fade = Math.max(0.04, 0.24 * (1 - z / 13));
      c.strokeStyle = `rgba(0, 240, 255, ${fade})`;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(lx, ly);
      c.lineTo(rx, ly);
      c.stroke();
    }
  }

  // 3. Draw multi-row 3D extruded skyscrapers (outer high-rise row + inner boulevard row) back-to-front.
  const drawBuilding3D = (
    side: -1 | 1,
    xInner: number,
    zNear: number,
    zDepth: number,
    bWidth: number,
    bHeight: number,
    colorIdx: number,
    isOuterRow: boolean,
  ) => {
    const zFar = zNear + zDepth;
    const xOuter = xInner + side * bWidth;

    const accent = NEON_COLORS[colorIdx % NEON_COLORS.length];
    const [ar, ag, ab] = accent;
    const depthFade = Math.min(1, Math.max(0.28, 1 - (zNear - 1.1) / 10.5)) * (isOuterRow ? 0.78 : 1);

    const inBotNear = project(xInner, 0, zNear);
    const inTopNear = project(xInner, bHeight, zNear);
    const outBotNear = project(xOuter, 0, zNear);
    const outTopNear = project(xOuter, bHeight, zNear);
    const inBotFar = project(xInner, 0, zFar);
    const inTopFar = project(xInner, bHeight, zFar);

    // Side wall facing inward toward the boulevard (angled in dramatic 3D perspective).
    const sideGrad = c.createLinearGradient(inTopNear[0], inTopNear[1], inBotFar[0], inBotFar[1]);
    sideGrad.addColorStop(0, `rgb(${Math.round(18 + ar * 0.1)}, ${Math.round(11 + ag * 0.06)}, ${Math.round(40 + ab * 0.11)})`);
    sideGrad.addColorStop(0.55, '#0d0920');
    sideGrad.addColorStop(1, '#060411');
    c.fillStyle = sideGrad;
    c.beginPath();
    c.moveTo(inBotNear[0], inBotNear[1]);
    c.lineTo(inTopNear[0], inTopNear[1]);
    c.lineTo(inTopFar[0], inTopFar[1]);
    c.lineTo(inBotFar[0], inBotFar[1]);
    c.closePath();
    c.fill();

    // Fine architectural window grid on the perspective side wall.
    const floors = Math.max(6, Math.min(28, Math.floor(bHeight * 14)));
    const cols = 4;
    for (let f = 1; f < floors; f += 1) {
      if (rand() > 0.6) continue;
      const yFloor = bHeight * (1 - f / floors);
      const yBand = Math.max(0.012, bHeight * 0.012);
      for (let col = 0; col < cols; col += 1) {
        if (rand() > 0.42) continue;
        const z0 = zNear + zDepth * (0.08 + (col / cols) * 0.84);
        const z1 = z0 + zDepth * (0.14 + rand() * 0.04);
        const p0 = project(xInner, yFloor, z0);
        const p1 = project(xInner, yFloor, z1);
        const p2 = project(xInner, yFloor - yBand, z1);
        const p3 = project(xInner, yFloor - yBand, z0);

        const winRoll = rand();
        const winAlpha = (0.22 + rand() * 0.36) * depthFade;
        c.fillStyle = winRoll < 0.48
          ? `rgba(${ar}, ${ag}, ${ab}, ${winAlpha})`
          : winRoll < 0.82
            ? `rgba(242, 236, 255, ${winAlpha * 0.72})`
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

    // Subtle vertical neon accent strip on select street-facing walls.
    if (!isOuterRow && rand() > 0.52 && zNear < 6.5) {
      const signZ0 = zNear + zDepth * 0.22;
      const signZ1 = zNear + zDepth * 0.29;
      const signTop = bHeight * (0.68 + rand() * 0.2);
      const signBot = signTop - bHeight * (0.2 + rand() * 0.18);
      const q0 = project(xInner, signTop, signZ0);
      const q1 = project(xInner, signTop, signZ1);
      const q2 = project(xInner, signBot, signZ1);
      const q3 = project(xInner, signBot, signZ0);
      c.fillStyle = `rgba(${ar}, ${ag}, ${ab}, ${0.58 * depthFade})`;
      c.beginPath();
      c.moveTo(q0[0], q0[1]);
      c.lineTo(q1[0], q1[1]);
      c.lineTo(q2[0], q2[1]);
      c.lineTo(q3[0], q3[1]);
      c.closePath();
      c.fill();
    }

    // Front face (facing camera, deeper obsidian shade with crisp fine window grid).
    const frontGrad = c.createLinearGradient(0, inTopNear[1], 0, inBotNear[1]);
    frontGrad.addColorStop(0, isOuterRow ? '#100a22' : '#0b071a');
    frontGrad.addColorStop(1, '#04020a');
    c.fillStyle = frontGrad;
    c.beginPath();
    c.moveTo(inBotNear[0], inBotNear[1]);
    c.lineTo(inTopNear[0], inTopNear[1]);
    c.lineTo(outTopNear[0], outTopNear[1]);
    c.lineTo(outBotNear[0], outBotNear[1]);
    c.closePath();
    c.fill();

    // Fine dotted glass curtain-wall windows on the front face (no chunky bars).
    const frontRows = Math.max(6, Math.min(26, Math.floor(bHeight * 13)));
    const frontCols = Math.max(3, Math.min(7, Math.floor(bWidth * 11)));
    for (let f = 1; f < frontRows; f += 1) {
      if (rand() > 0.52) continue;
      const yF = bHeight * (1 - f / frontRows);
      const yH = Math.max(0.011, bHeight * 0.011);
      for (let col = 0; col < frontCols; col += 1) {
        if (rand() > 0.34) continue;
        const x0 = xInner + side * bWidth * (0.1 + (col / frontCols) * 0.8);
        const x1 = x0 + side * bWidth * (0.5 / frontCols);
        const a0 = project(x0, yF, zNear);
        const a1 = project(x1, yF, zNear);
        const a2 = project(x1, yF - yH, zNear);
        const a3 = project(x0, yF - yH, zNear);
        const alpha = (0.18 + rand() * 0.28) * depthFade;
        c.fillStyle = rand() > 0.35
          ? `rgba(${ar}, ${ag}, ${ab}, ${alpha})`
          : `rgba(240, 232, 255, ${alpha * 0.8})`;
        c.beginPath();
        c.moveTo(a0[0], a0[1]);
        c.lineTo(a1[0], a1[1]);
        c.lineTo(a2[0], a2[1]);
        c.lineTo(a3[0], a3[1]);
        c.closePath();
        c.fill();
      }
    }

    // Crisp 3D neon architectural edge trims (rooftop + leading vertical corner).
    c.strokeStyle = `rgba(${ar}, ${ag}, ${ab}, ${0.88 * depthFade})`;
    c.lineWidth = Math.max(1.1, 2.1 * depthFade);
    c.beginPath();
    c.moveTo(inTopFar[0], inTopFar[1]);
    c.lineTo(inTopNear[0], inTopNear[1]);
    c.lineTo(outTopNear[0], outTopNear[1]);
    c.stroke();

    const edgeGrad = c.createLinearGradient(inTopNear[0], inTopNear[1], inBotNear[0], inBotNear[1]);
    edgeGrad.addColorStop(0, `rgba(${ar}, ${ag}, ${ab}, ${0.9 * depthFade})`);
    edgeGrad.addColorStop(0.65, `rgba(${ar}, ${ag}, ${ab}, ${0.35 * depthFade})`);
    edgeGrad.addColorStop(1, `rgba(${ar}, ${ag}, ${ab}, 0.05)`);
    c.strokeStyle = edgeGrad;
    c.lineWidth = Math.max(1, 1.9 * depthFade);
    c.beginPath();
    c.moveTo(inTopNear[0], inTopNear[1]);
    c.lineTo(inBotNear[0], inBotNear[1]);
    c.stroke();

    // Rooftop spire & animated beacon on tall towers.
    if (bHeight > 1.3 && rand() > 0.38) {
      const tip = project(xInner + side * bWidth * 0.45, bHeight + 0.26, zNear + zDepth * 0.25);
      const base = project(xInner + side * bWidth * 0.45, bHeight, zNear + zDepth * 0.25);
      c.strokeStyle = 'rgba(210, 195, 250, 0.36)';
      c.lineWidth = 1;
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

    if (!isOuterRow && zNear < 6.8) {
      const streetEdgeNear = project(side * (roadHalfW * 0.8), 0, zNear);
      const streetEdgeFar = project(side * (roadHalfW * 0.8), 0, zFar);
      reflections.push({
        xTop: streetEdgeFar[0],
        xBot: streetEdgeNear[0],
        wTop: Math.max(8, Math.abs(inBotFar[0] - streetEdgeFar[0]) * 1.4),
        wBot: Math.max(24, Math.abs(inBotNear[0] - streetEdgeNear[0]) * 1.8),
        color: accent,
        alpha: (0.16 + rand() * 0.1) * depthFade,
        phase: rand() * Math.PI * 2,
      });
    }
  };

  // Painter's order: draw outer-row skyscrapers first (deeper & taller toward the viewport edges),
  // then inner-row boulevard towers with breathing room between them.
  const depthSlots: number[] = [];
  for (let z = 8.6; z >= 1.25; z -= 0.82) {
    depthSlots.push(z);
  }

  depthSlots.forEach((z, idx) => {
    const zDepth = 0.52 + rand() * 0.16;
    const leftColor = idx % 3 === 0 ? 0 : idx % 3 === 1 ? 2 : 0;
    const rightColor = idx % 3 === 0 ? 1 : idx % 3 === 1 ? 1 : 2;

    // Outer city block row (fills the wide left/right flanks with distinct taller skyscrapers).
    const outerOffsetL = roadHalfW + 0.5 + rand() * 0.18;
    const outerOffsetR = roadHalfW + 0.5 + rand() * 0.18;
    drawBuilding3D(-1, -outerOffsetL, z + 0.18, zDepth, 0.36 + rand() * 0.24, 1.35 + rand() * 1.05, (leftColor + 2) % 3, true);
    drawBuilding3D(1, outerOffsetR, z + 0.18, zDepth, 0.36 + rand() * 0.24, 1.4 + rand() * 1.05, (rightColor + 2) % 3, true);

    // Far-flank skyscrapers for ultra-wide monitors.
    if (z < 5.5) {
      drawBuilding3D(-1, -(outerOffsetL + 0.44), z + 0.08, zDepth, 0.38 + rand() * 0.22, 1.2 + rand() * 0.95, leftColor, true);
      drawBuilding3D(1, outerOffsetR + 0.44, z + 0.08, zDepth, 0.38 + rand() * 0.22, 1.25 + rand() * 0.95, rightColor, true);
    }

    // Inner boulevard-facing skyscrapers (compact width so outer towers peek out behind them!).
    const innerOffsetL = roadHalfW + 0.03 + rand() * 0.07;
    const innerOffsetR = roadHalfW + 0.03 + rand() * 0.07;
    drawBuilding3D(-1, -innerOffsetL, z, zDepth, 0.28 + rand() * 0.18, 0.88 + rand() * 0.95 + (z < 2.6 ? 0.25 : 0), leftColor, false);
    drawBuilding3D(1, innerOffsetR, z, zDepth, 0.28 + rand() * 0.18, 0.92 + rand() * 0.95 + (z < 2.6 ? 0.25 : 0), rightColor, false);
  });

  // Distant perspective neon traffic light trails gliding smoothly along the avenue.
  const traffic: TrafficStreak[] = Array.from({ length: 14 }, (_, i) => {
    const toward = i % 2 === 0;
    const lane = toward ? -0.32 - rand() * 0.42 : 0.32 + rand() * 0.42;
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
      { cx: vx - width * 0.14, cy: vy * 0.92, r: width * 0.48, color: [0, 240, 255] as [number, number, number], alpha: 0.22, drift: 0.12, phase: 0.3 },
      { cx: vx + width * 0.14, cy: vy * 0.96, r: width * 0.52, color: [255, 42, 157] as [number, number, number], alpha: 0.28, drift: -0.1, phase: 1.9 },
      { cx: vx, cy: vy * 0.78, r: width * 0.46, color: [185, 117, 255] as [number, number, number], alpha: 0.18, drift: 0.08, phase: 3.7 },
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

    // 2. Cached 3D multi-row skyscraper metropolis & perspective boulevard.
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
      const zHead = 0.75 + Math.pow(1 - progress, 2.2) * 11;
      const zTail = zHead + (car.toward ? 0.45 : -0.45) * (0.5 + zHead * 0.14);
      if (zHead < 0.7 || zTail < 0.7) continue;

      const lx = car.lane * roadHalfW * 0.78;
      const head = project(lx, 0.02, zHead);
      const tail = project(lx, 0.02, zTail);
      const [r, g, b] = car.color;
      const alpha = Math.min(0.82, Math.max(0.1, (1 - zHead / 12) * 0.9));

      const grad = ctx.createLinearGradient(tail[0], tail[1], head[0], head[1]);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${alpha})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1.3, 4.2 * (1 - zHead / 13));
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
      const halo = ctx.createRadialGradient(beacon.x, beacon.y, 0, beacon.x, beacon.y, 9);
      halo.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.88 * glow})`);
      halo.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, ${0.3 * glow})`);
      halo.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(beacon.x, beacon.y, 9, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
  };

  return { draw };
}
