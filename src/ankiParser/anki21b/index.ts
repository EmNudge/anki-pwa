import { getNotesType } from "./proto";
import { Database } from "sql.js";
import { executeQueryAll } from "~/utils/sql";
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
    css: string;
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
      ord: number;
      ntid: string;
    }>(db, "SELECT name, ord, config, cast(ntid as text) as ntid FROM fields");

    return fields.map((field) => ({
      ...field,
      config: parseFieldConfigProto(field.config),
    }));
  })();

  const templatesMap = (() => {
    const templates = executeQueryAll<{
      name: string;
      ord: number;
      config: Uint8Array;
      ntid: string;
    }>(db, "SELECT name, ord, config, cast(ntid as text) as ntid FROM templates");

    const templatesMap = new Map<
      string,
      { name: string; afmt: string; qfmt: string; ord: number }[]
    >();

    for (const template of templates) {
      const templateProto = parseTemplatesProto(template.config);

      const { aFormat, qFormat } = templateProto;

      const curTemplate = {
        name: template.name,
        afmt: aFormat,
        qfmt: qFormat,
        ord: template.ord,
      };
      templatesMap.set(template.ntid, [...(templatesMap.get(template.ntid) ?? []), curTemplate]);
    }

    return templatesMap;
  })();

  const notesTypes = getNotesType(db);
  const notesTypeCssMap = new Map(notesTypes.map((nt) => [nt.id, nt.css]));

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

    const notesMap = new Map(notes.map((n) => [n.id, n]));

    // Query card rows to drive the output
    const cardRows = executeQueryAll<{
      id: number;
      nid: number;
      ord: number;
      did: number;
      odid: number;
    }>(db, "SELECT id, nid, ord, did, odid FROM cards");

    return cardRows
      .map((cardRow) => {
        const note = notesMap.get(cardRow.nid);
        if (!note) return null;

        // Sort fields by ord to ensure correct mapping to \x1F-delimited values
        const noteFields = fields
          .filter((field) => note.mid === field.ntid)
          .sort((a, b) => a.ord - b.ord);
        const fieldNames = noteFields.map((field) => field.name);

        const allTemplates = templatesMap.get(note.mid);
        assertTruthy(allTemplates, `Template for note ${note.mid} not found`);

        // Find the template matching this card's ordinal
        const matchingTemplate = allTemplates.find((t) => t.ord === cardRow.ord) ?? allTemplates[0];
        assertTruthy(matchingTemplate, `No template found for ord ${cardRow.ord}`);

        // Resolve deck name, using odid for filtered decks
        const effectiveDid = cardRow.odid !== 0 ? cardRow.odid : cardRow.did;
        const cardDeckName = decks[effectiveDid.toString()]?.name ?? "Unknown";

        return {
          values: Object.fromEntries(
            note.flds.split("\x1F").map((value, i) => [fieldNames[i], value]),
          ),
          templates: [
            {
              name: matchingTemplate.name,
              afmt: matchingTemplate.afmt,
              qfmt: matchingTemplate.qfmt,
            },
          ],
          css: notesTypeCssMap.get(note.mid) ?? "",
          tags: note.tags.trim().split(/\s+/).filter(Boolean),
          deckName: cardDeckName,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  })();

  return { cards, notesTypes, deckName, decks };
}
