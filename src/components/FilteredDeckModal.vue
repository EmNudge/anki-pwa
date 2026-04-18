<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Button, Modal } from "../design-system";
import { ankiDataSig, countFilteredDeckCards, createFilteredDeck } from "../stores";
import type { FilteredDeckSortOrder } from "../scheduler/types";

const props = defineProps<{
  isOpen: boolean;
  /** Pre-fill the query (from custom study presets) */
  initialQuery?: string;
  /** Pre-fill the deck name */
  initialName?: string;
  /** Pre-fill reschedule mode */
  initialReschedule?: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const name = ref("Filtered Deck 1");
const query = ref("");
const limit = ref(100);
const sortOrder = ref<FilteredDeckSortOrder>("random");
const reschedule = ref(true);
const creating = ref(false);

watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      name.value = props.initialName ?? "Filtered Deck 1";
      query.value = props.initialQuery ?? "";
      limit.value = 100;
      sortOrder.value = "random";
      reschedule.value = props.initialReschedule ?? true;
      creating.value = false;
    }
  },
);

const previewCount = computed(() => {
  if (!query.value.trim()) return ankiDataSig.value?.cards.length ?? 0;
  return countFilteredDeckCards(query.value);
});

const effectiveCount = computed(() => Math.min(previewCount.value, limit.value));

const canCreate = computed(
  () => name.value.trim() && query.value.trim() && effectiveCount.value > 0 && !creating.value,
);

async function handleCreate() {
  if (!canCreate.value) return;
  creating.value = true;
  try {
    await createFilteredDeck({
      name: name.value.trim(),
      query: query.value.trim(),
      limit: limit.value,
      sortOrder: sortOrder.value,
      reschedule: reschedule.value,
    });
    emit("close");
  } finally {
    creating.value = false;
  }
}

const SORT_OPTIONS: { value: FilteredDeckSortOrder; label: string }[] = [
  { value: "random", label: "Random" },
  { value: "orderAdded", label: "Order added" },
  { value: "orderDue", label: "Order due" },
  { value: "intervalAsc", label: "Interval (ascending)" },
  { value: "intervalDesc", label: "Interval (descending)" },
  { value: "easeAsc", label: "Ease (ascending)" },
  { value: "easeDesc", label: "Ease (descending)" },
  { value: "lapsesDesc", label: "Lapses (most first)" },
];
</script>

<template>
  <Modal :is-open="isOpen" title="Create Filtered Deck" size="md" @close="emit('close')">
    <div class="filtered-form">
      <label class="field">
        <span class="field-label">Name</span>
        <input v-model="name" type="text" class="field-input" placeholder="Filtered Deck 1" />
      </label>

      <label class="field">
        <span class="field-label">Search query</span>
        <input
          v-model="query"
          type="text"
          class="field-input"
          placeholder="e.g. is:due deck:Biology"
          @keydown.enter.prevent="handleCreate"
        />
        <span class="field-hint">
          {{ previewCount }} matching card{{ previewCount === 1 ? "" : "s" }}
        </span>
      </label>

      <div class="field-row">
        <label class="field field--half">
          <span class="field-label">Limit</span>
          <input v-model.number="limit" type="number" min="1" max="9999" class="field-input" />
        </label>

        <label class="field field--half">
          <span class="field-label">Sort order</span>
          <select v-model="sortOrder" class="field-input">
            <option v-for="opt in SORT_OPTIONS" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>
      </div>

      <label class="field field--checkbox">
        <input v-model="reschedule" type="checkbox" />
        <span>Reschedule cards based on my answers</span>
      </label>
      <span class="field-hint" style="margin-top: -8px">
        {{
          reschedule ? "Cards will be rescheduled normally." : "Cram mode: scheduling won't change."
        }}
      </span>

      <div class="preview-bar">
        Will study <strong>{{ effectiveCount }}</strong> card{{ effectiveCount === 1 ? "" : "s" }}
      </div>

      <div class="form-actions">
        <Button variant="secondary" @click="emit('close')">Cancel</Button>
        <Button variant="primary" :disabled="!canCreate" @click="handleCreate">
          {{ creating ? "Creating..." : "Create" }}
        </Button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.filtered-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.field--half {
  flex: 1;
}

.field--checkbox {
  flex-direction: row;
  align-items: center;
  gap: var(--spacing-2);
  cursor: pointer;
}

.field--checkbox input {
  margin: 0;
}

.field-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.field-input {
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-family: inherit;
}

.field-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-alpha);
}

.field-hint {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.field-row {
  display: flex;
  gap: var(--spacing-3);
}

.preview-bar {
  padding: var(--spacing-3);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  text-align: center;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--spacing-2);
  padding-top: var(--spacing-2);
}
</style>
