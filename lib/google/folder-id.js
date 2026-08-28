/**
 * A Drive folder id out of whatever the user pasted.
 *
 * Same reasoning as private-key.js: demanding a precisely-formatted value when
 * the obvious copy-paste produces five other shapes is a support burden, not
 * robustness. Every one of these is something Drive's own UI hands you:
 *
 *   https://drive.google.com/drive/folders/1AbC...
 *   https://drive.google.com/drive/u/0/folders/1AbC...        signed into 2 accounts
 *   https://drive.google.com/drive/folders/1AbC...?usp=sharing   from "Copy link"
 *   https://drive.google.com/drive/u/0/folders/1AbC...?ths=true
 *   https://drive.google.com/open?id=1AbC...                  older share links
 *   1AbC...                                                    the bare id
 *
 * A Shared Drive's own root is also a valid target; its id starts `0A`.
 */

/**
 * Drive ids are URL-safe base64-ish and at least ~19 characters. Short strings
 * are rejected rather than passed through, because the failure they cause —
 * an empty listing — looks identical to a permissions problem and wastes an
 * hour pointing at the wrong thing.
 */
const ID = /^[A-Za-z0-9_-]{15,}$/;

export function extractFolderId(input) {
  const raw = String(input ?? '').trim().replace(/^["']|["']$/g, '');
  if (!raw) return '';

  // /folders/<id>, with or without a /u/N/ account segment, up to ? or /
  const inPath = raw.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (inPath) return inPath[1];

  // Older ?id= share links, and ?resourcekey is a different thing — ignore it.
  const inQuery = raw.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (inQuery) return inQuery[1];

  // A Shared Drive opened at its root: /drive/u/0/<driveId> with no /folders/.
  const sharedRoot = raw.match(/\/drive\/(?:u\/\d+\/)?([A-Za-z0-9_-]{15,})(?:[/?#]|$)/);
  if (sharedRoot && sharedRoot[1] !== 'folders') return sharedRoot[1];

  // Already a bare id.
  if (ID.test(raw)) return raw;

  return '';
}

/** True when the value looks like a Shared Drive rather than a normal folder. */
export function isSharedDriveId(id) {
  return /^0A/.test(String(id || ''));
}

/** Why an unusable value is unusable. Never guesses a fix that might be wrong. */
export function describeFolderIdProblem(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return 'GOOGLE_DRIVE_ROOT_FOLDER_ID is empty.';
  if (/my-drive|\/drive\/home|\/drive\/?$/.test(raw)) {
    return 'That is the Drive home page, not a folder. Open the folder that contains your ' +
      'per-case folders and copy the URL from there.';
  }
  if (/\/file\/d\//.test(raw)) {
    return 'That is a link to a file, not a folder.';
  }
  if (/^[A-Za-z0-9_-]{1,14}$/.test(raw)) {
    return `"${raw}" is too short to be a Drive id — they are around 33 characters.`;
  }
  return 'Could not find a folder id in that value. Open the folder in Drive and copy the ' +
    'whole URL from the address bar; the id is the part after /folders/.';
}
