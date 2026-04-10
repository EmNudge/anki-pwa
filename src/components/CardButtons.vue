<script setup lang="ts">
import { computed } from "vue";
import { Button } from "../design-system";
import type { Answer } from "../scheduler/types";
import { getReviewControls, triggerReviewControl, type ReviewIntervals } from "./reviewControls";

const props = defineProps<{
  activeSide: "front" | "back";
  intervals?: ReviewIntervals;
}>();

const emit = defineEmits<{
  reveal: [];
  chooseAnswer: [answer: Answer];
}>();

const visibleControls = computed(() => getReviewControls(props.activeSide));
</script>

<template>
  <Button
    v-if="activeSide === 'front'"
    class="reveal-button"
    :variant="visibleControls[0]?.variant ?? 'primary'"
    size="lg"
    full-width
    @click="
      () =>
        triggerReviewControl('reveal', {
          reveal: () => emit('reveal'),
          chooseAnswer: (answer) => emit('chooseAnswer', answer),
        })
    "
  >
    {{ visibleControls[0]?.label ?? "Reveal" }}
  </Button>
  <div v-else class="button-set">
    <Button
      v-for="control in visibleControls"
      :key="control.action"
      :variant="control.variant"
      @click="
        () =>
          triggerReviewControl(control.action, {
            reveal: () => emit('reveal'),
            chooseAnswer: (answer) => emit('chooseAnswer', answer),
          })
      "
    >
      <span class="time">
        {{ control.interval ? (intervals?.[control.interval] ?? control.fallbackInterval) : "" }}
      </span>
      <span class="answer">{{ control.label }}</span>
    </Button>
  </div>
</template>

<style scoped>
.reveal-button {
  width: 500px;
  max-width: 100%;
}
@media (max-width: 1200px) {
  .reveal-button {
    width: 800px;
  }
}
@media (max-width: 768px) {
  .reveal-button {
    width: 100%;
  }
}
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
.button-set .time {
  opacity: 0.5;
}
@media (max-width: 1200px) {
  .button-set {
    width: 800px;
  }
}
@media (max-width: 768px) {
  .button-set {
    width: 100%;
  }
}
</style>
