import { Database } from "sql.js";
import { executeQuery, executeQueryAll } from "~/utils/sql";
import { modelSchema } from "./jsonParsers";
import { z } from "zod";
import { assertTruthy } from "~/utils/assert";

export type CardScheduling = {
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  fsrs: { stability: number; difficulty: number; desiredRetention: number } | null;
};

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
};

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
    req: [number, string, number[]][] | null;
  }[];
  notesTypes: null;
  deckName: string;
  decks: Record<string, { id: number; name: string }>;
  revlog: RevlogEntry[];
};

export function getDataFromAnki2(db: Database): AnkiDB2Data {
  const { models, deckName, decks } = (() => {
    // anki2 and anki21 only use the first row of the col table
    // models, decks, and dconf are JSON strings
    const colData = executeQuery<{
      conf: string;
      models: string;
      decks: string;
      dconf: string;
      tags: string;
    }>(db, "SELECT * from col");

    const parsedModels = modelSchema.parse(JSON.parse(colData.models));

    // Parse decks JSON to extract all deck information
    let deckName = "Unknown";
    let decks: Record<string, { id: number; name: string }> = {};
    try {
      const parsedDecks = JSON.parse(colData.decks) as Record<
        string,
        { id: number; name?: string }
      >;

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

    return { models: parsedModels, deckName, decks };
  })();

  const cards = (() => {
    const notes = executeQueryAll<{
      id: number;
      guid: string;
      modelId: string;
      tags: string;
      fields: string;
    }>(db, "SELECT id, guid, cast(mid as text) as modelId, tags, flds as fields FROM notes");

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
      data: string | Uint8Array;
    }>(
      db,
      "SELECT id, nid, ord, did, odid, type, queue, due, ivl, factor, reps, lapses, data FROM cards",
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
          keys.map((key, index) => [key, values[index] || null]),
        );

        // Find the template matching this card's ordinal
        const matchingTemplate =
          modelForCard.tmpls.find((t) => t.ord === cardRow.ord) ?? modelForCard.tmpls[0];
        assertTruthy(matchingTemplate, `No template found for ord ${cardRow.ord}`);

        // Resolve deck name, using odid (original deck) for filtered decks
        const effectiveDid = cardRow.odid !== 0 ? cardRow.odid : cardRow.did;
        const cardDeckName = decks[effectiveDid.toString()]?.name ?? "Unknown";

        // Parse FSRS state from card.data (JSON or protobuf)
        const fsrs = parseFsrsData(cardRow.data);

        return {
          values: valuesMap,
          tags: note.tags.trim().split(/\s+/).filter(Boolean),
          templates: [matchingTemplate],
          css: modelForCard.css,
          deckName: cardDeckName,
          guid: note.guid,
          noteType: modelForCard.type ?? 0,
          latexSvg: modelForCard.latexsvg ?? false,
          req: modelForCard.req ?? null,
          scheduling: {
            type: cardRow.type,
            queue: cardRow.queue,
            due: cardRow.due,
            ivl: cardRow.ivl,
            factor: cardRow.factor,
            reps: cardRow.reps,
            lapses: cardRow.lapses,
            fsrs,
          },
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  })();

  // Parse revlog if the table exists
  const revlog = (() => {
    try {
      return executeQueryAll<RevlogEntry>(
        db,
        "SELECT id, cid, usn, ease, ivl, lastIvl, factor, time, type FROM revlog",
      );
    } catch {
      // revlog table may not exist in all databases
      return [];
    }
  })();

  return { cards, notesTypes: null, deckName, decks, revlog };
}

/**
 * Parse FSRS memory state from card.data.
 * Supports both JSON format ({s, d, dr}) and protobuf format (FSRSMemoryState).
 */
function parseFsrsData(
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
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed.s === "number") {
        return {
          stability: parsed.s,
          difficulty: parsed.d,
          desiredRetention: parsed.dr ?? 0.9,
        };
      }
    } catch {
      // Not JSON — try interpreting as binary if it contains non-printable chars
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
    return { stability, difficulty, desiredRetention: 0.9 };
  }

  return null;
}
