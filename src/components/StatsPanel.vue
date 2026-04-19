<script setup lang="ts">
import { ref, shallowRef, watch, onMounted } from "vue";
import { Page } from "../design-system";
import { reviewDB } from "../scheduler/db";
import { normalizeCard } from "../stats/normalizeCard";
import {
  computeCardCounts,
  computeIntervalDistribution,
  computeEaseDistribution,
  computeFutureDue,
  computeCalendarHeatmap,
  computeReviewsByHour,
  computeAnswerButtons,
  computeTrueRetention,
  computeAddedCards,
  computeStudyStreak,
} from "../stats/computeStats";
import type { StatsPeriod } from "../stats/types";
import type {
  CardCountsData,
  AnswerButtonsData,
  TrueRetentionData,
  BucketData,
  DayCount,
} from "../stats/types";
import { useChartTheme } from "../composables/useChartTheme";

import StatsPeriodSelector from "./stats/StatsPeriodSelector.vue";
import StatsOverview from "./stats/StatsOverview.vue";
import CardCountsChart from "./stats/CardCountsChart.vue";
import AnswerButtonsChart from "./stats/AnswerButtonsChart.vue";
import CalendarHeatmap from "./stats/CalendarHeatmap.vue";
import IntervalChart from "./stats/IntervalChart.vue";
import EaseChart from "./stats/EaseChart.vue";
import FutureDueChart from "./stats/FutureDueChart.vue";
import HourlyReviewChart from "./stats/HourlyReviewChart.vue";
import AddedCardsChart from "./stats/AddedCardsChart.vue";

const { colors } = useChartTheme();

const MS_PER_DAY = 86_400_000;

const period = ref<StatsPeriod>("1m");
const loading = ref(true);

// Computed stat results
const cardCounts = shallowRef<CardCountsData>({ new: 0, learning: 0, young: 0, mature: 0 });
const answerButtons = shallowRef<AnswerButtonsData>({ again: 0, hard: 0, good: 0, easy: 0 });
const trueRetention = shallowRef<TrueRetentionData>({ retention: 0, total: 0, correct: 0 });
const intervalDist = shallowRef<BucketData[]>([]);
const easeDist = shallowRef<BucketData[]>([]);
const futureDue = shallowRef<DayCount[]>([]);
const calendarData = shallowRef<DayCount[]>([]);
const hourlyData = shallowRef<BucketData[]>([]);
const addedCardsData = shallowRef<DayCount[]>([]);
const totalReviews = ref(0);
const totalTimeMs = ref(0);
const streak = ref(0);

function getPeriodStartMs(p: StatsPeriod): number {
  const now = Date.now();
  switch (p) {
    case "1m":
      return now - 30 * MS_PER_DAY;
    case "3m":
      return now - 90 * MS_PER_DAY;
    case "1y":
      return now - 365 * MS_PER_DAY;
    case "all":
      return 0;
  }
}

async function loadStats() {
  loading.value = true;

  const startMs = getPeriodStartMs(period.value);
  const endMs = Date.now();

  const [allCards, logs, dailyStats] = await Promise.all([
    reviewDB.getAllCards(),
    reviewDB.getAllReviewLogsInRange(startMs, endMs),
    reviewDB.getAllDailyStats(),
  ]);

  const normalized = allCards.map(normalizeCard);

  // Filter daily stats to period
  const startDate = new Date(startMs).toISOString().slice(0, 10);
  const filteredDailyStats =
    period.value === "all" ? dailyStats : dailyStats.filter((s) => s.date >= startDate);

  // Card-based stats (always use all cards for current state)
  cardCounts.value = computeCardCounts(normalized);
  intervalDist.value = computeIntervalDistribution(normalized);
  easeDist.value = computeEaseDistribution(normalized);
  futureDue.value = computeFutureDue(normalized, 30);

  // Review-log-based stats (filtered by period)
  calendarData.value = computeCalendarHeatmap(logs);
  hourlyData.value = computeReviewsByHour(logs);
  answerButtons.value = computeAnswerButtons(logs);
  trueRetention.value = computeTrueRetention(logs, normalized);
  addedCardsData.value = computeAddedCards(normalized, startMs, endMs);

  // Aggregate totals
  totalReviews.value = filteredDailyStats.reduce((sum, s) => sum + s.newCount + s.reviewCount, 0);
  totalTimeMs.value = filteredDailyStats.reduce((sum, s) => sum + s.totalTimeMs, 0);
  streak.value = computeStudyStreak(dailyStats);

  loading.value = false;
}

onMounted(loadStats);
watch(period, loadStats);
</script>

<template>
  <Page class="stats-panel" data-testid="stats-panel">
    <template #title>
      <div class="stats-header">
        <h2 class="title stats-title">Statistics</h2>
        <StatsPeriodSelector v-model="period" />
      </div>
    </template>

    <div v-if="loading" class="stats-loading">Loading statistics...</div>

    <template v-else>
      <StatsOverview
        :total-reviews="totalReviews"
        :streak="streak"
        :card-counts="cardCounts"
        :true-retention="trueRetention"
        :total-time-ms="totalTimeMs"
      />

      <CalendarHeatmap :data="calendarData" :colors="colors" />

      <div class="chart-grid" data-testid="chart-grid">
        <CardCountsChart :data="cardCounts" :colors="colors" />
        <AnswerButtonsChart :data="answerButtons" :colors="colors" />
      </div>

      <FutureDueChart :data="futureDue" :colors="colors" />

      <div class="chart-grid" data-testid="chart-grid">
        <IntervalChart :data="intervalDist" :colors="colors" />
        <EaseChart :data="easeDist" :colors="colors" />
      </div>

      <div class="chart-grid" data-testid="chart-grid">
        <HourlyReviewChart :data="hourlyData" :colors="colors" />
        <AddedCardsChart :data="addedCardsData" :colors="colors" />
      </div>
    </template>
  </Page>
</template>

<style scoped>
.stats-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--spacing-3);
}

.title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0;
}

.stats-loading {
  text-align: center;
  padding: var(--spacing-12);
  color: var(--color-neutral-500);
  font-size: var(--font-size-sm);
}

.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: var(--spacing-4);
}
</style>
