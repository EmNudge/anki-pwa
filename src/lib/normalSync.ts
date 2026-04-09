/**
 * Normal (incremental) sync protocol for Anki collections.
 *
 * Implements the 9-step sync flow matching Anki desktop:
 * meta → start → applyGraves → applyChanges → chunk → applyChunk → sanityCheck2 → finish
 * with abort on error.
 */
import { createDatabase } from "~/utils/sql";
import {
  normalizeUrl,
  syncPost,
  syncPostV11,
  readResponseJson,
  type SyncState,
} from "./ankiSync";
import { mergeIndexedDBToSqlite } from "./syncWrite";
import {
  applyRemoteGraves,
  applyRemoteChunk,
  applyRemoteUnchunkedChanges,
  buildLocalGraves,
  buildLocalUnchunkedChanges,
  buildLocalChunks,
  getSanityCounts,
  finalizeUsn,
  isAnki21bFormat,
  type Graves,
  type Chunk,
  type UnchunkedChanges,
  type SanityCheckCounts,
  type SyncModel,
  type SyncDeck,
  type SyncDeckConfig,
} from "./syncMerge";

// ── Types ──────────────────────────────────────────────────────────

interface SyncMeta {
  mod: number;
  scm: number;
  usn: number;
  ts: number;
  msg: string;
  cont: boolean;
  hostNum: number;
  empty: boolean;
  mediaUsn: number;
  /** Server's maximum supported protocol version (undefined = legacy v10) */
  serverVersion: number | undefined;
}

/** Raw meta response from the sync server. */
interface RawMetaResponse {
  mod?: number;
  modified?: number;
  scm?: number;
  schema?: number;
  usn?: number;
  ts?: number;
  current_time?: number;
  msg?: string;
  server_message?: string;
  cont?: boolean;
  should_continue?: boolean;
  hostNum?: number;
  host_number?: number;
  empty?: boolean;
  mediaUsn?: number;
  media_usn?: number;
  v?: number;
  server_version?: number;
}

/** Raw start response from the sync server (remote graves). */
interface RawStartResponse {
  cards?: number[];
  notes?: number[];
  decks?: number[];
}

/** Raw applyChanges response from the sync server. */
interface RawApplyChangesResponse {
  models?: SyncModel[];
  decks?: [SyncDeck[], SyncDeckConfig[]];
  tags?: string[];
  conf?: Record<string, unknown>;
  crt?: number;
}

/** Raw sanityCheck2 response from the sync server. */
interface RawSanityCheckResponse {
  status?: string;
}

/** Raw finish response from the sync server. */
interface RawFinishResponse {
  mod?: number;
}

interface LocalMeta {
  mod: number;
  scm: number;
  usn: number;
  ls: number;
}

type SyncAction = "noChanges" | "normalSync" | "fullSyncRequired";

export class FullSyncRequiredError extends Error {
  constructor(message = "Full sync required") {
    super(message);
    this.name = "FullSyncRequiredError";
  }
}

export class SyncAbortedError extends Error {
  constructor(message = "Sync aborted by server") {
    super(message);
    this.name = "SyncAbortedError";
  }
}

type ProgressCallback = (status: string) => void;

interface NormalSyncResult {
  action: SyncAction;
  sqliteBytes?: Uint8Array;
  newState?: Partial<SyncState>;
}

const CHUNK_SIZE = 250;

/** Use v11 zstd transport when server supports it, otherwise legacy multipart. */
type ProtoVersion = 10 | 11;

// ── Protocol helpers ───────────────────────────────────────────────

async function syncEndpoint(
  serverUrl: string,
  endpoint: string,
  hkey: string,
  data: unknown = {},
  proto: ProtoVersion = 10,
): Promise<unknown> {
  const base = normalizeUrl(serverUrl);
  const url = `${base}/sync/${endpoint}`;

  const response = proto >= 11
    ? await syncPostV11(url, hkey, data)
    : await syncPost(url, hkey, data);

  if (response.status === 401 || response.status === 403) {
    throw new Error("Authentication expired. Please log in again.");
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`sync/${endpoint} failed: ${response.status} ${response.statusText} — ${body}`);
  }

  return readResponseJson(response);
}

// ── Individual sync steps ──────────────────────────────────────────

async function fetchMeta(
  serverUrl: string,
  hkey: string,
): Promise<SyncMeta> {
  // Request v11 — server will respond with its max supported version
  const r = await syncEndpoint(serverUrl, "meta", hkey, {
    v: 11,
    cv: "anki-pwa,0.1,web",
  }) as RawMetaResponse;

  // Detect server version from response.
  // v11 servers include a "v" or "server_version" field.
  // Legacy servers omit it (implicitly v10 or below).
  const serverVersion = r.v ?? r.server_version;

  return {
    mod: r.mod ?? r.modified ?? 0,
    scm: r.scm ?? r.schema ?? 0,
    usn: r.usn ?? 0,
    ts: r.ts ?? r.current_time ?? 0,
    msg: r.msg ?? r.server_message ?? "",
    cont: r.cont ?? r.should_continue ?? true,
    hostNum: r.hostNum ?? r.host_number ?? 0,
    empty: r.empty ?? false,
    mediaUsn: r.mediaUsn ?? r.media_usn ?? 0,
    serverVersion,
  };
}

