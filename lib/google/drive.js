/**
 * Google Drive, server side only.
 *
 * ── Why no `googleapis` ───────────────────────────────────────────────────
 * `googleapis` is a very large dependency that carries every Google API there
 * is; we use five Drive endpoints. The auth flow it exists to hide is a signed
 * JWT exchanged for a bearer token — about forty lines with `node:crypto`, and
 * `google-auth-library` alone would still be more than that. Same call as
 * `mailparser` in lib/domain/email.js, for the same reason.
 *
 * ── Two things about service accounts that bite everyone once ─────────────
 *
 * 1. A SERVICE ACCOUNT HAS ZERO STORAGE QUOTA. It can read anything shared
 *    with it, and uploading a file it would own fails with
 *    `storageQuotaExceeded` even though its Drive is empty. There are exactly
 *    two ways round it: write into a Shared Drive, where the organisation owns
 *    the storage, or use domain-wide delegation to act as a real user.
 *
 *    The firm keeps case folders in ordinary My Drive folders and is not
 *    moving them, so this uses DELEGATION: the account impersonates a real
 *    user, and files land in the existing folders owned by the firm.
 *
 * 2. Shared Drives are invisible unless you ask. Every list call must send
 *    `supportsAllDrives` and `includeItemsFromAllDrives`, or a folder that
 *    lives on a Shared Drive silently returns nothing — no error, no hint.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────
 * `drive.readonly` is enough to index. Uploading needs `drive.file`, which
 * only ever sees files this app created — the least privilege that still
 * works. Neither grants access to anything not explicitly shared.
 */

import 'server-only';
import { createSign } from 'node:crypto';
import { normalizePrivateKey, validatePrivateKey } from './private-key';
import { extractFolderId, describeFolderIdProblem } from './folder-id';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

export function driveConfig() {
  return {
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    // A PEM key is multi-line text and an env var is a single line, so every
    // deployment tool mangles it differently. normalizePrivateKey handles the
    // five manglings people actually paste -- see lib/google/private-key.js.
    privateKey: normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY),
    impersonate: process.env.GOOGLE_IMPERSONATE_USER || '',
    // Accepts a pasted Drive URL as readily as a bare id. The whole URL is
    // what the address bar and "Copy link" both give you, so demanding the
    // fragment in the middle just invites a wrong value that fails as an
    // empty listing -- indistinguishable from a permissions problem.
    rootFolderId: extractFolderId(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID),
  };
}

export function isDriveConfigured() {
  const c = driveConfig();
  return Boolean(c.clientEmail && c.privateKey && c.rootFolderId);
}

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Cached until shortly before expiry — a token exchange per request is waste. */
let cached = { token: '', expiresAt: 0 };

export async function getAccessToken({ now = Date.now() } = {}) {
  if (cached.token && cached.expiresAt > now + 60_000) return { ok: true, token: cached.token };

  const { clientEmail, privateKey, impersonate } = driveConfig();
  if (!clientEmail || !privateKey) {
    return { ok: false, error: 'Google Drive is not configured.' };
  }

  const iat = Math.floor(now / 1000);
  const claims = {
    iss: clientEmail,
    scope: SCOPES.join(' '),
    aud: TOKEN_URL,
    iat,
    exp: iat + 3600,
    // `sub` is what turns this into domain-wide delegation: the token acts as
    // this user. Without it the token is the service account itself, which
    // owns no storage and can see only what is shared with it directly.
    ...(impersonate ? { sub: impersonate } : {}),
  };

  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;

  // Validated rather than signed-and-hoped: OpenSSL's decode failure is
  // `error:1E08010C:DECODER routines::unsupported`, which tells nobody
  // anything. validatePrivateKey names the likely cause instead.
  const checked = validatePrivateKey(privateKey);
  if (!checked.ok) {
    return { ok: false, error: `GOOGLE_PRIVATE_KEY: ${checked.error}` };
  }

  let signature;
  try {
    signature = createSign('RSA-SHA256').update(unsigned).sign(checked.keyObject);
  } catch (err) {
    return { ok: false, error: `Could not sign the token: ${err.message}` };
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    // These errors are famously opaque, so the two common causes are named.
    const hint =
      body.error === 'unauthorized_client'
        ? ' — domain-wide delegation is probably not authorised for this client id and scope in the Admin console.'
        : body.error === 'invalid_grant'
          ? ' — the impersonated user may not exist, or the clock may be skewed.'
          : '';
    return { ok: false, error: `${body.error || res.status}: ${body.error_description || ''}${hint}` };
  }

  cached = { token: body.access_token, expiresAt: now + (body.expires_in || 3600) * 1000 };
  return { ok: true, token: cached.token };
}

