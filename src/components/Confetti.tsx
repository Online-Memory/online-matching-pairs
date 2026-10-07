"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#ffc93c", "#ff5d73", "#3d8bff", "#46c97a", "#b278ff", "#ff9f43", "#34d1d1", "#ffffff"];
const GRAVITY = 0.32; // per 60fps frame
const DRAG = 0.985;
const TERMINAL_VY = 5.5; // flutter down slowly, like paper

/** How long the end-of-game celebration (confetti and the headline) stays on screen. */
export const CELEBRATION_MS = 7000;

type Shape = "rect" | "ribbon" | "dot";
type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  shape: Shape;
  rotation: number;
  spin: number;
  flip: number;
  flipSpeed: number;
  age: number;
  life: number;
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)]!;

function piece(x: number, y: number, angle: number, speed: number): Piece {
  const shape = pick<Shape>(["rect", "rect", "ribbon", "dot"]);
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size: rand(7, 13),
    color: pick(COLORS),
    shape,
    rotation: rand(0, Math.PI * 2),
    spin: rand(-0.25, 0.25),
    flip: rand(0, Math.PI * 2),
    flipSpeed: rand(0.1, 0.35),
    age: 0,
    life: rand(150, 230),
  };
}

/** A cannon in a bottom corner firing up and towards the middle (angles: y grows downwards). */
function cannon(width: number, height: number, side: "left" | "right", count: number): Piece[] {
  return Array.from({ length: count }, () => {
    const lift = rand(0.7, 1.25); // radians above the horizontal
    const angle = side === "left" ? -lift : -Math.PI + lift;
    return piece(side === "left" ? 0 : width, height, angle, rand(14, 30));
  });
}

function rain(width: number, count: number): Piece[] {
  return Array.from({ length: count }, () => {
    const p = piece(rand(0, width), rand(-40, -10), Math.PI / 2, rand(1, 3));
    p.vx = rand(-1.2, 1.2);
    return p;
  });
}

/** Advance one piece by `dt` 60fps-frames: drag, gravity, spin. */
function stepPiece(p: Piece, dt: number) {
  p.vx *= Math.pow(DRAG, dt);
  p.vy = Math.min(p.vy * Math.pow(DRAG, dt) + GRAVITY * dt, TERMINAL_VY);
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.rotation += p.spin * dt;
  p.flip += p.flipSpeed * dt;
  p.age += dt;
}

function drawPiece(ctx: CanvasRenderingContext2D, p: Piece) {
  const fade = Math.min(1, (p.life - p.age) / 40);
  ctx.save();
  ctx.globalAlpha = Math.max(0, fade);
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.scale(1, Math.cos(p.flip)); // flutter
  ctx.fillStyle = p.color;
  if (p.shape === "dot") {
    ctx.beginPath();
    ctx.arc(0, 0, p.size / 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.shape === "ribbon") {
    ctx.fillRect(-p.size * 0.9, -p.size * 0.18, p.size * 1.8, p.size * 0.36);
  } else {
    ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
  }
  ctx.restore();
}

/**
 * Full-screen celebration: two confetti cannons, then a light shower. Each piece tumbles, flutters
 * (its width follows a cosine, as if turning over in the air), and fades out. Purely decorative.
 */
export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let width = 0;
    let height = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let pieces: Piece[] = [];
    const start = performance.now();
    let last = start;
    // Spawn schedule in ms since start.
    const schedule = [
      { at: 0, spawn: () => [...cannon(width, height, "left", 90), ...cannon(width, height, "right", 90)] },
      { at: 450, spawn: () => [...cannon(width, height, "left", 50), ...cannon(width, height, "right", 50)] },
      ...Array.from({ length: 12 }, (_, i) => ({ at: 800 + i * 150, spawn: () => rain(width, 8) })),
    ];
    let next = 0;
    let frame = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - last) / (1000 / 60), 3);
      last = now;
      const elapsed = now - start;

      while (next < schedule.length && schedule[next]!.at <= elapsed)
        pieces.push(...schedule[next++]!.spawn());

      ctx.clearRect(0, 0, width, height);
      for (const p of pieces) {
        stepPiece(p, dt);
        drawPiece(ctx, p);
      }
      pieces = pieces.filter((p) => p.age < p.life && p.y < height + 40);

      if (next < schedule.length || pieces.length > 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="confetti" aria-hidden data-testid="confetti" />;
}

type BurstProps = { x: number; y: number; count: number; delayMs?: number };

/**
 * A small radial pop of confetti at a point (viewport pixels) for a single match; `count` grows with
 * the streak tier. Starts after `delayMs` so it lands once the second tile has finished turning over.
 * Purely decorative; draws nothing under reduced motion.
 */
export function ConfettiBurst({ x, y, count, delayMs = 0 }: BurstProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let pieces: Piece[] = [];
    let last = 0;
    let frame = 0;

    const tick = (now: number) => {
      const dt = Math.min((now - last) / (1000 / 60), 3);
      last = now;
      ctx.clearRect(0, 0, width, height);
      for (const p of pieces) {
        stepPiece(p, dt);
        drawPiece(ctx, p);
      }
      pieces = pieces.filter((p) => p.age < p.life);
      if (pieces.length > 0) frame = requestAnimationFrame(tick);
    };

    const timer = setTimeout(() => {
      pieces = Array.from({ length: count }, () => {
        const p = piece(x, y, rand(0, Math.PI * 2), rand(5, 13));
        p.size = rand(5, 9);
        p.life = rand(35, 65);
        return p;
      });
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }, delayMs);

    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [x, y, count, delayMs]);

  return <canvas ref={canvasRef} className="confetti" aria-hidden data-testid="confetti-burst" />;
}
