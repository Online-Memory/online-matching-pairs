// Decorative drifting shapes behind the hero. Server-rendered, animated with CSS only.
const PARTICLES = [
  { x: 4, size: 14, delay: 0, dur: 14, tone: "signal", shape: "dot" },
  { x: 12, size: 22, delay: 3, dur: 18, tone: "sky", shape: "tile" },
  { x: 21, size: 10, delay: 7, dur: 12, tone: "cobalt", shape: "dot" },
  { x: 30, size: 18, delay: 1, dur: 16, tone: "signal", shape: "tile" },
  { x: 39, size: 12, delay: 9, dur: 13, tone: "sky", shape: "dot" },
  { x: 47, size: 24, delay: 5, dur: 20, tone: "cobalt", shape: "tile" },
  { x: 56, size: 10, delay: 2, dur: 11, tone: "signal", shape: "dot" },
  { x: 64, size: 16, delay: 8, dur: 15, tone: "sky", shape: "tile" },
  { x: 72, size: 13, delay: 4, dur: 14, tone: "cobalt", shape: "dot" },
  { x: 80, size: 20, delay: 10, dur: 19, tone: "signal", shape: "tile" },
  { x: 88, size: 11, delay: 6, dur: 12, tone: "sky", shape: "dot" },
  { x: 95, size: 17, delay: 2, dur: 17, tone: "cobalt", shape: "tile" },
] as const;

export function HeroParticles() {
  return (
    <div className="hero-particles" aria-hidden>
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="hero-particle"
          data-tone={p.tone}
          data-shape={p.shape}
          style={
            {
              "--x": `${p.x}%`,
              "--size": `${p.size}px`,
              "--delay": `${-p.delay}s`,
              "--dur": `${p.dur}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