function determineSyncAction(local: LocalMeta, remote: SyncMeta): SyncAction {
  if (remote.mod === local.mod) return "noChanges";
  if (remote.scm !== local.scm) return "fullSyncRequired";
  return "normalSync";
}

function readLocalMeta(db: import("sql.js").Database): LocalMeta {
  const result = db.exec("SELECT mod, scm, usn, ls FROM col");
  if (!result[0]?.values[0]) {
    return { mod: 0, scm: 0, usn: -1, ls: 0 };
  }
  const [mod, scm, usn, ls] = result[0].values[0] as [number, number, number, number];
  return { mod, scm, usn, ls };
}

async function startSync(
  serverUrl: string,
  hkey: string,
  clientUsn: number,
  localIsNewer: boolean,
  proto: ProtoVersion = 10,
): Promise<Graves> {
  const r = await syncEndpoint(serverUrl, "start", hkey, {
    minUsn: clientUsn,
    lnewer: localIsNewer,
  }, proto) as RawStartResponse;
  return {
    cards: r.cards ?? [],
    notes: r.notes ?? [],
    decks: r.decks ?? [],
  };
}

async function sendGraves(
  serverUrl: string,
  hkey: string,
  graves: Graves,
  proto: ProtoVersion = 10,
): Promise<void> {
  // Chunk graves in batches of CHUNK_SIZE
  const allIds: Array<[number, "cards" | "notes" | "decks"]> = [
    ...graves.cards.map((id) => [id, "cards" as const] as [number, "cards"]),
    ...graves.notes.map((id) => [id, "notes" as const] as [number, "notes"]),
    ...graves.decks.map((id) => [id, "decks" as const] as [number, "decks"]),
  ];

  for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
    const batch = allIds.slice(i, i + CHUNK_SIZE);
    const chunk: Graves = { cards: [], notes: [], decks: [] };
    for (const [id, type] of batch) {
      chunk[type].push(id);
    }
    await syncEndpoint(serverUrl, "applyGraves", hkey, { chunk }, proto);
  }

  // If no graves at all, still send an empty one
  if (allIds.length === 0) {
    await syncEndpoint(serverUrl, "applyGraves", hkey, {
      chunk: { cards: [], notes: [], decks: [] },
    }, proto);
  }
}

async function exchangeChanges(
  serverUrl: string,
  hkey: string,
  localChanges: UnchunkedChanges,
  proto: ProtoVersion = 10,
): Promise<UnchunkedChanges> {
  const r = await syncEndpoint(serverUrl, "applyChanges", hkey, {
    changes: localChanges,
  }, proto) as RawApplyChangesResponse;
  return {
    models: r.models ?? [],
    decks: r.decks ?? [[], []],
    tags: r.tags ?? [],
    conf: r.conf,
    crt: r.crt,
  };
}

async function receiveChunks(
  serverUrl: string,
  hkey: string,
  db: import("sql.js").Database,
  onProgress: ProgressCallback,
  proto: ProtoVersion = 10,
): Promise<void> {
  let chunkNum = 0;
  while (true) {
    chunkNum++;
    onProgress(`Receiving server changes (chunk ${chunkNum})...`);
    const result = await syncEndpoint(serverUrl, "chunk", hkey, {}, proto);
    const chunk = result as Chunk;
    await applyRemoteChunk(db, chunk);
    if (chunk.done) break;
  }
}

async function sendChunks(
  serverUrl: string,
  hkey: string,
  db: import("sql.js").Database,
  onProgress: ProgressCallback,
  proto: ProtoVersion = 10,
): Promise<void> {
  let chunkNum = 0;
  for (const chunk of buildLocalChunks(db)) {
    chunkNum++;
    onProgress(`Sending local changes (chunk ${chunkNum})...`);
    await syncEndpoint(serverUrl, "applyChunk", hkey, { chunk }, proto);
  }
}

async function sanityCheck(
  serverUrl: string,
  hkey: string,
  counts: SanityCheckCounts,
  proto: ProtoVersion = 10,
): Promise<void> {
  const r = await syncEndpoint(serverUrl, "sanityCheck2", hkey, {
    client: counts,
  }, proto) as RawSanityCheckResponse;
  if (r.status === "bad") {
    throw new Error(
      "Sync sanity check failed: client and server counts do not match. A full sync is required.",
    );
  }
}

async function finishSync(
  serverUrl: string,
  hkey: string,
  proto: ProtoVersion = 10,
): Promise<number> {
  const result = await syncEndpoint(serverUrl, "finish", hkey, {}, proto);
  // Server returns the new mod time (number)
  if (typeof result === "number") return result;
  // Some servers wrap in an object
  return (result as RawFinishResponse).mod ?? Date.now();
}

