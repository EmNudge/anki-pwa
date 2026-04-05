<script setup lang="ts">
import { ref, watch } from "vue";
import { reviewDB } from "../scheduler/db";
import { schedulerSettingsSig, initializeReviewQueue, cardsSig } from "../stores";
import type { SchedulerSettings } from "../scheduler/types";
import { Button, Modal } from "../design-system";

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const settings = ref<SchedulerSettings>({ ...schedulerSettingsSig.value });

// Sync settings when modal opens
watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) settings.value = { ...schedulerSettingsSig.value };
  },
);

async function handleSave() {
  const newSettings = JSON.parse(JSON.stringify(settings.value)) as SchedulerSettings;
  schedulerSettingsSig.value = newSettings;

  const cards = cardsSig.value;
  if (cards.length > 0) {
    const deckId = `deck-${cards.length}`;
    await reviewDB.saveSettings(deckId, newSettings);
    await initializeReviewQueue();
  }

  emit("close");
}

function updateSetting<K extends keyof SchedulerSettings>(key: K, value: SchedulerSettings[K]) {
  settings.value = { ...settings.value, [key]: value };
}

function updateFsrsParam<K extends keyof NonNullable<SchedulerSettings["fsrsParams"]>>(
  key: K,
  value: NonNullable<SchedulerSettings["fsrsParams"]>[K],
) {
  settings.value = {
    ...settings.value,
    fsrsParams: { ...settings.value.fsrsParams, [key]: value },
  };
}
</script>

<template>
  <Modal title="Scheduler Settings" :is-open="isOpen" size="sm" @close="emit('close')">
    <div class="form-section">
      <div class="section-title">Algorithm</div>
      <div class="form-group">
        <label class="form-label">Scheduling Algorithm</label>
        <select
          class="form-select"
          :value="settings.algorithm"
          @change="
            updateSetting('algorithm', ($event.target as HTMLSelectElement).value as 'sm2' | 'fsrs')
          "
        >
          <option value="sm2">SM-2 (Classic)</option>
          <option value="fsrs">FSRS (Modern)</option>
        </select>
        <div class="help-text">
          {{
            settings.algorithm === "sm2"
              ? "SM-2: Classic spaced repetition algorithm"
              : "FSRS: Modern algorithm with improved scheduling accuracy"
          }}
        </div>
      </div>
    </div>

    <div class="form-section">
      <div class="section-title">Daily Limits</div>
      <div class="form-group">
        <label class="form-label">New Cards per Day</label>
        <input
          type="number"
          class="form-input"
          :value="settings.dailyNewLimit"
          min="0"
          max="999"
          @change="
            updateSetting('dailyNewLimit', parseInt(($event.target as HTMLInputElement).value, 10))
          "
        />
      </div>
      <div class="form-group">
        <label class="form-label">Reviews per Day</label>
        <input
          type="number"
          class="form-input"
          :value="settings.dailyReviewLimit"
          min="0"
          max="9999"
          @change="
            updateSetting(
              'dailyReviewLimit',
              parseInt(($event.target as HTMLInputElement).value, 10),
            )
          "
        />
      </div>
    </div>

    <div v-if="settings.algorithm === 'fsrs'" class="form-section">
      <div class="section-title">FSRS Parameters</div>
      <div class="form-group">
        <label class="form-label">Target Retention (0-1)</label>
        <input
          type="number"
          class="form-input"
          :value="settings.fsrsParams?.requestRetention ?? 0.9"
          min="0"
          max="1"
          step="0.01"
          @change="
            updateFsrsParam(
              'requestRetention',
              parseFloat(($event.target as HTMLInputElement).value),
            )
          "
        />
        <div class="help-text">How much you want to remember (0.9 = 90% retention recommended)</div>
      </div>
      <div class="form-group">
        <label class="form-label">Maximum Interval (days)</label>
        <input
          type="number"
          class="form-input"
          :value="settings.fsrsParams?.maximumInterval ?? 36500"
          min="1"
          max="36500"
          @change="
            updateFsrsParam(
              'maximumInterval',
              parseInt(($event.target as HTMLInputElement).value, 10),
            )
          "
        />
        <div class="help-text">Maximum days between reviews (36500 = 100 years default)</div>
      </div>
    </div>

    <template #footer>
      <Button variant="secondary" @click="emit('close')">Cancel</Button>
      <Button variant="primary" @click="handleSave">Save Settings</Button>
    </template>
  </Modal>
</template>

<style scoped>
.form-section {
  margin-bottom: var(--spacing-6);
}
.section-title {
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
  margin-bottom: var(--spacing-3);
}
.form-group {
  margin-bottom: var(--spacing-4);
}
.form-label {
  display: block;
  margin-bottom: var(--spacing-2);
  font-weight: var(--font-weight-medium);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}
.form-input,
.form-select {
  width: 100%;
  padding: var(--spacing-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-elevated);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  transition: var(--transition-colors);
}
.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: var(--shadow-focus-ring);
}
.help-text {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  margin-top: var(--spacing-1);
}
</style>
