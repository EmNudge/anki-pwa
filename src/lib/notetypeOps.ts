import { type Database } from "sql.js";
import { executeQueryAll } from "~/utils/sql";
import {
  encodeNotesTypeConfig,
  encodeFieldConfig,
  encodeTemplateConfig,
  parseNotesTypeConfigProto,
  parseFieldConfigProto,
  parseTemplatesProto,
  type Anki21bFieldConfig,
} from "~/ankiParser/anki21b/proto";

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function generateId(): number {
  // Anki uses millisecond timestamps with some randomness
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

// --- Query helpers ---

export function getNotetypeUsageCounts(db: Database): Map<string, number> {
  const rows = executeQueryAll<{ mid: string; cnt: number }>(
    db,
    "SELECT cast(mid as text) as mid, COUNT(*) as cnt FROM notes GROUP BY mid",
  );
  return new Map(rows.map((r) => [r.mid, r.cnt]));
}

interface NotetypeRow {
  id: string;
  name: string;
  config: Uint8Array;
}

export function getAllNotetypes(db: Database): NotetypeRow[] {
  return executeQueryAll<NotetypeRow>(
    db,
    "SELECT cast(id as text) as id, name, config FROM notetypes",
  );
}

interface FieldRow {
  ntid: string;
  ord: number;
  name: string;
  config: Uint8Array;
}

export function getFieldsForNotetype(db: Database, ntid: string): FieldRow[] {
  return executeQueryAll<FieldRow>(
    db,
    "SELECT cast(ntid as text) as ntid, ord, name, config FROM fields WHERE ntid=? ORDER BY ord",
    [ntid] as unknown as Record<string, string>,
  ).sort((a, b) => a.ord - b.ord);
}

interface TemplateRow {
  ntid: string;
  ord: number;
  name: string;
  config: Uint8Array;
}

export function getTemplatesForNotetype(db: Database, ntid: string): TemplateRow[] {
  return executeQueryAll<TemplateRow>(
    db,
    "SELECT cast(ntid as text) as ntid, ord, name, config FROM templates WHERE ntid=? ORDER BY ord",
    [ntid] as unknown as Record<string, string>,
  ).sort((a, b) => a.ord - b.ord);
}

// --- Mutations ---

interface CreateNotetypeOptions {
  name: string;
  kind?: number; // 0=normal, 1=cloze
  originalStockKind?: number; // 6=image occlusion
  css?: string;
  fields: { name: string; config?: Partial<Anki21bFieldConfig> }[];
  templates: { name: string; qfmt: string; afmt: string }[];
}

export function createNotetype(db: Database, options: CreateNotetypeOptions): string {
  const id = generateId();
  const idStr = String(id);
  const mtime = now();

  const configBlob = encodeNotesTypeConfig({
    kind: options.kind ?? 0,
    originalStockKind: options.originalStockKind ?? 0,
    css: options.css ?? ".card {\n  font-family: arial;\n  font-size: 20px;\n  text-align: center;\n  color: black;\n  background-color: white;\n}\n",
  });

  db.run("INSERT INTO notetypes (id, name, mtime_secs, usn, config) VALUES (?, ?, ?, -1, ?)", [
    id,
    options.name,
    mtime,
    configBlob,
  ]);

  for (let i = 0; i < options.fields.length; i++) {
    const field = options.fields[i]!;
    const fieldConfig = encodeFieldConfig(field.config ?? {});
    db.run("INSERT INTO fields (ntid, ord, name, config) VALUES (?, ?, ?, ?)", [
      id,
      i,
      field.name,
      fieldConfig,
    ]);
  }

  for (let i = 0; i < options.templates.length; i++) {
    const tmpl = options.templates[i]!;
    const tmplConfig = encodeTemplateConfig({
      qFormat: tmpl.qfmt,
      aFormat: tmpl.afmt,
    });
    db.run(
      "INSERT INTO templates (ntid, ord, name, mtime_secs, usn, config) VALUES (?, ?, ?, ?, -1, ?)",
      [id, i, tmpl.name, mtime, tmplConfig],
    );
  }

  return idStr;
}

export function cloneNotetype(db: Database, sourceNtid: string, newName: string): string {
  const newId = generateId();
  const mtime = now();

  // Copy notetype row
  const rows = db.exec("SELECT config FROM notetypes WHERE id=?", [Number(sourceNtid)]);
  const configBlob = rows[0]?.values[0]?.[0] as Uint8Array;
  if (!configBlob) throw new Error(`Notetype ${sourceNtid} not found`);

  db.run("INSERT INTO notetypes (id, name, mtime_secs, usn, config) VALUES (?, ?, ?, -1, ?)", [
    newId,
    newName,
    mtime,
    configBlob,
  ]);

  // Copy fields
  const fields = getFieldsForNotetype(db, sourceNtid);
  for (const field of fields) {
    db.run("INSERT INTO fields (ntid, ord, name, config) VALUES (?, ?, ?, ?)", [
      newId,
      field.ord,
      field.name,
      field.config,
    ]);
  }

  // Copy templates
  const templates = getTemplatesForNotetype(db, sourceNtid);
  for (const tmpl of templates) {
    db.run(
      "INSERT INTO templates (ntid, ord, name, mtime_secs, usn, config) VALUES (?, ?, ?, ?, -1, ?)",
      [newId, tmpl.ord, tmpl.name, mtime, tmpl.config],
    );
  }

  return String(newId);
}

export function renameNotetype(db: Database, ntid: string, newName: string): void {
  db.run("UPDATE notetypes SET name=?, mtime_secs=?, usn=-1 WHERE id=?", [
    newName,
    now(),
    Number(ntid),
  ]);
}

export function updateNotetypeCss(db: Database, ntid: string, css: string): void {
  const rows = db.exec("SELECT config FROM notetypes WHERE id=?", [Number(ntid)]);
  const configBlob = rows[0]?.values[0]?.[0] as Uint8Array;
  if (!configBlob) return;

  const parsed = parseNotesTypeConfigProto(configBlob);
  const newConfig = encodeNotesTypeConfig({ ...parsed, css });
  db.run("UPDATE notetypes SET config=?, mtime_secs=?, usn=-1 WHERE id=?", [
    newConfig,
    now(),
    Number(ntid),
  ]);
}

export function addField(db: Database, ntid: string, fieldName: string, ord: number): void {
  const mtime = now();
  const ntidNum = Number(ntid);

  // Shift existing fields at or after this ordinal
  db.run("UPDATE fields SET ord = ord + 1 WHERE ntid=? AND ord >= ?", [ntidNum, ord]);

  // Insert new field
  const fieldConfig = encodeFieldConfig({});
  db.run("INSERT INTO fields (ntid, ord, name, config) VALUES (?, ?, ?, ?)", [
    ntidNum,
    ord,
    fieldName,
    fieldConfig,
  ]);

  // Pad existing notes' flds with empty segment at the right position
  const notes = executeQueryAll<{ id: number; flds: string }>(
    db,
    "SELECT id, flds FROM notes WHERE mid=?",
    [ntidNum] as unknown as Record<string, string>,
  );

  for (const note of notes) {
    const segments = note.flds.split("\x1f");
    segments.splice(ord, 0, "");
    db.run("UPDATE notes SET flds=?, mod=?, usn=-1 WHERE id=?", [
      segments.join("\x1f"),
      mtime,
      note.id,
    ]);
  }

  db.run("UPDATE notetypes SET mtime_secs=?, usn=-1 WHERE id=?", [mtime, ntidNum]);
}

export function removeField(db: Database, ntid: string, ord: number): void {
  const mtime = now();
  const ntidNum = Number(ntid);

  // Delete the field
  db.run("DELETE FROM fields WHERE ntid=? AND ord=?", [ntidNum, ord]);

  // Shift subsequent fields down
  db.run("UPDATE fields SET ord = ord - 1 WHERE ntid=? AND ord > ?", [ntidNum, ord]);

  // Strip the segment from all notes using this notetype
  const notes = executeQueryAll<{ id: number; flds: string }>(
    db,
    "SELECT id, flds FROM notes WHERE mid=?",
    [ntidNum] as unknown as Record<string, string>,
  );

  for (const note of notes) {
    const segments = note.flds.split("\x1f");
    segments.splice(ord, 1);
    db.run("UPDATE notes SET flds=?, mod=?, usn=-1 WHERE id=?", [
      segments.join("\x1f"),
      mtime,
      note.id,
    ]);
  }

  db.run("UPDATE notetypes SET mtime_secs=?, usn=-1 WHERE id=?", [mtime, ntidNum]);
}

export function renameField(db: Database, ntid: string, ord: number, newName: string): void {
  db.run("UPDATE fields SET name=? WHERE ntid=? AND ord=?", [newName, Number(ntid), ord]);
  db.run("UPDATE notetypes SET mtime_secs=?, usn=-1 WHERE id=?", [now(), Number(ntid)]);
}

export function reorderFields(db: Database, ntid: string, newOrdering: number[]): void {
  const mtime = now();
  const ntidNum = Number(ntid);

  // newOrdering[newOrd] = oldOrd — e.g., [2, 0, 1] means: new position 0 gets old field 2
  const fields = getFieldsForNotetype(db, ntid);

  // Remap fields to temporary negative ords to avoid unique constraint conflicts
  for (let newOrd = 0; newOrd < newOrdering.length; newOrd++) {
    const oldOrd = newOrdering[newOrd]!;
    db.run("UPDATE fields SET ord=? WHERE ntid=? AND ord=? AND name=?", [
      -(newOrd + 1),
      ntidNum,
      oldOrd,
      fields[oldOrd]!.name,
    ]);
  }
  // Flip to positive
  db.run("UPDATE fields SET ord = -(ord + 1) WHERE ntid=? AND ord < 0", [ntidNum]);

  // Rearrange flds segments in all notes
  const notes = executeQueryAll<{ id: number; flds: string }>(
    db,
    "SELECT id, flds FROM notes WHERE mid=?",
    [ntidNum] as unknown as Record<string, string>,
  );

  for (const note of notes) {
    const oldSegments = note.flds.split("\x1f");
    const newSegments = newOrdering.map((oldOrd) => oldSegments[oldOrd] ?? "");
    db.run("UPDATE notes SET flds=?, mod=?, usn=-1 WHERE id=?", [
      newSegments.join("\x1f"),
      mtime,
      note.id,
    ]);
  }

  db.run("UPDATE notetypes SET mtime_secs=?, usn=-1 WHERE id=?", [mtime, ntidNum]);
}

export function addTemplate(
  db: Database,
  ntid: string,
  template: { name: string; qfmt: string; afmt: string },
): void {
  const mtime = now();
  const ntidNum = Number(ntid);

  // Determine next ordinal
  const existing = getTemplatesForNotetype(db, ntid);
  const ord = existing.length;

  const tmplConfig = encodeTemplateConfig({
    qFormat: template.qfmt,
    aFormat: template.afmt,
  });

  db.run(
    "INSERT INTO templates (ntid, ord, name, mtime_secs, usn, config) VALUES (?, ?, ?, ?, -1, ?)",
    [ntidNum, ord, template.name, mtime, tmplConfig],
  );

  // Generate a card for each existing note of this notetype
  const notes = executeQueryAll<{ id: number }>(
    db,
    "SELECT id FROM notes WHERE mid=?",
    [ntidNum] as unknown as Record<string, string>,
  );

  for (const note of notes) {
    const cardId = generateId();
    // Get the deck ID from an existing card for this note, or default deck (1)
    const existingCard = db.exec("SELECT did FROM cards WHERE nid=? LIMIT 1", [note.id]);
    const did = existingCard[0]?.values[0]?.[0] ?? 1;
    db.run(
      "INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, ?, ?, ?, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')",
      [cardId, note.id, did, ord, mtime],
    );
  }

  db.run("UPDATE notetypes SET mtime_secs=?, usn=-1 WHERE id=?", [mtime, ntidNum]);
}

export function removeTemplate(db: Database, ntid: string, ord: number): void {
  const mtime = now();
  const ntidNum = Number(ntid);

  // Delete template
  db.run("DELETE FROM templates WHERE ntid=? AND ord=?", [ntidNum, ord]);

  // Shift subsequent templates down
  db.run("UPDATE templates SET ord = ord - 1 WHERE ntid=? AND ord > ?", [ntidNum, ord]);

  // Delete corresponding cards
  db.run("DELETE FROM cards WHERE nid IN (SELECT id FROM notes WHERE mid=?) AND ord=?", [
    ntidNum,
    ord,
  ]);

  // Shift card ords down too
  db.run(
    "UPDATE cards SET ord = ord - 1 WHERE nid IN (SELECT id FROM notes WHERE mid=?) AND ord > ?",
    [ntidNum, ord],
  );

  db.run("UPDATE notetypes SET mtime_secs=?, usn=-1 WHERE id=?", [mtime, ntidNum]);
}

export function updateTemplate(
  db: Database,
  ntid: string,
  ord: number,
  updates: { name?: string; qfmt?: string; afmt?: string },
): void {
  const mtime = now();
  const ntidNum = Number(ntid);

  if (updates.name != null) {
    db.run("UPDATE templates SET name=? WHERE ntid=? AND ord=?", [updates.name, ntidNum, ord]);
  }

  if (updates.qfmt != null || updates.afmt != null) {
    const rows = db.exec("SELECT config FROM templates WHERE ntid=? AND ord=?", [ntidNum, ord]);
    const configBlob = rows[0]?.values[0]?.[0] as Uint8Array | undefined;
    if (configBlob) {
      const parsed = parseTemplatesProto(configBlob);
      const newConfig = encodeTemplateConfig({
        qFormat: updates.qfmt ?? parsed.qFormat,
        aFormat: updates.afmt ?? parsed.aFormat,
        qFormatBrowser: parsed.qFormatBrowser,
        aFormatBrowser: parsed.aFormatBrowser,
        targetDeckId: parsed.targetDeckId,
        browserFontName: parsed.browserFontName,
        browserFontSize: parsed.browserFontSize,
      });
      db.run("UPDATE templates SET config=?, mtime_secs=?, usn=-1 WHERE ntid=? AND ord=?", [
        newConfig,
        mtime,
        ntidNum,
        ord,
      ]);
    }
  }

  db.run("UPDATE notetypes SET mtime_secs=?, usn=-1 WHERE id=?", [mtime, ntidNum]);
}

export function deleteNotetype(db: Database, ntid: string): void {
  const ntidNum = Number(ntid);

  // Check for existing notes
  const countRows = db.exec("SELECT COUNT(*) as cnt FROM notes WHERE mid=?", [ntidNum]);
  const count = Number(countRows[0]?.values[0]?.[0] ?? 0);
  if (count > 0) {
    throw new Error(`Cannot delete notetype: ${count} note(s) still use it`);
  }

  db.run("DELETE FROM templates WHERE ntid=?", [ntidNum]);
  db.run("DELETE FROM fields WHERE ntid=?", [ntidNum]);
  db.run("DELETE FROM notetypes WHERE id=?", [ntidNum]);
}

export function convertNotes(
  db: Database,
  noteIds: number[],
  targetNtid: string,
  fieldMapping: Record<string, string>, // targetFieldName -> sourceFieldName
): void {
  if (noteIds.length === 0) return;

  const mtime = now();
  const targetNtidNum = Number(targetNtid);

  // Get target notetype's fields and templates
  const targetFields = getFieldsForNotetype(db, targetNtid);
  const targetTemplates = getTemplatesForNotetype(db, targetNtid);

  // Get source notetype's fields (from the first note)
  const firstNote = db.exec("SELECT cast(mid as text) as mid FROM notes WHERE id=?", [
    noteIds[0]!,
  ]);
  const sourceMid = String(firstNote[0]?.values[0]?.[0]);
  const sourceFields = getFieldsForNotetype(db, sourceMid);
  const sourceFieldNames = sourceFields.map((f) => f.name);

  for (const noteId of noteIds) {
    // Read current flds
    const noteRow = db.exec("SELECT flds FROM notes WHERE id=?", [noteId]);
    const flds = String(noteRow[0]?.values[0]?.[0] ?? "");
    const sourceSegments = flds.split("\x1f");

    // Build source values map
    const sourceValues: Record<string, string> = {};
    for (let i = 0; i < sourceFieldNames.length; i++) {
      sourceValues[sourceFieldNames[i]!] = sourceSegments[i] ?? "";
    }

    // Remap to target fields
    const newSegments = targetFields.map((tf) => {
      const sourceFieldName = fieldMapping[tf.name];
      return sourceFieldName ? (sourceValues[sourceFieldName] ?? "") : "";
    });

    const newFlds = newSegments.join("\x1f");
    const sfld = (newSegments[0] ?? "").replace(/<[^>]*>/g, "").trim();

    db.run("UPDATE notes SET mid=?, flds=?, sfld=?, mod=?, usn=-1 WHERE id=?", [
      targetNtidNum,
      newFlds,
      sfld,
      mtime,
      noteId,
    ]);

    // Delete existing cards for this note
    db.run("DELETE FROM cards WHERE nid=?", [noteId]);

    // Create new cards — one per target template
    for (let i = 0; i < targetTemplates.length; i++) {
      const cardId = generateId();
      // Use default deck
      db.run(
        "INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) VALUES (?, ?, 1, ?, ?, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')",
        [cardId, noteId, i, mtime],
      );
    }
  }
}

export function updateFieldConfig(
  db: Database,
  ntid: string,
  ord: number,
  updates: Partial<Anki21bFieldConfig>,
): void {
  const ntidNum = Number(ntid);
  const rows = db.exec("SELECT config FROM fields WHERE ntid=? AND ord=?", [ntidNum, ord]);
  const configBlob = rows[0]?.values[0]?.[0] as Uint8Array | undefined;
  if (!configBlob) return;

  const parsed = parseFieldConfigProto(configBlob);
  const newConfig = encodeFieldConfig({ ...parsed, ...updates });
  db.run("UPDATE fields SET config=? WHERE ntid=? AND ord=?", [newConfig, ntidNum, ord]);
  db.run("UPDATE notetypes SET mtime_secs=?, usn=-1 WHERE id=?", [now(), ntidNum]);
}
