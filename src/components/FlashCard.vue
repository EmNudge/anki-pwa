<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { playClickSoundBasic, playClickSoundMelodic } from "../utils/sound";

export type Answer = "again" | "hard" | "good" | "easy";

const props = defineProps<{
  activeSide: "front" | "back";
  intervals?: { again: string; hard: string; good: string; easy: string };
}>();

const emit = defineEmits<{
  reveal: [];
  chooseAnswer: [answer: Answer];
}>();

function handleKeyDown(e: KeyboardEvent) {
  if (props.activeSide === "front") {
    if (e.key === " ") {
      playClickSoundBasic();
      emit("reveal");
    }
    return;
  }
  if (e.key === "e") { playClickSoundMelodic(); emit("chooseAnswer", "easy"); }
  else if (e.key === "h") { playClickSoundMelodic(); emit("chooseAnswer", "hard"); }
  else if (e.key === "g") { playClickSoundMelodic(); emit("chooseAnswer", "good"); }
  else if (e.key === "a") { playClickSoundMelodic(); emit("chooseAnswer", "again"); }
}

onMounted(() => document.addEventListener("keydown", handleKeyDown));
onUnmounted(() => document.removeEventListener("keydown", handleKeyDown));
</script>

<template>
  <div :class="['card', `card--${activeSide}`]">
    <div :class="['card-indicator', `card-indicator--${activeSide}`]">
      {{ activeSide === "front" ? "Front" : "Back" }}
    </div>
    <div class="card-content">
      <slot v-if="activeSide === 'front'" name="front" />
      <slot v-else name="back" />
    </div>
  </div>
</template>

<style scoped>
.card {
  border: 2px solid var(--color-border);
  background: var(--color-surface);
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  border-radius: var(--radius-lg);
  padding: 0;
  width: 500px;
  max-width: 100%;
  min-height: 500px;
  position: relative;
  overflow: hidden;
}
.card--front { border-top-color: var(--color-border); }
.card--back { border-top-color: var(--color-border); }
@media (max-width: 1200px) { .card { width: 800px; } }
@media (max-width: 768px) { .card { width: 100%; min-height: 400px; } }
.card-indicator {
  display: inline-block;
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  border-radius: 0 0 var(--radius-md) 0;
  position: absolute;
  top: 0;
  left: 0;
  opacity: 0.3;
}
.card-indicator--front { background: var(--color-primary); color: white; }
.card-indicator--back { background: var(--color-success); color: white; }
.card-content { padding: var(--spacing-8) var(--spacing-4) var(--spacing-4); }
.card-content :deep(img) { height: 200px; margin: 0 auto; }
.card-content :deep(hr) { margin: var(--spacing-4) 0; opacity: 0.25; }
h1 { margin: 0; font-weight: var(--font-weight-normal); font-size: var(--font-size-2xl); }
</style>
