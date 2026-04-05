import { BlobWriter, Entry, FileEntry } from "@zip-js/zip-js";
import { ZipReader } from "@zip-js/zip-js";
import { BlobReader } from "@zip-js/zip-js";
import { isTruthy } from "../utils/assert";
import { assertTruthy } from "../utils/assert";
import mime from "mime";
import { decompressZstd } from "../utils/zstd";
import { parseMediaProto } from "./parseMediaProto";
import { mediaMappingSchema } from "./anki2/jsonParsers";

/**
 * Type guard to check if an Entry is a FileEntry (has getData method)
 */
function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}

export async function getAnkiDataFromZip(file: Blob): Promise<{
  ankiDb: AnkiDb;
  files: Map<string, string>;
}> {
  const zipFileReader = new BlobReader(file);
  const zipReader = new ZipReader(zipFileReader);
  const entries = await zipReader.getEntries();

  const ankiDb = await getAnkiDbFromEntries(entries);

  const files = await getFilesFromEntries(entries);

  await zipReader.close();

  return { ankiDb, files };
}

// expensive operation, maybe lazy load?
async function getFilesFromEntries(entries: Entry[]): Promise<Map<string, string>> {
  const mediaFileEntry = entries.find((entry) => entry.filename === "media");
  assertTruthy(mediaFileEntry, "media file not found");

  if (!isFileEntry(mediaFileEntry)) {
    throw new Error("media entry is not a file");
  }

  // Get media file as binary data first (newer formats use Zstandard compression)
  const mediaFileBlob = await mediaFileEntry.getData(new BlobWriter());
  const mediaFileBytes = new Uint8Array(await mediaFileBlob.arrayBuffer());

  // Try to decompress if it's Zstandard compressed
  let mediaFileText: string;
  let decompressedBytes: Uint8Array;
  try {
    const decompressed = await decompressZstd(mediaFileBytes);
    decompressedBytes = decompressed;
    mediaFileText = new TextDecoder().decode(decompressed);
  } catch {
    // Not compressed, try as plain text
    decompressedBytes = mediaFileBytes;
    mediaFileText = new TextDecoder().decode(mediaFileBytes);
  }

  const mediaFile = (() => {
    try {
      // Try parsing as JSON first (older format)
      return mediaMappingSchema.parse(JSON.parse(mediaFileText));
      // eslint-disable-next-line no-unused-vars
    } catch {
      // If JSON parsing fails, try parsing as Protocol Buffer (newer .anki21b format)
      try {
        return parseMediaProto(decompressedBytes);
        // eslint-disable-next-line no-unused-vars
      } catch {
        // If both parsers fail, return empty object
        return {};
      }
    }
  })();
  const mediaFileMap = new Map(Object.entries(mediaFile));

  const filePromises = entries
    .map((entry) => {
      const actualFilename = mediaFileMap.get(entry.filename);
      if (!actualFilename) {
        return null;
      }

      if (!isFileEntry(entry)) {
        throw new Error(`entry ${entry.filename} is not a file`);
      }

      return { entry, actualFilename };
    })
    .filter(isTruthy)
    .map(async ({ entry, actualFilename }) => {
      const blob = await entry.getData(new BlobWriter());
      let fileBytes = new Uint8Array(await blob.arrayBuffer());

      // Check if file is Zstandard compressed and decompress if needed
      // Zstandard magic number is 0x28 0xB5 0x2F 0xFD
      const isZstdCompressed =
        fileBytes.length >= 4 &&
        fileBytes[0] === 0x28 &&
        fileBytes[1] === 0xb5 &&
        fileBytes[2] === 0x2f &&
        fileBytes[3] === 0xfd;

      if (isZstdCompressed) {
        try {
          const decompressed = await decompressZstd(fileBytes);
          fileBytes = new Uint8Array(decompressed);
        } catch {
          // If decompression fails, use original bytes
          // This allows graceful fallback for files that aren't actually compressed
        }
      }

      return {
        data: new Blob([fileBytes], {
          type: mime.getType(actualFilename) ?? "application/octet-stream",
        }),
        name: actualFilename,
      };
    });

  const files = await Promise.all(filePromises);

  return new Map(files.map((file) => [file.name, URL.createObjectURL(file.data)]));
}

type AnkiDb = { type: "21b" | "21" | "2"; array: Uint8Array };

async function getAnkiDbFromEntries(entries: Entry[]): Promise<AnkiDb> {
  const sqliteDbEntry = (() => {
    const fileMap = new Map(entries.map((entry) => [entry.filename, entry]));

    return (
      fileMap.get("collection.anki21b") ??
      fileMap.get("collection.anki21") ??
      fileMap.get("collection.anki2")
    );
  })();

  assertTruthy(sqliteDbEntry, "sqlite.db not found");

  if (!isFileEntry(sqliteDbEntry)) {
    throw new Error("sqlite.db entry is not a file");
  }

  const sqliteDbBlob = await sqliteDbEntry.getData(new BlobWriter());

  assertTruthy(sqliteDbBlob, "blob not parsed from data");

  const sqliteDbBlobByteArray = new Uint8Array(await sqliteDbBlob.arrayBuffer());

  if (sqliteDbEntry.filename === "collection.anki21b") {
    const array = await decompressZstd(sqliteDbBlobByteArray);
    return { type: "21b", array };
  }

  return {
    type: sqliteDbEntry.filename === "collection.anki21" ? "21" : "2",
    array: sqliteDbBlobByteArray,
  };
}
