import { createDatabase } from "~/utils/sql";
import { BlobWriter, ZipWriter, BlobReader } from "@zip-js/zip-js";
import type { AnkiDeckSpec } from "../lib/ollama";
import { stringHash, ANKI_DEFAULT_CSS } from "../utils/constants";

function generateId(): number {
  return Date.now() + Math.floor(Math.random() * 1000);
}

function fieldChecksum(field: string): number {
  return stringHash(field.replace(/<[^>]*>/g, "").trim());
}

function guidFromId(id: number): string {
  // Generate a base91-like GUID from an ID
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";
  let result = "";
  let n = id;
  while (n > 0) {
    result += chars[n % chars.length];
    n = Math.floor(n / chars.length);
  }
  return result.padEnd(10, chars[0]!);
}

const ANKI2_SCHEMA = `
CREATE TABLE IF NOT EXISTS col (
  id integer primary key,
  crt integer not null,
  mod integer not null,
  scm integer not null,
  ver integer not null,
  dty integer not null,
  usn integer not null,
  ls integer not null,
  conf text not null,
  models text not null,
  decks text not null,
  dconf text not null,
  tags text not null
);

CREATE TABLE IF NOT EXISTS notes (
  id integer primary key,
  guid text not null,
  mid integer not null,
  mod integer not null,
  usn integer not null,
  tags text not null,
  flds text not null,
  sfld integer not null,
  csum integer not null,
  flags integer not null,
  data text not null
);

CREATE TABLE IF NOT EXISTS cards (
  id integer primary key,
  nid integer not null,
  did integer not null,
  ord integer not null,
  mod integer not null,
  usn integer not null,
  type integer not null,
  queue integer not null,
  due integer not null,
  ivl integer not null,
  factor integer not null,
  reps integer not null,
  lapses integer not null,
  left integer not null,
  odue integer not null,
  odid integer not null,
  flags integer not null,
  data text not null
);

CREATE TABLE IF NOT EXISTS revlog (
  id integer primary key,
  cid integer not null,
  usn integer not null,
  ease integer not null,
  ivl integer not null,
  lastIvl integer not null,
  factor integer not null,
  time integer not null,
  type integer not null
);

CREATE TABLE IF NOT EXISTS graves (
  usn integer not null,
  oid integer not null,
  type integer not null
);
`;

const DEFAULT_CSS = ANKI_DEFAULT_CSS;

const DEFAULT_CONF = JSON.stringify({
  activeDecks: [1],
  curDeck: 1,
  newSpread: 0,
  collapseTime: 1200,
  timeLim: 0,
  estTimes: true,
  dueCounts: true,
  curModel: null,
  nextPos: 1,
  sortType: "noteFld",
  sortBackwards: false,
  addToCur: true,
});

const DEFAULT_DCONF = JSON.stringify({
  "1": {
    id: 1,
    mod: 0,
    name: "Default",
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: { delays: [1, 10], ints: [1, 4, 7], initialFactor: 2500, order: 1, perDay: 20 },
    rev: { perDay: 200, ease4: 1.3, ivlFct: 1, maxIvl: 36500, fuzz: 0.05 },
    lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 0 },
    dyn: false,
  },
});

export async function createApkg(spec: AnkiDeckSpec): Promise<Blob> {
  const db = await createDatabase();

  // Create schema
  db.run(ANKI2_SCHEMA);

  const now = Math.floor(Date.now() / 1000);
  const deckId = generateId();
  const modelId = generateId() + 1;

  // Single "Basic" note type with fixed Front/Back fields and standard template
  const models = JSON.stringify({
    [modelId]: {
      id: modelId,
      name: "Basic",
      type: 0,
      mod: now,
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [
        {
          name: "Card 1",
          ord: 0,
          qfmt: "{{Front}}",
          afmt: '{{FrontSide}}<hr id="answer">{{Back}}',
          bqfmt: "",
          bafmt: "",
          did: null,
          bfont: "",
          bsize: 0,
        },
      ],
      flds: [
        { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
        { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
      ],
      css: DEFAULT_CSS,
      latexPre: "",
      latexPost: "",
      latexsvg: false,
      req: [[0, "any", [0]]],
      tags: [],
      vers: [],
    },
  });

  // Build decks JSON
  const decks = JSON.stringify({
    "1": {
      id: 1,
      mod: now,
      name: "Default",
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      desc: "",
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
    },
    [deckId]: {
      id: deckId,
      mod: now,
      name: spec.deckName,
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      desc: "",
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
    },
  });

  // Insert collection row
  db.run(
    "INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [1, now, now, now * 1000, 11, 0, -1, 0, DEFAULT_CONF, models, decks, DEFAULT_DCONF, "{}"],
  );

  // Insert notes and cards — use a counter from a base timestamp to avoid ID collisions
  let nextId = Date.now();

  for (let i = 0; i < spec.cards.length; i++) {
    const card = spec.cards[i]!;
    const noteId = nextId++;
    const cardId = nextId++;
    const guid = guidFromId(noteId);
    const flds = `${card.front}\x1f${card.back}`;
    const csum = fieldChecksum(card.front);
    const tags = (card.tags ?? []).join(" ");

    db.run(
      "INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [noteId, guid, modelId, now, -1, tags ? ` ${tags} ` : "", flds, card.front, csum, 0, ""],
    );

    db.run(
      "INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [cardId, noteId, deckId, 0, now, -1, 0, 0, i, 0, 0, 0, 0, 0, 0, 0, 0, ""],
    );
  }

  // Export database to binary
  const dbData = db.export();
  db.close();

  // Create ZIP (.apkg)
  const zipWriter = new ZipWriter(new BlobWriter("application/zip"));

  await zipWriter.add("collection.anki2", new BlobReader(new Blob([new Uint8Array(dbData)])));
  // Empty media mapping
  await zipWriter.add("media", new BlobReader(new Blob([JSON.stringify({})])));

  return await zipWriter.close();
}
