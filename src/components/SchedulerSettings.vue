<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { reviewDB } from "../scheduler/db";
import {
  schedulerSettingsSig,
  initializeReviewQueue,
  settingsTargetDeckIdSig,
  getActiveDeckId,
} from "../stores";
import type { SchedulerSettings } from "../scheduler/types";
import { DEFAULT_SM2_PARAMS } from "../scheduler/types";
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

const sm2 = computed(() => ({
  ...DEFAULT_SM2_PARAMS,
  ...settings.value.sm2Params,
}));

function formatSteps(steps: number[]): string {
  return steps.map((s) => (s < 60 ? `${s}m` : `${s / 60}h`)).join(" ");
}

function parseSteps(input: string): number[] {
  return input
    .trim()
    .split(/\s+/)
    .map((s) => {
      const num = parseFloat(s);
      if (s.endsWith("h")) return num * 60;
      if (s.endsWith("d")) return num * 1440;
      return num; // default minutes
    })
    .filter((n) => !isNaN(n) && n > 0);
}

async function handleSave() {
  const newSettings = JSON.parse(JSON.stringify(settings.value)) as SchedulerSettings;
  const deckId = settingsTargetDeckIdSig.value ?? getActiveDeckId();

  await reviewDB.saveSettings(deckId, newSettings);
  schedulerSettingsSig.value = newSettings;
  settingsTargetDeckIdSig.value = null;

  // Re-initialize if this is the active deck
  if (deckId === getActiveDeckId()) {
    await initializeReviewQueue();
  }

  emit("close");
}

function updateSetting<K extends keyof SchedulerSettings>(key: K, value: SchedulerSettings[K]) {
  settings.value = { ...settings.value, [key]: value };
}

