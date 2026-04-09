import { z } from "zod";
import { isZstdCompressed } from "~/utils/constants";
import { getLocalMediaEntries } from "~/utils/mediaCache";

const SYNC_CONFIG_KEY = "anki-sync-config";
const SYNC_STATE_KEY = "anki-sync-state";

export interface SyncConfig {
  serverUrl: string;
  username: string;
}

export interface SyncState {
  hkey: string | null;
  lastSync: number | null;
  usn: number | null;
  scm: number | null;
}

export function readSyncConfig(): SyncConfig | null {
  const stored = localStorage.getItem(SYNC_CONFIG_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

export function writeSyncConfig(config: SyncConfig | null): void {
  if (config) {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
  } else {
    localStorage.removeItem(SYNC_CONFIG_KEY);
  }
}

export function readSyncState(): SyncState {
  const stored = localStorage.getItem(SYNC_STATE_KEY);
  if (!stored) return { hkey: null, lastSync: null, usn: null, scm: null };
  try {
    const parsed = JSON.parse(stored);
    return { hkey: null, lastSync: null, usn: null, scm: null, ...parsed };
  } catch {
    return { hkey: null, lastSync: null, usn: null, scm: null };
  }
}

export function writeSyncState(state: SyncState): void {
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
}

export function clearSyncState(): void {
  localStorage.removeItem(SYNC_STATE_KEY);
}

export function normalizeUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

/**
 * Build a legacy multipart sync form.
 * - "data": JSON-encoded payload
 * - "c": compression flag ("0" = none, "1" = gzip)
 * - Authenticated endpoints also get "k" (host key) as a separate top-level field.
 * - "v": client version string (media sync endpoints)
 */
function buildSyncForm(
  data: unknown,
  hkey?: string,
  extra?: Record<string, string>,
): FormData {
  const form = new FormData();
  if (hkey) {
    form.append("k", hkey);
  }
  form.append("data", JSON.stringify(data));
  form.append("c", "0");
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      form.append(key, value);
    }
  }
  return form;
}

/** Generate a random session key for sync session tracking. */
export function generateSessionKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/**
 * Post to a sync endpoint using legacy multipart transport (v8–v10).
 * The optional sessionKey ("s") is required for stateful sync endpoints.
 */
export async function syncPost(
  url: string,
  hkey?: string,
  data: unknown = {},
  sessionKey?: string,
): Promise<Response> {
  const extra: Record<string, string> | undefined = sessionKey ? { s: sessionKey } : undefined;
  const form = buildSyncForm(data, hkey, extra);
  return fetch(url, { method: "POST", body: form });
}

/**
 * Post to a sync endpoint using v11 transport:
 * - Auth via Authorization header
 * - Body is zstd-compressed JSON
 * - Content-Type: application/octet-stream
 * The optional sessionKey is sent in the anki-sync header for stateful endpoints.
 */
export async function syncPostV11(
  url: string,
  hkey: string,
  data: unknown = {},
  sessionKey?: string,
): Promise<Response> {
  const { compressZstd } = await import("../utils/zstd");
  const json = new TextEncoder().encode(JSON.stringify(data));
  const compressed = await compressZstd(json);

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${hkey}`,
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "zstd",
  };
  if (sessionKey) {
    headers["anki-sync-session"] = sessionKey;
  }

  return fetch(url, {
    method: "POST",
    headers,
    body: compressed.buffer as ArrayBuffer,
  });
}

/**
 * Authenticate with an Anki sync server and obtain a host key (hkey).
 */
export async function login(
  serverUrl: string,
  username: string,
  password: string,
): Promise<string> {
  const base = normalizeUrl(serverUrl);

  const response = await syncPost(`${base}/sync/hostKey`, undefined, {
    u: username,
    p: password,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Invalid username or password");
    }
    throw new Error(`Login failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  if (body.key) return body.key;
  throw new Error("Login response missing host key");
}

/**
 * Download the full collection database from the sync server.
 * Returns the raw SQLite database bytes (decompressed).
 */
