/**
 * Shared utilities for working with media files in the Cache API.
 * Used by both stores.ts (cache restoration) and ankiSync.ts (upload).
 */

const MEDIA_PATH_PREFIX = "/sync/media/";

/** Filter cache keys that belong to synced media entries. */
export function filterMediaKeys(allKeys: readonly Request[]): Request[] {
  return allKeys.filter((req) => new URL(req.url).pathname.startsWith(MEDIA_PATH_PREFIX));
}

/** Extract the filename from a media cache key. */
export function mediaKeyToFilename(req: Request): string {
  // decodeURIComponent is needed because the Cache API URL-encodes pathnames
  // (e.g., spaces → %20, unicode → %XX), but card HTML references raw filenames.
  return decodeURIComponent(new URL(req.url).pathname.slice(MEDIA_PATH_PREFIX.length));
}

/** Build a cache key path for a media filename. */
export function mediaCachePath(filename: string): string {
  return `${MEDIA_PATH_PREFIX}${filename}`;
}

async function loadMediaEntries<T>(
  cache: Cache,
  transform: (blob: Blob) => T,
): Promise<Map<string, T>> {
  const mediaKeys = filterMediaKeys(await cache.keys());
  const entries = new Map<string, T>();
  for (const req of mediaKeys) {
    const resp = await cache.match(req);
    if (resp) {
      entries.set(mediaKeyToFilename(req), transform(await resp.blob()));
    }
  }
  return entries;
}

/**
 * Load all cached media entries as filename → Blob.
 */
export function getLocalMediaEntries(cache: Cache): Promise<Map<string, Blob>> {
  return loadMediaEntries(cache, (blob) => blob);
}

/**
 * Load all cached media entries as filename → object URL string.
 * Caller is responsible for revoking the returned URLs when no longer needed.
 */
export function loadMediaObjectUrls(cache: Cache): Promise<Map<string, string>> {
  return loadMediaEntries(cache, (blob) => URL.createObjectURL(blob));
}

/**
 * Revoke all object URLs in a Map (for cleanup on deck switch / unmount).
 */
export function revokeMediaObjectUrls(urls: Map<string, string>): void {
  for (const url of urls.values()) {
    URL.revokeObjectURL(url);
  }
}

/**
 * Delete all media entries from the cache.
 */
export async function clearMediaCache(cache: Cache): Promise<void> {
  const mediaKeys = filterMediaKeys(await cache.keys());
  await Promise.all(mediaKeys.map((req) => cache.delete(req)));
}
