import { getNotesType } from "./proto";
import { Database } from "sql.js";
import { executeQuery, executeQueryAll } from "~/utils/sql";
import { parseFieldConfigProto, parseTemplatesProto } from "./proto";
import { assertTruthy } from "~/utils/assert";
import { type CardScheduling, type RevlogEntry } from "../anki2";
import { buildScheduling, resolveCardDeckName, isBlankCard, parseRevlog } from "../shared";

export type AnkiDB21bData = {
  cards: {
    ankiCardId?: number;
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
    guid: string;
    scheduling: CardScheduling | null;
    noteType: number;
    latexSvg: boolean;
    latexPre: string;
    latexPost: string;
    req: [number, string, number[]][] | null;
  }[];
  notesTypes: ReturnType<typeof getNotesType>;
  deckName: string;
  decks: Record<string, { id: number; name: string }>;
  revlog: RevlogEntry[];
  collectionCreationTime: number;
  tagsTable: { tag: string; collapsed: boolean }[];
};

export function getDataFromAnki21b(db: Database): AnkiDB21bData {
  // Extract collection creation time from col table if it exists
  const collectionCreationTime = (() => {
    try {
      const col = executeQuery<{ crt: number }>(db, "SELECT crt FROM col");
      return col.crt ?? 0;
    } catch {
      return 0;
    }
  })();

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

  // Pre-build fields-by-notetype map (sorted by ord) to avoid O(n²) lookups
  const fieldsByNtid = new Map<string, typeof fields>();
  for (const field of fields) {
    let list = fieldsByNtid.get(field.ntid);
    if (!list) {
      list = [];
      fieldsByNtid.set(field.ntid, list);
    }
    list.push(field);
  }
  for (const list of fieldsByNtid.values()) {
    list.sort((a, b) => a.ord - b.ord);
  }

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
  const notesTypeMap = new Map(notesTypes.map((nt) => [nt.id, nt]));

  const cards = (() => {
    /**
     * Notes define content.
     * They have a flds "array" that has its keys as entries in the fields table.
     */
    const notes = executeQueryAll<{
      id: number;
      guid: string;
      flds: string;
      tags: string;
      mid: string;
    }>(db, "SELECT id, guid, flds, tags, cast(mid as text) as mid FROM notes");

    const notesMap = new Map(notes.map((n) => [n.id, n]));

    // Query card rows to drive the output — include scheduling fields
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

        const noteFields = fieldsByNtid.get(note.mid) ?? [];
        const fieldNames = noteFields.map((field) => field.name);

        const allTemplates = templatesMap.get(note.mid);
        assertTruthy(allTemplates, `Template for note ${note.mid} not found`);

        // Find the template matching this card's ordinal
        const matchingTemplate = allTemplates.find((t) => t.ord === cardRow.ord) ?? allTemplates[0];
        assertTruthy(matchingTemplate, `No template found for ord ${cardRow.ord}`);

        const cardDeckName = resolveCardDeckName(cardRow, decks);

        // Get notetype info for this card
        const noteTypeInfo = notesTypeMap.get(note.mid);
        const values = Object.fromEntries(
          note.flds.split("\x1F").map((value, i) => [fieldNames[i], value]),
        );
        const req = (noteTypeInfo?.reqs ?? []).map((r, i) => {
          const mode = r.kind === 0 ? "none" : r.kind === 1 ? "any" : "all";
          const fieldOrds =
            "fieldOrds" in r && Array.isArray(r.fieldOrds)
              ? r.fieldOrds
              : "field_ords" in (r as Record<string, unknown>) &&
                  Array.isArray((r as { field_ords?: unknown[] }).field_ords)
                ? ((r as { field_ords?: number[] }).field_ords ?? [])
                : [];
          return [i, mode, fieldOrds] as [number, string, number[]];
        });

        if (isBlankCard(req, cardRow.ord, fieldNames, values)) {
          return null;
        }

        return {
          ankiCardId: cardRow.id,
          values,
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
          guid: note.guid,
          noteType: noteTypeInfo?.kind ?? 0,
          latexSvg: noteTypeInfo?.latexSvg ?? false,
          latexPre: noteTypeInfo?.latexPre ?? "",
          latexPost: noteTypeInfo?.latexPost ?? "",
          req,
          scheduling: buildScheduling(cardRow),
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
  })();

  const revlog = parseRevlog(db);

  // Parse tags table if it exists (anki21b has a dedicated tags table)
  const tagsTable = (() => {
    try {
      const rows = executeQueryAll<{ tag: string; collapsed: number }>(
        db, "SELECT tag, collapsed FROM tags",
      );
      return rows.map((r) => ({ tag: r.tag, collapsed: r.collapsed !== 0 }));
    } catch {
      return [];
    }
  })();

  return { cards, notesTypes, deckName, decks, revlog, collectionCreationTime, tagsTable };
}
