/**
 * Normal (incremental) sync protocol for Anki collections.
 *
 * Implements the 9-step sync flow matching Anki desktop:
 * meta → start → applyGraves → applyChanges → chunk → applyChunk → sanityCheck2 → finish
 * with abort on error.
 */
import { z } from "zod";
import { createDatabase } from "~/utils/sql";
import {
  normalizeUrl,
  syncPost,
  syncPostV11,
  readResponseJson,
  generateSessionKey,
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
  type UnchunkedChanges,
  type SanityCheckCounts,
  NotetypeSchemaMismatchError,
  chunkSchema,
} from "./syncMerge";
import { createProgress, type SyncProgress } from "./syncProgress";

// ── Zod Schemas ───────────────────────────────────────────────────

const rawMetaResponseSchema = z
  .object({
    mod: z.number().optional(),
    modified: z.number().optional(),
    scm: z.number().optional(),
    schema: z.number().optional(),
    usn: z.number().optional(),
    ts: z.number().optional(),
    current_time: z.number().optional(),
    msg: z.string().optional(),
    server_message: z.string().optional(),
    cont: z.boolean().optional(),
    should_continue: z.boolean().optional(),
    hostNum: z.number().optional(),
    host_number: z.number().optional(),
    empty: z.boolean().optional(),
    mediaUsn: z.number().optional(),
    media_usn: z.number().optional(),
    v: z.number().optional(),
    server_version: z.number().optional(),
  })
  .passthrough();

const rawStartResponseSchema = z
  .object({
    cards: z.array(z.number()).optional(),
    notes: z.array(z.number()).optional(),
    decks: z.array(z.number()).optional(),
  })
  .passthrough();

const syncModelSchema = z.object({ id: z.number() }).passthrough();
const syncDeckSchema = z.object({ id: z.number() }).passthrough();
const syncDeckConfigSchema = z.object({ id: z.number() }).passthrough();

const rawApplyChangesResponseSchema = z
  .object({
    models: z.array(syncModelSchema).optional(),
    decks: z.tuple([z.array(syncDeckSchema), z.array(syncDeckConfigSchema)]).optional(),
    tags: z.array(z.string()).optional(),
    conf: z.record(z.unknown()).optional(),
    crt: z.number().optional(),
  })
  .passthrough();

const rawSanityCheckResponseSchema = z
  .object({
    status: z.string().optional(),
  })
  .passthrough();

const rawFinishResponseSchema = z
  .object({
    mod: z.number().optional(),
  })
  .passthrough();

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

class SyncAbortedError extends Error {
  constructor(message = "Sync aborted by server") {
    super(message);
    this.name = "SyncAbortedError";
  }
}

export class ConcurrentSyncError extends Error {
  constructor() {
    super(
      "Another device is syncing with the server right now. Please wait and try again in a moment.",
    );
    this.name = "ConcurrentSyncError";
  }
}

export class ClockSkewError extends Error {
  constructor(skewMinutes: number) {
    super(
      `Your clock is off by ~${skewMinutes} minutes. Sync cannot proceed because incorrect timestamps would corrupt scheduling data. Please fix your system clock and try again.`,
    );
    this.name = "ClockSkewError";
  }
}

type ProgressCallback = (status: string, progress?: SyncProgress) => void;

interface NormalSyncResult {
  action: SyncAction;
  sqliteBytes?: Uint8Array;
  newState?: Partial<SyncState>;
  /** Protocol version negotiated with the server (10 = legacy multipart, 11 = zstd). */
  proto?: 10 | 11;
  /** Summary of what changed during sync */
  summary?: SyncSummary;
}

export interface SyncSummary {
  remoteGraves: number;
  localGraves: number;
  remoteMetadataChanges: number;
  localMetadataChanges: number;
  chunksReceived: number;
  chunksSent: number;
  mediaDownloaded: number;
  mediaUploaded: number;
}

const CHUNK_SIZE = 250;

/** Use v11 zstd transport when server supports it, otherwise legacy multipart. */
type ProtoVersion = 10 | 11;

