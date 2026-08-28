/**
 * Drive query construction and folder-tree reasoning.
 *
 * Pure, and separate from drive.js so it can be unit tested — drive.js imports
 * `server-only`, which throws outside a server bundle. Everything here is
 * string and map manipulation over data the caller has already fetched.
 *
 * Two things in this file are security-relevant rather than cosmetic:
 * `escapeQ`, because a folder name is user-controlled text going into a query
 * language, and `isWithinTree`, because the browse endpoint's whole safety
 * property rests on it.
 */

/** A folder is a file with this mimeType. Drive has no separate folder type. */
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Escape a value for a single-quoted Drive `q` literal.
 *
 * Backslash first, then quote — the other order double-escapes the backslash
 * it just inserted. A client called `O'Brien` is not an edge case, and an
 * unescaped quote does not error politely: it terminates the literal and the
 * rest of the name becomes query syntax.
 */
export function escapeQ(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * `('a' in parents or 'b' in parents)` for a set of folder ids.
 *
 * Drive has no "search this subtree" operator — `in parents` is immediate
 * children only — so a subtree search means naming every folder in it. That is
 * affordable because folders are few even when files are many, which is the
 * observation the whole design leans on.
 */
export function parentsClause(folderIds = []) {
  const ids = [...new Set(folderIds.filter(Boolean))];
  if (!ids.length) return '';
  return `(${ids.map((id) => `'${escapeQ(id)}' in parents`).join(' or ')})`;
}

/**
 * Drive's `q` has a practical length ceiling, and a firm-wide subtree can have
 * hundreds of folders. Past this many, the caller should search unscoped and
 * filter by ancestry afterwards instead.
 */
export const MAX_SCOPED_FOLDERS = 80;

/**
 * Build a search query.
 *
 * `fullText` is the reason live search beats the index this replaces: Drive
 * matches text INSIDE PDFs and Docs, which a table of filenames cannot.
 */
export function searchQuery(term, { folderIds = null, foldersOnly = false } = {}) {
  const needle = escapeQ(String(term || '').trim());
  const parts = ['trashed = false'];

  if (needle) parts.push(`(name contains '${needle}' or fullText contains '${needle}')`);
  if (foldersOnly) parts.push(`mimeType = '${FOLDER_MIME}'`);
  else parts.push(`mimeType != '${FOLDER_MIME}'`);

  if (folderIds && folderIds.length && folderIds.length <= MAX_SCOPED_FOLDERS) {
    const clause = parentsClause(folderIds);
    if (clause) parts.push(clause);
  }

  return parts.join(' and ');
}

/** Children of one folder, files and folders alike. */
export function childrenQuery(folderId) {
  return `'${escapeQ(folderId)}' in parents and trashed = false`;
}

/* ------------------------------------------------------------------ *
 * Folder trees
 * ------------------------------------------------------------------ */

/**
 * Index a flat list of folders by id, for ancestry walks.
 *
 * `folders` is `[{ id, name, parentId }]` — the shape drive.js returns.
 */
export function indexFolders(folders = []) {
  return new Map(folders.map((f) => [f.id, f]));
}

/**
 * Is `folderId` the root, or somewhere beneath it?
 *
 * THE BROWSE ENDPOINT'S ENTIRE SAFETY PROPERTY. Without it, any signed-in user
 * could list any folder the service account can see by passing its id — which
 * today means every other case in the firm's Drive.
 *
 * Walks parents rather than trusting a precomputed set, so a folder created
 * since the tree was built still resolves. `maxHops` stops a cycle in
 * malformed data from spinning: Drive should not produce one, and "should not"
 * is not a termination condition.
 */
export function isWithinTree(folderId, rootId, byId, { maxHops = 20 } = {}) {
  if (!folderId || !rootId) return false;
  if (folderId === rootId) return true;

  let current = byId.get(folderId);
  for (let hop = 0; hop < maxHops && current; hop++) {
    if (current.id === rootId) return true;
    if (!current.parentId) return false;
    if (current.parentId === rootId) return true;
    current = byId.get(current.parentId);
  }
  return false;
}

/**
 * The folders between the root and `folderId`, inclusive of the folder itself.
 *
 * The ROOT IS NOT INCLUDED, deliberately. The caller already knows what the
 * root is called — it is the case name — and looking it up here would need the
 * root in `byId`, which it is not: the tree contains the root's descendants,
 * not the root. The UI renders the case name and then this.
 *
 * Returns `[]` for the root itself, and `[]` when the folder is not under the
 * root at all — so a caller rendering the trail cannot display a path it has
 * not verified.
 */
export function breadcrumb(folderId, rootId, byId, { maxHops = 20 } = {}) {
  if (!folderId || folderId === rootId) return [];

  const trail = [];
  let current = byId.get(folderId);

  for (let hop = 0; hop < maxHops && current; hop++) {
    trail.unshift({ id: current.id, name: current.name });
    if (current.parentId === rootId) return trail;
    if (!current.parentId) return [];      // reached the top without the root
    current = byId.get(current.parentId);
  }

  return [];                                // unreachable, cyclic, or too deep
}

/**
 * Which matter does a search hit belong to?
 *
 * Walks the file's parents up until an id matches a case folder. A file sitting
 * directly in a case folder resolves on the first hop, which is the common case.
 *
 * `null` when the chain reaches the top without matching — a file loose in the
 * parent folder, outside any case. Reported as unfiled rather than guessed at.
 */
export function matterForFile(file, byId, matterIdByFolderId, { maxHops = 10 } = {}) {
  const first = (file?.parents || [])[0];
  if (!first) return null;

  let id = first;
  for (let hop = 0; hop < maxHops && id; hop++) {
    if (matterIdByFolderId.has(id)) return matterIdByFolderId.get(id);
    const node = byId.get(id);
    if (!node) return null;
    id = node.parentId;
  }
  return null;
}

/**
 * Folders first, then files, each alphabetically.
 *
 * Matches how Drive itself, and every file manager, orders a directory. Sorting
 * by name alone interleaves them and makes a folder easy to miss.
 */
export function sortChildren(children = []) {
  return [...children].sort((a, b) => {
    const aFolder = a.mimeType === FOLDER_MIME;
    const bFolder = b.mimeType === FOLDER_MIME;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true });
  });
}