function updateSm2Param<K extends keyof NonNullable<SchedulerSettings["sm2Params"]>>(
  key: K,
  value: NonNullable<SchedulerSettings["sm2Params"]>[K],
) {
  settings.value = {
    ...settings.value,
    sm2Params: { ...settings.value.sm2Params, [key]: value },
  };
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
  <Modal title="Deck Settings" :is-open="isOpen" size="sm" @close="emit('close')">
    <div class="form-section">
      <div class="section-title">Scheduler</div>
      <div class="form-group">
        <label class="toggle-row">
          <span class="form-label" style="margin-bottom: 0">Enable Scheduler</span>
          <input
            type="checkbox"
            :checked="settings.enabled"
            @change="updateSetting('enabled', ($event.target as HTMLInputElement).checked)"
          />
        </label>
        <div class="help-text">When disabled, cards are shown sequentially without spaced repetition</div>
      </div>
    </div>

    <div v-if="settings.enabled" class="form-section">
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
          <option value="sm2">SM-2 (Anki)</option>
          <option value="fsrs">FSRS (Modern)</option>
        </select>
        <div class="help-text">
          {{
            settings.algorithm === "sm2"
              ? "SM-2: Anki's modified spaced repetition algorithm with learning steps"
              : "FSRS: Modern algorithm with improved scheduling accuracy"
          }}
        </div>
      </div>
    </div>

    <div v-if="settings.enabled" class="form-section">
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

    <!-- SM-2 Parameters -->
    <div v-if="settings.enabled && settings.algorithm === 'sm2'" class="form-section">
      <div class="section-title">Learning</div>
      <div class="form-group">
        <label class="form-label">Learning Steps</label>
        <input
          type="text"
          class="form-input"
          :value="formatSteps(sm2.learningSteps)"
          @change="updateSm2Param('learningSteps', parseSteps(($event.target as HTMLInputElement).value))"
        />
        <div class="help-text">Steps for new cards (e.g., "1m 10m" or "1m 10m 1h")</div>
      </div>
      <div class="form-group">
        <label class="form-label">Graduating Interval (days)</label>
        <input
          type="number"
          class="form-input"
          :value="sm2.graduatingInterval"
          min="1"
          max="365"
          @change="updateSm2Param('graduatingInterval', parseInt(($event.target as HTMLInputElement).value, 10))"
        />
        <div class="help-text">Interval when a learning card graduates via Good</div>
      </div>
      <div class="form-group">
        <label class="form-label">Easy Interval (days)</label>
        <input
          type="number"
          class="form-input"
          :value="sm2.easyInterval"
          min="1"
          max="365"
          @change="updateSm2Param('easyInterval', parseInt(($event.target as HTMLInputElement).value, 10))"
        />
        <div class="help-text">Interval when a learning card graduates via Easy</div>
      </div>
    </div>

    <div v-if="settings.enabled && settings.algorithm === 'sm2'" class="form-section">
      <div class="section-title">Lapses</div>
      <div class="form-group">
        <label class="form-label">Relearning Steps</label>
        <input
          type="text"
          class="form-input"
          :value="formatSteps(sm2.relearningSteps)"
          @change="updateSm2Param('relearningSteps', parseSteps(($event.target as HTMLInputElement).value))"
        />
        <div class="help-text">Steps when a review card is failed (e.g., "10m")</div>
      </div>
      <div class="form-group">
        <label class="form-label">New Interval</label>
        <input
          type="number"
          class="form-input"
          :value="sm2.lapseNewInterval"
          min="0"
          max="1"
          step="0.05"
          @change="updateSm2Param('lapseNewInterval', parseFloat(($event.target as HTMLInputElement).value))"
        />
        <div class="help-text">Interval multiplier after a lapse (0 = reset, 0.5 = halve)</div>
      </div>
      <div class="form-group">
        <label class="form-label">Minimum Interval (days)</label>
        <input
          type="number"
          class="form-input"
          :value="sm2.minLapseInterval"
          min="1"
          max="365"
          @change="updateSm2Param('minLapseInterval', parseInt(($event.target as HTMLInputElement).value, 10))"
        />
        <div class="help-text">Minimum interval after a lapse</div>
      </div>
    </div>

    <div v-if="settings.enabled && settings.algorithm === 'sm2'" class="form-section">
      <div class="section-title">Advanced</div>
      <div class="form-group">
        <label class="form-label">Starting Ease</label>
        <input
          type="number"
          class="form-input"
          :value="sm2.startingEase"
          min="1.3"
          max="5"
          step="0.1"
          @change="updateSm2Param('startingEase', parseFloat(($event.target as HTMLInputElement).value))"
        />
        <div class="help-text">Initial ease factor for new cards (2.5 = 250%)</div>
      </div>
      <div class="form-group">
        <label class="form-label">Easy Bonus</label>
        <input
          type="number"
          class="form-input"
          :value="sm2.easyBonus"
          min="1"
          max="3"
          step="0.05"
          @change="updateSm2Param('easyBonus', parseFloat(($event.target as HTMLInputElement).value))"
        />
        <div class="help-text">Extra multiplier for Easy on review cards (1.3 = 130%)</div>
      </div>
      <div class="form-group">
        <label class="form-label">Hard Interval</label>
        <input
          type="number"
          class="form-input"
          :value="sm2.hardMultiplier"
          min="1"
          max="2"
          step="0.05"
          @change="updateSm2Param('hardMultiplier', parseFloat(($event.target as HTMLInputElement).value))"
        />
        <div class="help-text">Multiplier for Hard on review cards (1.2 = 120%)</div>
      </div>
      <div class="form-group">
        <label class="form-label">Interval Modifier</label>
        <input
          type="number"
          class="form-input"
          :value="sm2.intervalModifier"
          min="0.5"
          max="2"
          step="0.05"
          @change="updateSm2Param('intervalModifier', parseFloat(($event.target as HTMLInputElement).value))"
        />
        <div class="help-text">Global multiplier for all intervals (1.0 = no change)</div>
      </div>
      <div class="form-group">
        <label class="form-label">Maximum Interval (days)</label>
        <input
          type="number"
          class="form-input"
          :value="sm2.maximumInterval"
          min="1"
          max="36500"
          @change="updateSm2Param('maximumInterval', parseInt(($event.target as HTMLInputElement).value, 10))"
        />
        <div class="help-text">Maximum days between reviews (36500 = 100 years)</div>
      </div>
    </div>

    <!-- FSRS Parameters -->
    <div v-if="settings.enabled && settings.algorithm === 'fsrs'" class="form-section">
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
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
}
</style>
