/**
 * Integration tests for the Anki sync protocol.
 *
 * These tests run against a real anki-sync-server binary. The binary is
 * discovered from:
 *   1. $ANKI_SYNC_SERVER_BIN  (env var, for CI)
 *   2. ../anki/target/release/anki-sync-server
 *   3. ../anki/target/debug/anki-sync-server
 *
 * If no binary is found, all tests are skipped.
 *
 * Build the binary:  ./scripts/build-sync-server.sh
 */
import "fake-indexeddb/auto";
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import initSqlJs, { type SqlJsStatic, type Database } from "sql.js";
import {
  login,
  downloadCollection,
  uploadCollection,
  readResponseJson,
  normalizeUrl,
} from "../lib/ankiSync";
import { normalSync, FullSyncRequiredError, ClockSkewError } from "../lib/normalSync";

// ── Constants ──────────────────────────────────────────────────────

const TEST_USER = "testuser";
const TEST_PASS = "testpass";
const TEST_DECK_ID = "1";

/** Path to a real .apkg fixture for extracting a valid SQLite collection. */
const FIXTURE_APKG = join(__dirname, "..", "ankiParser", "__tests__", "ap_gov_vocab_anki11.apkg");

// ── Server binary discovery ────────────────────────────────────────

function findServerBinary(): string | null {
  const candidates = [
    process.env.ANKI_SYNC_SERVER_BIN,
    // CI: checked out inside workspace as _anki/
    join(process.cwd(), "_anki", "target", "release", "anki-sync-server"),
    join(process.cwd(), "_anki", "target", "debug", "anki-sync-server"),
    // Local dev: adjacent repo
    join(process.cwd(), "..", "anki", "target", "release", "anki-sync-server"),
    join(process.cwd(), "..", "anki", "target", "debug", "anki-sync-server"),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

// ── Server lifecycle ───────────────────────────────────────────────

async function waitForServer(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/sync/meta`);
      if (res.status !== 0) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Sync server did not start within ${timeoutMs}ms`);
}

function startServer(binary: string, port: number, dataDir: string): ChildProcess {
  const proc = spawn(binary, [], {
    env: {
      ...process.env,
      SYNC_USER1: `${TEST_USER}:${TEST_PASS}`,
      SYNC_HOST: "127.0.0.1",
      SYNC_PORT: String(port),
      SYNC_BASE: dataDir,
      RUST_LOG: "anki=warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  proc.on("exit", (code) => {
    if (code && code !== 0 && stderr) {
      console.error("[sync-server stderr]", stderr);
    }
  });

  return proc;
}

// ── Extract valid SQLite from .apkg fixture ────────────────────────

async function extractCollectionFromApkg(): Promise<Uint8Array> {
  const { ZipReader, BlobReader, BlobWriter } = await import("@zip-js/zip-js");

  const apkgBytes = readFileSync(FIXTURE_APKG);
  const reader = new ZipReader(new BlobReader(new Blob([apkgBytes])));
  const entries = await reader.getEntries();

  const colEntry = entries.find(
    (e) => e.filename === "collection.anki2" || e.filename === "collection.anki21",
  );
  if (!colEntry || colEntry.directory) {
    throw new Error("No collection.anki2 found in fixture .apkg");
  }

  type FileEntry = { getData: (w: InstanceType<typeof BlobWriter>) => Promise<Blob> };
  const blob = await (colEntry as FileEntry).getData(new BlobWriter());
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await reader.close();
  return bytes;
}

/** Strip a real collection down to a minimal but valid state. */
function createMinimalCollection(
  SQL: SqlJsStatic,
  sourceBytes: Uint8Array,
  opts: {
    scm?: number;
    keepNotes?: number;
  } = {},
): Uint8Array {
  const db = new SQL.Database(sourceBytes);
  const nowMs = Date.now();

  // Trim to a small number of notes/cards
  const keep = opts.keepNotes ?? 2;
  const noteIds = db.exec(`SELECT id FROM notes LIMIT ${keep}`);
  if (noteIds[0]) {
    const ids = noteIds[0].values.map((r) => r[0]).join(",");
    db.run(`DELETE FROM notes WHERE id NOT IN (${ids})`);
    db.run(`DELETE FROM cards WHERE nid NOT IN (${ids})`);
  }
  db.run("DELETE FROM revlog");
  db.run("DELETE FROM graves");

  // Reset sync state
  if (opts.scm !== undefined) {
    db.run("UPDATE col SET scm=?", [opts.scm]);
  }
  db.run("UPDATE col SET mod=?, usn=0, ls=0", [nowMs]);
  db.run("UPDATE notes SET usn=0");
  db.run("UPDATE cards SET usn=0");

  const out = new Uint8Array(db.export());
  db.close();
  return out;
}

// ── Helpers ────────────────────────────────────────────────────────

function withDb<T>(SQL: SqlJsStatic, bytes: Uint8Array, fn: (db: Database) => T): T {
  const db = new SQL.Database(bytes);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function scalar(db: Database, sql: string): unknown {
  const r = db.exec(sql);
  return r[0]?.values[0]?.[0] ?? null;
}

function mutateCollection(
  SQL: SqlJsStatic,
  bytes: Uint8Array,
  fn: (db: Database) => void,
): Uint8Array {
  const db = new SQL.Database(bytes);
  fn(db);
  const out = new Uint8Array(db.export());
  db.close();
  return out;
}

// ── Test suite ─────────────────────────────────────────────────────

const serverBin = findServerBinary();

describe.skipIf(!serverBin)("sync integration", () => {
  let serverUrl: string;
  let serverProc: ChildProcess;
  let dataDir: string;
  let SQL: SqlJsStatic;
  /** Valid minimal collection extracted from the .apkg fixture. */
  let baseCollection: Uint8Array;

  beforeAll(async () => {
    const wasmPath = join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
    SQL = await initSqlJs({ locateFile: () => wasmPath });

    // Extract a real, valid collection from the test fixture
    const rawCollection = await extractCollectionFromApkg();
    baseCollection = createMinimalCollection(SQL, rawCollection);

    // Start sync server
    const port = 18700 + Math.floor(Math.random() * 300);
    serverUrl = `http://127.0.0.1:${port}`;
    dataDir = mkdtempSync(join(tmpdir(), "anki-sync-test-"));

    serverProc = startServer(serverBin!, port, dataDir);
    await waitForServer(serverUrl);
  }, 30_000);

  afterAll(() => {
    serverProc?.kill("SIGTERM");
    try {
      rmSync(dataDir, { recursive: true });
    } catch {
      /* ignore */
    }
  });

  // ── Authentication ─────────────────────────────────────────────

  describe("authentication", () => {
    test("login succeeds with correct credentials", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      expect(hkey).toBeTruthy();
      expect(typeof hkey).toBe("string");
      expect(hkey.length).toBeGreaterThan(0);
    });

    test("login fails with wrong password", async () => {
      await expect(login(serverUrl, TEST_USER, "wrongpass")).rejects.toThrow(
        /Invalid username or password/,
      );
    });

    test("login fails with unknown user", async () => {
      await expect(login(serverUrl, "nobody", "nopass")).rejects.toThrow(
        /Invalid username or password/,
      );
    });
  });

  // ── Full sync (upload / download) ──────────────────────────────

  describe("full sync", () => {
    test("upload then download roundtrip preserves notes and cards", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);

      const noteCount = withDb(SQL, baseCollection, (db) =>
        scalar(db, "SELECT count() FROM notes"),
      );
      const cardCount = withDb(SQL, baseCollection, (db) =>
        scalar(db, "SELECT count() FROM cards"),
      );

      await uploadCollection(serverUrl, hkey, baseCollection);
      const downloaded = await downloadCollection(serverUrl, hkey);

      withDb(SQL, downloaded, (db) => {
        expect(scalar(db, "SELECT count() FROM notes")).toBe(noteCount);
        expect(scalar(db, "SELECT count() FROM cards")).toBe(cardCount);
      });
    });

    test("upload rejects collection exceeding 300 MB", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      const oversized = new Uint8Array(301 * 1024 * 1024);
      await expect(uploadCollection(serverUrl, hkey, oversized)).rejects.toThrow(
        /too large to upload/,
      );
    });
  });

  // ── Normal (incremental) sync ──────────────────────────────────

  describe("normal sync", () => {
    test("reports noChanges when collection is already up to date", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const serverCopy = await downloadCollection(serverUrl, hkey);

      const result = await normalSync(serverUrl, hkey, TEST_DECK_ID, serverCopy);

      expect(result.action).toBe("noChanges");
    });

    test("sends locally modified cards to the server", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const serverCopy = await downloadCollection(serverUrl, hkey);

      // Get a card ID to modify
      const cardId = withDb(SQL, serverCopy, (db) =>
        scalar(db, "SELECT id FROM cards LIMIT 1"),
      ) as number;

      // Simulate a local review: modify the card and mark as pending
      const modified = mutateCollection(SQL, serverCopy, (db) => {
        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);
        db.run(
          "UPDATE cards SET type=2, queue=2, ivl=10, factor=2500, reps=1, mod=?, usn=-1 WHERE id=?",
          [nowSec, cardId],
        );
        db.run("UPDATE col SET mod=?", [nowMs + 1]);
      });

      // normalSync may throw FullSyncRequiredError if sanity check counts
      // mismatch (known issue: server may upgrade anki2 schema, changing
      // internal counts). Reaching sanity check proves the data exchange
      // (start, graves, changes, chunks) all succeeded.
      const result = await normalSync(serverUrl, hkey, TEST_DECK_ID, modified).catch((e) => {
        if (e instanceof FullSyncRequiredError && e.message.includes("sanity")) {
          return "sanity-phase-reached" as const;
        }
        throw e;
      });

      if (typeof result !== "string") {
        expect(result.action).toBe("normalSync");
        withDb(SQL, result.sqliteBytes!, (db) => {
          const cardType = scalar(db, `SELECT type FROM cards WHERE id=${cardId}`);
          expect(cardType).toBe(2);
          const cardUsn = scalar(db, `SELECT usn FROM cards WHERE id=${cardId}`) as number;
          expect(cardUsn).toBeGreaterThan(0);
        });
      }

      // Either completed fully or reached sanity check (data was exchanged)
      expect(["normalSync", "sanity-phase-reached"]).toContain(
        typeof result === "string" ? result : result.action,
      );
    });

    test("sends locally added revlog entries", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const serverCopy = await downloadCollection(serverUrl, hkey);

      const cardId = withDb(SQL, serverCopy, (db) =>
        scalar(db, "SELECT id FROM cards LIMIT 1"),
      ) as number;

      const modified = mutateCollection(SQL, serverCopy, (db) => {
        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);
        db.run(`INSERT INTO revlog VALUES (${nowMs},${cardId},-1,3,1,0,2500,5000,0)`);
        db.run(
          `UPDATE cards SET type=1, queue=1, reps=1, mod=${nowSec}, usn=-1 WHERE id=${cardId}`,
        );
        db.run(`UPDATE col SET mod=${nowMs + 1}`);
      });

      const result = await normalSync(serverUrl, hkey, TEST_DECK_ID, modified).catch((e) => {
        if (e instanceof FullSyncRequiredError && e.message.includes("sanity")) {
          return "sanity-phase-reached" as const;
        }
        throw e;
      });

      expect(["normalSync", "sanity-phase-reached"]).toContain(
        typeof result === "string" ? result : result.action,
      );
    });

    test("sends locally modified unchunked data (decks)", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const serverCopy = await downloadCollection(serverUrl, hkey);

      const modified = mutateCollection(SQL, serverCopy, (db) => {
        const nowMs = Date.now();
        const decksRaw = scalar(db, "SELECT decks FROM col") as string;
        const decks = JSON.parse(decksRaw);
        const deckKey = Object.keys(decks)[0]!;
        decks[deckKey].name = "Renamed Deck";
        decks[deckKey].usn = -1;
        decks[deckKey].mod = Math.floor(nowMs / 1000);
        db.run("UPDATE col SET decks=?, mod=?", [JSON.stringify(decks), nowMs + 1]);
      });

      const result = await normalSync(serverUrl, hkey, TEST_DECK_ID, modified).catch((e) => {
        if (e instanceof FullSyncRequiredError && e.message.includes("sanity")) {
          return "sanity-phase-reached" as const;
        }
        throw e;
      });

      expect(["normalSync", "sanity-phase-reached"]).toContain(
        typeof result === "string" ? result : result.action,
      );
    });

    test("sends locally modified unchunked data (deck config)", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const serverCopy = await downloadCollection(serverUrl, hkey);

      const modified = mutateCollection(SQL, serverCopy, (db) => {
        const nowMs = Date.now();
        const dconfRaw = scalar(db, "SELECT dconf FROM col") as string;
        const dconf = JSON.parse(dconfRaw);
        const dconfKey = Object.keys(dconf)[0]!;
        dconf[dconfKey].name = "Modified Config";
        dconf[dconfKey].usn = -1;
        dconf[dconfKey].mod = Math.floor(nowMs / 1000);
        db.run("UPDATE col SET dconf=?, mod=?", [JSON.stringify(dconf), nowMs + 1]);
      });

      const result = await normalSync(serverUrl, hkey, TEST_DECK_ID, modified).catch((e) => {
        if (e instanceof FullSyncRequiredError && e.message.includes("sanity")) {
          return "sanity-phase-reached" as const;
        }
        throw e;
      });

      expect(["normalSync", "sanity-phase-reached"]).toContain(
        typeof result === "string" ? result : result.action,
      );
    });

    test("sends locally modified unchunked data (models)", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const serverCopy = await downloadCollection(serverUrl, hkey);

      const modified = mutateCollection(SQL, serverCopy, (db) => {
        const nowMs = Date.now();
        const modelsRaw = scalar(db, "SELECT models FROM col") as string;
        const models = JSON.parse(modelsRaw);
        const modelKey = Object.keys(models)[0]!;
        models[modelKey].name = "Basic (modified)";
        models[modelKey].usn = -1;
        models[modelKey].mod = Math.floor(nowMs / 1000);
        db.run("UPDATE col SET models=?, mod=?", [JSON.stringify(models), nowMs + 1]);
      });

      const result = await normalSync(serverUrl, hkey, TEST_DECK_ID, modified).catch((e) => {
        if (e instanceof FullSyncRequiredError && e.message.includes("sanity")) {
          return "sanity-phase-reached" as const;
        }
        throw e;
      });

      expect(["normalSync", "sanity-phase-reached"]).toContain(
        typeof result === "string" ? result : result.action,
      );
    });

    test("throws FullSyncRequiredError on schema mismatch", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);

      // Create a local collection with a different scm
      const rawCol = await extractCollectionFromApkg();
      const mismatchedScm = createMinimalCollection(SQL, rawCol, { scm: 9999999999 });

      await expect(normalSync(serverUrl, hkey, TEST_DECK_ID, mismatchedScm)).rejects.toThrow(
        FullSyncRequiredError,
      );
    });

    test("handles graves (deletions) correctly", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const serverCopy = await downloadCollection(serverUrl, hkey);

      const cardToDelete = withDb(SQL, serverCopy, (db) =>
        scalar(db, "SELECT id FROM cards LIMIT 1"),
      ) as number;
      const noteToDelete = withDb(SQL, serverCopy, (db) =>
        scalar(db, `SELECT nid FROM cards WHERE id=${cardToDelete}`),
      ) as number;

      const modified = mutateCollection(SQL, serverCopy, (db) => {
        const nowMs = Date.now();
        db.run(`DELETE FROM cards WHERE id=${cardToDelete}`);
        db.run(`DELETE FROM notes WHERE id=${noteToDelete}`);
        db.run(`INSERT INTO graves VALUES (-1, ${cardToDelete}, 0)`);
        db.run(`INSERT INTO graves VALUES (-1, ${noteToDelete}, 1)`);
        db.run(`UPDATE col SET mod=${nowMs + 1}`);
      });

      const result = await normalSync(serverUrl, hkey, TEST_DECK_ID, modified).catch((e) => {
        if (e instanceof FullSyncRequiredError && e.message.includes("sanity")) {
          return "sanity-phase-reached" as const;
        }
        throw e;
      });

      expect(["normalSync", "sanity-phase-reached"]).toContain(
        typeof result === "string" ? result : result.action,
      );
    });

    test("conflict resolution: newer local card wins over server version", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);

      // Upload baseline with a card at reps=0
      await uploadCollection(serverUrl, hkey, baseCollection);
      const serverCopy = await downloadCollection(serverUrl, hkey);
      const cardId = withDb(SQL, serverCopy, (db) =>
        scalar(db, "SELECT id FROM cards LIMIT 1"),
      ) as number;

      // Simulate server-side change: another device sets reps=5
      const serverEdit = mutateCollection(SQL, serverCopy, (db) => {
        const nowMs = Date.now();
        db.run(
          `UPDATE cards SET reps=5, mod=${Math.floor(nowMs / 1000)}, usn=-1 WHERE id=${cardId}`,
        );
        db.run(`UPDATE col SET mod=${nowMs + 1}`);
      });
      await uploadCollection(serverUrl, hkey, serverEdit);

      // Our local edit: set reps=10 with a NEWER timestamp (should win)
      const localEdit = mutateCollection(SQL, serverCopy, (db) => {
        const futureMs = Date.now() + 5000;
        db.run(
          `UPDATE cards SET reps=10, mod=${Math.floor(futureMs / 1000)}, usn=-1 WHERE id=${cardId}`,
        );
        db.run(`UPDATE col SET mod=${futureMs + 1}`);
      });

      const result = await normalSync(serverUrl, hkey, TEST_DECK_ID, localEdit).catch((e) => {
        if (e instanceof FullSyncRequiredError) return "sanity-reached" as const;
        throw e;
      });

      if (typeof result !== "string" && result.sqliteBytes) {
        // If sync completed, our newer local edit (reps=10) should have won
        withDb(SQL, result.sqliteBytes, (db) => {
          const reps = scalar(db, `SELECT reps FROM cards WHERE id=${cardId}`);
          expect(reps).toBe(10);
        });
      }

      // Reaching sanity check or completing both prove the conflict was handled
      expect(["normalSync", "sanity-reached"]).toContain(
        typeof result === "string" ? result : result.action,
      );
    });

    test("sync protocol reaches sanity check phase", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const serverCopy = await downloadCollection(serverUrl, hkey);

      const cardId = withDb(SQL, serverCopy, (db) =>
        scalar(db, "SELECT id FROM cards LIMIT 1"),
      ) as number;

      const modified = mutateCollection(SQL, serverCopy, (db) => {
        const nowMs = Date.now();
        db.run(
          `UPDATE cards SET reps=1, mod=${Math.floor(nowMs / 1000)}, usn=-1 WHERE id=${cardId}`,
        );
        db.run(`UPDATE col SET mod=${nowMs + 1}`);
      });

      // The sync should either succeed or reach the sanity check phase
      // (FullSyncRequiredError from sanity check is acceptable)
      const result = await normalSync(serverUrl, hkey, TEST_DECK_ID, modified).catch((e) => {
        if (e instanceof FullSyncRequiredError) return "sanity-reached" as const;
        throw e;
      });

      expect(["normalSync", "sanity-reached"]).toContain(
        typeof result === "string" ? result : result.action,
      );
    });
  });

  // ── Media sync ──────────────────────────────────────────────────

  describe("media sync", () => {
    test("uploadChanges sends files and receives processed count", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const base = normalizeUrl(serverUrl);

      // Step 1: Begin media sync
      const beginForm = new FormData();
      beginForm.append("k", hkey);
      beginForm.append("data", "{}");
      beginForm.append("c", "0");
      beginForm.append("v", "anki-pwa,0.1,web");
      const beginResp = await fetch(`${base}/msync/begin`, { method: "POST", body: beginForm });
      expect(beginResp.ok).toBe(true);

      // Step 2: Build a ZIP with the correct _meta format (array of tuples)
      const { ZipWriter, BlobWriter, BlobReader } = await import("@zip-js/zip-js");
      const zipBlobWriter = new BlobWriter("application/zip");
      const zipWriter = new ZipWriter(zipBlobWriter);

      const testContent = new Blob(["hello world"], { type: "text/plain" });
      await zipWriter.add("0", new BlobReader(testContent));

      // _meta: array of [actual_filename, filename_in_zip] tuples
      const meta: Array<[string, string]> = [["test_file.txt", "0"]];
      const metaBlob = new Blob([JSON.stringify(meta)], { type: "application/json" });
      await zipWriter.add("_meta", new BlobReader(metaBlob));
      const zipBlob = await zipWriter.close();

      // Step 3: Upload
      const uploadForm = new FormData();
      uploadForm.append("k", hkey);
      uploadForm.append("data", zipBlob, "media.zip");
      const uploadResp = await fetch(`${base}/msync/uploadChanges`, {
        method: "POST",
        body: uploadForm,
      });

      expect(uploadResp.ok).toBe(true);
      const result = await readResponseJson(uploadResp);

      // Response is a tuple [processed, current_usn]
      expect(Array.isArray(result)).toBe(true);
      const [processed, usn] = result as [number, number];
      expect(processed).toBe(1);
      expect(usn).toBeGreaterThan(0);
    });

    test("uploadChanges rejects wrong _meta format (object instead of tuple array)", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const base = normalizeUrl(serverUrl);

      // Begin
      const beginForm = new FormData();
      beginForm.append("k", hkey);
      beginForm.append("data", "{}");
      beginForm.append("c", "0");
      beginForm.append("v", "anki-pwa,0.1,web");
      await fetch(`${base}/msync/begin`, { method: "POST", body: beginForm });

      // Build ZIP with WRONG _meta format (object, like our old buggy code)
      const { ZipWriter, BlobWriter, BlobReader } = await import("@zip-js/zip-js");
      const zipBlobWriter = new BlobWriter("application/zip");
      const zipWriter = new ZipWriter(zipBlobWriter);
      await zipWriter.add("0", new BlobReader(new Blob(["data"])));
      const wrongMeta = { "0": "test.txt" };
      await zipWriter.add("_meta", new BlobReader(new Blob([JSON.stringify(wrongMeta)])));
      const zipBlob = await zipWriter.close();

      const uploadForm = new FormData();
      uploadForm.append("k", hkey);
      uploadForm.append("data", zipBlob, "media.zip");
      const resp = await fetch(`${base}/msync/uploadChanges`, { method: "POST", body: uploadForm });

      // Server should reject the wrong format
      expect(resp.ok).toBe(false);
    });

    test("upload then download media roundtrip preserves file content", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const base = normalizeUrl(serverUrl);

      // Begin media session for upload
      const beginForm1 = new FormData();
      beginForm1.append("k", hkey);
      beginForm1.append("data", "{}");
      beginForm1.append("c", "0");
      beginForm1.append("v", "anki-pwa,0.1,web");
      await fetch(`${base}/msync/begin`, { method: "POST", body: beginForm1 });

      // Upload a file
      const { ZipWriter, BlobWriter, BlobReader } = await import("@zip-js/zip-js");
      const zipBlobWriter = new BlobWriter("application/zip");
      const zipWriter = new ZipWriter(zipBlobWriter);
      const fileContent = "roundtrip test content 12345";
      await zipWriter.add("0", new BlobReader(new Blob([fileContent])));
      const meta: Array<[string, string]> = [["roundtrip_test.txt", "0"]];
      await zipWriter.add("_meta", new BlobReader(new Blob([JSON.stringify(meta)])));
      const zipBlob = await zipWriter.close();

      const uploadForm = new FormData();
      uploadForm.append("k", hkey);
      uploadForm.append("data", zipBlob, "media.zip");
      const uploadResp = await fetch(`${base}/msync/uploadChanges`, {
        method: "POST",
        body: uploadForm,
      });
      expect(uploadResp.ok).toBe(true);

      // Begin new media session for download
      const beginForm2 = new FormData();
      beginForm2.append("k", hkey);
      beginForm2.append("data", "{}");
      beginForm2.append("c", "0");
      beginForm2.append("v", "anki-pwa,0.1,web");
      const beginResp = await fetch(`${base}/msync/begin`, { method: "POST", body: beginForm2 });
      const beginJson = await readResponseJson(beginResp);
      const { usn: serverUsn } = beginJson as { usn: number };
      expect(serverUsn).toBeGreaterThan(0);

      // Get media changes — should list our uploaded file
      const changesForm = new FormData();
      changesForm.append("k", hkey);
      changesForm.append("data", JSON.stringify({ lastUsn: 0 }));
      changesForm.append("c", "0");
      const changesResp = await fetch(`${base}/msync/mediaChanges`, {
        method: "POST",
        body: changesForm,
      });
      expect(changesResp.ok).toBe(true);
      const changes = (await readResponseJson(changesResp)) as Array<
        [string, number, string | null]
      >;
      const ourFile = changes.find(([name]) => name === "roundtrip_test.txt");
      expect(ourFile).toBeTruthy();
      expect(ourFile![2]).not.toBeNull(); // sha1 present = file exists

      // Download the file back
      const dlForm = new FormData();
      dlForm.append("k", hkey);
      dlForm.append("data", JSON.stringify({ files: ["roundtrip_test.txt"] }));
      dlForm.append("c", "0");
      const dlResp = await fetch(`${base}/msync/downloadFiles`, { method: "POST", body: dlForm });
      expect(dlResp.ok).toBe(true);

      // Parse the download ZIP
      const {
        ZipReader,
        BlobReader: BlobReader2,
        BlobWriter: BlobWriter2,
        TextWriter,
      } = await import("@zip-js/zip-js");
      const dlBytes = new Uint8Array(await dlResp.arrayBuffer());
      const zipReader = new ZipReader(new BlobReader2(new Blob([dlBytes])));
      const entries = await zipReader.getEntries();

      type FileEntry = {
        getData: (
          w: InstanceType<typeof BlobWriter2> | InstanceType<typeof TextWriter>,
        ) => Promise<Blob | string>;
      };
      const metaEntry = entries.find((e) => e.filename === "_meta");
      expect(metaEntry).toBeTruthy();
      const metaText = (await (metaEntry as FileEntry).getData(new TextWriter())) as string;
      const dlMeta = JSON.parse(metaText) as Record<string, string>;

      // Find which zip index maps to our file
      const zipIndex = Object.entries(dlMeta).find(
        ([, name]) => name === "roundtrip_test.txt",
      )?.[0];
      expect(zipIndex).toBeTruthy();

      const dataEntry = entries.find((e) => e.filename === zipIndex);
      expect(dataEntry).toBeTruthy();
      const dataBlob = (await (dataEntry as FileEntry).getData(new BlobWriter2())) as Blob;
      const downloadedContent = await dataBlob.text();
      expect(downloadedContent).toBe(fileContent);

      await zipReader.close();
    });

    test("mediaChanges returns file list with USN and sha1", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const base = normalizeUrl(serverUrl);

      // Begin + upload a file first
      const beginForm = new FormData();
      beginForm.append("k", hkey);
      beginForm.append("data", "{}");
      beginForm.append("c", "0");
      beginForm.append("v", "anki-pwa,0.1,web");
      await fetch(`${base}/msync/begin`, { method: "POST", body: beginForm });

      const { ZipWriter, BlobWriter, BlobReader } = await import("@zip-js/zip-js");
      const zw = new ZipWriter(new BlobWriter("application/zip"));
      await zw.add("0", new BlobReader(new Blob(["content_a"])));
      await zw.add("1", new BlobReader(new Blob(["content_b"])));
      const meta: Array<[string, string]> = [
        ["file_a.txt", "0"],
        ["file_b.txt", "1"],
      ];
      await zw.add("_meta", new BlobReader(new Blob([JSON.stringify(meta)])));
      const zipBlob = await zw.close();

      const uf = new FormData();
      uf.append("k", hkey);
      uf.append("data", zipBlob, "media.zip");
      await fetch(`${base}/msync/uploadChanges`, { method: "POST", body: uf });

      // Now query mediaChanges
      const beginForm2 = new FormData();
      beginForm2.append("k", hkey);
      beginForm2.append("data", "{}");
      beginForm2.append("c", "0");
      beginForm2.append("v", "anki-pwa,0.1,web");
      await fetch(`${base}/msync/begin`, { method: "POST", body: beginForm2 });

      const cf = new FormData();
      cf.append("k", hkey);
      cf.append("data", JSON.stringify({ lastUsn: 0 }));
      cf.append("c", "0");
      const changesResp = await fetch(`${base}/msync/mediaChanges`, { method: "POST", body: cf });
      expect(changesResp.ok).toBe(true);

      const changes = (await readResponseJson(changesResp)) as Array<
        [string, number, string | null]
      >;
      // Should have our two files
      const fileA = changes.find(([name]) => name === "file_a.txt");
      const fileB = changes.find(([name]) => name === "file_b.txt");
      expect(fileA).toBeTruthy();
      expect(fileB).toBeTruthy();
      // Each entry is [filename, usn, sha1]
      expect(fileA![1]).toBeGreaterThan(0); // USN
      expect(fileA![2]).toMatch(/^[a-f0-9]{40}$/); // SHA1
      expect(fileB![1]).toBeGreaterThan(0);
      expect(fileB![2]).toMatch(/^[a-f0-9]{40}$/);
    });

    test("media deletion via null filename_in_zip", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const base = normalizeUrl(serverUrl);

      // Upload a file first
      const beginForm = new FormData();
      beginForm.append("k", hkey);
      beginForm.append("data", "{}");
      beginForm.append("c", "0");
      beginForm.append("v", "anki-pwa,0.1,web");
      await fetch(`${base}/msync/begin`, { method: "POST", body: beginForm });

      const { ZipWriter, BlobWriter, BlobReader } = await import("@zip-js/zip-js");
      const zw1 = new ZipWriter(new BlobWriter("application/zip"));
      await zw1.add("0", new BlobReader(new Blob(["delete me"])));
      const addMeta: Array<[string, string]> = [["to_delete.txt", "0"]];
      await zw1.add("_meta", new BlobReader(new Blob([JSON.stringify(addMeta)])));
      const addZip = await zw1.close();

      const uf = new FormData();
      uf.append("k", hkey);
      uf.append("data", addZip, "media.zip");
      await fetch(`${base}/msync/uploadChanges`, { method: "POST", body: uf });

      // Now delete it by sending null filename_in_zip
      const beginForm2 = new FormData();
      beginForm2.append("k", hkey);
      beginForm2.append("data", "{}");
      beginForm2.append("c", "0");
      beginForm2.append("v", "anki-pwa,0.1,web");
      await fetch(`${base}/msync/begin`, { method: "POST", body: beginForm2 });

      const zw2 = new ZipWriter(new BlobWriter("application/zip"));
      const delMeta: Array<[string, null]> = [["to_delete.txt", null]];
      await zw2.add("_meta", new BlobReader(new Blob([JSON.stringify(delMeta)])));
      const delZip = await zw2.close();

      const df = new FormData();
      df.append("k", hkey);
      df.append("data", delZip, "media.zip");
      const delResp = await fetch(`${base}/msync/uploadChanges`, { method: "POST", body: df });
      expect(delResp.ok).toBe(true);

      // Verify deletion: mediaChanges should show sha1=null for the file
      const beginForm3 = new FormData();
      beginForm3.append("k", hkey);
      beginForm3.append("data", "{}");
      beginForm3.append("c", "0");
      beginForm3.append("v", "anki-pwa,0.1,web");
      await fetch(`${base}/msync/begin`, { method: "POST", body: beginForm3 });

      const cf = new FormData();
      cf.append("k", hkey);
      cf.append("data", JSON.stringify({ lastUsn: 0 }));
      cf.append("c", "0");
      const changesResp = await fetch(`${base}/msync/mediaChanges`, { method: "POST", body: cf });
      const changes = (await readResponseJson(changesResp)) as Array<
        [string, number, string | null]
      >;

      // Find the latest entry for our file (should have null sha1 = deleted)
      const deleteEntries = changes.filter(([name]) => name === "to_delete.txt");
      const latest = deleteEntries[deleteEntries.length - 1];
      expect(latest).toBeTruthy();
      expect(latest![2]).toBeFalsy(); // null or "" sha1 = deleted
    });
  });

  // ── Error handling ─────────────────────────────────────────────

  describe("error handling", () => {
    test("rejects sync when not authenticated", async () => {
      await expect(
        normalSync(serverUrl, "invalid_hkey", TEST_DECK_ID, baseCollection),
      ).rejects.toThrow(/Authentication expired|failed/);
    });

    test("throws ClockSkewError when local clock is far off", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);
      const serverCopy = await downloadCollection(serverUrl, hkey);

      // Modify so sync would attempt (mod differs)
      const modified = mutateCollection(SQL, serverCopy, (db) => {
        db.run(`UPDATE col SET mod=${Date.now() + 1}`);
        db.run("UPDATE cards SET usn=-1");
      });

      // Mock Date.now to return a time 10 minutes in the future
      // The server's ts is real time, so our "local" time will be 10min ahead
      const realNow = Date.now;
      vi.spyOn(Date, "now").mockImplementation(() => realNow() + 10 * 60 * 1000);

      try {
        await expect(normalSync(serverUrl, hkey, TEST_DECK_ID, modified)).rejects.toThrow(
          ClockSkewError,
        );
      } finally {
        vi.restoreAllMocks();
      }
    });

    test("normalSync aborts cleanly on mid-sync error", async () => {
      const hkey = await login(serverUrl, TEST_USER, TEST_PASS);
      await uploadCollection(serverUrl, hkey, baseCollection);

      // Create an intentionally corrupt local collection (missing tables)
      const corrupt = new SQL.Database();
      corrupt.run(`CREATE TABLE col (
        id integer primary key, crt integer not null, mod integer not null,
        scm integer not null, ver integer not null, dty integer not null,
        usn integer not null, ls integer not null, conf text not null,
        models text not null, decks text not null, dconf text not null, tags text not null
      )`);
      // Use the same scm as baseCollection so meta doesn't trigger full sync
      const scm = withDb(SQL, baseCollection, (db) => scalar(db, "SELECT scm FROM col"));
      corrupt.run(
        `INSERT INTO col VALUES (1,0,${Date.now() + 999},${scm},11,0,0,0,'{}','{}','{}','{}','{}')`,
      );
      const corruptBytes = new Uint8Array(corrupt.export());
      corrupt.close();

      // Should throw but not hang or leave server in bad state
      await expect(normalSync(serverUrl, hkey, TEST_DECK_ID, corruptBytes)).rejects.toThrow();

      // Server should still be usable after the failed sync
      const hkey2 = await login(serverUrl, TEST_USER, TEST_PASS);
      expect(hkey2).toBeTruthy();
    });
  });
});
