<script setup lang="ts">
import { computed } from "vue";
import { Bar } from "vue-chartjs";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import type { BucketData } from "../../stats/types";
import type { ChartColors } from "../../composables/useChartTheme";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

const props = defineProps<{ data: BucketData[]; colors: ChartColors }>();

const chartData = computed<ChartData<"bar">>(() => ({
  labels: props.data.map((b) => b.label),
  datasets: [
    {
      data: props.data.map((b) => b.count),
      backgroundColor: props.colors.success,
      borderRadius: 4,
    },
  ],
}));

const chartOptions = computed<ChartOptions<"bar">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { color: props.colors.textSecondary, font: { size: 11 } },
    },
    y: {
      grid: { color: props.colors.gridLine },
      ticks: { color: props.colors.textSecondary },
      beginAtZero: true,
    },
  },
}));
</script>

<template>
  <div class="chart-card">
    <h3 class="chart-title">Ease Factor Distribution</h3>
    <div class="chart-container">
      <Bar :data="chartData" :options="chartOptions" />
    </div>
  </div>
</template>

<style scoped>
.chart-card {
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-neutral-200);
  border-radius: var(--radius-lg);
  padding: var(--spacing-4);
}

.chart-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--color-neutral-900);
  margin: 0 0 var(--spacing-3) 0;
}

.chart-container {
  position: relative;
  height: 250px;
}
</style>
