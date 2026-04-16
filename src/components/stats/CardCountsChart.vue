<script setup lang="ts">
import { computed } from "vue";
import { Doughnut } from "vue-chartjs";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import type { CardCountsData } from "../../stats/types";
import type { ChartColors } from "../../composables/useChartTheme";

ChartJS.register(ArcElement, Tooltip, Legend);

const props = defineProps<{ data: CardCountsData; colors: ChartColors }>();

const chartData = computed<ChartData<"doughnut">>(() => ({
  labels: ["New", "Learning", "Young", "Mature"],
  datasets: [
    {
      data: [props.data.new, props.data.learning, props.data.young, props.data.mature],
      backgroundColor: [
        props.colors.newCard,
        props.colors.learning,
        props.colors.young,
        props.colors.mature,
      ],
      borderWidth: 0,
    },
  ],
}));

const chartOptions = computed<ChartOptions<"doughnut">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: "bottom",
      labels: { color: props.colors.text, padding: 16 },
    },
  },
}));
</script>

<template>
  <div class="chart-card">
    <h3 class="chart-title">Card States</h3>
    <div class="chart-container">
      <Doughnut :data="chartData" :options="chartOptions" />
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
