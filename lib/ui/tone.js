/**
 * Urgency level -> badge classes.
 *
 * This table existed twice, byte for byte, in app/tasks/page.jsx and
 * components/sections/DeadlineChainSection.jsx -- along with the badge's own
 * padding and type classes. Two copies of a colour table is how a deadline
 * ends up amber on one screen and red on another.
 *
 * The LEVELS themselves are not defined here. `urgency()` in lib/domain/dates.js
 * owns that decision, including the rule that a missing date is `unknown` and
 * never `ok`. This module only says what each level looks like.
 */

/**
 * Every level `urgency()` can return. Values are semantic tokens, so these
 * follow the theme -- see the @theme block in app/globals.css.
 */
export const URGENCY_STYLE = {
  overdue: 'bg-danger-bg text-danger-ink border-danger-line',
  critical: 'bg-alert-bg text-alert-ink border-alert-line',
  warning: 'bg-warn-bg text-warn-ink border-warn-line',
  ok: 'bg-canvas text-ink-2 border-line',
  unknown: 'bg-raised text-ink-3 border-line-strong',
};

const BADGE_SHAPE = 'px-2 py-0.5 rounded text-[11px] font-semibold border';

/**
 * The complete className for a due-date badge.
 *
 * Falls back to `unknown` rather than returning an unstyled badge: an
 * unrecognised level means we do not know how urgent something is, which is
 * exactly what `unknown` communicates.
 */
export function urgencyBadgeClass(level) {
  return `${BADGE_SHAPE} ${URGENCY_STYLE[level] || URGENCY_STYLE.unknown}`;
}
