<script setup lang="ts">
import { ref, onMounted } from "vue";
import { reviewDB } from "../scheduler/db";
import type { StoredReviewLog } from "../scheduler/types";
import type { AnkiSM2ReviewLog, CardPhase } from "../scheduler/anki-sm2-algorithm";
import type { ReviewLog as FSRSReviewLog } from "ts-fsrs";

const props = defineProps<{
  cardId: string;
}>();

const logs = ref<StoredReviewLog[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const result = await reviewDB.getReviewLogsForCard(props.cardId);
    logs.value = result.sort((a, b) => b.timestamp - a.timestamp);
  } finally {
    loading.value = false;
  }
});

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeTaken(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return remainSecs > 0 ? `${mins}m ${remainSecs}s` : `${mins}m`;
}

function formatInterval(days: number): string {
  if (days < 1) {
    const mins = Math.round(days * 24 * 60);
    if (mins < 60) return `${mins}m`;
    return `${Math.round(days * 24)}h`;
  }
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function getRating(log: StoredReviewLog): string {
  if (typeof log.rating === "string") {
    return log.rating.charAt(0).toUpperCase() + log.rating.slice(1);
  }
  const map: Record<number, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
  return map[log.rating] ?? String(log.rating);
}

function getRatingClass(log: StoredReviewLog): string {
  const rating = typeof log.rating === "string" ? log.rating : "";
  if (rating === "again" || log.rating === 1) return "rating-again";
  if (rating === "hard" || log.rating === 2) return "rating-hard";
  if (rating === "good" || log.rating === 3) return "rating-good";
  if (rating === "easy" || log.rating === 4) return "rating-easy";
  return "";
}

function isSM2Log(log: StoredReviewLog["reviewLog"]): log is AnkiSM2ReviewLog {
  return "previousPhase" in log && "newPhase" in log;
}

function getInterval(log: StoredReviewLog): string {
  if (isSM2Log(log.reviewLog)) {
    return formatInterval(log.reviewLog.interval);
  }
  const fsrs = log.reviewLog as FSRSReviewLog;
  return `${fsrs.scheduled_days}d`;
}

function getPrevInterval(log: StoredReviewLog): string {
  if (isSM2Log(log.reviewLog)) {
    return formatInterval(log.reviewLog.previousInterval);
  }
  return "--";
}

function getEase(log: StoredReviewLog): string {
  if (isSM2Log(log.reviewLog)) {
    return `${Math.round(log.reviewLog.ease * 100)}%`;
  }
  const fsrs = log.reviewLog as FSRSReviewLog;
  return `D:${fsrs.difficulty.toFixed(1)}`;
}

function getTransition(log: StoredReviewLog): string | null {
  if (!isSM2Log(log.reviewLog)) return null;
  const prev = log.reviewLog.previousPhase;
  const next = log.reviewLog.newPhase;
  if (prev === next) return null;
  const labels: Record<CardPhase, string> = {
    new: "New",
    learning: "Learning",
    review: "Review",
    relearning: "Relearning",
  };
  return `${labels[prev]} → ${labels[next]}`;
}

function totalTimeSpent(): string {
  let totalMs = 0;
  for (const log of logs.value) {
    if (isSM2Log(log.reviewLog)) {
      // SM2 logs store timestamp but not duration directly; approximate from gap between reviews
    }
  }
  // We don't have per-review duration in the log entries, so show count only
  return "";
}

const totalReviews = () => logs.value.length;
</script>

<template>
  <div class="review-log-panel">
    <div v-if="loading" class="review-log-loading">Loading...</div>
    <template v-else>
      <div v-if="logs.length === 0" class="review-log-empty">No reviews yet</div>
      <template v-else>
        <div class="review-log-summary">
          <div class="summary-stat">
            <span class="summary-label">Total Reviews</span>
            <span class="summary-value">{{ totalReviews() }}</span>
          </div>
        </div>

        <table class="review-log-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Rating</th>
              <th>Interval</th>
              <th>Ease</th>
              <th>Info</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in logs" :key="log.timestamp">
              <td class="log-date">{{ formatDate(log.timestamp) }}</td>
              <td>
                <span :class="['rating-badge', getRatingClass(log)]">{{ getRating(log) }}</span>
              </td>
              <td class="log-interval">
                <span class="interval-prev">{{ getPrevInterval(log) }}</span>
                <span class="interval-arrow">→</span>
                <span class="interval-new">{{ getInterval(log) }}</span>
              </td>
              <td class="log-ease">{{ getEase(log) }}</td>
              <td class="log-transition">
                <span v-if="getTransition(log)" class="transition-badge">{{
                  getTransition(log)
                }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </template>
  </div>
</template>

<style scoped>
.review-log-panel {
  font-size: var(--font-size-xs);
}

.review-log-loading,
.review-log-empty {
  color: var(--color-text-tertiary);
  text-align: center;
  padding: var(--spacing-4);
}

.review-log-summary {
  display: flex;
  gap: var(--spacing-4);
  margin-bottom: var(--spacing-3);
  padding: var(--spacing-2) var(--spacing-3);
  background: var(--color-surface-elevated);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
}

.summary-stat {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-0-5);
}

.summary-label {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-2xs);
  font-weight: var(--font-weight-medium);
}

.summary-value {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-semibold);
}

.review-log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-2xs);
}

.review-log-table th {
  text-align: left;
  padding: var(--spacing-1) var(--spacing-2);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-tertiary);
  font-weight: var(--font-weight-semibold);
  white-space: nowrap;
}

.review-log-table td {
  padding: var(--spacing-1) var(--spacing-2);
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

.review-log-table tbody tr:hover {
  background: var(--color-surface-elevated);
}

.log-date {
  color: var(--color-text-secondary);
}

.rating-badge {
  display: inline-block;
  padding: 0 var(--spacing-1-5);
  border-radius: var(--radius-xs);
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-2xs);
}

.rating-again {
  background: var(--color-error-100, #fee2e2);
  color: var(--color-error-700, #b91c1c);
}

.rating-hard {
  background: var(--color-warning-100, #fef3c7);
  color: var(--color-warning-700, #a16207);
}

.rating-good {
  background: var(--color-success-100, #dcfce7);
  color: var(--color-success-700, #15803d);
}

.rating-easy {
  background: var(--color-primary-100, #dbeafe);
  color: var(--color-primary-700, #1d4ed8);
}

:root[data-theme="dark"] .rating-again {
  background: var(--color-error-950, #450a0a);
  color: var(--color-error-400, #f87171);
}

:root[data-theme="dark"] .rating-hard {
  background: var(--color-warning-950, #451a03);
  color: var(--color-warning-400, #fbbf24);
}

:root[data-theme="dark"] .rating-good {
  background: var(--color-success-950, #052e16);
  color: var(--color-success-400, #4ade80);
}

:root[data-theme="dark"] .rating-easy {
  background: var(--color-primary-950, #172554);
  color: var(--color-primary-400, #60a5fa);
}

.log-interval {
  font-family: var(--font-family-mono);
}

.interval-prev {
  color: var(--color-text-tertiary);
}

.interval-arrow {
  color: var(--color-text-tertiary);
  margin: 0 var(--spacing-0-5);
}

.interval-new {
  color: var(--color-text-primary);
  font-weight: var(--font-weight-medium);
}

.log-ease {
  font-family: var(--font-family-mono);
  color: var(--color-text-secondary);
}

.transition-badge {
  display: inline-block;
  padding: 0 var(--spacing-1);
  border-radius: var(--radius-xs);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: var(--font-size-2xs);
}

.log-transition {
  min-width: 0;
}
</style>
