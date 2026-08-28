import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeQ, parentsClause, searchQuery, childrenQuery, indexFolders,
  isWithinTree, breadcrumb, matterForFile, sortChildren,
  FOLDER_MIME, MAX_SCOPED_FOLDERS,
} from './drive-paths.js';

/* A case: root → Medical Records → Northside Clinic, and root → Pleadings. */
const ROOT = 'rootA';
const TREE = [
  { id: 'med', name: 'Medical Records', parentId: ROOT },
  { id: 'clinic', name: 'Northside Clinic', parentId: 'med' },
  { id: 'plead', name: 'Pleadings', parentId: ROOT },
];
const byId = indexFolders(TREE);

/* ------------------------------------------------------------------ *
 * Escaping — a folder name is user text going into a query language
 * ------------------------------------------------------------------ */

test("a quote in a folder name does not escape the literal", () => {
  // Unescaped, this terminates the string and the rest becomes query syntax.
  assert.equal(escapeQ("O'Brien"), "O\\'Brien");
  assert.equal(escapeQ("O'Brien's Files"), "O\\'Brien\\'s Files");
});

test('backslash is escaped before the quote, not after', () => {
  // The other order double-escapes the backslash it just inserted.
  assert.equal(escapeQ('a\\b'), 'a\\\\b');
  assert.equal(escapeQ("a\\'b"), "a\\\\\\'b");
});

test('escaping handles absent values without throwing', () => {
  assert.equal(escapeQ(null), '');
  assert.equal(escapeQ(undefined), '');
});

test("a search term with a quote produces a usable query", () => {
  const q = searchQuery("O'Brien");
  assert.ok(q.includes("name contains 'O\\'Brien'"));
  assert.ok(q.includes('trashed = false'));
});

/* ------------------------------------------------------------------ *
 * Query construction
 * ------------------------------------------------------------------ */

test('a subtree is searched by naming every folder in it', () => {
  // Drive has no "search this subtree" operator; `in parents` is immediate
  // children only.
  const clause = parentsClause(['a', 'b']);
  assert.equal(clause, "('a' in parents or 'b' in parents)");
});

test('duplicate and empty folder ids are dropped', () => {
  assert.equal(parentsClause(['a', 'a', '', null, 'b']), "('a' in parents or 'b' in parents)");
  assert.equal(parentsClause([]), '');
});

test('search matches file CONTENTS, not just names', () => {
  // The whole reason live search beats the index it replaces.
  assert.ok(searchQuery('hipaa').includes("fullText contains 'hipaa'"));
});

test('a file search excludes folders, and a folder search excludes files', () => {
  assert.ok(searchQuery('x').includes(`mimeType != '${FOLDER_MIME}'`));
  assert.ok(searchQuery('x', { foldersOnly: true }).includes(`mimeType = '${FOLDER_MIME}'`));
});

test('too many folders drops the scope rather than building a huge query', () => {
  // Drive's `q` has a length ceiling. Past the cap the caller must search
  // unscoped and filter by ancestry instead -- silently truncating the folder
  // list would quietly stop searching part of the case.
  const many = Array.from({ length: MAX_SCOPED_FOLDERS + 1 }, (_, i) => `f${i}`);
  assert.ok(!searchQuery('x', { folderIds: many }).includes('in parents'));

  const few = ['f1', 'f2'];
  assert.ok(searchQuery('x', { folderIds: few }).includes('in parents'));
});

test('an empty search term still yields a valid listing query', () => {
  const q = searchQuery('');
  assert.ok(q.includes('trashed = false'));
  assert.ok(!q.includes('contains'));
});

test('childrenQuery escapes the folder id', () => {
  assert.equal(childrenQuery("ab'c"), "'ab\\'c' in parents and trashed = false");
});

/* ------------------------------------------------------------------ *
 * Ancestry — the browse endpoint's whole safety property
 * ------------------------------------------------------------------ */

test('the root itself is inside its own tree', () => {
  assert.ok(isWithinTree(ROOT, ROOT, byId));
});

test('a direct child and a grandchild are inside', () => {
  assert.ok(isWithinTree('med', ROOT, byId));
  assert.ok(isWithinTree('clinic', ROOT, byId), 'two levels down');
});

