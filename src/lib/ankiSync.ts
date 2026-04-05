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
 */
function buildSyncForm(
  data: Record<string, unknown>,
  hkey?: string,
): FormData {
  const form = new FormData();
  if (hkey) {
    form.append("k", hkey);
  }
  form.append("data", JSON.stringify(data));
  form.append("c", "0");
  return form;
}

/**
 * Post to an unauthenticated sync endpoint (e.g. hostKey).
 */
async function syncPost(url: string, data: Record<string, unknown>): Promise<Response> {
  const form = buildSyncForm(data);
  return fetch(url, { method: "POST", body: form });
}

/**
 * Post to an authenticated sync endpoint with the host key.
 */
async function syncPostAuth(
  url: string,
  hkey: string,
  data: Record<string, unknown> = {},
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

  // Begin media sync
  const beginResponse = await syncPostAuth(`${base}/msync/begin`, hkey);

  if (!beginResponse.ok) {
    return mediaFiles;
  }

  const beginData = await tryParseResponse(beginResponse);
  if (!beginData?.data) return mediaFiles;

  const serverUsn = (beginData.data.usn as number) ?? 0;
  if (serverUsn === 0) return mediaFiles;

  // Fetch media changes in batches
  let lastUsn = 0;

  while (lastUsn < serverUsn) {
    const changesResponse = await syncPostAuth(`${base}/msync/mediaChanges`, hkey, {
      last_usn: lastUsn,
    });

    if (!changesResponse.ok) break;

    const changesData = await tryParseResponse(changesResponse);
    if (!changesData?.data) break;

    const changes = (changesData.data.changes ?? []) as [string, number, string | null][];
    if (changes.length === 0) break;

    // Files with non-null sha1 need downloading
    const filesToDownload = changes
      .filter(([, , sha1]) => sha1 !== null)
      .map(([filename]) => filename);

    if (filesToDownload.length > 0) {
      const dlResponse = await syncPostAuth(`${base}/msync/downloadFiles`, hkey, {
        files: filesToDownload,
      });

      if (dlResponse.ok) {
        const zipBlob = await dlResponse.blob();
        const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
        const decompressed = await decompressIfNeeded(zipBytes);

        try {
          const { ZipReader, BlobReader, BlobWriter } = await import("@zip-js/zip-js");
          const zipReader = new ZipReader(
            new BlobReader(new Blob([decompressed.buffer as ArrayBuffer])),
          );
          const entries = await zipReader.getEntries();

          for (const entry of entries) {
            if (entry.directory || !("getData" in entry)) continue;
            const idx = parseInt(entry.filename, 10);
            const filename = filesToDownload[idx];
            if (filename) {
              const blob = await (
                entry as {
                  getData: (w: InstanceType<typeof BlobWriter>) => Promise<Blob>;
                }
              ).getData(new BlobWriter());
              mediaFiles.set(filename, blob);
            }
          }

          await zipReader.close();
        } catch {
          // ZIP parsing failed — skip media for this batch
        }
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

async function tryParseResponse(
  response: Response,
): Promise<{ data?: Record<string, unknown>; err?: string } | null> {
  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const decompressed = await decompressIfNeeded(bytes);
    const text = new TextDecoder().decode(decompressed);
    const parsed = JSON.parse(text);
    if (parsed.err) return null;
    return parsed;
  } catch {
    return null;
  }
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