async function abortSync(
  serverUrl: string,
  hkey: string,
): Promise<void> {
  try {
    await syncEndpoint(serverUrl, "abort", hkey);
  } catch {
    // Ignore abort errors — the sync is already failed
  }
}

// ── Main orchestrator ──────────────────────────────────────────────

/**
 * Perform a normal (incremental) sync with the server.
 *
 * @param serverUrl - The sync server URL
 * @param hkey - Authentication host key
 * @param deckId - The local deck ID for IndexedDB lookups
 * @param sqliteBytes - The cached SQLite collection bytes
 * @param onProgress - Progress callback for UI updates
 * @returns The sync result with updated SQLite bytes and new state
 * @throws FullSyncRequiredError if schema mismatch detected
 * @throws SyncAbortedError if server requests abort
 */
export async function normalSync(
  serverUrl: string,
  hkey: string,
  deckId: string,
  sqliteBytes: Uint8Array,
  onProgress: ProgressCallback = () => {},
): Promise<NormalSyncResult> {
  const db = await createDatabase(sqliteBytes);
  let sessionStarted = false;

  try {
    // Step 0: Merge IndexedDB review state into SQLite (marks changed rows with usn=-1)
    onProgress("Merging local review state...");
    await mergeIndexedDBToSqlite(db, deckId);

    // Step 1: Read local metadata and fetch remote metadata
    const localMeta = readLocalMeta(db);
    onProgress("Checking server for changes...");
    const remoteMeta = await fetchMeta(serverUrl, hkey);

    // Check server messages
    if (remoteMeta.msg) {
      onProgress(`Server: ${remoteMeta.msg}`);
    }
    if (!remoteMeta.cont) {
      throw new SyncAbortedError(remoteMeta.msg || "Server requested abort");
    }

    // Clock skew detection: warn if local and server clocks differ by >5 minutes
    if (remoteMeta.ts > 0) {
      const localTimeSec = Date.now() / 1000;
      const skewSec = Math.abs(localTimeSec - remoteMeta.ts);
      if (skewSec > 300) {
        const skewMin = Math.round(skewSec / 60);
        onProgress(
          `Warning: your clock is off by ~${skewMin} minutes. This may cause scheduling issues.`,
        );
      }
    }

    // Step 2: Determine sync action
    const action = determineSyncAction(localMeta, remoteMeta);

    if (action === "noChanges") {
      onProgress("Already up to date.");
      db.close();
      return { action: "noChanges" };
    }

    if (action === "fullSyncRequired") {
      db.close();
      throw new FullSyncRequiredError();
    }

    // Negotiate protocol: use v11 (zstd) if server supports it, else legacy
    const proto: ProtoVersion = (remoteMeta.serverVersion ?? 0) >= 11 ? 11 : 10;

    // Step 3: Start sync — exchange graves
    const localIsNewer = localMeta.mod > remoteMeta.mod;
    onProgress("Starting sync session...");
    sessionStarted = true;
    const remoteGraves = await startSync(serverUrl, hkey, localMeta.usn, localIsNewer, proto);

    // Apply remote graves (deletions from server)
    onProgress("Applying remote deletions...");
    await applyRemoteGraves(db, remoteGraves);

    // Step 4: Send local graves
    onProgress("Sending local deletions...");
    const localGraves = buildLocalGraves(db);
    await sendGraves(serverUrl, hkey, localGraves, proto);

    // Step 5: Exchange unchunked changes (models, decks, config, tags)
    const anki21b = isAnki21bFormat(db);
    onProgress("Exchanging deck and notetype changes...");
    const localChanges = buildLocalUnchunkedChanges(db, anki21b, localIsNewer);
    const remoteChanges = await exchangeChanges(serverUrl, hkey, localChanges, proto);
    applyRemoteUnchunkedChanges(db, remoteChanges, anki21b);

    // Step 6: Receive server chunks (cards, notes, revlog)
    await receiveChunks(serverUrl, hkey, db, onProgress, proto);

    // Step 7: Send local chunks
    await sendChunks(serverUrl, hkey, db, onProgress, proto);

    // Step 8: Sanity check
    onProgress("Verifying sync integrity...");
    const counts = getSanityCounts(db, anki21b);
    await sanityCheck(serverUrl, hkey, counts, proto);

    // Step 9: Finish
    onProgress("Finalizing...");
    const newMod = await finishSync(serverUrl, hkey, proto);
    sessionStarted = false;

    // Update USNs and collection metadata
    finalizeUsn(db, remoteMeta.usn, newMod);

    // Export modified SQLite
    const newBytes = new Uint8Array(db.export());
    db.close();

    return {
      action: "normalSync",
      sqliteBytes: newBytes,
      newState: {
        lastSync: Date.now(),
        usn: remoteMeta.usn,
        scm: remoteMeta.scm,
      },
    };
  } catch (error) {
    if (sessionStarted) {
      await abortSync(serverUrl, hkey);
    }
    try { db.close(); } catch { /* already closed */ }
    throw error;
  }
}