test("ANOTHER CASE'S FOLDER IS REFUSED", () => {
  // The test that matters. Without this, any signed-in user could list any
  // folder the service account can see by passing its id -- which means every
  // other case in the firm's Drive.
  const other = indexFolders([{ id: 'otherMed', name: 'Medical Records', parentId: 'rootB' }]);
  assert.equal(isWithinTree('otherMed', ROOT, other), false);
  assert.equal(isWithinTree('rootB', ROOT, byId), false);
});

test('an unknown folder id is refused, not assumed', () => {
  assert.equal(isWithinTree('never-seen', ROOT, byId), false);
  assert.equal(isWithinTree('', ROOT, byId), false);
  assert.equal(isWithinTree('med', '', byId), false);
});

test('a cycle in the data terminates instead of hanging', () => {
  // Drive should not produce one. "Should not" is not a termination condition.
  const cyclic = indexFolders([
    { id: 'x', name: 'X', parentId: 'y' },
    { id: 'y', name: 'Y', parentId: 'x' },
  ]);
  assert.equal(isWithinTree('x', ROOT, cyclic), false);
});

/* ------------------------------------------------------------------ *
 * Breadcrumbs
 * ------------------------------------------------------------------ */

test('the trail runs root-first and excludes the root', () => {
  // The caller renders the case name; including the root here would need it in
  // the map, and the map holds the root's descendants, not the root.
  assert.deepEqual(breadcrumb('clinic', ROOT, byId).map((c) => c.name),
    ['Medical Records', 'Northside Clinic']);
  assert.deepEqual(breadcrumb('med', ROOT, byId).map((c) => c.name), ['Medical Records']);
});

test('the root has an empty trail', () => {
  assert.deepEqual(breadcrumb(ROOT, ROOT, byId), []);
});

test('a folder outside the tree yields no trail at all', () => {
  // A caller rendering the trail must not display a path it has not verified.
  const other = indexFolders([{ id: 'stray', name: 'Stray', parentId: 'elsewhere' }]);
  assert.deepEqual(breadcrumb('stray', ROOT, other), []);
});

/* ------------------------------------------------------------------ *
 * Mapping a search hit back to a case
 * ------------------------------------------------------------------ */

const matterByFolder = new Map([[ROOT, 'matter-1'], ['rootB', 'matter-2']]);

test('a file sitting directly in a case folder resolves on the first hop', () => {
  assert.equal(matterForFile({ parents: [ROOT] }, byId, matterByFolder), 'matter-1');
});

test('a file two folders deep still resolves to its case', () => {
  assert.equal(matterForFile({ parents: ['clinic'] }, byId, matterByFolder), 'matter-1');
});

test('a file outside every case is unfiled, not guessed at', () => {
  assert.equal(matterForFile({ parents: ['elsewhere'] }, byId, matterByFolder), null);
  assert.equal(matterForFile({ parents: [] }, byId, matterByFolder), null);
  assert.equal(matterForFile({}, byId, matterByFolder), null);
});

/* ------------------------------------------------------------------ *
 * Ordering
 * ------------------------------------------------------------------ */

test('folders come before files, each sorted naturally', () => {
  const sorted = sortChildren([
    { name: 'zebra.pdf', mimeType: 'application/pdf' },
    { name: 'Pleadings', mimeType: FOLDER_MIME },
    { name: 'apple.pdf', mimeType: 'application/pdf' },
    { name: 'Medical Records', mimeType: FOLDER_MIME },
  ]).map((c) => c.name);
  assert.deepEqual(sorted, ['Medical Records', 'Pleadings', 'apple.pdf', 'zebra.pdf']);
});

test('numbered files sort 2 before 10, not lexically', () => {
  const sorted = sortChildren([
    { name: 'Exhibit 10.pdf', mimeType: 'application/pdf' },
    { name: 'Exhibit 2.pdf', mimeType: 'application/pdf' },
  ]).map((c) => c.name);
  assert.deepEqual(sorted, ['Exhibit 2.pdf', 'Exhibit 10.pdf']);
});
