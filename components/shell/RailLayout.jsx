/**
 * The left rail is a SLOT, not a fixed component.
 *
 * Filevine fills it differently per view: due-date buckets on Tasks, kind
 * filters with counts on Feed, a faceted filter panel on Documents, the section
 * list on a matter. The shell owns the position; the view owns the contents.
 */

export default function RailLayout({ title, count, rail, children, wide = false }) {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] bg-slate-50">
      {rail ? (
        <aside className="w-60 shrink-0 border-r border-slate-200 bg-white hidden lg:flex lg:flex-col">
          {title ? (
            <div className="px-5 pt-5 pb-3">
              <h1 className="text-xl font-bold text-slate-900">{title}</h1>
              {count !== undefined && count !== null ? (
                <p className="text-sm text-slate-500 mt-0.5">{count} items</p>
              ) : null}
            </div>
          ) : null}
          <div className="flex-1 overflow-y-auto pb-6">{rail}</div>
        </aside>
      ) : null}

      <main className="flex-1 min-w-0">
        <div className={wide ? 'p-4 sm:p-6' : 'p-4 sm:p-6 max-w-6xl'}>{children}</div>
      </main>
    </div>
  );
}

/** A rail row. Used by every view's rail so they stay visually identical. */
export function RailItem({ icon: Icon, label, count, active, onClick, href }) {
  const cls = `w-full flex items-center gap-2.5 px-5 py-2 text-sm transition text-left ${
    active ? 'bg-teal-50 text-teal-800 font-semibold' : 'text-slate-700 hover:bg-slate-50'
  }`;
  const inner = (
    <>
      {Icon ? <Icon size={17} className={active ? 'text-teal-700' : 'text-slate-400'} /> : null}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count !== null ? (
        <span className="text-xs text-slate-400 tabular-nums">{count > 99 ? '99+' : count}</span>
      ) : null}
    </>
  );
  if (href) {
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
