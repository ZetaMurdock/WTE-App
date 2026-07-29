// "Open the full Codex page" — from anywhere, to the right section.
//
// The sheet, the VTT and the contextual card all need to send someone to a Codex
// page, and none of them owns the Codex tab. A window event keeps that one-way:
// the caller says where to go, App switches tabs, and the browser navigates. No
// component needs a reference to any other.
//
// The anchor matters more than it looks. The official corpus groups every
// ability in a domain onto one page, so a stem alone lands you at the top of a
// very long file with no indication of which of twenty abilities you asked about.
export const OPEN_CODEX_PAGE = "wte-open-codex-page";

export interface OpenCodexPageDetail {
  stem: string;
  /** A section within the page. Matched by text, because the exported wiki HTML
   *  carries no id attributes to use as fragments. */
  anchor?: string;
}

export function openCodexPage(stem: string, anchor?: string): void {
  if (!stem || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenCodexPageDetail>(OPEN_CODEX_PAGE, { detail: { stem, anchor } }));
}

export function onOpenCodexPage(fn: (detail: OpenCodexPageDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent<OpenCodexPageDetail>).detail;
    if (detail?.stem) fn(detail);
  };
  window.addEventListener(OPEN_CODEX_PAGE, handler);
  return () => window.removeEventListener(OPEN_CODEX_PAGE, handler);
}