function safeJsonParse(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

// ── Protocol helpers ───────────────────────────────────────────────

async function syncEndpoint(
  serverUrl: string,
  endpoint: string,
  hkey: string,
  data: unknown = {},
  proto: ProtoVersion = 10,
  sessionKey?: string,
): Promise<unknown> {
  const base = normalizeUrl(serverUrl);
  const url = `${base}/sync/${endpoint}`;

  const response =
    proto >= 11
      ? await syncPostV11(url, hkey, data, sessionKey)
      : await syncPost(url, hkey, data, sessionKey);

  if (response.status === 401 || response.status === 403) {
    throw new Error("Authentication expired. Please log in again.");
  }
  if (response.status === 409) {
    throw new ConcurrentSyncError();
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`sync/${endpoint} failed: ${response.status} ${response.statusText} — ${body}`);
  }

  return readResponseJson(response);
}

// ── Individual sync steps ──────────────────────────────────────────

async function fetchMeta(serverUrl: string, hkey: string): Promise<SyncMeta> {
  // Request v11 — server will respond with its max supported version
  const r = rawMetaResponseSchema.parse(
    await syncEndpoint(serverUrl, "meta", hkey, {
      v: 11,
      cv: "anki-pwa,0.1,web",
    }),
  );

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
  const row = result[0].values[0];
  const mod = Number(row[0]);
  const scm = Number(row[1]);
  const usn = Number(row[2]);
  const ls = Number(row[3]);
  return { mod, scm, usn, ls };
}

async function startSync(
  serverUrl: string,
  hkey: string,
  clientUsn: number,
  localIsNewer: boolean,
  proto: ProtoVersion = 10,
  sessionKey?: string,
): Promise<Graves> {
  const r = rawStartResponseSchema.parse(
    await syncEndpoint(
      serverUrl,
      "start",
      hkey,
      {
        minUsn: clientUsn,
        lnewer: localIsNewer,
      },
      proto,
      sessionKey,
    ),
  );
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
  sessionKey?: string,
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
    await syncEndpoint(serverUrl, "applyGraves", hkey, { chunk }, proto, sessionKey);
  }

  // If no graves at all, still send an empty one
  if (allIds.length === 0) {
    await syncEndpoint(
      serverUrl,
      "applyGraves",
      hkey,
      {
        chunk: { cards: [], notes: [], decks: [] },
      },
      proto,
      sessionKey,
    );
  }
}

async function exchangeChanges(
  serverUrl: string,
  hkey: string,
  localChanges: UnchunkedChanges,
  proto: ProtoVersion = 10,
  sessionKey?: string,
): Promise<UnchunkedChanges> {
  const r = rawApplyChangesResponseSchema.parse(
    await syncEndpoint(
      serverUrl,
      "applyChanges",
      hkey,
      {
        changes: localChanges,
      },
      proto,
      sessionKey,
    ),
  );
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
  pendingUsn: number,
  proto: ProtoVersion = 10,
  sessionKey?: string,
): Promise<void> {
  let chunkNum = 0;
  while (true) {
    chunkNum++;
    onProgress(`Receiving server changes (chunk ${chunkNum})...`);
    const result = await syncEndpoint(serverUrl, "chunk", hkey, {}, proto, sessionKey);
    const chunk = chunkSchema.parse(result);
    await applyRemoteChunk(db, chunk, pendingUsn);
    if (chunk.done) break;
  }
}

async function sendChunks(
  serverUrl: string,
  hkey: string,
  db: import("sql.js").Database,
  onProgress: ProgressCallback,
  proto: ProtoVersion = 10,
  sessionKey?: string,
): Promise<void> {
  let chunkNum = 0;
  for (const chunk of buildLocalChunks(db)) {
    chunkNum++;
    onProgress(`Sending local changes (chunk ${chunkNum})...`);
    await syncEndpoint(serverUrl, "applyChunk", hkey, { chunk }, proto, sessionKey);
  }
}

async function sanityCheck(
  serverUrl: string,
  hkey: string,
  counts: SanityCheckCounts,
  proto: ProtoVersion = 10,
  sessionKey?: string,
): Promise<void> {
  const r = rawSanityCheckResponseSchema.parse(
    await syncEndpoint(
      serverUrl,
      "sanityCheck2",
      hkey,
      {
        client: counts,
      },
      proto,
      sessionKey,
    ),
  );
  if (r.status === "bad") {
    throw new FullSyncRequiredError(
      "Sync sanity check failed: client and server counts do not match. A full sync is required.",
    );
  }
}

