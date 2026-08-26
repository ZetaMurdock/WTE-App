// Is someone typing into the character sheet right now?
//
// WHY THIS QUESTION IS ASKED AT ALL: an incoming sheet is applied by writing the
// row and remounting the open overlay. The sheet editor is state-first — it loads
// the record once, holds edits in memory, and writes them 400ms after the last
// keystroke — so a remount mid-sentence throws away the caret, the scroll
// position, the tab the reader was on, and the half-typed note that had not
// reached the debounce yet. Worse, the unmounting editor flushes that stale draft
// on its way out, straight over the record that had just arrived: a live Curator
// edit would land and then be silently undone by the player's own save.
//
// So a record that arrives for a sheet being typed into is HELD, not applied, and
// this is the test for "being typed into". Held records are reconciled a moment
// after the typing stops, against the agreement as it stood when they arrived, so
// the player's draft and the Curator's edit both survive as an ordinary merge.
const EDITABLE = /^(INPUT|TEXTAREA|SELECT)$/;

/** True when `active` is a field the reader is editing inside `container`.
 *  Buttons, links and the surrounding page do not count: clicking a tab or
 *  hovering the sheet is not work that a refresh can destroy. */
export function isEditingWithin(active: Element | null | undefined, containerSelector: string): boolean {
  if (!active) return false;
  const el = active as HTMLElement;
  const editable = EDITABLE.test(el.tagName) || el.isContentEditable === true;
  if (!editable) return false;
  // A disabled or read-only field cannot be mid-edit — the Curator's read-only
  // view of a player sheet must not be able to stall that sheet's sync.
  if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) return false;
  return typeof el.closest === "function" ? el.closest(containerSelector) !== null : false;
}
