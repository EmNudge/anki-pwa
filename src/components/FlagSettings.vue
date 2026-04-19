<script setup lang="ts">
import { ref, watch } from "vue";
import { getFlags, getDefaultFlagLabel, renameFlag, customFlagLabelsSig } from "../lib/flags";
import { Button, Modal, TextInput } from "../design-system";

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const labels = ref<Record<number, string>>({});

watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) {
      // Initialize with current labels
      const flags = getFlags();
      const entries: Record<number, string> = {};
      for (const f of flags) {
        entries[f.flag] = customFlagLabelsSig.value[f.flag] || "";
      }
      labels.value = entries;
    }
  },
);

function save() {
  for (const [key, value] of Object.entries(labels.value)) {
    renameFlag(Number(key), value);
  }
  emit("close");
}
</script>

<template>
  <Modal :is-open="isOpen" title="Flag Labels" size="sm" @close="emit('close')">
    <div class="flag-list">
      <div v-for="f in getFlags()" :key="f.flag" class="flag-row" data-testid="flag-row">
        <span class="flag-color" data-testid="flag-color" :style="{ backgroundColor: f.color }" />
        <TextInput v-model="labels[f.flag]" size="sm" :placeholder="getDefaultFlagLabel(f.flag)" />
      </div>
    </div>
    <p class="flag-hint">Leave blank to use the default color name.</p>

    <template #footer>
      <Button variant="ghost" @click="emit('close')">Cancel</Button>
      <Button variant="primary" @click="save">Save</Button>
    </template>
  </Modal>
</template>

<style scoped>
.flag-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.flag-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
}

.flag-color {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.flag-hint {
  margin-top: var(--spacing-3);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
</style>
