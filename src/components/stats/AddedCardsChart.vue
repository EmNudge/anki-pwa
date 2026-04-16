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
import type { DayCount } from "../../stats/types";
import type { ChartColors } from "../../composables/useChartTheme";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

const props = defineProps<{ data: DayCount[]; colors: ChartColors }>();

const chartData = computed<ChartData<"bar">>(() => {
  const labels = props.data.map((d) => {
    const date = new Date(d.date);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  });

  return {
    labels,
    datasets: [
      {
        data: props.data.map((d) => d.count),
        backgroundColor: props.colors.success,
        borderRadius: 2,
      },
    ],
  };
});

const chartOptions = computed<ChartOptions<"bar">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title: (items) => {
          const idx = items[0]?.dataIndex;
          return idx != null ? props.data[idx].date : "";
        },
      },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: {
        color: props.colors.textSecondary,
        font: { size: 10 },
        maxTicksLimit: 10,
      },
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
    <h3 class="chart-title">Cards Added</h3>
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