export async function downloadCollection(
  serverUrl: string,
  hkey: string,
  onProgress?: (status: string) => void,
): Promise<Uint8Array> {
  const base = normalizeUrl(serverUrl);

  const response = await syncPost(`${base}/sync/download`, hkey);

  if (response.status === 401 || response.status === 403) {
    throw new Error("Authentication expired. Please log in again.");
  }

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const bytes = await readResponseBytes(response, onProgress ? (received) => {
    const mb = (received / (1024 * 1024)).toFixed(1);
    onProgress(`Downloading collection... (${mb} MB)`);
  } : undefined);

  return decompressIfNeeded(bytes);
}

const DOWNLOAD_BATCH_SIZE = 25;

const mediaSyncBeginSchema = z.object({
  usn: z.number(),
});

const mediaChangeSchema = z.tuple([
  z.string(),
  z.number(),
  z.string().nullable(),
]);

const mediaChangesSchema = z.array(mediaChangeSchema);

const mediaMetaSchema = z.record(z.string(), z.string());

/**
 * Download media files from the sync server.
 * Returns a map of filename -> Blob.
 */
export async function downloadMedia(
  serverUrl: string,
  hkey: string,
  onProgress?: (status: string) => void,
): Promise<Map<string, Blob>> {
  const base = normalizeUrl(serverUrl);
  const mediaFiles = new Map<string, Blob>();

  // Begin media sync — "v" must be a top-level multipart field
  const beginForm = buildSyncForm({}, hkey, { v: "anki-pwa,0.1,web" });
  const beginResponse = await fetch(`${base}/msync/begin`, {
    method: "POST",
    body: beginForm,
  });

  if (!beginResponse.ok) {
    const body = await beginResponse.text().catch(() => "(unreadable)");
    throw new Error(`msync/begin failed: ${beginResponse.status} ${beginResponse.statusText} — ${body}`);
  }

  const beginJson = await readResponseJson(beginResponse);
  const { usn: serverUsn } = mediaSyncBeginSchema.parse(beginJson);
  if (serverUsn === 0) return mediaFiles;

  // Fetch media changes in batches
  let lastUsn = 0;

  while (lastUsn < serverUsn) {
    const changesResponse = await syncPost(`${base}/msync/mediaChanges`, hkey, {
      lastUsn,
    });

    if (!changesResponse.ok) {
      const body = await changesResponse.text().catch(() => "(unreadable)");
      throw new Error(`msync/mediaChanges failed: ${changesResponse.status} ${changesResponse.statusText} — ${body}`);
    }

    const changesJson = await readResponseJson(changesResponse);
    const changes = mediaChangesSchema.parse(changesJson);
    if (changes.length === 0) break;

    // Files with non-null sha1 need downloading
    const filesToDownload = changes
      .filter(([, , sha1]) => sha1 !== null)
      .map(([filename]) => filename);

    // Download in batches — server may return fewer files than requested
    // (zip size limit), so advance by actual count received, like the
    // official client does.
    let dlOffset = 0;
    while (dlOffset < filesToDownload.length) {
      const batch = filesToDownload.slice(dlOffset, dlOffset + DOWNLOAD_BATCH_SIZE);

      const dlResponse = await syncPost(`${base}/msync/downloadFiles`, hkey, {
        files: batch,
      });

      if (!dlResponse.ok) {
        const body = await dlResponse.text().catch(() => "(unreadable)");
        throw new Error(`msync/downloadFiles failed: ${dlResponse.status} ${dlResponse.statusText} — ${body}`);
      }

      const zipBlob = await dlResponse.blob();
      const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
      const decompressed = await decompressIfNeeded(zipBytes);

      const { ZipReader, BlobReader, BlobWriter, TextWriter } = await import("@zip-js/zip-js");
      const zipReader = new ZipReader(
        new BlobReader(new Blob([decompressed as BlobPart])),
      );
      const entries = await zipReader.getEntries();

      // Read _meta entry to get index-to-filename mapping
      type EntryWithGetData = {
        getData: (w: InstanceType<typeof BlobWriter> | InstanceType<typeof TextWriter>) => Promise<Blob | string>;
      };
      const metaEntry = entries.find((e) => e.filename === "_meta");
      if (!metaEntry || !("getData" in metaEntry)) {
        throw new Error("msync/downloadFiles ZIP missing _meta entry");
      }
      const metaText = await (metaEntry as EntryWithGetData).getData(new TextWriter());
      const meta = mediaMetaSchema.parse(JSON.parse(metaText as string));

      let received = 0;
      for (const entry of entries) {
        if (entry.directory || entry.filename === "_meta" || !("getData" in entry)) continue;
        const filename = meta[entry.filename];
        if (filename) {
          const blob = await (entry as EntryWithGetData).getData(new BlobWriter());
          mediaFiles.set(filename, blob as Blob);
          received++;
        }
      }

      await zipReader.close();
      onProgress?.(`Downloading media files... (${mediaFiles.size} downloaded)`);

      if (received === 0) {
        // Server returned no files — skip this batch to avoid infinite loop
        dlOffset += batch.length;
      } else {
        // Advance by actual files received (server may have hit zip size limit)
        dlOffset += received;
      }
    }

    const lastChange = changes[changes.length - 1];
    if (lastChange) {
      lastUsn = lastChange[1];
    } else {
      break;
    }
  }

  return mediaFiles;
}

