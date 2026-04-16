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
import type { AnswerButtonsData } from "../../stats/types";
import type { ChartColors } from "../../composables/useChartTheme";

ChartJS.register(ArcElement, Tooltip, Legend);

const props = defineProps<{ data: AnswerButtonsData; colors: ChartColors }>();

const chartData = computed<ChartData<"doughnut">>(() => ({
  labels: ["Again", "Hard", "Good", "Easy"],
  datasets: [
    {
      data: [props.data.again, props.data.hard, props.data.good, props.data.easy],
      backgroundColor: [
        props.colors.again,
        props.colors.hard,
        props.colors.good,
        props.colors.easy,
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
    <h3 class="chart-title">Answer Buttons</h3>
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
