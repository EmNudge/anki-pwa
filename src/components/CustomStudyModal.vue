<script setup lang="ts">
import { ref, computed } from "vue";
import { Button, Modal, TextInput } from "../design-system";
import { ankiDataSig, selectedDeckIdSig } from "../stores";

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (
    e: "create-filtered",
    payload: {
      name: string;
      query: string;
      reschedule: boolean;
    },
  ): void;
}>();

const currentDeckName = computed(() => {
  const data = ankiDataSig.value;
  const deckId = selectedDeckIdSig.value;
  if (!data || !deckId) return null;
  return data.decks[deckId]?.name ?? null;
});

const deckFilter = computed(() => {
  const name = currentDeckName.value;
  if (!name) return "";
  return name.includes(" ") ? `deck:"${name}"` : `deck:${name}`;
});

type Preset = {
  label: string;
  description: string;
  getQuery: () => string;
  reschedule: boolean;
};

const reviewAheadDays = ref(1);

const presets = computed<Preset[]>(() => {
  const df = deckFilter.value;
  const ahead = reviewAheadDays.value;
  return [
    {
      label: "Review forgotten cards",
      description: "Study cards you answered Again on recently",
      getQuery: () => (df ? `rated:7:1 ${df}` : "rated:7:1"),
      reschedule: true,
    },
    {
      label: "Review ahead",
      description: `Preview cards due in the next ${ahead} day${ahead === 1 ? "" : "s"}`,
      getQuery: () => {
        const base = `prop:due>0 prop:due<=${ahead}`;
        return df ? `${base} ${df}` : base;
      },
      reschedule: false,
    },
    {
      label: "Preview new cards",
      description: "Study new cards without affecting scheduling",
      getQuery: () => (df ? `is:new ${df}` : "is:new"),
      reschedule: false,
    },
    {
      label: "Study by state: due",
      description: "Review all cards that are currently due",
      getQuery: () => (df ? `is:due ${df}` : "is:due"),
      reschedule: true,
    },
    {
      label: "Cram all cards",
      description: "Study all cards in the deck without rescheduling",
      getQuery: () => df || "*",
      reschedule: false,
    },
  ];
});

function selectPreset(preset: Preset) {
  const dn = currentDeckName.value ?? "Filtered";
  emit("create-filtered", {
    name: `${preset.label} – ${dn}`,
    query: preset.getQuery(),
    reschedule: preset.reschedule,
  });
  emit("close");
}
</script>

<template>
  <Modal :is-open="isOpen" title="Custom Study" size="sm" @close="emit('close')">
    <div class="custom-study" data-testid="custom-study-modal">
      <p v-if="currentDeckName" class="deck-context">
        Deck: <strong>{{ currentDeckName }}</strong>
      </p>

      <div class="preset-list">
        <button
          v-for="(preset, i) in presets"
          :key="i"
          class="preset-btn"
          @click="selectPreset(preset)"
        >
          <span class="preset-label">{{ preset.label }}</span>
          <span class="preset-desc">{{ preset.description }}</span>
        </button>
      </div>

      <div v-if="presets.some((p) => p.label.includes('ahead'))" class="ahead-config">
        <label class="ahead-label">
          Review ahead days:
          <TextInput
            :model-value="String(reviewAheadDays)"
            @update:model-value="reviewAheadDays = Number($event)"
            size="sm"
            type="number"
            min="1"
            max="30"
            class="ahead-input"
          />
        </label>
      </div>

      <div class="custom-study-footer">
        <Button variant="secondary" @click="emit('close')">Cancel</Button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.custom-study {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.deck-context {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0;
}

.preset-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.preset-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--spacing-1);
  padding: var(--spacing-3) var(--spacing-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
  transition: var(--transition-colors);
  font-family: inherit;
  width: 100%;
}

.preset-btn:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-border-hover);
}

.preset-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
}

.preset-desc {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}

.ahead-config {
  padding: var(--spacing-2) 0;
}

.ahead-label {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.ahead-input {
  width: 60px;
}

.custom-study-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
