import { BlobWriter, BlobReader, ZipWriter, ZipReader, type Entry, type FileEntry } from "@zip-js/zip-js";
import { compressZstd, decompressZstd } from "../utils/zstd";
import { getLocalMediaEntries } from "../utils/mediaCache";
import { getCachedSqlite, loadSyncedCollection, initializeReviewQueue } from "../stores";
import mime from "mime";

function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}

/**
 * Create a .colpkg blob from the current collection (SQLite + media).
 * The format is Anki-compatible: collection.anki21b (zstd) + numbered media files + media JSON.
 */
export async function createColpkg(): Promise<Blob> {
  const sqliteBytes = await getCachedSqlite();
  if (!sqliteBytes) throw new Error("No collection loaded");

  const compressed = await compressZstd(sqliteBytes);

  // Gather media from cache
  const cache = await caches.open("anki-cache");
  const mediaEntries = await getLocalMediaEntries(cache);

  const zipWriter = new ZipWriter(new BlobWriter("application/zip"));

  // Add compressed SQLite database
  await zipWriter.add(
    "collection.anki21b",
    new BlobReader(new Blob([compressed as BlobPart])),
  );

  // Add media files with numeric names and build the mapping
  const mediaMapping: Record<string, string> = {};
  let index = 0;
  for (const [filename, blob] of mediaEntries) {
    const key = String(index);
    mediaMapping[key] = filename;
    await zipWriter.add(key, new BlobReader(blob));
    index++;
  }

  // Add media mapping JSON
  await zipWriter.add(
    "media",
    new BlobReader(new Blob([JSON.stringify(mediaMapping)])),
  );

  return await zipWriter.close();
}

/**
 * Restore a collection from a .colpkg blob.
 * Parses the ZIP, extracts SQLite + media, and loads them into the app.
 */
export async function restoreColpkg(file: Blob): Promise<void> {
  const zipReader = new ZipReader(new BlobReader(file));
  const entries = await zipReader.getEntries();

  // Find the SQLite database
  const fileMap = new Map(entries.map((e) => [e.filename, e]));
  const dbEntry =
    fileMap.get("collection.anki21b") ??
    fileMap.get("collection.anki21") ??
    fileMap.get("collection.anki2");

  if (!dbEntry || !isFileEntry(dbEntry)) {
    await zipReader.close();
    throw new Error("No collection database found in .colpkg");
  }

  const dbBlob = await dbEntry.getData(new BlobWriter());
  let sqliteBytes = new Uint8Array(await dbBlob.arrayBuffer());

  // Decompress if anki21b (zstd-compressed)
  if (dbEntry.filename === "collection.anki21b") {
    sqliteBytes = new Uint8Array(await decompressZstd(sqliteBytes));
  }

  // Parse media mapping
  const mediaEntry = fileMap.get("media");
  let mediaBlobs: Map<string, Blob> | undefined;

  if (mediaEntry && isFileEntry(mediaEntry)) {
    const mediaBlob = await mediaEntry.getData(new BlobWriter());
    const mediaText = await mediaBlob.text();
    let mediaMapping: Record<string, string>;
    try {
      mediaMapping = JSON.parse(mediaText);
    } catch {
      mediaMapping = {};
    }

    // Build filename → Blob map from numbered entries
    const reverseMap = new Map(
      Object.entries(mediaMapping).map(([num, name]) => [num, name]),
    );
    mediaBlobs = new Map<string, Blob>();

    for (const [numKey, filename] of reverseMap) {
      const entry = fileMap.get(numKey);
      if (entry && isFileEntry(entry)) {
        const blob = await entry.getData(new BlobWriter());
        const typed = new Blob([blob], {
          type: mime.getType(filename) ?? "application/octet-stream",
        });
        mediaBlobs.set(filename, typed);
      }
    }
  }

  await zipReader.close();

  // Load into app
  await loadSyncedCollection(sqliteBytes, mediaBlobs);
  await initializeReviewQueue();
}
