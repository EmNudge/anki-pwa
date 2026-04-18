/**
 * Duplicate detection utilities for Anki notes.
 *
 * Follows Anki's default behavior: duplicates are identified by the first field
 * (sort field) of a note, with HTML stripped and whitespace normalized.
 * Also supports fuzzy matching via bigram-based string similarity.
 */

export type NoteInfo = {
  guid: string;
  values: Record<string, string | null>;
  tags: string[];
  deckName: string;
  fieldNames: string[];
};

import { decodeHtmlEntities } from "./format";
import { groupBy } from "./groupBy";
import { stripHtml } from "./stripHtml";

export type DuplicateGroup = {
  /** The normalized key used to group these notes */
  key: string;
  /** Display text for the group (un-normalized first field) */
  displayKey: string;
  /** Notes that share this key */
  notes: NoteInfo[];
  /** Similarity score (1.0 for exact, <1.0 for fuzzy) */
  similarity: number;
};

export type DuplicateScope = "all" | "deck" | "notetype";

export type DuplicateSearchOptions = {
  /** Which field to compare (index into field list). Default: 0 (first field / sort field) */
  fieldIndex: number;
  /** Scope of comparison */
  scope: DuplicateScope;
  /** Whether to include fuzzy matches */
  fuzzy: boolean;
  /** Minimum similarity threshold for fuzzy matching (0-1). Default: 0.8 */
  fuzzyThreshold: number;
};

/**
 * Strip HTML tags, sound references, and normalize whitespace for comparison.
 */
