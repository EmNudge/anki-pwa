import { ref, onMounted, onUnmounted } from "vue";

function getCssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export interface ChartColors {
  primary: string;
  success: string;
  error: string;
  warning: string;
  text: string;
  textSecondary: string;
  gridLine: string;
  surface: string;
  // Answer button colors
  again: string;
  hard: string;
  good: string;
  easy: string;
  // Card state colors
  newCard: string;
  learning: string;
  young: string;
  mature: string;
}

function readColors(): ChartColors {
  return {
    primary: getCssVar("--color-primary-500") || "#8b5cf6",
    success: getCssVar("--color-success-500") || "#10b981",
    error: getCssVar("--color-error-500") || "#f43f5e",
    warning: getCssVar("--color-warning-500") || "#f59e0b",
    text: getCssVar("--color-neutral-900") || "#18181b",
    textSecondary: getCssVar("--color-neutral-500") || "#71717a",
    gridLine: getCssVar("--color-neutral-200") || "#e4e4e7",
    surface: getCssVar("--color-neutral-50") || "#fafafa",
    again: getCssVar("--color-error-500") || "#f43f5e",
    hard: getCssVar("--color-warning-500") || "#f59e0b",
    good: getCssVar("--color-success-500") || "#10b981",
    easy: getCssVar("--color-primary-400") || "#a78bfa",
    newCard: getCssVar("--color-primary-400") || "#a78bfa",
    learning: getCssVar("--color-warning-400") || "#fbbf24",
    young: getCssVar("--color-success-400") || "#34d399",
    mature: getCssVar("--color-success-700") || "#047857",
  };
}

export function useChartTheme() {
  const colors = ref<ChartColors>(readColors());
  let observer: MutationObserver | null = null;

  onMounted(() => {
    colors.value = readColors();
    observer = new MutationObserver(() => {
      colors.value = readColors();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  });

  onUnmounted(() => {
    observer?.disconnect();
  });

  return { colors };
}
