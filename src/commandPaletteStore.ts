import { ref } from "vue";
import type { Component, VNode } from "vue";

export interface Command {
  id: string;
  title: string;
  description?: string;
  icon?: Component;
  hotkey?: string;
  label?: string;
  children?: Command[];
  handler?: () => void | { keepOpen: boolean };
  metadata?: {
    label: string;
    value: string | VNode;
  }[];
}

export const commandPaletteOpenSig = ref(false);
export const commandPaletteInitialParentSig = ref<string | null>(null);

export function openCommandPalette(initialParent?: string) {
  commandPaletteInitialParentSig.value = initialParent ?? null;
  commandPaletteOpenSig.value = true;
}
