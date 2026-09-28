'use client';

/**
 * A date box that does not save a half-typed year.
 *
 * Browser date inputs report every keystroke as a finished date: typing 2026
 * sends 0002, 0020, 0202, then 2026. Wired straight to a save, the first three
 * went to the database -- rejected by its range checks where there were any,
 * and STORED where there were not (an intake date of 0202-12-24, found on a
 * real case). See `isCompleteDate` in lib/domain/dates.js.
 *
 * So the box keeps what is being typed locally and only calls `onChange` once
 * the value is complete, or cleared. If somebody leaves it half-typed, it goes
 * back to the last saved value rather than keeping a year that was never sent.
 *
 * Every date box that saves as you type should use this. The ones that save
 * on a button press (a new task, a contact's date of birth) do not need it.
 */

import { useEffect, useRef, useState } from 'react';
import { isCompleteDate } from '@/lib/domain/dates';

export default function DateInput({ value, onChange, onBlur, onFocus, ...rest }) {
  const saved = value || '';
  const [draft, setDraft] = useState(saved);
  const focused = useRef(false);

  // Follow the saved value -- a colleague's change, a "Today" button -- but
  // never while somebody is mid-way through typing into this box.
  useEffect(() => {
    if (!focused.current) setDraft(saved);
  }, [saved]);

  return (
    <input
      {...rest}
      type="date"
      value={draft}
      onFocus={(e) => { focused.current = true; onFocus?.(e); }}
      onBlur={(e) => {
        focused.current = false;
        // Left half-typed: show what is actually saved, not a year nobody sent.
        if (!isCompleteDate(draft)) setDraft(saved);
        onBlur?.(e);
      }}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (isCompleteDate(next) && next !== saved) onChange(next);
      }}
    />
  );
}
