'use client';

/**
 * The old combined Litigation tab.
 *
 * Retired from the rail: the firm's real section list has no Litigation tab,
 * and its thirteen items now render inside Pleading, Discovery, Depositions,
 * Negotiations and Medicals instead.
 *
 * Kept because the section is `hidden`, not deleted — /matters/{id}/litigation
 * still resolves, and this shows all thirteen in one place for anyone who wants
 * the old view. Nothing writes here that the new sections cannot see: they are
 * the same `matter_checklist_item` rows, keyed by field_key.
 */

import ChecklistItems from './ChecklistItems';
import { FIELDS } from '@/lib/domain/fields';

const SECTIONS_WITH_ITEMS = [
  ...new Set(FIELDS.filter((f) => f.type === 'yesnoDoc').map((f) => f.section)),
];

export default function LitigationSection({ matterId, matter }) {
  return (
    <div>
      <p className="mb-4 rounded border border-line bg-canvas px-4 py-2.5 text-sm text-ink-2">
        This combined view is retired. These items now live in their own
        sections — {SECTIONS_WITH_ITEMS.join(', ')} — and are the same records
        wherever you edit them.
      </p>
      {SECTIONS_WITH_ITEMS.map((label) => (
        <ChecklistItems
          key={label}
          matterId={matterId}
          matter={matter}
          sectionLabel={label}
          title={label}
        />
      ))}
    </div>
  );
}
