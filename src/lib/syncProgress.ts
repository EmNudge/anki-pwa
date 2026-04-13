/**
 * Structured sync progress tracking.
 * Provides typed stage information for the sync progress UI.
 */

export type SyncStage =
  | "idle"
  | "merging-local"
  | "checking-server"
  | "starting-session"
  | "applying-deletions"
  | "sending-deletions"
  | "exchanging-metadata"
  | "receiving-changes"
  | "sending-changes"
  | "verifying"
  | "finalizing"
  | "applying-config"
  | "downloading-collection"
  | "downloading-media"
  | "uploading-collection"
  | "uploading-media"
  | "done"
  | "error";

export interface SyncProgress {
  stage: SyncStage;
  message: string;
  /** 0-1 progress within the overall sync. undefined if indeterminate. */
  fraction: number | undefined;
  /** Detailed sub-status (e.g. "chunk 3 of 5") */
  detail: string | undefined;
}

const STAGE_ORDER: readonly SyncStage[] = [
  "merging-local",
  "checking-server",
  "starting-session",
  "applying-deletions",
  "sending-deletions",
  "exchanging-metadata",
  "receiving-changes",
  "sending-changes",
  "verifying",
  "finalizing",
  "applying-config",
  "downloading-media",
  "uploading-media",
  "done",
];

const STAGE_LABELS: Record<SyncStage, string> = {
  idle: "Ready",
  "merging-local": "Merging local changes",
  "checking-server": "Checking server",
  "starting-session": "Starting sync session",
  "applying-deletions": "Applying remote deletions",
  "sending-deletions": "Sending local deletions",
  "exchanging-metadata": "Exchanging metadata",
  "receiving-changes": "Receiving server changes",
  "sending-changes": "Sending local changes",
  verifying: "Verifying integrity",
  finalizing: "Finalizing",
  "applying-config": "Applying deck config",
  "downloading-collection": "Downloading collection",
  "downloading-media": "Downloading media",
  "uploading-collection": "Uploading collection",
  "uploading-media": "Uploading media",
  done: "Complete",
  error: "Error",
};

export function stageLabel(stage: SyncStage): string {
  return STAGE_LABELS[stage];
}

function stageFraction(stage: SyncStage): number {
  const index = STAGE_ORDER.indexOf(stage);
  if (index === -1) return 0;
  return (index + 1) / STAGE_ORDER.length;
}

export function createProgress(stage: SyncStage, detail?: string): SyncProgress {
  return {
    stage,
    message: STAGE_LABELS[stage],
    fraction: stageFraction(stage),
    detail,
  };
}
