import { test as base, type Page } from '@playwright/test';
import path from 'path';

// ─── State management ────────────────────────────────────────────────

/**
 * Clear all app state: localStorage, IndexedDB review data, and Cache API.
 */
export async function clearAppState(page: Page) {
  await page.evaluate(async () => {
    localStorage.clear();
    const dbReq = indexedDB.deleteDatabase('anki-review-db');
    await new Promise<void>((resolve) => {
      dbReq.onsuccess = () => resolve();
      dbReq.onerror = () => resolve();
      dbReq.onblocked = () => resolve();
    });
    const cache = await caches.open('anki-cache');
    const keys = await cache.keys();
    await Promise.all(keys.map((k) => cache.delete(k)));
  });
}

// ─── .apkg deck loading ──────────────────────────────────────────────

/**
 * Load an .apkg file into the app via the Cache API (legacy blob path).
 * The deck ends up as `kind: "blob"` — not a synced collection.
 */
export async function loadAnkiDeck(page: Page, filename = 'example_music_intervals.apkg') {
  const fs = await import('fs');
  const deckPath = path.join(process.cwd(), 'src/ankiParser/__tests__', filename);
  const fileBuffer = fs.readFileSync(deckPath);

  await page.evaluate(async (fileDataArray) => {
    const uint8Array = new Uint8Array(fileDataArray);
    const blob = new Blob([uint8Array], { type: 'application/octet-stream' });
    const cache = await caches.open('anki-cache');
    await cache.put('anki-deck', new Response(blob));
    window.location.reload();
  }, Array.from(fileBuffer));

  await page.waitForLoadState('networkidle');

  const deckRow = page.locator('.deck-row').first();
  await deckRow.waitFor({ timeout: 30000 });
  await deckRow.click();
  await page.waitForSelector('.card', { timeout: 30000 });
}

// ─── Synced SQLite collection ────────────────────────────────────────

export type IONoteSpec = {
  mode?: 'hide-all-guess-one' | 'hide-one';
  header?: string;
  backExtra?: string;
  numShapes?: number;
};

/**
 * Build a fresh anki21b SQLite database in the browser and return its bytes.
 *
 * The DB always contains:
 * - a "Default" deck
 * - a "Basic" notetype with Front/Back fields + one sample note
 *
 * Optionally, pass `ioNotes` to bake Image Occlusion notes into the DB.
 */
