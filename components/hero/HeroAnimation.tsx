'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/* ═══════════════════════════════════════════════════════════════════ */
/*  Phases (slower — time to read)                                      */
/*                                                                       */
/*  0: Logo — big → shrink (2.5s)                                       */
/*  1: Problem 1 (5s)                                                   */
/*  2: Answer 1 (5.5s)                                                  */
/*  3: Problem 2 (5s)                                                   */
/*  4: Answer 2 (5s)                                                    */
/*  → loops to 0                                                        */
/*                                                                       */
/*  Visual language: the canvas stays near-black at all times — the      */
/*  accent appears as a soft warm glow (never a full-screen orange),    */
/*  so the cycle reads without eye strain. Answer lines pop in           */
/*  vermillion; problem lines stay muted.                                */
/* ═══════════════════════════════════════════════════════════════════ */

const PHASE_DURATIONS = [2500, 5000, 5500, 5000, 5000];
const TOTAL_CYCLE = PHASE_DURATIONS.reduce((a, b) => a + b, 0);

const CONTENT: Record<number, { top: string; bottom: string } | null> = {
  0: null,
  1: { top: "You built something beautiful.", bottom: "Now it's an email attachment." },
  2: { top: "With LiveFolio you publish it.", bottom: "One MCP call. One link. Live." },
  3: { top: "You built a live dashboard.", bottom: "Nobody can see it behind a login." },
  4: { top: "With LiveFolio it's public.", bottom: "Versioned. Analytics built in." },
};

/** Problem phases get a stronger warm glow; answers a faint one. */
function glowFor(phase: number): string {
  const strong = phase === 1 || phase === 3;
  const alpha = strong ? 0.16 : 0.07;
  return `radial-gradient(62% 55% at 50% 48%, rgba(255,59,0,${alpha}), transparent 72%)`;
}

/* ── Light sweep overlay (clipped to the glyphs) ─────────────────── */

function ShineOverlay({ text }: { text: string }) {
  return (
    <span
      aria-hidden
      className="absolute inset-0 z-20 pointer-events-none animate-lf-shine"
      style={{
        backgroundImage:
          'linear-gradient(100deg, transparent 0%, rgba(255,255,255,0.65) 50%, transparent 100%)',
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
      }}
    >
      {text}
    </span>
  );
}

/* ── Fade-in line ────────────────────────────────────────────────── */

function FadeInLine({ text, show, className, shine }: { text: string; show: boolean; className: string; shine?: boolean }) {
  return (
    <div
      className={className}
      style={{
        opacity: show ? 1 : 0,
        transform: `translateY(${show ? 0 : 14}px)`,
        transition: 'opacity 600ms cubic-bezier(0.16, 1, 0.3, 1), transform 600ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {shine ? (
        <span className="relative inline-block">
          <span className="relative z-10">{text}</span>
          <ShineOverlay text={text} />
        </span>
      ) : (
        text
      )}
    </div>
  );
}

/* ── Typing line ─────────────────────────────────────────────────── */

