<script setup lang="ts">
import type { CardCountsData, TrueRetentionData } from "../../stats/types";

const props = defineProps<{
  totalReviews: number;
  streak: number;
  cardCounts: CardCountsData;
  trueRetention: TrueRetentionData;
  totalTimeMs: number;
}>();

function formatTime(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
</script>

<template>
  <div class="overview-grid">
    <div class="stat-card">
      <div class="stat-value">{{ props.totalReviews.toLocaleString() }}</div>
      <div class="stat-label">Total Reviews</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{{ props.streak }}</div>
      <div class="stat-label">Day Streak</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">
        {{
          props.trueRetention.total > 0
            ? (props.trueRetention.retention * 100).toFixed(1) + "%"
            : "—"
        }}
      </div>
      <div class="stat-label">True Retention</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{{ formatTime(props.totalTimeMs) }}</div>
      <div class="stat-label">Study Time</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">{{ props.cardCounts.mature.toLocaleString() }}</div>
      <div class="stat-label">Mature Cards</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">
        {{
          (
            props.cardCounts.new +
            props.cardCounts.learning +
            props.cardCounts.young +
            props.cardCounts.mature
          ).toLocaleString()
        }}
      </div>
      <div class="stat-label">Total Cards</div>
    </div>
  </div>
</template>

<style scoped>
.overview-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--spacing-3);
}

.stat-card {
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-neutral-200);
  border-radius: var(--radius-lg);
  padding: var(--spacing-4);
  text-align: center;
}

.stat-value {
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-neutral-900);
  line-height: 1.2;
}

.stat-label {
  font-size: var(--font-size-xs);
  color: var(--color-neutral-500);
  margin-top: var(--spacing-1);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
</style>
