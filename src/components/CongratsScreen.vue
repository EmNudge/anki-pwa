<script setup lang="ts">
import { computed } from "vue";
import {
  reviewQueueSig,
  fullQueueSig,
  reviewModeSig,
} from "../stores";
import { Button } from "../design-system";

const stats = computed(() => {
  const queue = reviewQueueSig.value;
  if (!queue) return null;
  return queue.getTodayStats();
});

const nextDue = computed(() => {
  const queue = reviewQueueSig.value;
  if (!queue) return null;
  return queue.getNextDueDate(fullQueueSig.value);
});

const timeSpent = computed(() => {
  const ms = stats.value?.totalTimeMs ?? 0;
  if (ms < 60_000) return "< 1 minute";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs} hour${hrs === 1 ? "" : "s"}`;
});

const nextDueText = computed(() => {
  const d = nextDue.value;
  if (!d) return "No more cards scheduled";
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return "Now";
  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ~${hrs} hour${hrs === 1 ? "" : "s"}`;
  const days = Math.floor(hrs / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
});

const reviewed = computed(() => {
  if (!stats.value) return 0;
  return stats.value.newCount + stats.value.reviewCount;
});
</script>

<template>
  <div class="congrats">
    <div class="congrats-card">
      <h2 class="congrats-title">Congratulations!</h2>
      <p class="congrats-subtitle">You've finished this deck for now.</p>

      <dl class="congrats-stats">
        <div class="stat">
          <dt>Reviewed today</dt>
          <dd>{{ reviewed }} card{{ reviewed === 1 ? "" : "s" }}</dd>
        </div>
        <div class="stat">
          <dt>Time spent</dt>
          <dd>{{ timeSpent }}</dd>
        </div>
        <div class="stat">
          <dt>Next due</dt>
          <dd>{{ nextDueText }}</dd>
        </div>
      </dl>

      <div class="congrats-actions">
        <Button variant="secondary" @click="reviewModeSig = 'deck-list'">
          Back to Decks
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.congrats {
  display: flex;
  justify-content: center;
  padding: var(--spacing-8) var(--spacing-4);
}

.congrats-card {
  max-width: 400px;
  width: 100%;
  text-align: center;
}

.congrats-title {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
  margin: 0 0 var(--spacing-2) 0;
}

.congrats-subtitle {
  color: var(--color-text-secondary);
  font-size: var(--font-size-base);
  margin: 0 0 var(--spacing-6) 0;
}

.congrats-stats {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
  margin: 0 0 var(--spacing-6) 0;
  padding: var(--spacing-4);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat dt {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.stat dd {
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.congrats-actions {
  display: flex;
  justify-content: center;
  gap: var(--spacing-3);
}
</style>
