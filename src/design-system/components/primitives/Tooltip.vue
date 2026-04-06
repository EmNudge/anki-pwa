<script setup lang="ts">
import { ref, reactive } from "vue";

defineProps<{
  text: string;
}>();

const wrapperRef = ref<HTMLElement>();
const tipRef = ref<HTMLElement>();
const visible = ref(false);
const pos = reactive({ top: "auto", bottom: "auto", left: "auto", transform: "" });

function getScrollParent(el: HTMLElement): HTMLElement {
  let node = el.parentElement;
  while (node) {
    const { overflow, overflowX, overflowY } = getComputedStyle(node);
    if (/(auto|scroll|hidden)/.test(overflow + overflowY + overflowX)) return node;
    node = node.parentElement;
  }
  return document.documentElement;
}

function show() {
  visible.value = true;

  // Wait one frame so the tooltip is rendered and measurable
  requestAnimationFrame(() => {
    const wrapper = wrapperRef.value;
    const tip = tipRef.value;
    if (!wrapper || !tip) return;

    const bounds = getScrollParent(wrapper).getBoundingClientRect();
    const anchor = wrapper.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const gap = 6;

    // Vertical: prefer above, fall back to below
    const fitsAbove = anchor.top - tipRect.height - gap >= bounds.top;
    if (fitsAbove) {
      pos.bottom = "100%";
      pos.top = "auto";
    } else {
      pos.top = "100%";
      pos.bottom = "auto";
    }

    // Horizontal: start centered, then clamp within bounds
    const centeredLeft = anchor.left + anchor.width / 2 - tipRect.width / 2;
    const centeredRight = centeredLeft + tipRect.width;

    if (centeredLeft < bounds.left) {
      // Overflows left — anchor to left edge of wrapper
      pos.left = "0";
      pos.transform = "none";
    } else if (centeredRight > bounds.right) {
      // Overflows right — anchor to right edge of wrapper
      pos.left = "auto";
      pos.transform = "none";
    } else {
      // Fits centered
      pos.left = "50%";
      pos.transform = "translateX(-50%)";
    }
  });
}

function hide() {
  visible.value = false;
}
</script>

<template>
  <span ref="wrapperRef" class="ds-tooltip-wrapper" @mouseenter="show" @mouseleave="hide">
    <slot />
    <span
      ref="tipRef"
      class="ds-tooltip"
      :class="{ 'ds-tooltip--visible': visible }"
      :style="{
        top: pos.top,
        bottom: pos.bottom,
        left: pos.left,
        right: pos.left === 'auto' ? '0' : 'auto',
        transform: pos.transform,
        marginBottom: pos.bottom === '100%' ? '6px' : '0',
        marginTop: pos.top === '100%' ? '6px' : '0',
      }"
      role="tooltip"
    >
      {{ text }}
    </span>
  </span>
</template>

<style scoped>
.ds-tooltip-wrapper {
  position: relative;
  display: inline-flex;
}

.ds-tooltip {
  position: absolute;
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-tight);
  color: var(--color-text-inverse);
  background: var(--color-text-primary);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-sm);
  white-space: nowrap;
  pointer-events: none;
  z-index: var(--z-index-tooltip);
  opacity: 0;
  transition: opacity 0.1s ease;
}

.ds-tooltip--visible {
  opacity: 1;
}
</style>