const UPLOAD_BATCH_SIZE = 25;

/**
 * Upload locally-cached media files to the sync server.
 *
 * Follows Anki's media sync protocol:
 * 1. begin — start a media sync session, get server USN
 * 2. mediaChanges — discover what the server already has
 * 3. uploadChanges — send files the server is missing, in ZIP batches
 * 4. mediaSanity — verify local/remote counts match
 */
export async function uploadMedia(
  serverUrl: string,
  hkey: string,
  onProgress?: (status: string) => void,
): Promise<number> {
  const base = normalizeUrl(serverUrl);

  // Open the media cache
  const cache = await caches.open("anki-cache");
  const localMedia = await getLocalMediaEntries(cache);
  if (localMedia.size === 0) return 0;

  // Step 1: Begin media sync
  const beginForm = buildSyncForm({}, hkey, { v: "anki-pwa,0.1,web" });
  const beginResponse = await fetch(`${base}/msync/begin`, {
    method: "POST",
    body: beginForm,
  });
  if (!beginResponse.ok) {
    const body = await beginResponse.text().catch(() => "(unreadable)");
    throw new Error(`msync/begin failed: ${beginResponse.status} ${beginResponse.statusText} — ${body}`);
  }
  const beginJson = await readResponseJson(beginResponse);
  const { usn: serverUsn } = mediaSyncBeginSchema.parse(beginJson);

  // Step 2: Collect server's known files to find what needs uploading
  const serverFiles = new Set<string>();
  let lastUsn = 0;
  const scanLimit = Math.max(serverUsn, 1);

  while (lastUsn < scanLimit) {
    const changesResponse = await syncPost(`${base}/msync/mediaChanges`, hkey, {
      lastUsn,
    });
    if (!changesResponse.ok) break;
    const changesJson = await readResponseJson(changesResponse);
    const changes = mediaChangesSchema.parse(changesJson);
    if (changes.length === 0) break;
    for (const [filename, , sha1] of changes) {
      if (sha1 !== null) {
        serverFiles.add(filename);
      }
      // sha1 === null means deleted on server — we should upload if we have it
    }
    const lastChange = changes[changes.length - 1];
    if (lastChange) {
      lastUsn = lastChange[1];
    } else {
      break;
    }
  }

  // Determine files to upload (local files not on server)
  const filesToUpload: Array<[string, Blob]> = [];
  for (const [filename, blob] of localMedia) {
    if (!serverFiles.has(filename)) {
      filesToUpload.push([filename, blob]);
    }
  }

  if (filesToUpload.length === 0) return 0;

  // Step 3: Upload in batches as ZIP files
  let uploaded = 0;
  const { ZipWriter, BlobWriter, BlobReader } = await import("@zip-js/zip-js");

  for (let i = 0; i < filesToUpload.length; i += UPLOAD_BATCH_SIZE) {
    const batch = filesToUpload.slice(i, i + UPLOAD_BATCH_SIZE);

    // Build ZIP with numeric keys and a _meta mapping
    // Upload _meta format: array of [actual_filename, filename_in_zip] tuples
    const zipBlobWriter = new BlobWriter("application/zip");
    const zipWriter = new ZipWriter(zipBlobWriter);
    const meta: Array<[string, string]> = [];

    for (let j = 0; j < batch.length; j++) {
      const entry = batch[j]!;
      const zipKey = String(j);
      meta.push([entry[0], zipKey]);
      await zipWriter.add(zipKey, new BlobReader(entry[1]));
    }

    // Add _meta entry
    const metaBlob = new Blob([JSON.stringify(meta)], { type: "application/json" });
    await zipWriter.add("_meta", new BlobReader(metaBlob));
    const zipBlob = await zipWriter.close();

    // POST the ZIP to /msync/uploadChanges
    const form = new FormData();
    form.append("k", hkey);
    form.append("data", zipBlob, "media.zip");

    const uploadResponse = await fetch(`${base}/msync/uploadChanges`, {
      method: "POST",
      body: form,
    });

    if (!uploadResponse.ok) {
      const body = await uploadResponse.text().catch(() => "(unreadable)");
      throw new Error(`msync/uploadChanges failed: ${uploadResponse.status} ${uploadResponse.statusText} — ${body}`);
    }

    const r = await readResponseJson(uploadResponse);
    // Response is a tuple [processed, current_usn] (Serialize_tuple format)
    if (Array.isArray(r)) {
      uploaded += (r[0] as number) ?? batch.length;
    } else {
      const obj = r as { processed?: number; current_usn?: number };
      uploaded += obj.processed ?? batch.length;
    }
    onProgress?.(`Uploading media files... (${uploaded} of ${filesToUpload.length})`);
  }

  // Step 4: Media sanity check
  const localCount = localMedia.size;
  const sanityResponse = await syncPost(`${base}/msync/mediaSanity`, hkey, {
    local: localCount,
  });
  if (sanityResponse.ok) {
    const s = await readResponseJson(sanityResponse) as { status?: string };
    if (s.status === "bad") {
      console.warn("Media sanity check failed: local and server media counts differ");
    }
  }

  return uploaded;
}