async function finishSync(
  serverUrl: string,
  hkey: string,
  proto: ProtoVersion = 10,
  sessionKey?: string,
): Promise<number> {
  const result = await syncEndpoint(serverUrl, "finish", hkey, {}, proto, sessionKey);
  // Server returns the new mod time (number)
  if (typeof result === "number") return result;
  // Some servers wrap in an object
  const parsed = rawFinishResponseSchema.parse(result);
  return parsed.mod ?? Date.now();
}

async function abortSync(
  serverUrl: string,
  hkey: string,
  proto: ProtoVersion = 10,
  sessionKey?: string,
): Promise<void> {
  try {
    await syncEndpoint(serverUrl, "abort", hkey, {}, proto, sessionKey);
  } catch {
    // Ignore abort errors — the sync is already failed
  }
}

// ── Deck config → scheduler settings ──────────────────────────────

/**
 * Extract deck configs from the synced SQLite and apply them to the
 * IndexedDB scheduler settings so that new/review limits, learning steps,
 * and other parameters match what the user configured on desktop Anki.
 */
async function applyDeckConfigsToScheduler(
  db: import("sql.js").Database,
  deckId: string,
): Promise<void> {
  const { reviewDB } = await import("../scheduler/db");
  const { DEFAULT_SM2_PARAMS } = await import("../scheduler/types");

  // Detect format
  const hasNotetypes = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='notetypes'",
  );
  const isAnki21b = (hasNotetypes[0]?.values.length ?? 0) > 0;

  // Collect all deck configs
  const rawDconfSchema = z
    .object({
      new: z
        .object({
          delays: z.array(z.number()).optional(),
          perDay: z.number().optional(),
          order: z.number().optional(),
        })
        .optional(),
      lapse: z
        .object({
          delays: z.array(z.number()).optional(),
          minInt: z.number().optional(),
          mult: z.number().optional(),
          leechFails: z.number().optional(),
        })
        .optional(),
      rev: z
        .object({
          perDay: z.number().optional(),
          ease4: z.number().optional(),
          hardFactor: z.number().optional(),
          ivlFct: z.number().optional(),
          maxIvl: z.number().optional(),
          fuzz: z.boolean().optional(),
        })
        .optional(),
      maxTaken: z.number().optional(),
    })
    .passthrough();

  type RawDconf = z.infer<typeof rawDconfSchema>;

  const configs = new Map<string, RawDconf>();

  if (isAnki21b) {
    const dcResult = db.exec("SELECT id, config FROM deck_config");
    if (dcResult[0]) {
      for (const row of dcResult[0].values) {
        const parsed = rawDconfSchema.safeParse(safeJsonParse(String(row[1] ?? "")));
        if (parsed.success) {
          configs.set(String(row[0]), parsed.data);
        }
      }
    }
  } else {
    const dconfRaw = db.exec("SELECT dconf FROM col");
    if (dconfRaw[0]?.values[0]) {
      const outer = safeJsonParse(String(dconfRaw[0].values[0][0] ?? ""));
      if (outer && typeof outer === "object") {
        for (const [id, raw] of Object.entries(outer)) {
          const parsed = rawDconfSchema.safeParse(raw);
          if (parsed.success) configs.set(id, parsed.data);
        }
      }
    }
  }

  if (configs.size === 0) return;

  // For now, apply the first config (deck 1 / default) to the scheduler deckId.
  // A more complete implementation would map each deck to its config.
  const cfg = configs.values().next().value;
  if (!cfg) return;

  const existing = await reviewDB.getSettings(deckId);

  const sm2Params = {
    ...DEFAULT_SM2_PARAMS,
    ...existing.sm2Params,
    learningSteps: cfg.new?.delays ?? DEFAULT_SM2_PARAMS.learningSteps,
    relearningSteps: cfg.lapse?.delays ?? DEFAULT_SM2_PARAMS.relearningSteps,
    lapseNewInterval: cfg.lapse?.mult ?? DEFAULT_SM2_PARAMS.lapseNewInterval,
    minLapseInterval: cfg.lapse?.minInt ?? DEFAULT_SM2_PARAMS.minLapseInterval,
    leechThreshold: cfg.lapse?.leechFails ?? DEFAULT_SM2_PARAMS.leechThreshold,
    easyBonus: cfg.rev?.ease4 ?? DEFAULT_SM2_PARAMS.easyBonus,
    hardMultiplier: cfg.rev?.hardFactor ?? DEFAULT_SM2_PARAMS.hardMultiplier,
    intervalModifier: cfg.rev?.ivlFct ?? DEFAULT_SM2_PARAMS.intervalModifier,
    maximumInterval: cfg.rev?.maxIvl ?? DEFAULT_SM2_PARAMS.maximumInterval,
  };

  await reviewDB.saveSettings(deckId, {
    ...existing,
    dailyNewLimit: cfg.new?.perDay ?? existing.dailyNewLimit,
    dailyReviewLimit: cfg.rev?.perDay ?? existing.dailyReviewLimit,
    sm2Params,
  });
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
  try {
    return await normalSyncInner(serverUrl, hkey, deckId, sqliteBytes, onProgress);
  } catch (error) {
    if (error instanceof ConcurrentSyncError) {
      // A stale session is blocking us — abort it and retry once
      onProgress("Clearing stale sync session...");
      await abortSync(serverUrl, hkey);
      return await normalSyncInner(serverUrl, hkey, deckId, sqliteBytes, onProgress);
    }
    throw error;
  }
}

