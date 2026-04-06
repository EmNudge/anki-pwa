import { z } from "zod";

const SYNC_CONFIG_KEY = "anki-sync-config";
const SYNC_STATE_KEY = "anki-sync-state";

export interface SyncConfig {
  serverUrl: string;
  username: string;
}

interface SyncState {
  hkey: string | null;
  lastSync: number | null;
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

export function writeSyncConfig(config: SyncConfig | null) {
  if (config) {
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
  } else {
    localStorage.removeItem(SYNC_CONFIG_KEY);
  }
}

export function readSyncState(): SyncState {
  const stored = localStorage.getItem(SYNC_STATE_KEY);
  if (!stored) return { hkey: null, lastSync: null };
  try {
    return JSON.parse(stored);
  } catch {
    return { hkey: null, lastSync: null };
  }
}

export function writeSyncState(state: SyncState) {
  localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
}

export function clearSyncState() {
  localStorage.removeItem(SYNC_STATE_KEY);
}

function normalizeUrl(serverUrl: string): string {
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

/**
 * Post to an unauthenticated sync endpoint (e.g. hostKey).
 */
async function syncPost(url: string, data: unknown = {}): Promise<Response> {
  const form = buildSyncForm(data);
  return fetch(url, { method: "POST", body: form });
}

/**
 * Post to an authenticated sync endpoint with the host key.
 */
async function syncPostAuth(
  url: string,
  hkey: string,
  data: unknown = {},
): Promise<Response> {
  const form = buildSyncForm(data, hkey);
  return fetch(url, { method: "POST", body: form });
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

  const response = await syncPost(`${base}/sync/hostKey`, {
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
): Promise<Uint8Array> {
  const base = normalizeUrl(serverUrl);

  const response = await syncPostAuth(`${base}/sync/download`, hkey);

  if (response.status === 401 || response.status === 403) {
    throw new Error("Authentication expired. Please log in again.");
  }

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());

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
    const changesResponse = await syncPostAuth(`${base}/msync/mediaChanges`, hkey, {
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

      const dlResponse = await syncPostAuth(`${base}/msync/downloadFiles`, hkey, {
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
        new BlobReader(new Blob([decompressed.buffer as ArrayBuffer])),
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

async function readResponseJson(response: Response): Promise<unknown> {
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

async function decompressIfNeeded(bytes: Uint8Array): Promise<Uint8Array> {
  // Gzip: 0x1f 0x8b
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new DecompressionStream("gzip");
    const decompressed = new Response(
      new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(ds),
    );
    return new Uint8Array(await decompressed.arrayBuffer());
  }

  // Zstandard: 0x28 0xB5 0x2F 0xFD
  if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) {
    const { decompressZstd } = await import("../utils/zstd");
    return decompressZstd(bytes);
  }

  return bytes;
}
