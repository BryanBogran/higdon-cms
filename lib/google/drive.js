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
    // Env vars cannot hold real newlines, so the key is stored with literal
    // \n and restored here. Forgetting this produces a signature error that
    // says nothing about newlines.
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    impersonate: process.env.GOOGLE_IMPERSONATE_USER || '',
    rootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '',
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

  let signature;
  try {
    signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey);
  } catch (err) {
    return { ok: false, error: `Could not sign the token — check GOOGLE_PRIVATE_KEY: ${err.message}` };
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

/** Test-only: the token cache is module state and would leak between tests. */
export function __resetTokenCache() {
  cached = { token: '', expiresAt: 0 };
}
