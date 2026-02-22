import { Database } from "sql.js";
import { executeQuery, executeQueryAll } from "~/utils/sql";
import { modelSchema } from "./jsonParsers";
import { z } from "zod";
import { assertTruthy } from "~/utils/assert";

export type AnkiDB2Data = {
  cards: {
    values: {
      [k: string]: string | null;
    };
    tags: string[];
    templates: z.infer<typeof modelSchema>[string]["tmpls"];
    deckName: string;
  }[];
  notesTypes: null;
  deckName: string;
  decks: Record<string, { id: number; name: string }>;
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
    const notes = executeQueryAll<{ id: number; modelId: string; tags: string; fields: string }>(
      db,
      "SELECT id, cast(mid as text) as modelId, tags, flds as fields FROM notes",
    );

    // Query cards table to get deck IDs for each note
    const cardsDeckInfo = executeQueryAll<{ nid: number; did: number }>(
      db,
      "SELECT nid, did FROM cards",
    );

    // Create a map from note ID to deck ID (use first card's deck if multiple cards per note)
    const noteToDeckId = new Map<number, number>();
    for (const card of cardsDeckInfo) {
      if (!noteToDeckId.has(card.nid)) {
        noteToDeckId.set(card.nid, card.did);
      }
    }

    return notes.map((note) => {
      const modelForCard = models[note.modelId];
      assertTruthy(modelForCard, `Model ${note.modelId} not found`);

      const keys = modelForCard.flds.map((fld) => fld.name);
      const values = note.fields.split("\x1F");
      const valuesMap = Object.fromEntries(keys.map((key, index) => [key, values[index] || null]));

      // Get deck name for this note
      const deckId = noteToDeckId.get(note.id);
      const cardDeckName =
        deckId !== undefined ? (decks[deckId.toString()]?.name ?? "Unknown") : "Unknown";

      return {
        values: valuesMap,
        tags: note.tags.split("\x1F"),
        templates: modelForCard.tmpls,
        deckName: cardDeckName,
      };
    });
  })();

  return { cards, notesTypes: null, deckName, decks };
}
