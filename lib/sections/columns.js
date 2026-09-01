/**
 * How much room a column needs.
 *
 * ── The bug this fixes ────────────────────────────────────────────────────
 *
 * Every cell had the same `min-w-[130px]`. A table laid out `auto` shares
 * width by content, so the greedy columns — the two textareas — took what they
 * wanted and every name column collapsed to that 130px floor. On the Medicals
 * table that rendered "Aguilar, Karen" as "Aguilar, Karer" and the provider
 * name as "Memo", with the clipped half hidden under the next input.
 *
 * A truncated client name in a legal file is not a cosmetic problem. Two
 * providers called "Memorial Hermann Southwest" and "Memorial Hermann
 * Northwest" are indistinguishable at "Memo".
 *
 * ── Why minimums rather than fixed widths ─────────────────────────────────
 *
 * A minimum lets a wide screen give a column MORE and stops a narrow one
 * taking less. The table already scrolls horizontally, so the honest failure
 * on a small screen is a scrollbar — not a name with its end cut off, which
 * looks like the data is wrong rather than the window being small.
 *
 * The contact and text figures account for the icon: `.input` with `pl-8`
 * spends 32px before the first character, so 190px of column is about 150px
 * of readable name.
 */
export const COLUMN_MIN_WIDTH = {
  contact: 220,      // "Memorial Hermann Southwest", plus the person icon
  text: 170,
  textarea: 220,
  select: 170,       // the widest option decides, and several are sentences
  date: 155,         // mm/dd/yyyy plus the native picker button
  datedone: 190,     // a date and its completion stamp, side by side
  money: 120,        // "$ 125,000.00"
  calculated: 120,
  yesnounknown: 165, // three buttons in a row
  yesnoDoc: 165,
  url: 190,
  driveFile: 200,    // a filename, or the whole drop target when empty
  attachments: 200,
  // Wrapping pills. Given room it lays out two or three per line instead of
  // one, which is the difference between a readable cell and a tall column of
  // single words.
  multiselect: 260,
};

/** Anything not listed. Wide enough for a short value, narrow enough to fit. */
export const DEFAULT_MIN_WIDTH = 150;

export function columnMinWidth(type) {
  return COLUMN_MIN_WIDTH[type] ?? DEFAULT_MIN_WIDTH;
}
