import { useEffect, useRef } from "react";

// Custom dot cursor: a small accent dot with a trailing ring that replaces the
// native cursor. It reacts to what's under it — buttons/tabs grow it, danger
// controls turn it red, text inputs stretch it into a caret bar — and clicking
// pulses the ring. Direct DOM writes only (no React state per mousemove).
// Iframes keep their own native cursor (separate documents), so the dot hides
// while the pointer is over one.
export function CursorDot({ enabled }: { enabled: boolean }) {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.classList.toggle("wte-dot-cursor", enabled);
    if (!enabled) return;
    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    let rx = -100;
    let ry = -100;
    let tx = -100;
    let ty = -100;
    let raf = 0;

    const classify = (el: Element | null): string => {
      if (!el) return "";
      const danger = el.closest("[title*='Delete' i], [title*='Remove' i]");
      if (danger) return " danger";
      if (el.closest("input[type='text'], input[type='number'], input:not([type]), textarea, [contenteditable='true']")) return " text";
      if (el.closest("button, a, select, [role='button'], .tab, .chip, .vtt2-action, .profile-row")) return " hover";
      return "";
    };

    const onMove = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      dot.style.transform = `translate(${tx}px, ${ty}px)`;
      const overFrame = (e.target as Element | null)?.tagName === "IFRAME";
      const base = "cursor-dot" + classify(e.target as Element | null);
      dot.className = base + (overFrame ? " off" : "");
      ring.classList.toggle("off", overFrame);
    };
    const onDown = () => {
      ring.classList.remove("pulse");
      // restart the pulse animation
      void ring.offsetWidth;
      ring.classList.add("pulse");
    };
    const onLeave = () => {
      dot.classList.add("off");
      ring.classList.add("off");
    };
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // the ring trails the dot with a soft chase — DELTA-timed so the feel is
      // identical at 60Hz, 144Hz, or through frame drops (no more stutter-lurch)
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const k = 1 - Math.exp(-12 * dt);
      rx += (tx - rx) * k;
      ry += (ty - ry) * k;
      if (Math.abs(tx - rx) < 0.1) rx = tx;
      if (Math.abs(ty - ry) < 0.1) ry = ty;
      ring.style.transform = `translate(${rx}px, ${ry}px)`;
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.body.classList.remove("wte-dot-cursor");
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <>
      <div ref={dotRef} className="cursor-dot" />
      {/* the visible circle lives on an inner core so the click pulse scales
          IN PLACE — scaling the translated wrapper multiplied the screen
          position and made the ring lurch toward the corner on every click */}
      <div ref={ringRef} className="cursor-ring">
        <div className="cursor-ring-core" />
      </div>
    </>
  );
}
