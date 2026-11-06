import { useEffect, useRef } from 'react';

/** Curtain layers: each is a ribbon of vertical rays hanging from a slowly bending lower edge. */
const CURTAINS = [
  { base: 0.34, reach: 0.3, amp: 0.07, freq: 1.7, speed: 0.045, sway: 0.6, glow: 0.9, sprite: 0 },
  { base: 0.24, reach: 0.22, amp: 0.05, freq: 2.6, speed: -0.03, sway: 1.9, glow: 0.62, sprite: 1 },
  { base: 0.46, reach: 0.26, amp: 0.04, freq: 1.1, speed: 0.022, sway: 3.4, glow: 0.42, sprite: 0 },
] as const;

/** Internal resolution divisor: the canvas is upscaled by CSS, which softens the rays for free. */
const SCALE = 4;

function raySprite(stops: Array<[number, string]>): HTMLCanvasElement {
  const sprite = document.createElement('canvas');
  sprite.width = 1;
  sprite.height = 128;
  const context = sprite.getContext('2d');
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 128);
    stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1, 128);
  }
  return sprite;
}

export function AuroraSurface({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = canvas?.parentElement;
    if (!canvas || !stage || !active) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sprites = [
      raySprite([
        [0, 'rgba(150, 110, 255, 0)'],
        [0.35, 'rgba(150, 110, 255, 0.28)'],
        [0.72, 'rgba(84, 240, 176, 0.78)'],
        [0.9, 'rgba(150, 255, 210, 0.95)'],
        [1, 'rgba(84, 240, 176, 0)'],
      ]),
      raySprite([
        [0, 'rgba(255, 120, 160, 0)'],
        [0.4, 'rgba(255, 120, 160, 0.22)'],
        [0.78, 'rgba(120, 200, 255, 0.55)'],
        [1, 'rgba(120, 200, 255, 0)'],
      ]),
    ];
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastDraw = 0;
    let time = 37;

    const draw = () => {
      if (width <= 0 || height <= 0) return;
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';
      const step = 1;
      CURTAINS.forEach((curtain) => {
        const sprite = sprites[curtain.sprite];
        for (let x = 0; x < width; x += step) {
          const u = x / width;
          const edge = height * (
            curtain.base
            + curtain.amp * Math.sin(u * curtain.freq * Math.PI * 2 + time * curtain.speed * 6 + curtain.sway)
            + curtain.amp * 0.45 * Math.sin(u * curtain.freq * 5.3 - time * curtain.speed * 9)
          );
          const fold = 0.5 + 0.5 * Math.sin(u * 11 + time * curtain.speed * 14 + curtain.sway * 2);
          const rays = 0.55 + 0.45 * Math.sin(u * 97 + time * 0.35 + curtain.sway) * Math.sin(u * 41 - time * 0.21);
          const envelope = Math.sin(Math.min(1, Math.max(0, u * 1.08 - 0.04)) * Math.PI) ** 0.8;
          const alpha = curtain.glow * envelope * (0.25 + 0.75 * fold) * rays;
          if (alpha <= 0.02) continue;
          const reach = height * curtain.reach * (0.75 + 0.35 * fold);
          context.globalAlpha = Math.min(1, alpha);
          context.drawImage(sprite, x, edge - reach, step, reach + height * 0.03);
        }
      });
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    };

    const render = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      if (now - lastDraw >= 42) {
        time += reduced.matches ? 0 : Math.min((now - lastDraw) / 1000, 0.08);
        draw();
        lastDraw = now;
      }
      if (!reduced.matches) frame = requestAnimationFrame(render);
    };
    const schedule = () => {
      if (!frame && !document.hidden && !reduced.matches) frame = requestAnimationFrame(render);
    };
    const resize = () => {
      width = Math.max(1, Math.round(stage.clientWidth / SCALE));
      height = Math.max(1, Math.round(stage.clientHeight / SCALE));
      canvas.width = width;
      canvas.height = height;
      draw();
    };
    const onMotionChange = () => {
      if (reduced.matches) {
        cancelAnimationFrame(frame);
        frame = 0;
        draw();
      } else {
        schedule();
      }
    };
    const onVisibility = () => {
      if (!document.hidden) return schedule();
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    reduced.addEventListener('change', onMotionChange);
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      reduced.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active]);

  return <canvas ref={canvasRef} className="aurora-sky" aria-hidden="true" hidden={!active} />;
}
