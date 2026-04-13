<script setup lang="ts">
import { computed } from "vue";
import type { SyncSummary } from "../lib/normalSync";

const props = defineProps<{
  summary: SyncSummary | null;
}>();

const entries = computed(() => {
  if (!props.summary) return [];
  const items: Array<{ label: string; count: number; direction: "in" | "out" }> = [];
  if (props.summary.remoteGraves > 0) {
    items.push({
      label: "Remote deletions applied",
      count: props.summary.remoteGraves,
      direction: "in",
    });
  }
  if (props.summary.localGraves > 0) {
    items.push({
      label: "Local deletions sent",
      count: props.summary.localGraves,
      direction: "out",
    });
  }
  if (props.summary.remoteMetadataChanges > 0) {
    items.push({
      label: "Metadata changes received",
      count: props.summary.remoteMetadataChanges,
      direction: "in",
    });
  }
  if (props.summary.localMetadataChanges > 0) {
    items.push({
      label: "Metadata changes sent",
      count: props.summary.localMetadataChanges,
      direction: "out",
    });
  }
  if (props.summary.chunksReceived > 0) {
    items.push({
      label: "Data chunks received",
      count: props.summary.chunksReceived,
      direction: "in",
    });
  }
  if (props.summary.chunksSent > 0) {
    items.push({ label: "Data chunks sent", count: props.summary.chunksSent, direction: "out" });
  }
  if (props.summary.mediaDownloaded > 0) {
    items.push({
      label: "Media files downloaded",
      count: props.summary.mediaDownloaded,
      direction: "in",
    });
  }
  if (props.summary.mediaUploaded > 0) {
    items.push({
      label: "Media files uploaded",
      count: props.summary.mediaUploaded,
      direction: "out",
    });
  }
  return items;
});

const isEmpty = computed(() => entries.value.length === 0);
</script>

<template>
  <div v-if="summary" class="sync-summary">
    <div v-if="isEmpty" class="sync-summary__empty">No changes were exchanged.</div>
    <div v-else class="sync-summary__list">
      <div v-for="entry of entries" :key="entry.label" class="sync-summary__item">
        <span class="sync-summary__arrow" :class="`sync-summary__arrow--${entry.direction}`">
          {{ entry.direction === "in" ? "↓" : "↑" }}
        </span>
        <span class="sync-summary__label">{{ entry.label }}</span>
        <span class="sync-summary__count">{{ entry.count }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sync-summary {
  padding: var(--spacing-3);
  background: color-mix(in srgb, var(--color-primary) 4%, var(--color-surface));
  border: 1px solid color-mix(in srgb, var(--color-primary) 15%, var(--color-border));
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
}

.sync-summary__empty {
  color: var(--color-text-secondary);
  text-align: center;
}

.sync-summary__list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.sync-summary__item {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.sync-summary__arrow {
  font-weight: var(--font-weight-semibold);
  width: 16px;
  text-align: center;
}

.sync-summary__arrow--in {
  color: var(--color-primary);
}

.sync-summary__arrow--out {
  color: #f59e0b;
}

.sync-summary__label {
  color: var(--color-text-secondary);
  flex: 1;
}

.sync-summary__count {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
  font-variant-numeric: tabular-nums;
}
</style>