async function api(path, { method = 'GET', params = {}, token } = {}) {
  const url = new URL(`${API}${path}`);
  // Non-negotiable on every call, or Shared Drive content is silently absent.
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('includeItemsFromAllDrives', 'true');
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));

  const res = await fetch(url, { method, headers: { authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: body?.error?.message || `Drive returned ${res.status}`, status: res.status };
  }
  return { ok: true, body };
}

/** A single-quote inside a name would otherwise break the query syntax. */
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** Immediate child folders of `parentId` — one per case, in this firm's Drive. */
export async function listChildFolders(parentId, { token } = {}) {
  const auth = token ? { ok: true, token } : await getAccessToken();
  if (!auth.ok) return auth;

  const folders = [];
  let pageToken;
  do {
    const r = await api('/files', {
      token: auth.token,
      params: {
        q: `'${q(parentId)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'nextPageToken, files(id, name, createdTime, modifiedTime)',
        pageSize: 1000,
        pageToken,
      },
    });
    if (!r.ok) return r;
    folders.push(...(r.body.files || []));
    pageToken = r.body.nextPageToken;
  } while (pageToken);

  return { ok: true, folders };
}

/**
 * Every file under a folder, walking sub-folders.
 *
 * `maxFiles` is a real stop, not a suggestion: a mis-pointed root folder could
 * otherwise walk the firm's entire Drive. The caller is told when it trips
 * rather than being handed a quietly truncated list.
 */
export async function listFilesRecursive(folderId, { token, maxFiles = 5000, maxDepth = 8 } = {}) {
  const auth = token ? { ok: true, token } : await getAccessToken();
  if (!auth.ok) return auth;

  const files = [];
  const queue = [{ id: folderId, path: '', depth: 0 }];
  let truncated = false;

  while (queue.length) {
    const { id, path, depth } = queue.shift();
    let pageToken;
    do {
      const r = await api('/files', {
        token: auth.token,
        params: {
          q: `'${q(id)}' in parents and trashed = false`,
          fields:
            'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, webViewLink)',
          pageSize: 1000,
          pageToken,
        },
      });
      if (!r.ok) return r;

      for (const f of r.body.files || []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          if (depth < maxDepth) queue.push({ id: f.id, path: path ? `${path}/${f.name}` : f.name, depth: depth + 1 });
          continue;
        }
        if (files.length >= maxFiles) { truncated = true; break; }
        files.push({ ...f, folderPath: path });
      }
      pageToken = truncated ? null : r.body.nextPageToken;
    } while (pageToken);

    if (truncated) break;
  }

  return { ok: true, files, truncated };
}

/**
 * Upload bytes into a Drive folder.
 *
 * Multipart rather than resumable: these are email attachments and scanned
 * records, and resumable upload only earns its extra round-trip on files large
 * enough to be worth restarting.
 */
export async function uploadFile({ folderId, name, mimeType, bytes, token }) {
  const auth = token ? { ok: true, token } : await getAccessToken();
  if (!auth.ok) return auth;

  const boundary = `hlcms${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name, parents: [folderId] });

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const url = new URL(`${UPLOAD_API}/files`);
  url.searchParams.set('uploadType', 'multipart');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', 'id, name, mimeType, size, webViewLink, createdTime, modifiedTime');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${auth.token}`,
      'content-type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = out?.error?.message || `Drive returned ${res.status}`;
    // The single most common failure, and the message alone does not explain it.
    const hint = /storage quota/i.test(msg)
      ? ' — a service account owns no storage. Set GOOGLE_IMPERSONATE_USER so uploads are owned by a real user, or write into a Shared Drive.'
      : '';
    return { ok: false, error: msg + hint };
  }
  return { ok: true, file: out };
}

/** Create a case folder. Used only for matters that have no folder yet. */
export async function createFolder({ parentId, name, token }) {
  const auth = token ? { ok: true, token } : await getAccessToken();
  if (!auth.ok) return auth;

  const url = new URL(`${API}/files`);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', 'id, name, webViewLink');

  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${auth.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: out?.error?.message || `Drive returned ${res.status}` };
  return { ok: true, folder: out };
}

/**
 * Work out WHY a listing came back empty.
 *
 * Drive does not distinguish "this folder does not exist" from "you may not
 * see it" — both return 404, deliberately, so an outsider cannot probe for the
 * existence of a folder by id. And a folder you cannot see lists as empty
 * rather than forbidden. So an empty result has three quite different causes
 * and no way to tell them apart from the listing alone:
 *
 *   1. Nothing at all is shared with this account   -> the share step was missed
 *   2. Things are shared, but not this folder id    -> wrong id, or wrong folder shared
 *   3. The folder is visible but holds no subfolders -> pointed at a case folder,
 *                                                       not the parent
 *
 * This asks three questions whose answers separate them.
 */
export async function diagnoseDrive() {
  const { rootFolderId, impersonate, clientEmail } = driveConfig();
  const auth = await getAccessToken();
  if (!auth.ok) return { ok: false, stage: 'token', error: auth.error };

  const out = {
    ok: true,
    actingAs: impersonate || `${clientEmail} (the service account itself)`,
    impersonating: Boolean(impersonate),
    rootFolderId,
  };

  // No usable id at all: say so before making three API calls that cannot
  // possibly answer the question.
  if (!rootFolderId) {
    out.rootVisible = false;
    out.diagnosis = describeFolderIdProblem(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
    return out;
  }

  // Q1: can this account see ANYTHING in Drive?
  const anything = await api('/files', {
    token: auth.token,
    params: { pageSize: 5, fields: 'files(id, name, mimeType)', q: 'trashed = false' },
  });
  out.canSeeAnything = anything.ok ? (anything.body.files || []).length > 0 : false;
  out.visibleSample = anything.ok
    ? (anything.body.files || []).map((f) => f.name).slice(0, 5)
    : [];

  // Q2: is the configured root visible, and is it actually a folder?
  const root = await api(`/files/${encodeURIComponent(rootFolderId)}`, {
    token: auth.token,
    params: { fields: 'id, name, mimeType, driveId' },
  });
  out.rootVisible = root.ok;
  out.rootName = root.ok ? root.body.name : null;
  out.rootIsFolder = root.ok ? root.body.mimeType === 'application/vnd.google-apps.folder' : null;
  out.rootOnSharedDrive = root.ok ? Boolean(root.body.driveId) : null;

  // Q3: if visible, what is directly inside it — anything, not just folders?
  if (root.ok) {
    const kids = await api('/files', {
      token: auth.token,
      params: {
        q: `'${q(rootFolderId)}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType)',
        pageSize: 10,
      },
    });
    const files = kids.ok ? kids.body.files || [] : [];
    out.childCount = files.length;
    out.childFolders = files.filter((f) => f.mimeType === 'application/vnd.google-apps.folder').length;
    out.childSample = files.map((f) => f.name).slice(0, 5);
  }

  out.diagnosis = explainEmptyDrive(out);
  return out;
}

/** One sentence naming the cause and the fix. */
export function explainEmptyDrive(d) {
  if (!d.canSeeAnything && !d.rootVisible) {
    return `Nothing in Drive is shared with this account. Open the folder that CONTAINS your per-case folders in Drive, click Share, and add ${d.actingAs} as a Viewer. That single share is the whole grant.`;
  }
  if (!d.rootVisible) {
    return `This account can see other things in Drive, but not the folder id in GOOGLE_DRIVE_ROOT_FOLDER_ID. Either the id is wrong, or a different folder was shared. The id is the last part of the folder's URL: drive.google.com/drive/folders/THIS-PART.`;
  }
  if (d.rootIsFolder === false) {
    return `GOOGLE_DRIVE_ROOT_FOLDER_ID points at "${d.rootName}", which is a file, not a folder.`;
  }
  if (d.childCount === 0) {
    return `The folder "${d.rootName}" is visible but completely empty.`;
  }
  if (d.childFolders === 0) {
    return `"${d.rootName}" contains ${d.childCount} item(s) but no sub-folders — this looks like a single case folder rather than the folder that contains them all. Point GOOGLE_DRIVE_ROOT_FOLDER_ID one level up.`;
  }
  return `"${d.rootName}" has ${d.childFolders} sub-folder(s) and should be matching. If the dry run still reports zero, that is a bug worth reporting.`;
}

/** Test-only: the token cache is module state and would leak between tests. */
export function __resetTokenCache() {
  cached = { token: '', expiresAt: 0 };
}
