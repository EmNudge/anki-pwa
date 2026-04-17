import { z } from "zod";
import type { AnkiData } from "./ankiParser";
import { formatFileSize } from "./utils/format";

const cachedFileEntrySchema = z.array(
  z.object({
    name: z.string(),
    size: z.number(),
    addedAt: z.number(),
  }),
);

export type CachedFileEntry = z.infer<typeof cachedFileEntrySchema>[number];

export type DeckInput =
  | { kind: "blob"; blob: Blob }
  | { kind: "sample"; data: AnkiData }
  | { kind: "sqlite"; bytes: Uint8Array; mediaFiles?: Map<string, string> };
type DeckLibraryItem = {
  detail: string;
  id: string;
  isRemovable: boolean;
  meta: string;
  title: string;
};

const activeDeckSourceStorageKey = "anki-active-deck";
const cachedFilesStorageKey = "anki-cached-files";
const legacyActiveFileStorageKey = "anki-active-file";
const adoptedSamplesStorageKey = "anki-adopted-samples";
export const importedDeckFileName = "imported-deck.apkg";

export function readCachedFiles(): CachedFileEntry[] {
  const storedFiles = localStorage.getItem(cachedFilesStorageKey);
  if (!storedFiles) {
    return [];
  }

  try {
    return cachedFileEntrySchema.parse(JSON.parse(storedFiles));
  } catch {
    return [];
  }
}

export function writeCachedFiles(cachedFiles: CachedFileEntry[]) {
  localStorage.setItem(cachedFilesStorageKey, JSON.stringify(cachedFiles));
}

export function readStoredActiveDeckSourceId({
  cachedFiles,
  sampleDeckIds,
}: {
  cachedFiles: CachedFileEntry[];
  sampleDeckIds: Set<string>;
}): string | null {
  const storedActiveDeckSourceId =
    localStorage.getItem(activeDeckSourceStorageKey) ??
    localStorage.getItem(legacyActiveFileStorageKey);

  if (!storedActiveDeckSourceId) {
    return null;
  }

  const isKnownDeckSource =
    storedActiveDeckSourceId === "sync-collection" ||
    sampleDeckIds.has(storedActiveDeckSourceId) ||
    cachedFiles.some((file) => file.name === storedActiveDeckSourceId);

  return isKnownDeckSource ? storedActiveDeckSourceId : null;
}

export function persistActiveDeckSourceId(id: string | null) {
  if (id) {
    localStorage.setItem(activeDeckSourceStorageKey, id);
    localStorage.setItem(legacyActiveFileStorageKey, id);
    return;
  }

  localStorage.removeItem(activeDeckSourceStorageKey);
  localStorage.removeItem(legacyActiveFileStorageKey);
}

export function upsertCachedFileEntry(
  cachedFiles: CachedFileEntry[],
  entry: CachedFileEntry,
): CachedFileEntry[] {
  return cachedFiles.some((cachedFile) => cachedFile.name === entry.name)
    ? cachedFiles
    : [...cachedFiles, entry];
}

export function removeCachedFileEntry(cachedFiles: CachedFileEntry[], name: string) {
  return cachedFiles.filter((file) => file.name !== name);
}


function formatAddedDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function createCachedDeckLibraryItem(file: CachedFileEntry): DeckLibraryItem {
  return {
    id: file.name,
    title: file.name,
    detail: `${formatFileSize(file.size)} · ${formatAddedDate(file.addedAt)}`,
    meta: "Uploaded deck",
    isRemovable: true,
  };
}

export function createSampleDeckLibraryItem(sampleDeck: {
  id: string;
  name: string;
  description: string;
  data: { cards: { length: number } };
}): DeckLibraryItem {
  return {
    id: sampleDeck.id,
    title: sampleDeck.name,
    detail: sampleDeck.description,
    meta: `${sampleDeck.data.cards.length} cards · built in`,
    isRemovable: false,
  };
}

export function readAdoptedSampleIds(): string[] {
  const stored = localStorage.getItem(adoptedSamplesStorageKey);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeAdoptedSampleIds(ids: string[]) {
  localStorage.setItem(adoptedSamplesStorageKey, JSON.stringify(ids));
}