export function normalizeForComparison(html: string | null): string {
  if (!html) return "";
  return decodeHtmlEntities(stripHtml(html)).replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Compute bigram-based similarity between two strings (Dice coefficient).
 * Returns a value between 0 (no similarity) and 1 (identical).
 */
export function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    bigramsA.set(bigram, (bigramsA.get(bigram) ?? 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = bigramsA.get(bigram);
    if (count && count > 0) {
      bigramsA.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2 * intersectionSize) / (a.length - 1 + (b.length - 1));
}

/**
 * Extract the field value at the given index from a note's values map.
 */
function getFieldValue(note: NoteInfo, fieldIndex: number): string | null {
  const keys = note.fieldNames;
  const key = keys[fieldIndex];
  if (!key) return null;
  return note.values[key] ?? null;
}

/**
 * Build NoteInfo objects from AnkiData cards, deduplicating by guid.
 */
export function buildNoteInfos(
  cards: {
    guid: string;
    values: Record<string, string | null>;
    tags: string[];
    deckName: string;
    templates: { qfmt: string; afmt: string; name: string; ord?: number }[];
  }[],
): NoteInfo[] {
  const seen = new Set<string>();
  return cards
    .filter((card) => {
      if (seen.has(card.guid)) return false;
      seen.add(card.guid);
      return true;
    })
    .map((card) => ({
      guid: card.guid,
      values: card.values,
      tags: card.tags,
      deckName: card.deckName,
      fieldNames: Object.keys(card.values),
    }));
}

function cleanDisplayKey(html: string | null): string {
  return stripHtml(html);
}

/**
 * Find duplicate notes based on exact matching of the specified field.
 */
export function findExactDuplicates(
  notes: NoteInfo[],
  options: DuplicateSearchOptions,
): DuplicateGroup[] {
  const { fieldIndex, scope } = options;

  const notesWithKeys = notes
    .map((note) => {
      const normalized = normalizeForComparison(getFieldValue(note, fieldIndex));
      if (!normalized) return null;
      const key = scope === "deck" ? `${note.deckName}\x1F${normalized}` : normalized;
      return { note, key };
    })
    .filter((entry) => entry !== null);

  const grouped = groupBy(notesWithKeys, (entry) => entry.key);

  return Object.entries(grouped)
    .filter(([, entries]) => entries !== undefined && entries.length >= 2)
    .map(([key, entries]) => {
      const noteGroup = entries!.map((e) => e.note);
      const rawDisplayKey = getFieldValue(noteGroup[0]!, fieldIndex) ?? key;
      return {
        key,
        displayKey: cleanDisplayKey(rawDisplayKey) || key,
        notes: noteGroup,
        similarity: 1.0,
      };
    })
    .toSorted((a, b) => b.notes.length - a.notes.length);
}

/**
 * Find fuzzy duplicate notes using string similarity.
 * This is O(n^2) so we limit it to notes that share at least some similarity.
 */
export function findFuzzyDuplicates(
  notes: NoteInfo[],
  options: DuplicateSearchOptions,
): DuplicateGroup[] {
  const { fieldIndex, scope, fuzzyThreshold } = options;

  const noteValues = notes
    .map((note) => {
      const normalized = normalizeForComparison(getFieldValue(note, fieldIndex));
      if (!normalized) return null;
      const scopeKey = scope === "deck" ? note.deckName : "all";
      return { note, normalized, scopeKey };
    })
    .filter((entry) => entry !== null);

  const scopeGroups = groupBy(noteValues, (nv) => nv.scopeKey);

  const mergedGuids = new Set<string>();

  return Object.values(scopeGroups)
    .filter((group) => group !== undefined)
    .flatMap((scopeNotes) => {
      // Union-Find to group similar notes (inherently imperative)
      const parent = new Map<number, number>();
      function find(i: number): number {
        let p = parent.get(i) ?? i;
        while (p !== (parent.get(p) ?? p)) {
          p = parent.get(p) ?? p;
        }
        parent.set(i, p);
        return p;
      }
      function union(i: number, j: number) {
        parent.set(find(i), find(j));
      }

      const limit = Math.min(scopeNotes.length, 2000);
      const simCache = new Map<string, number>();
      for (let i = 0; i < limit; i++) {
        for (let j = i + 1; j < limit; j++) {
          const a = scopeNotes[i]!;
          const b = scopeNotes[j]!;
          if (a.normalized === b.normalized) continue;
          const sim = stringSimilarity(a.normalized, b.normalized);
          if (sim >= fuzzyThreshold) {
            simCache.set(`${i}:${j}`, sim);
            union(i, j);
          }
        }
      }

      const clusterMap = groupBy(
        Array.from({ length: limit }, (_, i) => i),
        (i) => find(i),
      );

      return Object.values(clusterMap)
        .filter((indices): indices is number[] => indices !== undefined && indices.length >= 2)
        .map((indices) => {
          let totalSim = 0;
          let count = 0;
          for (let i = 0; i < indices.length; i++) {
            for (let j = i + 1; j < indices.length; j++) {
              const a = indices[i]!;
              const b = indices[j]!;
              const key = a < b ? `${a}:${b}` : `${b}:${a}`;
              totalSim += simCache.get(key) ?? 1.0;
              count++;
            }
          }
          const avgSim = count > 0 ? totalSim / count : 1.0;
          const clusterNotes = indices.map((i) => scopeNotes[i]!.note);
          const displayKey = cleanDisplayKey(getFieldValue(clusterNotes[0]!, fieldIndex));
          return {
            key: `fuzzy-${clusterNotes.map((n) => n.guid).join("-")}`,
            displayKey: displayKey || "(empty)",
            notes: clusterNotes,
            similarity: Math.round(avgSim * 100) / 100,
          };
        })
        .filter((group) => {
          if (group.notes.every((n) => mergedGuids.has(n.guid))) return false;
          group.notes.forEach((n) => mergedGuids.add(n.guid));
          return true;
        });
    })
    .toSorted((a, b) => b.notes.length - a.notes.length);
}

/**
 * Main entry point: find all duplicates (exact + optionally fuzzy).
 */
export function findDuplicates(
  notes: NoteInfo[],
  options: DuplicateSearchOptions,
): DuplicateGroup[] {
  const exactGroups = findExactDuplicates(notes, options);

  if (!options.fuzzy) return exactGroups;

  const exactGuids = new Set(exactGroups.flatMap((group) => group.notes.map((n) => n.guid)));

  const remainingNotes = notes.filter((n) => !exactGuids.has(n.guid));
  const fuzzyGroups = findFuzzyDuplicates(remainingNotes, options);

  return [...exactGroups, ...fuzzyGroups];
}