export async function buildSyncedDb(page: Page, ioNotes?: IONoteSpec[]): Promise<number[]> {
  return page.evaluate(async (ioNotes) => {
    const { createDatabase } = await import('/src/utils/sql.ts');
    const { encodeNotesTypeConfig, encodeFieldConfig, encodeTemplateConfig } =
      await import('/src/ankiParser/anki21b/proto/index.ts');
    const db = await createDatabase();

    // Schema
    db.run(`CREATE TABLE notetypes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, mtime_secs INTEGER NOT NULL, usn INTEGER NOT NULL, config BLOB NOT NULL)`);
    db.run(`CREATE TABLE fields (ntid INTEGER NOT NULL, ord INTEGER NOT NULL, name TEXT NOT NULL, config BLOB NOT NULL, PRIMARY KEY (ntid, ord))`);
    db.run(`CREATE TABLE templates (ntid INTEGER NOT NULL, ord INTEGER NOT NULL, name TEXT NOT NULL, mtime_secs INTEGER NOT NULL, usn INTEGER NOT NULL, config BLOB NOT NULL, PRIMARY KEY (ntid, ord))`);
    db.run(`CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT NOT NULL, mid INTEGER NOT NULL, mod INTEGER NOT NULL, usn INTEGER NOT NULL, tags TEXT NOT NULL, flds TEXT NOT NULL, sfld INTEGER NOT NULL DEFAULT 0, csum INTEGER NOT NULL DEFAULT 0, flags INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '')`);
    db.run(`CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER NOT NULL, did INTEGER NOT NULL, ord INTEGER NOT NULL, mod INTEGER NOT NULL, usn INTEGER NOT NULL, type INTEGER NOT NULL, queue INTEGER NOT NULL, due INTEGER NOT NULL, ivl INTEGER NOT NULL, factor INTEGER NOT NULL, reps INTEGER NOT NULL, lapses INTEGER NOT NULL, "left" INTEGER NOT NULL, odue INTEGER NOT NULL, odid INTEGER NOT NULL, flags INTEGER NOT NULL, data TEXT NOT NULL)`);
    db.run(`CREATE TABLE decks (id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, mtime_secs INTEGER NOT NULL, usn INTEGER NOT NULL, common BLOB NOT NULL, kind BLOB NOT NULL)`);
    db.run(`CREATE TABLE deck_config (id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, mtime_secs INTEGER NOT NULL, usn INTEGER NOT NULL, config BLOB NOT NULL)`);
    db.run(`CREATE TABLE tags (tag TEXT PRIMARY KEY NOT NULL, usn INTEGER NOT NULL)`);

    const mtime = Math.floor(Date.now() / 1000);
    const css = '.card{font-family:arial;font-size:20px;text-align:center;}';
    db.run(`INSERT INTO decks (id, name, mtime_secs, usn, common, kind) VALUES (1, 'Default', ?, -1, x'', x'')`, [mtime]);

    // Basic notetype
    const BASIC_NT = 1000000;
    db.run(`INSERT INTO notetypes (id, name, mtime_secs, usn, config) VALUES (?, 'Basic', ?, -1, ?)`,
      [BASIC_NT, mtime, encodeNotesTypeConfig({ kind: 0, originalStockKind: 0, css })]);
    db.run(`INSERT INTO fields (ntid, ord, name, config) VALUES (?, 0, 'Front', ?), (?, 1, 'Back', ?)`,
      [BASIC_NT, encodeFieldConfig({}), BASIC_NT, encodeFieldConfig({})]);
    db.run(`INSERT INTO templates (ntid, ord, name, mtime_secs, usn, config) VALUES (?, 0, 'Card 1', ?, -1, ?)`,
      [BASIC_NT, mtime, encodeTemplateConfig({ qFormat: '{{Front}}', aFormat: '{{FrontSide}}<hr id=answer>{{Back}}' })]);

    // Sample basic note
    db.run(`INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (1, 'basic1', ?, ?, -1, '', 'Sample\x1fBack', 0, 0, 0, '')`, [BASIC_NT, mtime]);
    db.run(`INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, "left", odue, odid, flags, data) VALUES (2, 1, 1, 0, ?, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`, [mtime]);

    // IO notetype + notes
    if (ioNotes && ioNotes.length > 0) {
      const IO_NT = 2000000;
      db.run(`INSERT INTO notetypes (id, name, mtime_secs, usn, config) VALUES (?, 'Image Occlusion', ?, -1, ?)`,
        [IO_NT, mtime, encodeNotesTypeConfig({ kind: 1, originalStockKind: 6, css })]);
      const fc = encodeFieldConfig({});
      db.run(`INSERT INTO fields (ntid, ord, name, config) VALUES (?, 0, 'Image Occlusion', ?), (?, 1, 'Header', ?), (?, 2, 'Back Extra', ?), (?, 3, 'Occlusions', ?)`,
        [IO_NT, fc, IO_NT, fc, IO_NT, fc, IO_NT, fc]);
      db.run(`INSERT INTO templates (ntid, ord, name, mtime_secs, usn, config) VALUES (?, 0, 'Card 1', ?, -1, ?)`,
        [IO_NT, mtime, encodeTemplateConfig({
          qFormat: '{{#Image Occlusion}}{{Image Occlusion}}{{/Image Occlusion}}',
          aFormat: '{{#Image Occlusion}}{{Image Occlusion}}{{/Image Occlusion}}',
        })]);

      let noteId = 100;
      let cardId = 200;
      for (const spec of ioNotes) {
        const n = spec.numShapes ?? 3;
        const mode = spec.mode ?? 'hide-all-guess-one';
        const header = spec.header ?? 'Test IO Header';
        const backExtra = spec.backExtra ?? 'Test Back Extra';
        const shapes = Array.from({ length: n }, (_, i) =>
          `<rect data-ordinal="${i + 1}" x="${50 + i * 200}" y="${50 + i * 100}" width="150" height="100" fill="#ffeba2" />`).join('');
        const flds = [`<img src="test-io-image.png">`, header, backExtra,
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" data-mode="${mode}">${shapes}</svg>`].join('\x1f');
        db.run(`INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (?, ?, ?, ?, -1, 'io-test', ?, 0, 0, 0, '')`,
          [noteId, `io${noteId}`, IO_NT, mtime, flds]);
        for (let ord = 0; ord < n; ord++) {
          db.run(`INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, "left", odue, odid, flags, data) VALUES (?, ?, 1, ?, ?, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
            [cardId++, noteId, ord, mtime]);
        }
        noteId++;
      }
    }

    const bytes = new Uint8Array(db.export());
    db.close();
    return Array.from(bytes);
  }, ioNotes ?? null);
}

/**
 * Load pre-built SQLite bytes as a synced collection and navigate to study.
 * The deck ends up as `kind: "sqlite"` — a synced collection that supports
 * mutations like addNote, getOrCreateIONotetype, etc.
 */
export async function loadSyncedDb(page: Page, bytes: number[]) {
  await page.evaluate(async (bytes) => {
    const { loadSyncedCollection } = await import('/src/stores.ts');
    await loadSyncedCollection(new Uint8Array(bytes));
  }, bytes);

  const el = page.locator('.card, .deck-row').first();
  await el.waitFor({ timeout: 30000 });
  if (await page.locator('.deck-row').first().isVisible()) {
    await page.locator('.deck-row').first().click();
    await page.waitForSelector('.card', { timeout: 30000 });
  }
}

// ─── Fixtures ────────────────────────────────────────────────────────

/**
 * Extended test fixture with deck loading utilities.
 *
 * - `loadedDeckPage` — pre-loaded with example_music_intervals.apkg (blob path)
 */
export const test = base.extend<{
  loadedDeckPage: Page;
}>({
  loadedDeckPage: async ({ page }, use) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await clearAppState(page);
    await page.reload({ waitUntil: 'networkidle' });
    await loadAnkiDeck(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
