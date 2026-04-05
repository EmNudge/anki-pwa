<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { playClickSoundBasic, playClickSoundMelodic } from "../utils/sound";
import type { Answer } from "../scheduler/types";
import SandboxedCard from "./SandboxedCard.vue";
import { useTheme } from "../design-system/hooks/useTheme";

const { theme } = useTheme();
const cardBackground = ref<string | null>(null);

const props = defineProps<{
  activeSide: "front" | "back";
  frontHtml: string;
  backHtml: string;
  cardCss: string;
  intervals?: { again: string; hard: string; good: string; easy: string };
}>();

const emit = defineEmits<{
  reveal: [];
  chooseAnswer: [answer: Answer];
  audioButtonClick: [src: string];
}>();

function handleKeyDown(e: KeyboardEvent) {
  if (props.activeSide === "front") {
    if (e.key === " " || e.key === "Enter") {
      playClickSoundBasic();
      emit("reveal");
    }
    return;
  }
  if (e.key === "a" || e.key === "1") {
    playClickSoundMelodic();
    emit("chooseAnswer", "again");
  } else if (e.key === "h" || e.key === "2") {
    playClickSoundMelodic();
    emit("chooseAnswer", "hard");
  } else if (e.key === "g" || e.key === " " || e.key === "3") {
    playClickSoundMelodic();
    emit("chooseAnswer", "good");
  } else if (e.key === "e" || e.key === "4") {
    playClickSoundMelodic();
    emit("chooseAnswer", "easy");
  }
}

onMounted(() => document.addEventListener("keydown", handleKeyDown));
onUnmounted(() => document.removeEventListener("keydown", handleKeyDown));
</script>

<template>
  <div
    :class="['card', `card--${activeSide}`]"
    :style="cardBackground ? { background: cardBackground } : undefined"
  >
    <div :class="['card-indicator', `card-indicator--${activeSide}`]">
      {{ activeSide === "front" ? "Front" : "Back" }}
    </div>
    <div class="card-content">
      <SandboxedCard
        :card-html="activeSide === 'front' ? frontHtml : backHtml"
        :card-css="cardCss"
        :theme="theme"
        @audio-button-click="(src: string) => emit('audioButtonClick', src)"
        @background-detected="(color: string | null) => (cardBackground = color)"
      />
    </div>
  </div>
</template>

<style scoped>
.card {
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  box-shadow: var(--shadow-base);
  border-radius: var(--radius-xl);
  padding: 0;
  width: 500px;
  max-width: 100%;
  min-height: 500px;
  position: relative;
  overflow: hidden;
}
@media (max-width: 1200px) {
  .card {
    width: 800px;
  }
}
@media (max-width: 768px) {
  .card {
    width: 100%;
    min-height: 400px;
  }
}
.card-indicator {
  display: inline-block;
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--letter-spacing-wide);
  text-transform: uppercase;
  border-radius: 0 0 var(--radius-md) 0;
  position: absolute;
  top: 0;
  left: 0;
  opacity: 0.6;
}
.card-indicator--front {
  background: var(--color-primary-100);
  color: var(--color-primary-700);
}
.card-indicator--back {
  background: var(--color-success-100);
  color: var(--color-success-700);
}
:root[data-theme="dark"] .card-indicator--front {
  background: var(--color-primary-950);
  color: var(--color-primary-300);
}
:root[data-theme="dark"] .card-indicator--back {
  background: var(--color-success-950);
  color: var(--color-success-300);
}
.card-content {
  padding: var(--spacing-8) var(--spacing-4) var(--spacing-4);
}
h1 {
  margin: 0;
  font-weight: var(--font-weight-normal);
  font-size: var(--font-size-2xl);
}
</style>
