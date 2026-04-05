import initSqlJs, { Database } from "sql.js";
import protobuf from "protobufjs";
import fieldConfigProto from "../anki21b/proto/field.proto?raw";
import templatesProto from "../anki21b/proto/templates.proto?raw";
import path from "path";

async function getSQLInstance() {
  const wasmPath = path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  return await initSqlJs({
    locateFile: () => wasmPath,
  });
}

export async function createAnki2Database(): Promise<Database> {
  const SQL = await getSQLInstance();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE col (
      id INTEGER PRIMARY KEY,
      crt INTEGER NOT NULL,
      mod INTEGER NOT NULL,
      scm INTEGER NOT NULL,
      ver INTEGER NOT NULL,
      dty INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      ls INTEGER NOT NULL,
      conf TEXT NOT NULL,
      models TEXT NOT NULL,
      decks TEXT NOT NULL,
      dconf TEXT NOT NULL,
      tags TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      guid TEXT NOT NULL,
      mid INTEGER NOT NULL,
      mod INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      tags TEXT NOT NULL,
      flds TEXT NOT NULL,
      sfld TEXT NOT NULL,
      csum INTEGER NOT NULL,
      flags INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY,
      nid INTEGER NOT NULL,
      did INTEGER NOT NULL,
      ord INTEGER NOT NULL,
      mod INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      type INTEGER NOT NULL,
      queue INTEGER NOT NULL,
      due INTEGER NOT NULL,
      ivl INTEGER NOT NULL,
      factor INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      lapses INTEGER NOT NULL,
      left INTEGER NOT NULL,
      odue INTEGER NOT NULL,
      odid INTEGER NOT NULL,
      flags INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  return db;
}

export async function createAnki21bDatabase(): Promise<Database> {
  const SQL = await getSQLInstance();
  const db = new SQL.Database();

  db.run(`
    CREATE TABLE notetypes (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      mtime_secs INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      config BLOB NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE fields (
      ntid INTEGER NOT NULL,
      ord INTEGER NOT NULL,
      name TEXT NOT NULL,
      config BLOB NOT NULL,
      PRIMARY KEY (ntid, ord)
    );
  `);

  db.run(`
    CREATE TABLE templates (
      ntid INTEGER NOT NULL,
      ord INTEGER NOT NULL,
      name TEXT NOT NULL,
      mtime_secs INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      config BLOB NOT NULL,
      PRIMARY KEY (ntid, ord)
    );
  `);

  db.run(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      guid TEXT NOT NULL,
      mid INTEGER NOT NULL,
      mod INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      tags TEXT NOT NULL,
      flds TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY,
      nid INTEGER NOT NULL,
      did INTEGER NOT NULL,
      ord INTEGER NOT NULL,
      mod INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      type INTEGER NOT NULL,
      queue INTEGER NOT NULL,
      due INTEGER NOT NULL,
      ivl INTEGER NOT NULL,
      factor INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      lapses INTEGER NOT NULL,
      left INTEGER NOT NULL,
      odue INTEGER NOT NULL,
      odid INTEGER NOT NULL,
      flags INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE decks (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      mtime_secs INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      common BLOB NOT NULL,
      kind BLOB NOT NULL
    );
  `);

  return db;
}

export interface Anki2Note {
  id: number;
  modelId: string;
  tags: string[];
  fields: Record<string, string>;
}

export interface Anki2Model {
  id: string;
  css: string;
  latexPre: string;
  latexPost: string;
  type?: number; // 0=MODEL_STD, 1=MODEL_CLOZE
  latexsvg?: boolean;
  req?: [number, string, number[]][];
  fields: { name: string }[];
  templates: {
    name: string;
    afmt: string;
    qfmt: string;
    ord: number;
  }[];
}

export function insertAnki2Data(db: Database, models: Anki2Model[], notes: Anki2Note[]): void {
  const modelsObj = Object.fromEntries(models.map((m) => [m.id, m]));

  const colData = {
    conf: "{}",
    models: JSON.stringify(
      Object.fromEntries(
        models.map((m) => [
          m.id,
          {
            id: m.id,
            css: m.css,
            latexPre: m.latexPre,
            latexPost: m.latexPost,
            ...(m.type !== undefined ? { type: m.type } : {}),
            ...(m.latexsvg !== undefined ? { latexsvg: m.latexsvg } : {}),
            ...(m.req !== undefined ? { req: m.req } : {}),
            flds: m.fields,
            tmpls: m.templates,
          },
        ]),
      ),
    ),
    decks: JSON.stringify({
      "1": {
        id: 1,
        name: "Default",
        mod: 0,
        usn: 0,
        lrnToday: [0, 0],
        revToday: [0, 0],
        newToday: [0, 0],
        timeToday: [0, 0],
        collapsed: false,
        browserCollapsed: false,
        desc: "",
        dyn: 0,
        conf: 1,
      },
    }),
    dconf: "{}",
    tags: "{}",
  };

  db.run(
    `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
     VALUES (1, 0, 0, 0, 11, 0, 0, 0, ?, ?, ?, ?, ?)`,
    [colData.conf, colData.models, colData.decks, colData.dconf, colData.tags],
  );

  for (const note of notes) {
    const model = modelsObj[note.modelId];
    if (!model) {
      throw new Error(`Model ${note.modelId} not found`);
    }

    const fieldValues = model.fields.map((f) => note.fields[f.name] ?? "");
    const fldsString = fieldValues.join("\x1F");
    // Anki stores tags as space-delimited with leading/trailing spaces
    const tagsString = note.tags.length > 0 ? ` ${note.tags.join(" ")} ` : "";

    db.run(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (?, ?, ?, 0, 0, ?, ?, '', 0, 0, '')`,
      [note.id, `guid${note.id}`, note.modelId, tagsString, fldsString],
    );

    // Insert one card per template (Anki generates one card per template ordinal)
    for (const tmpl of model.templates) {
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (?, ?, 1, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
        [note.id * 1000 + tmpl.ord, note.id, tmpl.ord],
      );
    }
  }
}

