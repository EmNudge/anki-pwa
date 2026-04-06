import { Database } from "sql.js";
import { executeQueryAll } from "~/utils/sql";
import {
  type CardScheduling,
  type RevlogEntry,
  getQueueName,
  getTypeName,
  getDueType,
  getRevlogTypeName,
  parseFsrsData,
} from "./anki2";

/**
 * Build a CardScheduling object from a raw card row.
 * Shared between anki2 and anki21b parsers.
 */
export function buildScheduling(cardRow: {
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  odue: number;
  flags: number;
  left: number;
  data: string | Uint8Array;
}): CardScheduling {
  return {
    type: cardRow.type,
    typeName: getTypeName(cardRow.type),
    queue: cardRow.queue,
    queueName: getQueueName(cardRow.queue),
    due: cardRow.due,
    dueType: getDueType(cardRow.queue),
    ivl: cardRow.ivl,
    ivlUnit: cardRow.ivl < 0 ? ("seconds" as const) : ("days" as const),
    factor: cardRow.factor,
    easeFactor: cardRow.factor === 0 ? null : cardRow.factor / 1000,
    reps: cardRow.reps,
    lapses: cardRow.lapses,
    odue: cardRow.odue,
    flags: cardRow.flags,
    left: cardRow.left,
    fsrs: parseFsrsData(cardRow.data),
  };
}

/**
 * Resolve the effective deck name for a card, considering filtered decks (odid).
 */
export function resolveCardDeckName(
  cardRow: { odid: number; did: number },
  decks: Record<string, { id: number; name: string }>,
): string {
  const effectiveDid = cardRow.odid !== 0 ? cardRow.odid : cardRow.did;
  return decks[effectiveDid.toString()]?.name ?? "Unknown";
}

/**
 * Check blank card filtering using req (required fields) data.
 * Returns true if the card should be filtered out (is blank).
 */
export function isBlankCard(
  req: [number, string, number[]][] | null,
  cardOrd: number,
  fieldNames: string[],
  values: Record<string, string | null>,
): boolean {
  if (!req) return false;

  const reqForOrd = req.find((r) => r[0] === cardOrd);
  if (!reqForOrd) return false;

  const [, mode, fieldIndices] = reqForOrd;
  if (mode === "any") {
    const anyFilled = fieldIndices.some((idx) => {
      const fieldName = fieldNames[idx];
      return fieldName && (values[fieldName]?.trim() ?? "") !== "";
    });
    if (!anyFilled) return true;
  } else if (mode === "all") {
    const allFilled = fieldIndices.every((idx) => {
      const fieldName = fieldNames[idx];
      return fieldName && (values[fieldName]?.trim() ?? "") !== "";
    });
    if (!allFilled) return true;
  }

  return false;
}

/**
 * Parse the revlog table from a database.
 * Returns an empty array if the table doesn't exist.
 */
export function parseRevlog(db: Database): RevlogEntry[] {
  try {
    const rows = executeQueryAll<Omit<RevlogEntry, "typeName">>(
      db,
      "SELECT id, cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog",
    );
    return rows.map((r) => ({ ...r, typeName: getRevlogTypeName(r.type) }));
  } catch {
    return [];
  }
}
