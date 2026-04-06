import { Database } from "sql.js";
import { executeQuery, executeQueryAll } from "~/utils/sql";
import { modelSchema, deckSchema, fsrsJsonSchema } from "./jsonParsers";
import { z } from "zod";
import { assertTruthy } from "~/utils/assert";
import { buildScheduling, resolveCardDeckName, isBlankCard, parseRevlog } from "../shared";

export type CardScheduling = {
  type: number;
  typeName: string;
  queue: number;
  queueName: string;
  due: number;
  dueType: "position" | "dayOffset" | "timestamp" | "dayLearningOffset";
  ivl: number;
  ivlUnit: "days" | "seconds";
  factor: number;
  easeFactor: number | null;
  reps: number;
  lapses: number;
  odue: number;
  flags: number;
  left: number;
  fsrs: { stability: number; difficulty: number; desiredRetention: number | undefined } | null;
};

export function getQueueName(queue: number): string {
  switch (queue) {
    case -3: return "schedulerBuried";
    case -2: return "userBuried";
    case -1: return "suspended";
    case 0: return "new";
    case 1: return "learning";
    case 2: return "review";
    case 3: return "dayLearning";
    case 4: return "preview";
    default: return "unknown";
  }
}

export function getTypeName(type: number): string {
  switch (type) {
    case 0: return "new";
    case 1: return "learning";
    case 2: return "review";
    case 3: return "relearning";
    default: return "unknown";
  }
}

export type RevlogEntry = {
  id: number;
  cid: number;
  usn: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
  typeName: string;
};

export function getRevlogTypeName(type: number): string {
  switch (type) {
    case 0: return "learning";
    case 1: return "review";
    case 2: return "relearning";
    case 3: return "filtered";
    case 4: return "manual";
    default: return "unknown";
  }
}

export function getDueType(queue: number): CardScheduling["dueType"] {
  switch (queue) {
    case 0: return "position";
    case 1: return "timestamp";
    case 2: return "dayOffset";
    case 3: return "dayLearningOffset";
    default: return "position";
  }
}

export type AnkiDB2Data = {
  cards: {
    values: {
      [k: string]: string | null;
    };
    tags: string[];
    templates: z.infer<typeof modelSchema>[string]["tmpls"];
    css: string;
    deckName: string;
    guid: string;
    scheduling: CardScheduling | null;
    noteType: number; // 0=MODEL_STD, 1=MODEL_CLOZE
    latexSvg: boolean;
    latexPre: string;
    latexPost: string;
    req: [number, string, number[]][] | null;
    noteData: string | null;
    csum: number | null;
    sfld: string | null;
  }[];
  notesTypes: { id: string | number; schemaHash: string; latexPre: string; latexSvg: boolean }[];
  deckName: string;
  decks: Record<string, { id: number; name: string }>;
  revlog: RevlogEntry[];
  collectionCreationTime: number;
  deckConfigs: Record<string, { learnSteps?: number[]; relearnSteps?: number[] }>;
  graves: { usn: number; oid: number; type: number }[];
};

