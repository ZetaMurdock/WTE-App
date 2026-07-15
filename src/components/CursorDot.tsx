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
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // the ring trails the dot with a soft chase
      rx += (tx - rx) * 0.18;
      ry += (ty - ry) * 0.18;
      ring.style.transform = `translate(${rx}px, ${ry}px)`;
    };
    tick();
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
      <div ref={ringRef} className="cursor-ring" />
    </>
  );
}