async function normalSyncInner(
  serverUrl: string,
  hkey: string,
  deckId: string,
  sqliteBytes: Uint8Array,
  onProgress: ProgressCallback = () => {},
): Promise<NormalSyncResult> {
  const db = await createDatabase(sqliteBytes);
  let sessionStarted = false;
  let proto: ProtoVersion = 10;
  const sessionKey = generateSessionKey();

  try {
    // Step 0: Merge IndexedDB review state into SQLite (marks changed rows with usn=-1)
    onProgress("Merging local review state...", createProgress("merging-local"));
    await mergeIndexedDBToSqlite(db, deckId);

    // Step 1: Read local metadata and fetch remote metadata
    const localMeta = readLocalMeta(db);
    onProgress("Checking server for changes...", createProgress("checking-server"));
    const remoteMeta = await fetchMeta(serverUrl, hkey);

    // Check server messages
    if (remoteMeta.msg) {
      onProgress(`Server: ${remoteMeta.msg}`);
    }
    if (!remoteMeta.cont) {
      throw new SyncAbortedError(remoteMeta.msg || "Server requested abort");
    }

    // Clock skew detection: block sync if clocks differ by >5 minutes
    if (remoteMeta.ts > 0) {
      const localTimeSec = Date.now() / 1000;
      const skewSec = Math.abs(localTimeSec - remoteMeta.ts);
      if (skewSec > 300) {
        throw new ClockSkewError(Math.round(skewSec / 60));
      }
    }

    // Step 2: Determine sync action
    const action = determineSyncAction(localMeta, remoteMeta);

    if (action === "noChanges") {
      onProgress("Already up to date.");
      const noChangeProto: 10 | 11 = (remoteMeta.serverVersion ?? 0) >= 11 ? 11 : 10;
      db.close();
      return { action: "noChanges", proto: noChangeProto };
    }

    if (action === "fullSyncRequired") {
      db.close();
      throw new FullSyncRequiredError();
    }

    // Negotiate protocol: use v11 (zstd) if server supports it, else legacy
    proto = (remoteMeta.serverVersion ?? 0) >= 11 ? 11 : 10;

    // Step 3: Start sync — exchange graves
    const localIsNewer = localMeta.mod > remoteMeta.mod;
    onProgress("Starting sync session...", createProgress("starting-session"));
    sessionStarted = true;
    const remoteGraves = await startSync(
      serverUrl,
      hkey,
      localMeta.usn,
      localIsNewer,
      proto,
      sessionKey,
    );

    // Apply remote graves (deletions from server)
    const remoteGraveCount =
      remoteGraves.cards.length + remoteGraves.notes.length + remoteGraves.decks.length;
    onProgress(
      `Applying ${remoteGraveCount} remote deletion${remoteGraveCount !== 1 ? "s" : ""}...`,
      createProgress(
        "applying-deletions",
        `${remoteGraveCount} deletion${remoteGraveCount !== 1 ? "s" : ""}`,
      ),
    );
    await applyRemoteGraves(db, remoteGraves);

    // Step 4: Send local graves
    const localGraves = buildLocalGraves(db);
    const localGraveCount =
      localGraves.cards.length + localGraves.notes.length + localGraves.decks.length;
    onProgress(
      `Sending ${localGraveCount} local deletion${localGraveCount !== 1 ? "s" : ""}...`,
      createProgress(
        "sending-deletions",
        `${localGraveCount} deletion${localGraveCount !== 1 ? "s" : ""}`,
      ),
    );
    await sendGraves(serverUrl, hkey, localGraves, proto, sessionKey);

    // Step 5: Exchange unchunked changes (models, decks, config, tags)
    const anki21b = isAnki21bFormat(db);
    const localChanges = buildLocalUnchunkedChanges(db, anki21b, localIsNewer);
    const localUnchunkedCount =
      localChanges.models.length +
      localChanges.decks[0].length +
      localChanges.decks[1].length +
      localChanges.tags.length;
    onProgress(
      `Exchanging metadata (${localUnchunkedCount} local change${localUnchunkedCount !== 1 ? "s" : ""})...`,
      createProgress(
        "exchanging-metadata",
        `${localUnchunkedCount} local change${localUnchunkedCount !== 1 ? "s" : ""}`,
      ),
    );
    const remoteChanges = await exchangeChanges(serverUrl, hkey, localChanges, proto, sessionKey);
    try {
      applyRemoteUnchunkedChanges(db, remoteChanges, anki21b, localIsNewer);
    } catch (e) {
      if (e instanceof NotetypeSchemaMismatchError) {
        throw new FullSyncRequiredError(e.message);
      }
      throw e;
    }

    // Step 6: Receive server chunks (cards, notes, revlog)
    let chunksReceived = 0;
    const origReceiveProgress = onProgress;
    await receiveChunks(
      serverUrl,
      hkey,
      db,
      (status) => {
        chunksReceived++;
        origReceiveProgress(status, createProgress("receiving-changes", `chunk ${chunksReceived}`));
      },
      localMeta.usn,
      proto,
      sessionKey,
    );

    // Step 7: Send local chunks
    let chunksSent = 0;
    await sendChunks(
      serverUrl,
      hkey,
      db,
      (status) => {
        chunksSent++;
        onProgress(status, createProgress("sending-changes", `chunk ${chunksSent}`));
      },
      proto,
      sessionKey,
    );

    // Step 8: Sanity check
    onProgress("Verifying sync integrity...", createProgress("verifying"));
    const counts = getSanityCounts(db, anki21b);
    await sanityCheck(serverUrl, hkey, counts, proto, sessionKey);

    // Step 9: Finish
    onProgress("Finalizing...", createProgress("finalizing"));
    const newMod = await finishSync(serverUrl, hkey, proto, sessionKey);
    sessionStarted = false;

    // Update USNs and collection metadata
    finalizeUsn(db, remoteMeta.usn, newMod, anki21b);

    // Apply synced deck configs to scheduler settings
    onProgress("Applying deck configuration...", createProgress("applying-config"));
    await applyDeckConfigsToScheduler(db, deckId);

    // Export modified SQLite
    const newBytes = new Uint8Array(db.export());
    db.close();

    const remoteMetadataChanges =
      remoteChanges.models.length +
      remoteChanges.decks[0].length +
      remoteChanges.decks[1].length +
      remoteChanges.tags.length;

    return {
      action: "normalSync",
      sqliteBytes: newBytes,
      newState: {
        lastSync: Date.now(),
        usn: remoteMeta.usn,
        scm: remoteMeta.scm,
      },
      proto,
      summary: {
        remoteGraves: remoteGraveCount,
        localGraves: localGraveCount,
        remoteMetadataChanges,
        localMetadataChanges: localUnchunkedCount,
        chunksReceived,
        chunksSent,
        mediaDownloaded: 0,
        mediaUploaded: 0,
      },
    };
  } catch (error) {
    if (sessionStarted) {
      await abortSync(serverUrl, hkey, proto, sessionKey);
    }
    try {
      db.close();
    } catch {
      /* already closed */
    }
    throw error;
  }
}
