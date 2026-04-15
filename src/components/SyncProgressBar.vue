<script setup lang="ts">
import { computed } from "vue";
import { stageLabel, type SyncProgress } from "../lib/syncProgress";

const props = defineProps<{
  progress: SyncProgress | null;
  isActive: boolean;
}>();

const percentage = computed(() => {
  if (!props.progress?.fraction) return 0;
  return Math.round(props.progress.fraction * 100);
});

const label = computed(() => {
  if (!props.progress) return "";
  return stageLabel(props.progress.stage);
});

const detail = computed(() => props.progress?.detail ?? "");
</script>

<template>
  <div v-if="isActive && progress" class="sync-progress">
    <div class="sync-progress__header">
      <span class="sync-progress__label">{{ label }}</span>
      <span class="sync-progress__detail">{{ detail }}</span>
    </div>
    <div class="sync-progress__track">
      <div
        class="sync-progress__fill"
        :class="{ 'sync-progress__fill--indeterminate': progress.fraction === undefined }"
        :style="{ width: `${percentage}%` }"
      />
    </div>
    <div class="sync-progress__percentage">{{ progress.fraction !== undefined ? `${percentage}%` : '' }}</div>
  </div>
</template>

<style scoped>
.sync-progress {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
  padding: var(--spacing-3);
  background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
  border: 1px solid color-mix(in srgb, var(--color-primary) 20%, var(--color-border));
  border-radius: var(--radius-md);
}

.sync-progress__header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.sync-progress__label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.sync-progress__detail {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.sync-progress__track {
  height: 6px;
  background: var(--color-surface-elevated);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.sync-progress__fill {
  height: 100%;
  background: var(--color-primary);
  border-radius: var(--radius-sm);
  transition: width 0.3s ease;
}

.sync-progress__fill--indeterminate {
  width: 100% !important;
  animation: indeterminate 1.5s ease-in-out infinite;
}

.sync-progress__percentage {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  text-align: right;
}

@keyframes indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(200%);
  }
}
</style>
