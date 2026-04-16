<script setup lang="ts">
import { computed, ref } from "vue";
import type { DayCount } from "../../stats/types";
import type { ChartColors } from "../../composables/useChartTheme";

const props = defineProps<{ data: DayCount[]; colors: ChartColors }>();

const tooltipInfo = ref<{ text: string; x: number; y: number } | null>(null);

const CELL_SIZE = 13;
const CELL_GAP = 3;
const TOTAL = CELL_SIZE + CELL_GAP;
const WEEKS = 53;
const LABEL_WIDTH = 28;

const countMap = computed(() => {
  const m = new Map<string, number>();
  for (const d of props.data) m.set(d.date, d.count);
  return m;
});

const maxCount = computed(() => {
  let max = 0;
  for (const d of props.data) if (d.count > max) max = d.count;
  return max || 1;
});

function getColor(count: number): string {
  if (count === 0) return props.colors.gridLine;
  const ratio = count / maxCount.value;
  if (ratio < 0.25) return props.colors.young;
  if (ratio < 0.5) return props.colors.good;
  if (ratio < 0.75) return props.colors.success;
  return props.colors.mature;
}

interface CellInfo {
  x: number;
  y: number;
  date: string;
  count: number;
  color: string;
}

const cells = computed<CellInfo[]>(() => {
  const result: CellInfo[] = [];
  const today = new Date();
  const todayDay = today.getDay();

  // Start from (WEEKS-1)*7 days ago, aligned to Sunday
  const startOffset = (WEEKS - 1) * 7 + todayDay;
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - startOffset);

  for (let week = 0; week < WEEKS; week++) {
    for (let day = 0; day < 7; day++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + week * 7 + day);
      if (d > today) continue;

      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const count = countMap.value.get(dateStr) ?? 0;

      result.push({
        x: LABEL_WIDTH + week * TOTAL,
        y: day * TOTAL,
        date: dateStr,
        count,
        color: getColor(count),
      });
    }
  }

  return result;
});

const dayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];

function handleMouseEnter(cell: CellInfo, event: MouseEvent) {
  const rect = (event.target as SVGElement).getBoundingClientRect();
  tooltipInfo.value = {
    text: `${cell.date}: ${cell.count} review${cell.count !== 1 ? "s" : ""}`,
    x: rect.left + rect.width / 2,
    y: rect.top,
  };
}

function handleMouseLeave() {
  tooltipInfo.value = null;
}
</script>

<template>
  <div class="chart-card">
    <h3 class="chart-title">Review Activity</h3>
    <div class="heatmap-wrapper">
      <svg
        :width="LABEL_WIDTH + WEEKS * TOTAL"
        :height="7 * TOTAL"
        class="heatmap-svg"
      >
        <!-- Day labels -->
        <text
          v-for="(label, i) in dayLabels"
          :key="'label-' + i"
          :x="LABEL_WIDTH - 6"
          :y="i * TOTAL + CELL_SIZE"
          class="day-label"
          text-anchor="end"
        >
          {{ label }}
        </text>
        <!-- Cells -->
        <rect
          v-for="(cell, i) in cells"
          :key="i"
          :x="cell.x"
          :y="cell.y"
          :width="CELL_SIZE"
          :height="CELL_SIZE"
          :fill="cell.color"
          rx="2"
          ry="2"
          @mouseenter="handleMouseEnter(cell, $event)"
          @mouseleave="handleMouseLeave"
        />
      </svg>
    </div>
    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="tooltipInfo"
        class="heatmap-tooltip"
        :style="{ left: tooltipInfo.x + 'px', top: tooltipInfo.y - 8 + 'px' }"
      >
        {{ tooltipInfo.text }}
      </div>
    </Teleport>
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

.heatmap-wrapper {
  overflow-x: auto;
}

.heatmap-svg {
  display: block;
}

.day-label {
  font-size: 10px;
  fill: var(--color-neutral-500);
}

.heatmap-svg rect {
  cursor: pointer;
  transition: opacity 0.1s;
}

.heatmap-svg rect:hover {
  opacity: 0.8;
  stroke: var(--color-neutral-900);
  stroke-width: 1;
}
</style>

<style>
.heatmap-tooltip {
  position: fixed;
  transform: translate(-50%, -100%);
  background: var(--color-neutral-900);
  color: var(--color-neutral-50);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 9999;
}
</style>