/** Maximum uncompressed payload size accepted by AnkiWeb (300 MB). */
const MAX_SYNC_PAYLOAD_BYTES = 300 * 1024 * 1024;

/**
 * Upload a full collection database to the sync server, replacing the server's copy.
 * This is equivalent to Anki's "Upload to AnkiWeb" (force one-way push).
 */
export async function uploadCollection(
  serverUrl: string,
  hkey: string,
  sqliteBytes: Uint8Array,
): Promise<void> {
  if (sqliteBytes.byteLength > MAX_SYNC_PAYLOAD_BYTES) {
    const sizeMB = Math.round(sqliteBytes.byteLength / (1024 * 1024));
    throw new Error(
      `Collection is too large to upload (${sizeMB} MB). Maximum is ${MAX_SYNC_PAYLOAD_BYTES / (1024 * 1024)} MB.`,
    );
  }

  const base = normalizeUrl(serverUrl);

  const form = new FormData();
  form.append("k", hkey);
  form.append("data", new Blob([sqliteBytes as BlobPart]), "collection.anki2");
  form.append("c", "0");

  const response = await fetch(`${base}/sync/upload`, {
    method: "POST",
    body: form,
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Authentication expired. Please log in again.");
  }

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.text();
  if (body.trim() !== "OK") {
    throw new Error(`Upload rejected by server: ${body}`);
  }
}

export async function readResponseJson(response: Response): Promise<unknown> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const decompressed = await decompressIfNeeded(bytes);
  const text = new TextDecoder().decode(decompressed);
  const parsed = JSON.parse(text);
  // Unwrap {data: ...} envelope used by some server implementations
  if (parsed && typeof parsed === "object" && "data" in parsed && parsed.data != null) {
    return parsed.data;
  }
  return parsed;
}

/**
 * Read a response body into a Uint8Array, optionally reporting bytes received.
 */
async function readResponseBytes(
  response: Response,
  onBytesReceived?: (received: number) => void,
): Promise<Uint8Array> {
  if (!onBytesReceived || !response.body) {
    const blob = await response.blob();
    return new Uint8Array(await blob.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onBytesReceived(received);
  }

  const result = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function decompressIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  // Gzip: 0x1f 0x8b
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new DecompressionStream("gzip");
    const decompressed = new Response(
      new Blob([bytes as BlobPart]).stream().pipeThrough(ds),
    );
    return new Uint8Array(await decompressed.arrayBuffer());
  }

  if (isZstdCompressed(bytes)) {
    const { decompressZstd } = await import("../utils/zstd");
    return decompressZstd(bytes);
  }

  return bytes;
}
