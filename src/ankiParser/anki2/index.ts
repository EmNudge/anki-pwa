import { Database } from "sql.js";
import { executeQuery, executeQueryAll } from "~/utils/sql";
import {
  modelSchema,
  deckSchema,
  colConfSchema,
  dconfSchema,
  fsrsJsonSchema,
  type DconfEntry,
} from "./jsonParsers";
import { z } from "zod";
import { assertTruthy } from "~/utils/assert";
import { buildScheduling, resolveCardDeckName, isBlankCard, parseRevlog } from "../shared";
import { stringHash } from "~/utils/constants";

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

const QUEUE_NAMES: Record<number, string> = {
  [-3]: "userBuried",
  [-2]: "schedulerBuried",
  [-1]: "suspended",
  0: "new",
  1: "learning",
  2: "review",
  3: "dayLearning",
  4: "preview",
};

const TYPE_NAMES: Record<number, string> = {
  0: "new",
  1: "learning",
  2: "review",
  3: "relearning",
};

export function getQueueName(queue: number): string {
  return QUEUE_NAMES[queue] ?? "unknown";
}

export function getTypeName(type: number): string {
  return TYPE_NAMES[type] ?? "unknown";
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

const REVLOG_TYPE_NAMES: Record<number, string> = {
  0: "learning",
  1: "review",
  2: "relearning",
  3: "filtered",
  4: "manual",
  5: "rescheduled",
};

const DUE_TYPES: Record<number, CardScheduling["dueType"]> = {
  0: "position",
  1: "timestamp",
  2: "dayOffset",
  3: "dayLearningOffset",
};

export function getRevlogTypeName(type: number): string {
  return REVLOG_TYPE_NAMES[type] ?? "unknown";
}

export function getDueType(queue: number): CardScheduling["dueType"] {
  return DUE_TYPES[queue] ?? "position";
}

export type Anki2Deck = {
  id: number;
  name: string;
  description?: string;
  mod?: number;
  usn?: number;
  lrnToday?: [number, number];
  revToday?: [number, number];
  newToday?: [number, number];
  timeToday?: [number, number];
  collapsed?: boolean;
  browserCollapsed?: boolean;
  conf?: number;
  dyn?: number;
  extendNew?: number;
  extendRev?: number;
};

export type Anki2DeckConfig = {
  id?: number | string;
  name?: string;
  learnSteps?: number[];
  relearnSteps?: number[];
  new?: DconfEntry["new"];
  rev?: DconfEntry["rev"];
  lapse?: DconfEntry["lapse"];
  maxTaken?: number;
  autoplay?: boolean;
  timer?: number;
  replayq?: boolean;
  dyn?: boolean;
  mod?: number;
  usn?: number;
};

export type ColConf = z.infer<typeof colConfSchema>;

export type AnkiDB2Data = {
  cards: {
    ankiCardId?: number;
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
    originalStockKind?: number;
    latexSvg: boolean;
    latexPre: string;
    latexPost: string;
    req: [number, string, number[]][] | null;
    fieldDescriptions: Record<string, string>;
    noteData: string | null;
    csum: number | null;
    sfld: string | null;
    noteMod?: number;
    noteUsn?: number;
    noteFlags?: number;
    cardMod?: number;
    cardUsn?: number;
  }[];
  notesTypes: { id: string | number; schemaHash: string; latexPre: string; latexSvg: boolean }[];
  deckName: string;
  decks: Record<string, Anki2Deck>;
  revlog: RevlogEntry[];
  collectionCreationTime: number;
  deckConfigs: Record<string, Anki2DeckConfig>;
  colConf: ColConf | null;
  graves: { usn: number; oid: number; type: number }[];
};

export function getDataFromAnki2(db: Database): AnkiDB2Data {
  const { models, deckName, decks, colConf, collectionCreationTime } = (() => {
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

    // Parse collection config
    let colConf: ColConf | null = null;
    try {
      colConf = colConfSchema.parse(JSON.parse(colData.conf));
    } catch {
      // keep null
    }

    // Parse decks JSON to extract all deck information
    let deckName = "Unknown";
    let decks: Record<string, Anki2Deck> = {};
    try {
      const parsedDecks = deckSchema.parse(JSON.parse(colData.decks));

      // Convert to our format, filtering out entries without names
      decks = Object.fromEntries(
        Object.entries(parsedDecks)
          .filter(([_, deck]) => deck.name)
          .map(([id, deck]) => [
            id,
            {
              id: deck.id,
              name: deck.name!,
              description: deck.desc || undefined,
              mod: deck.mod,
              usn: deck.usn,
              lrnToday: deck.lrnToday,
              revToday: deck.revToday,
              newToday: deck.newToday,
              timeToday: deck.timeToday,
              collapsed: deck.collapsed,
              browserCollapsed: deck.browserCollapsed,
              conf: deck.conf,
              dyn: deck.dyn,
              extendNew: deck.extendNew,
              extendRev: deck.extendRev,
            },
          ]),
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

    return {
      models: parsedModels,
      deckName,
      decks,
      colConf,
      collectionCreationTime: colData.crt ?? 0,
    };
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
      mod: number;
      usn: number;
      flags: number;
    }>(
      db,
      "SELECT id, guid, cast(mid as text) as modelId, tags, flds as fields, data, sfld, csum, mod, usn, flags FROM notes",
    );

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
      mod: number;
      usn: number;
    }>(
      db,
      "SELECT id, nid, ord, did, odid, type, queue, due, ivl, factor, reps, lapses, odue, flags, left, data, mod, usn FROM cards",
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
        const fieldDescriptions = Object.fromEntries(
          modelForCard.flds
            .filter((fld) => fld.description)
            .map((fld) => [fld.name, fld.description!]),
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
          ankiCardId: cardRow.id,
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
          fieldDescriptions,
          noteData: note.data || null,
          csum: note.csum ?? null,
          sfld: note.sfld ?? null,
          scheduling: buildScheduling(cardRow),
          noteMod: note.mod,
          noteUsn: note.usn,
          noteFlags: note.flags,
          cardMod: cardRow.mod,
          cardUsn: cardRow.usn,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  })();

  const revlog = parseRevlog(db);

  // Parse deck configs from col.dconf JSON (anki2 format)
  const deckConfigs = (() => {
    try {
      const colData = executeQuery<{ dconf: string }>(db, "SELECT dconf FROM col");
      const parsed = dconfSchema.parse(JSON.parse(colData.dconf));
      const result: Record<string, Anki2DeckConfig> = {};
      for (const [id, config] of Object.entries(parsed)) {
        result[id] = {
          id: config.id,
          name: config.name,
          learnSteps: config.new?.delays,
          relearnSteps: config.lapse?.delays,
          new: config.new,
          rev: config.rev,
          lapse: config.lapse,
          maxTaken: config.maxTaken,
          autoplay: config.autoplay,
          timer: config.timer,
          replayq: config.replayq,
          dyn: config.dyn,
          mod: config.mod,
          usn: config.usn,
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
        db,
        "SELECT usn, oid, type FROM graves",
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
    return {
      id: model.id,
      schemaHash: stringHash(hashInput).toString(16),
      latexPre: model.latexPre ?? "",
      latexSvg: model.latexsvg ?? false,
    };
  });

  return {
    cards,
    notesTypes,
    deckName,
    decks,
    revlog,
    collectionCreationTime,
    deckConfigs,
    colConf,
    graves,
  };
}

/**
 * Parse FSRS memory state from card.data.
 * Supports both JSON format ({s, d, dr}) and protobuf format (FSRSMemoryState).
 */
export function parseFsrsData(data: string | Uint8Array): CardScheduling["fsrs"] {
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
function parseFsrsProtobuf(data: Uint8Array): CardScheduling["fsrs"] {
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
