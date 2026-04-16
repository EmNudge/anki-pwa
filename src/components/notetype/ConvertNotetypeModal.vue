<script setup lang="ts">
import { ref, computed, watch } from "vue";
import Modal from "~/design-system/components/primitives/Modal.vue";
import Button from "~/design-system/components/primitives/Button.vue";

export interface NotetypeInfo {
  id: string;
  name: string;
  fields: string[];
}

const props = defineProps<{
  isOpen: boolean;
  sourceNotetype: NotetypeInfo;
  allNotetypes: NotetypeInfo[];
  noteCount: number;
}>();

const emit = defineEmits<{
  close: [];
  convert: [targetNtid: string, fieldMapping: Record<string, string>];
}>();

const targetNtid = ref("");
const fieldMapping = ref<Record<string, string>>({});

const targetNotetype = computed(() =>
  props.allNotetypes.find((nt) => nt.id === targetNtid.value),
);

const availableTargets = computed(() =>
  props.allNotetypes.filter((nt) => nt.id !== props.sourceNotetype.id),
);

// Reset mapping when target changes
watch(targetNtid, () => {
  const target = targetNotetype.value;
  if (!target) {
    fieldMapping.value = {};
    return;
  }
  // Auto-map fields with matching names
  const map: Record<string, string> = {};
  for (const tf of target.fields) {
    const match = props.sourceNotetype.fields.find(
      (sf) => sf.toLowerCase() === tf.toLowerCase(),
    );
    if (match) map[tf] = match;
  }
  fieldMapping.value = map;
});

// Reset when opening
watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      targetNtid.value = "";
      fieldMapping.value = {};
    }
  },
);

function handleConvert() {
  if (!targetNtid.value) return;
  emit("convert", targetNtid.value, { ...fieldMapping.value });
}
</script>

<template>
  <Modal :is-open="isOpen" title="Convert Note Type" size="md" @close="emit('close')">
    <div class="convert-form">
      <p class="convert-info">
        Convert {{ noteCount }} note(s) from <strong>{{ sourceNotetype.name }}</strong> to another
        note type. Map each target field to a source field.
      </p>

      <div class="form-group">
        <label class="form-label">Target Note Type</label>
        <select v-model="targetNtid" class="form-select">
          <option value="" disabled>Select a note type...</option>
          <option v-for="nt in availableTargets" :key="nt.id" :value="nt.id">
            {{ nt.name }}
          </option>
        </select>
      </div>

      <div v-if="targetNotetype" class="mapping-section">
        <label class="form-label">Field Mapping</label>
        <div class="mapping-list">
          <div v-for="targetField in targetNotetype.fields" :key="targetField" class="mapping-row">
            <span class="mapping-target">{{ targetField }}</span>
            <span class="mapping-arrow">&larr;</span>
            <select
              :value="fieldMapping[targetField] ?? ''"
              class="form-select form-select--sm"
              @change="fieldMapping[targetField] = ($event.target as HTMLSelectElement).value"
            >
              <option value="">(empty)</option>
              <option
                v-for="sf in sourceNotetype.fields"
                :key="sf"
                :value="sf"
              >
                {{ sf }}
              </option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <Button variant="ghost" @click="emit('close')">Cancel</Button>
      <Button :disabled="!targetNtid" @click="handleConvert">Convert</Button>
    </template>
  </Modal>
</template>

<style scoped>
.convert-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.convert-info {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: var(--line-height-relaxed);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.form-select {
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  background: var(--color-surface);
  color: var(--color-text-primary);
}

.form-select--sm {
  padding: var(--spacing-1) var(--spacing-2);
  flex: 1;
}

.mapping-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.mapping-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
  padding: var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-elevated);
}

.mapping-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
}

.mapping-target {
  font-weight: var(--font-weight-medium);
  font-size: var(--font-size-sm);
  min-width: 120px;
}

.mapping-arrow {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-lg);
}
</style>
