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
  return (
    html
      // Remove sound tags
      .replace(/\[sound:[^\]]+\]/g, "")
      // Remove HTML tags
      .replace(/<[^>]*>/g, "")
      // Decode common HTML entities
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );
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
  const seen = new Map<string, NoteInfo>();
  for (const card of cards) {
    if (seen.has(card.guid)) continue;
    const fieldNames = Object.keys(card.values);
    seen.set(card.guid, {
      guid: card.guid,
      values: card.values,
      tags: card.tags,
      deckName: card.deckName,
      fieldNames,
    });
  }
  return Array.from(seen.values());
}

/**
 * Find duplicate notes based on exact matching of the specified field.
 */
export function findExactDuplicates(
  notes: NoteInfo[],
  options: DuplicateSearchOptions,
): DuplicateGroup[] {
  const { fieldIndex, scope } = options;
  const groups = new Map<string, NoteInfo[]>();

  for (const note of notes) {
    const raw = getFieldValue(note, fieldIndex);
    const normalized = normalizeForComparison(raw);
    if (!normalized) continue;

    // Build the grouping key based on scope
    let key: string;
    if (scope === "deck") {
      key = `${note.deckName}\x1F${normalized}`;
    } else {
      key = normalized;
    }

    const group = groups.get(key);
    if (group) {
      group.push(note);
    } else {
      groups.set(key, [note]);
    }
  }

  const result: DuplicateGroup[] = [];
  for (const [key, noteGroup] of groups) {
    if (noteGroup.length < 2) continue;
    const displayKey = getFieldValue(noteGroup[0]!, fieldIndex) ?? key;
    const cleanDisplayKey = displayKey
      .replace(/<[^>]*>/g, "")
      .replace(/\[sound:[^\]]+\]/g, "")
      .trim();
    result.push({
      key,
      displayKey: cleanDisplayKey || key,
      notes: noteGroup,
      similarity: 1.0,
    });
  }

  // Sort by group size (largest groups first)
  result.sort((a, b) => b.notes.length - a.notes.length);
  return result;
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

  // Build normalized values
  const noteValues: { note: NoteInfo; normalized: string; scopeKey: string }[] = [];
  for (const note of notes) {
    const raw = getFieldValue(note, fieldIndex);
    const normalized = normalizeForComparison(raw);
    if (!normalized) continue;
    const scopeKey = scope === "deck" ? note.deckName : "all";
    noteValues.push({ note, normalized, scopeKey });
  }

  // Group by scope first
  const scopeGroups = new Map<string, typeof noteValues>();
  for (const nv of noteValues) {
    const group = scopeGroups.get(nv.scopeKey);
    if (group) group.push(nv);
    else scopeGroups.set(nv.scopeKey, [nv]);
  }

  const result: DuplicateGroup[] = [];
  const mergedGuids = new Set<string>();

  for (const scopeNotes of scopeGroups.values()) {
    // Skip exact matches (already handled)
    // Use Union-Find to group similar notes together
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

    // Compare all pairs within scope (limit to first 2000 to avoid freezing)
    const limit = Math.min(scopeNotes.length, 2000);
    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < limit; j++) {
        const a = scopeNotes[i]!;
        const b = scopeNotes[j]!;
        // Skip if exactly the same (handled by exact matching)
        if (a.normalized === b.normalized) continue;
        const sim = stringSimilarity(a.normalized, b.normalized);
        if (sim >= fuzzyThreshold) {
          union(i, j);
        }
      }
    }

    // Collect groups
    const clusters = new Map<number, { indices: number[]; minSim: number }>();
    for (let i = 0; i < limit; i++) {
      const root = find(i);
      const cluster = clusters.get(root);
      if (cluster) {
        cluster.indices.push(i);
      } else {
        clusters.set(root, { indices: [i], minSim: 1.0 });
      }
    }

    for (const cluster of clusters.values()) {
      if (cluster.indices.length < 2) continue;

      // Calculate average similarity within the group
      let totalSim = 0;
      let count = 0;
      for (let i = 0; i < cluster.indices.length; i++) {
        for (let j = i + 1; j < cluster.indices.length; j++) {
          const a = scopeNotes[cluster.indices[i]!]!;
          const b = scopeNotes[cluster.indices[j]!]!;
          if (a.normalized !== b.normalized) {
            totalSim += stringSimilarity(a.normalized, b.normalized);
            count++;
          } else {
            totalSim += 1.0;
            count++;
          }
        }
      }

      const avgSim = count > 0 ? totalSim / count : 1.0;
      const clusterNotes = cluster.indices.map((i) => scopeNotes[i]!.note);

      // Skip if all notes already covered by exact matching
      if (clusterNotes.every((n) => mergedGuids.has(n.guid))) continue;
      for (const n of clusterNotes) mergedGuids.add(n.guid);

      const displayKey =
        getFieldValue(clusterNotes[0]!, fieldIndex)
          ?.replace(/<[^>]*>/g, "")
          .replace(/\[sound:[^\]]+\]/g, "")
          .trim() ?? "";

      result.push({
        key: `fuzzy-${clusterNotes.map((n) => n.guid).join("-")}`,
        displayKey: displayKey || "(empty)",
        notes: clusterNotes,
        similarity: Math.round(avgSim * 100) / 100,
      });
    }
  }

  result.sort((a, b) => b.notes.length - a.notes.length);
  return result;
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

  // For fuzzy, exclude notes already in exact groups
  const exactGuids = new Set<string>();
  for (const group of exactGroups) {
    for (const note of group.notes) {
      exactGuids.add(note.guid);
    }
  }

  const remainingNotes = notes.filter((n) => !exactGuids.has(n.guid));
  const fuzzyGroups = findFuzzyDuplicates(remainingNotes, options);

  return [...exactGroups, ...fuzzyGroups];
}