export function getDataFromAnki2(db: Database): AnkiDB2Data {
  const { models, deckName, decks, collectionCreationTime } = (() => {
    // anki2 and anki21 only use the first row of the col table
    // models, decks, and dconf are JSON strings
    const colData = executeQuery<{
      conf: string;
      models: string;
      decks: string;
      dconf: string;
      tags: string;
      crt: number;
    }>(db, "SELECT * from col");

    const parsedModels = modelSchema.parse(JSON.parse(colData.models));

    // Parse decks JSON to extract all deck information
    let deckName = "Unknown";
    let decks: Record<string, { id: number; name: string }> = {};
    try {
      const parsedDecks = deckSchema.parse(JSON.parse(colData.decks));

      // Convert to our format, filtering out entries without names
      decks = Object.fromEntries(
        Object.entries(parsedDecks)
          .filter(([_, deck]) => deck.name)
          .map(([id, deck]) => [id, { id: deck.id, name: deck.name! }]),
      );

      // Use the first deck's name for backwards compatibility
      const deckEntries = Object.values(decks);
      if (deckEntries.length > 0 && deckEntries[0]?.name) {
        deckName = deckEntries[0].name;
      }
    } catch (e) {
      // If parsing fails, keep defaults
      console.warn("Failed to parse deck information from decks JSON:", e);
    }

    return { models: parsedModels, deckName, decks, collectionCreationTime: colData.crt ?? 0 };
  })();

  const cards = (() => {
    const notes = executeQueryAll<{
      id: number;
      guid: string;
      modelId: string;
      tags: string;
      fields: string;
      data: string;
      sfld: string;
      csum: number;
    }>(db, "SELECT id, guid, cast(mid as text) as modelId, tags, flds as fields, data, sfld, csum FROM notes");

    const notesMap = new Map(notes.map((n) => [n.id, n]));

    // Query card rows to drive the output — one output card per card row
    const cardRows = executeQueryAll<{
      id: number;
      nid: number;
      ord: number;
      did: number;
      odid: number;
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
    }>(
      db,
      "SELECT id, nid, ord, did, odid, type, queue, due, ivl, factor, reps, lapses, odue, flags, left, data FROM cards",
    );

    return cardRows
      .map((cardRow) => {
        const note = notesMap.get(cardRow.nid);
        if (!note) return null;

        const modelForCard = models[note.modelId];
        assertTruthy(modelForCard, `Model ${note.modelId} not found`);

        const keys = modelForCard.flds.map((fld) => fld.name);
        const values = note.fields.split("\x1F");
        const valuesMap = Object.fromEntries(
          keys.map((key, index) => [key, values[index] ?? null]),
        );

        // Find the template matching this card's ordinal
        const matchingTemplate =
          modelForCard.tmpls.find((t) => t.ord === cardRow.ord) ?? modelForCard.tmpls[0];
        assertTruthy(matchingTemplate, `No template found for ord ${cardRow.ord}`);

        const cardDeckName = resolveCardDeckName(cardRow, decks);

        // Check req (blank card filtering)
        if (isBlankCard(modelForCard.req ?? null, cardRow.ord, keys, valuesMap)) {
          return null;
        }

        return {
          values: valuesMap,
          tags: note.tags.trim().split(/\s+/).filter(Boolean),
          templates: [matchingTemplate],
          css: modelForCard.css,
          deckName: cardDeckName,
          guid: note.guid,
          noteType: modelForCard.type ?? 0,
          latexSvg: modelForCard.latexsvg ?? false,
          latexPre: modelForCard.latexPre ?? "",
          latexPost: modelForCard.latexPost ?? "",
          req: modelForCard.req ?? null,
          noteData: note.data || null,
          csum: note.csum ?? null,
          sfld: note.sfld ?? null,
          scheduling: buildScheduling(cardRow),
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  })();

  const revlog = parseRevlog(db);

  // Parse deck configs from col.dconf JSON (anki2 format)
  const deckConfigs = (() => {
    try {
      const colData = executeQuery<{ dconf: string }>(db, "SELECT dconf FROM col");
      const parsed = JSON.parse(colData.dconf) as Record<string, Record<string, unknown>>;
      const result: Record<string, { learnSteps?: number[]; relearnSteps?: number[] }> = {};
      for (const [id, config] of Object.entries(parsed)) {
        const newConf = config?.new as { delays?: number[] } | undefined;
        const lapseConf = config?.lapse as { delays?: number[] } | undefined;
        result[id] = {
          learnSteps: newConf?.delays,
          relearnSteps: lapseConf?.delays,
        };
      }
      return result;
    } catch {
      return {};
    }
  })();

  // Parse graves (deleted objects) if the table exists
  const graves = (() => {
    try {
      return executeQueryAll<{ usn: number; oid: number; type: number }>(
        db, "SELECT usn, oid, type FROM graves",
      );
    } catch {
      return [];
    }
  })();

  // Build notesTypes with schema hash
  const notesTypes = Object.values(models).map((model) => {
    const fieldNames = model.flds.map((f) => f.name);
    const templateNames = model.tmpls.map((t) => t.name);
    const hashInput = [...fieldNames, ...templateNames].join("\x1f");
    // Simple string hash for notetype matching
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return {
      id: model.id,
      schemaHash: Math.abs(hash).toString(16),
      latexPre: model.latexPre ?? "",
      latexSvg: model.latexsvg ?? false,
    };
  });

  return { cards, notesTypes, deckName, decks, revlog, collectionCreationTime, deckConfigs, graves };
}

/**
 * Parse FSRS memory state from card.data.
 * Supports both JSON format ({s, d, dr}) and protobuf format (FSRSMemoryState).
 */
export function parseFsrsData(
  data: string | Uint8Array,
): CardScheduling["fsrs"] {
  if (!data) return null;

  // If it's a Uint8Array (binary), try protobuf parsing
  if (data instanceof Uint8Array) {
    return parseFsrsProtobuf(data);
  }

  // If it's a string, try JSON first
  if (typeof data === "string") {
    try {
      const parsed = fsrsJsonSchema.parse(JSON.parse(data));
      return {
        stability: parsed.s,
        difficulty: parsed.d,
        desiredRetention: parsed.dr,
      };
    } catch {
      // Not JSON or wrong shape — try interpreting as binary if it contains non-printable chars
    }
  }

  return null;
}

/**
 * Parse protobuf-encoded FSRSMemoryState.
 * Message: { stability: float (field 1), difficulty: float (field 2) }
 */
function parseFsrsProtobuf(
  data: Uint8Array,
): CardScheduling["fsrs"] {
  if (data.length < 5) return null;

  let stability: number | null = null;
  let difficulty: number | null = null;
  let offset = 0;

  while (offset < data.length) {
    const tag = data[offset++];
    if (tag === undefined) break;

    const fieldNumber = tag >> 3;
    const wireType = tag & 0x07;

    if (wireType === 5 && offset + 4 <= data.length) {
      // 32-bit (float)
      const view = new DataView(data.buffer, data.byteOffset + offset, 4);
      const value = view.getFloat32(0, true); // little-endian
      offset += 4;

      if (fieldNumber === 1) stability = value;
      else if (fieldNumber === 2) difficulty = value;
    } else if (wireType === 0) {
      // varint — skip
      while (offset < data.length && (data[offset]! & 0x80) !== 0) offset++;
      offset++;
    } else if (wireType === 2) {
      // length-delimited — skip
      let len = 0;
      let shift = 0;
      while (offset < data.length) {
        const byte = data[offset++]!;
        len |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) break;
        shift += 7;
      }
      offset += len;
    } else {
      break;
    }
  }

  if (stability !== null && difficulty !== null) {
    return { stability, difficulty, desiredRetention: undefined };
  }

  return null;
}
