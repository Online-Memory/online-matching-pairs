"use client";

import { useState } from "react";

// 0 = starts face down. Every tile gets a picture so a face-down one can be flipped up by clicking.
const HERO_FACES = [3, 17, 0, 9, 0, 17, 26, 0, 41, 0, 3, 33];
const PICTURES = [3, 17, 9, 26, 41, 33];

function pictureFor(face: number, i: number) {
  return face || PICTURES[(i * 5 + 2) % PICTURES.length];
}

/** The decorative hero board: hover glows, click flips a tile and sends out a ripple. */
export function HeroBoard() {
  const [flipped, setFlipped] = useState(() => HERO_FACES.map((face) => face !== 0));
  const [ripple, setRipple] = useState<{ tile: number; n: number } | null>(null);

  function toggle(i: number) {
    setFlipped((current) => current.map((f, j) => (j === i ? !f : f)));
    setRipple((r) => ({ tile: i, n: (r?.n ?? 0) + 1 }));
  }

  return (
    // Mouse-only toy: the buttons skip the tab order so 12 stops don't sit in front of the forms.
    <div className="hero-board" aria-hidden>
      {HERO_FACES.map((face, i) => (
        <button
          key={i}
          type="button"
          tabIndex={-1}
          className="hero-tile"
          data-flipped={flipped[i]}
          data-intro={face ? "" : undefined}
          style={{ "--i": i } as React.CSSProperties}
          onClick={() => toggle(i)}
        >
          <span className="tile-inner">
            <span className="tile-back" />
            {/* eslint-disable-next-line @next/next/no-img-element -- decorative static image */}
            <img className="tile-face" src={`/hero/${pictureFor(face, i)}.webp`} alt="" />
          </span>
          {ripple?.tile === i && <span key={ripple.n} className="hero-ripple" />}
        </button>
      ))}
    </div>
  );
}
