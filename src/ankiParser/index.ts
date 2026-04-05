import { getAnkiDataFromZip } from "./unzipAnki";
import initSqlJs from "sql.js";
import wasm from "sql.js/dist/sql-wasm.wasm?url";
import { AnkiDB21bData, getDataFromAnki21b } from "./anki21b";
import { AnkiDB2Data, getDataFromAnki2 } from "./anki2";

export type AnkiData = {
  files: Map<string, string>;
  cards: AnkiDB2Data["cards"] | AnkiDB21bData["cards"];
  deckName: string;
  decks: Record<string, { id: number; name: string }>;
  notesTypes: AnkiDB2Data["notesTypes"] | AnkiDB21bData["notesTypes"];
  collectionCreationTime: number;
  deckConfigs: AnkiDB2Data["deckConfigs"] | Record<string, never>;
};

export async function getAnkiDataFromBlob(file: Blob): Promise<AnkiData> {
  const { ankiDb, files } = await getAnkiDataFromZip(file);

  const SQL = await initSqlJs({ locateFile: () => wasm });
  const db = new SQL.Database(ankiDb.array);

  if (ankiDb.type === "21b") {
    const { cards, deckName, decks, notesTypes, collectionCreationTime } = getDataFromAnki21b(db);
    return { cards, files, deckName, decks, notesTypes, collectionCreationTime, deckConfigs: {} };
  }

  const { cards, deckName, decks, notesTypes, collectionCreationTime, deckConfigs } =
    getDataFromAnki2(db);
  return { cards, files, deckName, decks, notesTypes, collectionCreationTime, deckConfigs };
}
