'use client';

/**
 * One row of a wide section table, as a card to read -- Filevine's "item view".
 *
 * The row's two main fields make the header (provider · amount), then only the
 * fields that HAVE a value, as quiet label/value pairs in as many columns as
 * the screen allows. A card is for reading; clicking it opens the editor.
 *
 * This replaced a table row nineteen input boxes wide. The point is not the
 * boxes being smaller -- it is that most of them were empty, and a wall of
 * empty boxes is what "cluttered" looks like. See lib/sections/layout.js.
 */

import { Paperclip, ChevronRight } from 'lucide-react';
import { DocButtons } from '../GenerateDoc';
import { displayValue, previewFields } from '@/lib/sections/layout';

export default function ItemCard({ collection, layout, row, matterId, docTemplates = [], onOpen }) {
  const byKey = new Map(collection.columns.map((c) => [c.key, c]));
  const text = (key) => (key ? displayValue(byKey.get(key), row[key], row) : '');

  const title = text(layout.left);
  const right = text(layout.right);
  const status = text(layout.status);
  const { shown, empty } = previewFields(collection, row);

  const open = () => onOpen(row.id);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      aria-label={`Open ${title || 'this entry'}`}
      className="group cursor-pointer rounded-xl border border-line bg-surface px-4 py-3 shadow-sm transition hover:border-accent-line hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-solid"
    >
      {/*
        Wraps rather than squeezes. On a phone the amount and the document
        buttons took the whole row and the provider's name -- the one thing
        the card is FOR -- truncated to nothing. The name keeps a minimum
        width; everything else moves down a line when there is no room.
      */}
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-[11rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`truncate font-semibold ${title ? 'text-ink' : 'text-ink-4'}`}>
              {title || 'Unnamed'}
            </h3>
            {status ? (
              <span className="whitespace-nowrap rounded-full border border-line bg-raised px-2 py-0.5 text-[11px] font-medium text-ink-2">
                {status}
              </span>
            ) : null}
          </div>
        </div>

        {right ? (
          <div className="shrink-0 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-4">
              {byKey.get(layout.right)?.label}
            </p>
            <p className="font-semibold tabular-nums text-ink">{right}</p>
          </div>
        ) : null}

        {/*
          The row's documents. Clicks stop here: the card itself opens the
          editor, and a Med Req click that also opened a drawer would be two
          things at once. GenerateDoc's own dialog sits inside this wrapper,
          so it is covered too.
        */}
        {docTemplates.length ? (
          <div
            className="flex shrink-0 flex-wrap items-center gap-1"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <DocButtons matterId={matterId} templates={docTemplates} row={row} />
          </div>
        ) : null}

        <ChevronRight size={16} className="mt-1 hidden shrink-0 text-ink-4 sm:block transition group-hover:translate-x-0.5 group-hover:text-accent-ink" />
      </header>

      {shown.length ? (
        <dl
          className="mt-3 grid gap-x-6 gap-y-2.5 border-t border-line-soft pt-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
        >
          {shown.map((f) => (
            <div key={f.key} className={f.long ? 'col-span-full' : 'min-w-0'}>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-4">{f.label}</dt>
              <dd className={`text-sm text-ink-2 ${f.long ? 'line-clamp-2 whitespace-pre-line' : 'truncate'}`} title={f.text}>
                {f.files.length ? (
                  <span className="flex flex-wrap gap-1.5">
                    {f.files.map((file, i) => (
                      <a
                        key={`${i}-${file.id || file.name}`}
                        href={file.url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex max-w-full items-center gap-1 rounded border border-line bg-canvas px-1.5 py-0.5 text-xs text-accent-ink hover:underline"
                      >
                        <Paperclip size={11} className="shrink-0" />
                        <span className="truncate">{file.name || 'file'}</span>
                      </a>
                    ))}
                  </span>
                ) : f.text}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-xs text-ink-4">No details yet — click to fill in.</p>
      )}

      {shown.length && empty ? (
        <p className="mt-2 text-[11px] text-ink-4">
          {empty} {empty === 1 ? 'field' : 'fields'} empty
        </p>
      ) : null}
    </article>
  );
}
