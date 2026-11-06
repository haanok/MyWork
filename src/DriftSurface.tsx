import { useEffect, useRef } from 'react';

interface Star {
  x: number;
  y: number;
  ox: number;
  oy: number;
  depth: number;
  phase: number;
}

export function DriftSurface({ water }: { water: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const app = canvas?.closest<HTMLElement>('.app');
    const stage = canvas?.parentElement;
    if (!canvas || !app || !stage) return;
    const context = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastDraw = 0;
    let flowTime = 0;
    let stars: Star[] = [];
    let current = { x: 0, y: 0 };
    let glass: HTMLElement | null = null;
    let pointer: { x: number; y: number; target: HTMLElement | null } | null = null;
    const surfaces = '.lamp, .data-menu-list, .import-dialog, .quick-add-dialog, .mcp-dialog';

    const resetGlass = () => {
      glass?.style.removeProperty('--glass-x');
      glass?.style.removeProperty('--glass-y');
      glass?.removeAttribute('data-glass-active');
      glass = null;
    };

    const drawWater = (elapsed = 0) => {
      if (!context || !water || width <= 0 || height <= 0) return;
      flowTime += elapsed;
      context.clearRect(0, 0, width, height);
      stars.forEach((star, index) => {
        const across = star.x * width;
        const down = star.y * height;
        const angle = Math.sin(across / 320 + flowTime * 0.14) * 1.2
          + Math.cos(down / 260 - flowTime * 0.1) * 0.8;
        const driftX = Math.cos(angle) * (6 + star.depth * 10);
        const driftY = Math.sin(angle) * (6 + star.depth * 10);
        star.x = ((across + driftX * elapsed + width) % width) / width;
        star.y = ((down + driftY * elapsed + height) % height) / height;
        const baseX = star.x * width;
        const baseY = star.y * height;
        const distance = Math.hypot(baseX - current.x, baseY - current.y);
        const near = Math.max(0, 1 - distance / 170);
        const push = near * near * (3 - 2 * near) * (0.6 + star.depth * 0.4) * 80;
        const ease = Math.min(1, elapsed * 5);
        const targetX = distance > 0 ? ((baseX - current.x) / distance) * push : 0;
        const targetY = distance > 0 ? ((baseY - current.y) / distance) * push : 0;
        star.ox += (targetX - star.ox) * ease;
        star.oy += (targetY - star.oy) * ease;
        const starX = baseX + star.ox;
        const starY = baseY + star.oy;
        const shimmer = 0.82 + Math.sin(flowTime * 0.55 + star.phase) * 0.18;
        const opacity = (0.16 + star.depth * 0.46) * shimmer;
        context.fillStyle = `rgba(220, 235, 239, ${opacity})`;
        context.beginPath();
        context.arc(starX, starY, 0.35 + star.depth * 0.85, 0, Math.PI * 2);
        context.fill();
        if (index % 9 === 0) {
          const length = 8 + star.depth * 14;
          context.beginPath();
          context.moveTo(starX, starY);
          context.lineTo(starX - Math.cos(angle) * length, starY - Math.sin(angle) * length);
          context.strokeStyle = `rgba(192, 222, 230, ${opacity * 0.18})`;
          context.lineWidth = 0.6;
          context.stroke();
        }
      });
    };

    const render = (now: number) => {
      frame = 0;
      if (document.hidden) return;
      if (pointer) {
        const target = pointer.target;
        if (glass !== target) resetGlass();
        glass = target;
        if (glass) {
          const bounds = glass.getBoundingClientRect();
          glass.style.setProperty('--glass-x', `${((pointer.x - bounds.left) / bounds.width) * 100}%`);
          glass.style.setProperty('--glass-y', `${((pointer.y - bounds.top) / bounds.height) * 100}%`);
          glass.setAttribute('data-glass-active', '');
        }
        pointer = null;
      }
      if (now - lastDraw >= 33) {
        const elapsed = reduced.matches ? 0 : Math.min((now - lastDraw) / 1000, 0.05);
        drawWater(elapsed);
        lastDraw = now;
      }
      if (water && !reduced.matches && !document.hidden) frame = requestAnimationFrame(render);
    };
    const schedule = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(render);
    };
    const resize = () => {
      width = stage.clientWidth;
      height = stage.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.min(360, Math.max(90, Math.round(width * height / 3200)));
      if (stars.length !== count) {
        stars = Array.from({ length: count }, (_, index) => ({
          x: (index * 0.7548776662 + 0.13) % 1,
          y: (index * 0.569840291 + 0.37) % 1,
          ox: 0,
          oy: 0,
          depth: (index * 0.6180339887 + 0.2) % 1,
          phase: index * 2.3999632297,
        }));
      }
      if (width && height) drawWater();
    };
    const disturb = (event: PointerEvent) => {
      if (reduced.matches || document.hidden || !event.isPrimary) return;
      const target = event.target instanceof Element ? event.target : null;
      pointer = { x: event.clientX, y: event.clientY, target: target?.closest<HTMLElement>(surfaces) ?? null };
      if (water && target?.closest('.map')) {
        const bounds = canvas.getBoundingClientRect();
        current.x = event.clientX - bounds.left;
        current.y = event.clientY - bounds.top;
      }
      schedule();
    };
    const leave = () => {
      pointer = null;
      resetGlass();
    };
    const settle = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      leave();
      drawWater();
    };
    const onMotionChange = () => (reduced.matches ? settle() : schedule());
    const onVisibility = () => {
      if (!document.hidden) return schedule();
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const endTouch = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') leave();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    app.addEventListener('pointermove', disturb, { passive: true });
    app.addEventListener('pointerdown', disturb, { passive: true });
    app.addEventListener('pointerleave', leave);
    app.addEventListener('pointerup', endTouch);
    app.addEventListener('pointercancel', leave);
    reduced.addEventListener('change', onMotionChange);
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resetGlass();
      app.removeEventListener('pointermove', disturb);
      app.removeEventListener('pointerdown', disturb);
      app.removeEventListener('pointerleave', leave);
      app.removeEventListener('pointerup', endTouch);
      app.removeEventListener('pointercancel', leave);
      reduced.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [water]);

  return <canvas ref={canvasRef} className="drift-water" aria-hidden="true" hidden={!water} />;
}