function TypingLine({
  text,
  typing,
  className,
  style,
  shine,
}: {
  text: string;
  typing: boolean;
  className: string;
  style?: React.CSSProperties;
  /** Moving light sweep across the finished line (first letter → last). */
  shine?: boolean;
}) {
  const [chars, setChars] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!typing) { setChars(0); return; }

    let i = 0;
    setChars(0);
    intervalRef.current = setInterval(() => {
      i++;
      setChars(i);
      if (i >= text.length && intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }, 70); // slower typing — easier to read

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [typing, text]);

  if (!typing && chars === 0) return null;

  const isTyping = typing && chars < text.length;
  const done = chars === text.length;

  // Finished line with the shine sweep: a white gradient clipped to the
  // glyphs animates across — light appears to travel letter by letter.
  if (shine && done) {
    return (
      <div className={className} style={style}>
        <span className="relative inline-block">
          <span className="relative z-10">{text}</span>
          <span
            aria-hidden
            className="absolute inset-0 z-20 pointer-events-none animate-lf-shine"
            style={{
              backgroundImage:
                'linear-gradient(100deg, transparent 0%, rgba(255,255,255,0.65) 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {text}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className={className} style={style}>
      {text.slice(0, chars)}
      {isTyping ? (
        <span
          className="inline-block animate-pulse rounded-sm align-baseline"
          style={{ width: 3, height: '0.55em', background: 'currentColor', marginLeft: '0.15em' }}
        />
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  Main Component                                                     */
/* ═══════════════════════════════════════════════════════════════════ */

export default function HeroAnimation() {
  const [mounted, setMounted] = useState(false);
  const [cycleTime, setCycleTime] = useState(0);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  // Respect reduced-motion: show one static frame, no animation loop.
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  const tick = useCallback(() => {
    setCycleTime((Date.now() - startRef.current) % TOTAL_CYCLE);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    setMounted(true);
    startRef.current = Date.now();
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  // Current phase + elapsed within it
  let phase = 0;
  let phaseElapsed = cycleTime;
  for (let i = 0; i < PHASE_DURATIONS.length; i++) {
    if (phaseElapsed < PHASE_DURATIONS[i]) { phase = i; break; }
    phaseElapsed -= PHASE_DURATIONS[i];
  }

  if (reducedMotion) phase = 2; // static "answer" frame

  const content = CONTENT[phase];

  // Timing: top fades in at 500ms, bottom types at 1200ms.
  const showTop = phaseElapsed > 500;
  const typingBottom = phaseElapsed > 1200;

  // Logo: starts big, shrinks. Buffer 200ms to avoid overlap with previous phase.
  const logoDelay = phase === 0 ? Math.max(0, phaseElapsed - 200) : 0;
  const logoProgress = phase === 0 ? Math.min(1, logoDelay / 1300) : 0;
  const logoScale = phase === 0 ? 3 - logoProgress * 2.5 : 1;
  const logoVisible = phase === 0 && logoDelay > 0;

  if (!mounted) {
    return (
      <div className="w-full h-full bg-[#0F0F0D] flex items-center justify-center">
        <div
          className="w-12 h-12 sm:w-16 sm:h-16 bg-[#FF3B00] rounded-md"
          style={{ boxShadow: '0 0 40px rgba(255,59,0,0.45), 0 0 120px rgba(255,59,0,0.2)' }}
        />
      </div>
    );
  }

  const isAnswer = phase === 2 || phase === 4;

  return (
    <div
      className="relative w-full h-full flex items-center justify-center overflow-hidden bg-[#0F0F0D]"
      style={{ backgroundImage: glowFor(phase), transition: 'background-image 700ms ease' }}
    >
      {/* Shine keyframes — light sweep across the answer line */}
      <style>{`
        @keyframes lf-shine {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .animate-lf-shine { animation: lf-shine 2.6s linear infinite; }
      `}</style>

      {/* Grain */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E")` }} />

      {/* Logo phase */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ opacity: logoVisible ? 1 : 0, transition: 'opacity 200ms' }}>
        <div
          className="bg-[#FF3B00] w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-md"
          style={{
            transform: `scale(${logoScale})`,
            transition: 'transform 1.3s cubic-bezier(0.16, 1, 0.3, 1)',
            boxShadow: '0 0 40px rgba(255,59,0,0.45), 0 0 120px rgba(255,59,0,0.2)',
          }}
        />
      </div>

      {/* Content phases — crossfades on phase change. The frame is
          centered in the space ABOVE the CTA bar, so the text sits
          optically centered between the hero top and the buttons. */}
      {content && (
        <div
          key={phase}
          className="flex items-center justify-center w-full h-full z-10 pointer-events-none"
        >
        <div className="grid grid-rows-[0.35fr_auto_1.25fr] items-center justify-items-center gap-3 sm:gap-4 px-6 sm:px-10 md:px-16 w-full h-[calc(100%-10rem)] sm:h-[calc(100%-12rem)] md:h-[calc(100%-14rem)] animate-in fade-in duration-500">
          <div />
          {/* Big poster type — answers in vermillion with the light sweep */}
          <div className="text-center text-[clamp(2.75rem,9vw,4.5rem)] sm:text-[clamp(3rem,8vw,5.5rem)] md:text-[clamp(3.5rem,8vw,6.5rem)]">
            <FadeInLine
              text={content.top}
              show={showTop}
              className={isAnswer ? 'font-black tracking-tighter leading-[1.02] text-[#FF3B00]' : 'font-black tracking-tighter leading-[1.02] text-[#F4F4F0]'}
              shine={isAnswer && !reducedMotion}
            />
          </div>
          {/* Sub-line — answers pop, problems stay muted */}
          <div className="text-center self-start text-[clamp(1.35rem,4.2vw,2.4rem)] sm:text-[clamp(1.5rem,4vw,2.8rem)] md:text-[clamp(1.6rem,4vw,3rem)] pt-2 sm:pt-4">
            <TypingLine
              text={content.bottom}
              typing={typingBottom}
              className={isAnswer ? 'font-semibold tracking-tight text-[#FF3B00]' : 'font-medium tracking-tight text-[#F4F4F0]/60'}
            />
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