export interface Anki21bNote {
  id: number;
  mid: string;
  tags: string[];
  fields: Record<string, string>;
}

export interface Anki21bField {
  ntid: string;
  ord: number;
  name: string;
  config: {
    sticky?: boolean;
    rtl?: boolean;
    fontName?: string;
    fontSize?: number;
    description?: string;
    plainText?: boolean;
    collapsed?: boolean;
    excludeFromSearch?: boolean;
    preventDeletion?: boolean;
  };
}

export interface Anki21bTemplate {
  ntid: string;
  ord: number;
  name: string;
  qFormat: string;
  aFormat: string;
}

export interface Anki21bNotetype {
  id: string;
  name: string;
  config: {
    css?: string;
    latexPre?: string;
    latexPost?: string;
    latexSvg?: boolean;
    kind?: number;
    reqs?: { kind: number; fieldOrds: number[] }[];
  };
}

export function insertAnki21bData(
  db: Database,
  notetypes: Anki21bNotetype[],
  fields: Anki21bField[],
  templates: Anki21bTemplate[],
  notes: Anki21bNote[],
): void {
  const { root: notesTypeRoot } = protobuf.parse(
    `
    syntax = "proto3";
    message NotesTypeConfig {
      int32 kind = 1;
      int32 sortFieldIdx = 2;
      string css = 3;
      int64 targetDeckIdUnused = 4;
      string latexPre = 5;
      string latexPost = 6;
      bool latexSvg = 7;
      repeated Requirement reqs = 8;
      int64 originalId = 9;
      int32 originalStockKind = 10;
      bytes other = 255;
    }
    message Requirement {
      int32 kind = 1;
      repeated int32 fieldOrds = 2;
    }
  `,
    { keepCase: true },
  );

  const NotesTypeConfig = notesTypeRoot.lookupType("NotesTypeConfig");

  for (const notetype of notetypes) {
    const message = NotesTypeConfig.create({
      kind: notetype.config.kind ?? 0,
      sortFieldIdx: 0,
      css: notetype.config.css ?? "",
      targetDeckIdUnused: 0,
      latexPre: notetype.config.latexPre ?? "",
      latexPost: notetype.config.latexPost ?? "",
      latexSvg: notetype.config.latexSvg ?? false,
      reqs: notetype.config.reqs ?? [],
      originalId: 0,
      originalStockKind: 0,
      other: Buffer.from([]),
    });

    const configData = NotesTypeConfig.encode(message).finish();

    db.run(`INSERT INTO notetypes (id, name, mtime_secs, usn, config) VALUES (?, ?, 0, 0, ?)`, [
      notetype.id,
      notetype.name,
      configData,
    ]);
  }

  const { root: fieldRoot } = protobuf.parse(fieldConfigProto);
  const FieldConfig = fieldRoot.lookupType("FieldConfig");

  for (const field of fields) {
    const configData = FieldConfig.encode({
      sticky: field.config.sticky || false,
      rtl: field.config.rtl || false,
      fontName: field.config.fontName || "Arial",
      fontSize: field.config.fontSize || 20,
      description: field.config.description || "",
      plainText: field.config.plainText || false,
      collapsed: field.config.collapsed || false,
      excludeFromSearch: field.config.excludeFromSearch || false,
      preventDeletion: field.config.preventDeletion || false,
      other: new Uint8Array(),
    }).finish();

    db.run(`INSERT INTO fields (ntid, ord, name, config) VALUES (?, ?, ?, ?)`, [
      field.ntid,
      field.ord,
      field.name,
      configData,
    ]);
  }

  const { root: templateRoot } = protobuf.parse(templatesProto);
  const TemplateConfig = templateRoot.lookupType("TemplateConfig");

  for (const template of templates) {
    const configData = TemplateConfig.encode({
      qFormat: template.qFormat,
      aFormat: template.aFormat,
      id: 0,
    }).finish();

    db.run(
      `INSERT INTO templates (ntid, ord, name, mtime_secs, usn, config) VALUES (?, ?, ?, 0, 0, ?)`,
      [template.ntid, template.ord, template.name, configData],
    );
  }

  // Insert a default deck
  db.run(
    `INSERT INTO decks (id, name, mtime_secs, usn, common, kind) VALUES (1, 'Default', 0, 0, X'', X'')`,
  );

  for (const note of notes) {
    const noteFields = fields.filter((f) => f.ntid === note.mid);
    const fieldValues = noteFields
      .sort((a, b) => a.ord - b.ord)
      .map((f) => note.fields[f.name] ?? "");
    const fldsString = fieldValues.join("\x1F");
    // Anki stores tags as space-delimited with leading/trailing spaces
    const tagsString = note.tags.length > 0 ? ` ${note.tags.join(" ")} ` : "";

    db.run(`INSERT INTO notes (id, guid, mid, mod, usn, tags, flds) VALUES (?, ?, ?, 0, 0, ?, ?)`, [
      note.id,
      `guid${note.id}`,
      note.mid,
      tagsString,
      fldsString,
    ]);

    // Insert one card per template for this note
    const noteTemplates = templates.filter((t) => t.ntid === note.mid);
    for (const tmpl of noteTemplates) {
      db.run(
        `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
         VALUES (?, ?, 1, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
        [note.id * 1000 + tmpl.ord, note.id, tmpl.ord],
      );
    }
  }
}
