<script setup lang="ts">
import { Button } from "../design-system";
import { playClickSoundBasic, playClickSoundMelodic } from "../utils/sound";
import type { Answer } from "../scheduler/types";

const props = defineProps<{
  activeSide: "front" | "back";
  intervals?: { again: string; hard: string; good: string; easy: string };
}>();

const emit = defineEmits<{
  reveal: [];
  chooseAnswer: [answer: Answer];
}>();
</script>

<template>
  <Button
    v-if="activeSide === 'front'"
    class="reveal-button"
    variant="primary"
    size="lg"
    full-width
    @click="() => { playClickSoundBasic(); emit('reveal'); }"
  >
    Reveal
  </Button>
  <div v-else class="button-set">
    <Button
      variant="secondary"
      @click="() => { playClickSoundMelodic(); emit('chooseAnswer', 'again'); }"
    >
      <span class="time">{{ intervals?.again ?? "&lt;1m" }}</span>
      <span class="answer">Again</span>
    </Button>
    <Button
      variant="secondary"
      @click="() => { playClickSoundMelodic(); emit('chooseAnswer', 'hard'); }"
    >
      <span class="time">{{ intervals?.hard ?? "&lt;6m" }}</span>
      <span class="answer">Hard</span>
    </Button>
    <Button
      variant="primary"
      @click="() => { playClickSoundMelodic(); emit('chooseAnswer', 'good'); }"
    >
      <span class="time">{{ intervals?.good ?? "&lt;10m" }}</span>
      <span class="answer">Good</span>
    </Button>
    <Button
      variant="secondary"
      @click="() => { playClickSoundMelodic(); emit('chooseAnswer', 'easy'); }"
    >
      <span class="time">{{ intervals?.easy ?? "&lt;5d" }}</span>
      <span class="answer">Easy</span>
    </Button>
  </div>
</template>

<style scoped>
.reveal-button { width: 500px; max-width: 100%; }
@media (max-width: 1200px) { .reveal-button { width: 800px; } }
@media (max-width: 768px) { .reveal-button { width: 100%; } }
.button-set {
  display: flex;
  justify-content: center;
  gap: var(--spacing-4);
  width: 500px;
  max-width: 100%;
}
.button-set > * {
  flex: 1 1 0;
  min-width: 0;
}
.button-set .time { opacity: 0.5; }
@media (max-width: 1200px) { .button-set { width: 800px; } }
@media (max-width: 768px) { .button-set { width: 100%; } }
</style>
