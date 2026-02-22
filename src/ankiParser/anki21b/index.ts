import { getNotesType } from "./proto";
import { Database } from "sql.js";
import { executeQueryAll, buildNoteToDeckMap, resolveDeckName } from "~/utils/sql";
import { parseFieldConfigProto, parseTemplatesProto } from "./proto";
import { assertTruthy } from "~/utils/assert";

export type AnkiDB21bData = {
  cards: {
    values: {
      [k: string]: string;
    };
    tags: string[];
    templates: {
      name: string;
      afmt: string;
      qfmt: string;
    }[];
    deckName: string;
  }[];
  notesTypes: ReturnType<typeof getNotesType>;
  deckName: string;
  decks: Record<string, { id: number; name: string }>;
};

export function getDataFromAnki21b(db: Database): AnkiDB21bData {
  // Extract all decks from the decks table
  const { decks, deckName } = (() => {
    try {
      const deckRows = executeQueryAll<{ id: number; name: string }>(
        db,
        "SELECT id, name FROM decks",
      );

      const decks = Object.fromEntries(
        deckRows.map((deck) => [deck.id.toString(), { id: deck.id, name: deck.name }]),
      );

      // Use the first non-default deck's name, or "Default" if only default exists
      const deckName =
        deckRows.find((d) => d.name !== "Default")?.name ?? deckRows[0]?.name ?? "Unknown";

      return { decks, deckName };
    } catch (e) {
      console.warn("Failed to parse deck information:", e);
      return { decks: {}, deckName: "Unknown" };
    }
  })();

  /**
   * Fields define the font size and name for each side of a card.
   * Their key is a composite of ntid + ord and is identical to the ntid of one row in templates
   */
  const fields = (() => {
    const fields = executeQueryAll<{
      config: Uint8Array;
      name: string;
      ntid: string;
    }>(db, "SELECT name, config, cast(ntid as text) as ntid FROM fields");

    return fields.map((field) => ({
      ...field,
      config: parseFieldConfigProto(field.config),
    }));
  })();

  const templatesMap = (() => {
    const templates = executeQueryAll<{
      name: string;
      config: Uint8Array;
      ntid: string;
    }>(db, "SELECT name, config, cast(ntid as text) as ntid FROM templates");

    const templatesMap = new Map<string, { name: string; afmt: string; qfmt: string }[]>();

    for (const template of templates) {
      const templateProto = parseTemplatesProto(template.config);

      const { aFormat, qFormat } = templateProto;

      const curTemplate = { name: template.name, afmt: aFormat, qfmt: qFormat };
      templatesMap.set(template.ntid, [...(templatesMap.get(template.ntid) ?? []), curTemplate]);
    }

    return templatesMap;
  })();

  const cards = (() => {
    /**
     * Notes define content.
     * They have a flds "array" that has its keys as entries in the fields table.
     */
    const notes = executeQueryAll<{
      id: number;
      flds: string;
      tags: string;
      mid: string;
    }>(db, "SELECT id, flds, tags, cast(mid as text) as mid FROM notes");

    const noteToDeckId = buildNoteToDeckMap(db);

    return notes.map((note) => {
      const fieldNames = fields
        .filter((field) => note.mid === field.ntid)
        .map((field) => field.name);

      const templates = templatesMap.get(note.mid);
      assertTruthy(templates, `Template for note ${note.mid} not found`);

      const cardDeckName = resolveDeckName(note.id, noteToDeckId, decks);

      return {
        values: Object.fromEntries(
          note.flds.split("\x1F").map((value, i) => [fieldNames[i], value]),
        ),
        // anki21b only has one template per model?
        templates: templates,
        tags: [],
        deckName: cardDeckName,
      };
    });
  })();

  const notesTypes = getNotesType(db);
  return { cards, notesTypes, deckName, decks };
}
