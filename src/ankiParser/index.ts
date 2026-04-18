import { getAnkiDataFromZip } from "./unzipAnki";
import { createDatabase } from "~/utils/sql";
import { AnkiDB21bData, getDataFromAnki21b } from "./anki21b";
import { AnkiDB2Data, getDataFromAnki2 } from "./anki2";

export type AnkiData = {
  files: Map<string, string>;
  cards: AnkiDB2Data["cards"] | AnkiDB21bData["cards"];
  deckName: string;
  decks: AnkiDB2Data["decks"] | AnkiDB21bData["decks"];
  notesTypes: AnkiDB2Data["notesTypes"] | AnkiDB21bData["notesTypes"];
  collectionCreationTime: number;
  deckConfigs: AnkiDB2Data["deckConfigs"] | AnkiDB21bData["deckConfigs"];
  colConf: AnkiDB2Data["colConf"] | null;
};

export async function getAnkiDataFromBlob(file: Blob): Promise<AnkiData> {
  const { ankiDb, files } = await getAnkiDataFromZip(file);

  const db = await createDatabase(ankiDb.array);

  if (ankiDb.type === "21b") {
    const { cards, deckName, decks, notesTypes, collectionCreationTime, deckConfigs } =
      getDataFromAnki21b(db);
    return {
      cards,
      files,
      deckName,
      decks,
      notesTypes,
      collectionCreationTime,
      deckConfigs,
      colConf: null,
    };
  }

  const { cards, deckName, decks, notesTypes, collectionCreationTime, deckConfigs, colConf } =
    getDataFromAnki2(db);
  return {
    cards,
    files,
    deckName,
    decks,
    notesTypes,
    collectionCreationTime,
    deckConfigs,
    colConf,
  };
}

/**
 * Parse a raw SQLite database (as returned by the Anki sync download endpoint).
 * Auto-detects whether the DB uses anki2 (JSON col table) or anki21b (protobuf notetypes table) format.
 */
export async function getAnkiDataFromSqlite(
  sqliteBytes: Uint8Array,
  mediaFiles?: Map<string, string>,
): Promise<AnkiData> {
  const db = await createDatabase(sqliteBytes);
  const files = mediaFiles ?? new Map<string, string>();

  try {
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = new Set((tables[0]?.values ?? []).map((row) => row[0] as string));

    if (tableNames.has("notetypes")) {
      const { cards, deckName, decks, notesTypes, collectionCreationTime, deckConfigs } =
        getDataFromAnki21b(db);
      return {
        cards,
        files,
        deckName,
        decks,
        notesTypes,
        collectionCreationTime,
        deckConfigs,
        colConf: null,
      };
    }

    const { cards, deckName, decks, notesTypes, collectionCreationTime, deckConfigs, colConf } =
      getDataFromAnki2(db);
    return {
      cards,
      files,
      deckName,
      decks,
      notesTypes,
      collectionCreationTime,
      deckConfigs,
      colConf,
    };
  } finally {
    db.close();
  }
}
