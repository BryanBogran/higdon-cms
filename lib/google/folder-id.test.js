import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFolderId, isSharedDriveId, describeFolderIdProblem } from './folder-id.js';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456';

test('the plain folder URL', () => {
  assert.equal(extractFolderId(`https://drive.google.com/drive/folders/${ID}`), ID);
});

test('with a /u/N/ account segment — what you get with two accounts signed in', () => {
  assert.equal(extractFolderId(`https://drive.google.com/drive/u/0/folders/${ID}`), ID);
  assert.equal(extractFolderId(`https://drive.google.com/drive/u/3/folders/${ID}`), ID);
});

test('with the query string that "Copy link" adds', () => {
  assert.equal(extractFolderId(`https://drive.google.com/drive/folders/${ID}?usp=sharing`), ID);
  assert.equal(extractFolderId(`https://drive.google.com/drive/u/0/folders/${ID}?ths=true`), ID);
  assert.equal(extractFolderId(`https://drive.google.com/drive/folders/${ID}?usp=drive_link`), ID);
});

test('an older ?id= share link', () => {
  assert.equal(extractFolderId(`https://drive.google.com/open?id=${ID}`), ID);
});

test('a bare id passes through', () => {
  assert.equal(extractFolderId(ID), ID);
});

test('quotes and whitespace from a paste', () => {
  assert.equal(extractFolderId(`  "https://drive.google.com/drive/folders/${ID}"  `), ID);
});

test('a Shared Drive root is recognised', () => {
  const drive = '0ABcDeFgHiJkLmNoPqRsTuVwXyZ';
  assert.equal(extractFolderId(`https://drive.google.com/drive/u/0/folders/${drive}`), drive);
  assert.ok(isSharedDriveId(drive));
  assert.ok(!isSharedDriveId(ID));
});

test('something too short is rejected, not passed through', () => {
  // Passing it through produces an empty listing, which looks exactly like a
  // permissions problem and sends you looking in the wrong place for an hour.
  assert.equal(extractFolderId('abc123'), '');
  assert.match(describeFolderIdProblem('abc123'), /too short/);
});

test('the Drive home page is called out specifically', () => {
  assert.equal(extractFolderId('https://drive.google.com/drive/my-drive'), '');
  assert.match(describeFolderIdProblem('https://drive.google.com/drive/my-drive'), /home page/);
  assert.match(describeFolderIdProblem('https://drive.google.com/drive/u/0/my-drive'), /home page/);
});

test('a file link is not a folder link', () => {
  const url = `https://drive.google.com/file/d/${ID}/view`;
  assert.match(describeFolderIdProblem(url), /a file, not a folder/);
});

test('empty says empty', () => {
  assert.equal(extractFolderId(''), '');
  assert.equal(extractFolderId(null), '');
  assert.match(describeFolderIdProblem(''), /is empty/);
});
