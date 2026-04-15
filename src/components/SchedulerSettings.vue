<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { reviewDB } from "../scheduler/db";
import {
  schedulerSettingsSig,
  initializeReviewQueue,
  settingsTargetDeckIdSig,
  settingsTargetDeckNodeSig,
  getActiveDeckId,
  isSyncedCollection,
  renameDeckInCollection,
  deleteDeckFromCollection,
  exportDeckFromCollection,
  exportCardsCsvJson,
  presetsSig,
  loadPresets,
  createPreset,
  clonePreset,
  renamePreset,
  deletePreset,
  applyPresetToDeck,
  exportPresetJson,
  importPresetJson,
} from "../stores";
import type { SchedulerSettings, DayOfWeek, AutoAdvanceSettings } from "../scheduler/types";
import type { ExportFormat, ExportScope } from "../ankiExporter/csvJsonExport";
import {
  DEFAULT_SM2_PARAMS,
  DEFAULT_AUTO_ADVANCE,
  DEFAULT_EASY_DAYS,
  DEFAULT_LOAD_BALANCER,
} from "../scheduler/types";
import { Button, Modal } from "../design-system";
import { Pencil } from "lucide-vue-next";

const DAY_NAMES: Record<DayOfWeek, string> = {
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
};

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const settings = ref<SchedulerSettings>({ ...schedulerSettingsSig.value });

// Deck management state
const isRenaming = ref(false);
const renameValue = ref("");
const showDeleteConfirm = ref(false);
const isExporting = ref(false);

// Preset management state
const activeTab = ref<"settings" | "presets">("settings");
const newPresetName = ref("");
const renamingPresetId = ref<string | null>(null);
const renamingPresetName = ref("");
const importJsonText = ref("");
const showImportField = ref(false);

// Export options
const exportFormat = ref<ExportFormat | "apkg">("apkg");
const exportScope = ref<ExportScope>("deck");
const exportIncludeScheduling = ref(true);
const exportIncludeHtml = ref(true);

const deckNode = computed(() => settingsTargetDeckNodeSig.value);
const isSynced = computed(() => isSyncedCollection());
const presets = computed(() => presetsSig.value);

const autoAdvance = computed<AutoAdvanceSettings>(() => ({
  ...DEFAULT_AUTO_ADVANCE,
  ...settings.value.autoAdvance,
}));

const easyDays = computed(() => ({
  ...DEFAULT_EASY_DAYS,
  ...settings.value.easyDays,
}));

const loadBalancer = computed(() => ({
  ...DEFAULT_LOAD_BALANCER,
  ...settings.value.loadBalancer,
}));

// Sync settings when modal opens
watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) {
      settings.value = { ...schedulerSettingsSig.value };
      isRenaming.value = false;
      showDeleteConfirm.value = false;
      activeTab.value = "settings";
      loadPresets();
    }
  },
);

function startRename() {
  if (!deckNode.value) return;
  renameValue.value = deckNode.value.name;
  isRenaming.value = true;
}

async function confirmRename() {
  const node = deckNode.value;
  if (!node || !renameValue.value.trim()) return;
  const newName = renameValue.value.trim();
  if (newName === node.name) {
    isRenaming.value = false;
    return;
  }
  await renameDeckInCollection(node.id, node.fullName, newName);
  isRenaming.value = false;
  emit("close");
}

async function confirmDelete() {
  const node = deckNode.value;
  if (!node) return;
  await deleteDeckFromCollection(node.id, node.fullName);
  showDeleteConfirm.value = false;
  emit("close");
}

async function handleExport() {
  const node = deckNode.value;
  if (!node) return;
  isExporting.value = true;
  try {
    if (exportFormat.value === "apkg") {
      await exportDeckFromCollection(node.fullName);
    } else {
      await exportCardsCsvJson({
        format: exportFormat.value as ExportFormat,
        scope: exportScope.value,
        deckName: exportScope.value === "deck" ? node.fullName : undefined,
        includeScheduling: exportIncludeScheduling.value,
        includeHtml: exportIncludeHtml.value,
      });
    }
  } finally {
    isExporting.value = false;
  }
}

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

function updateAutoAdvance<K extends keyof AutoAdvanceSettings>(
  key: K,
  value: AutoAdvanceSettings[K],
) {
  settings.value = {
    ...settings.value,
    autoAdvance: { ...autoAdvance.value, [key]: value },
  };
}

function updateEasyDay(day: DayOfWeek, multiplier: number) {
  settings.value = {
    ...settings.value,
    easyDays: { ...easyDays.value, [day]: multiplier },
  };
}

function updateLoadBalancer<K extends keyof NonNullable<SchedulerSettings["loadBalancer"]>>(
  key: K,
  value: NonNullable<SchedulerSettings["loadBalancer"]>[K],
) {
  settings.value = {
    ...settings.value,
    loadBalancer: { ...loadBalancer.value, [key]: value },
  };
}

// Preset actions
async function handleCreatePreset() {
  const name = newPresetName.value.trim();
  if (!name) return;
  await createPreset(name, settings.value);
  newPresetName.value = "";
}

async function handleClonePreset(id: string) {
  const source = presets.value.find((p) => p.id === id);
  if (!source) return;
  await clonePreset(id, `${source.name} (copy)`);
}

function startRenamingPreset(id: string, currentName: string) {
  renamingPresetId.value = id;
  renamingPresetName.value = currentName;
}

async function confirmRenamePreset() {
  if (!renamingPresetId.value || !renamingPresetName.value.trim()) return;
  await renamePreset(renamingPresetId.value, renamingPresetName.value.trim());
  renamingPresetId.value = null;
}

async function handleApplyPreset(id: string) {
  await applyPresetToDeck(id);
  settings.value = { ...schedulerSettingsSig.value };
  activeTab.value = "settings";
}

function handleExportPreset(id: string) {
  const preset = presets.value.find((p) => p.id === id);
  if (!preset) return;
  const json = exportPresetJson(preset);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${preset.name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleImportPreset() {
  const text = importJsonText.value.trim();
  if (!text) return;
  const id = await importPresetJson(text);
  if (id) {
    importJsonText.value = "";
    showImportField.value = false;
  }
}
</script>

<template>
  <Modal title="Deck Settings" :is-open="isOpen" size="sm" @close="emit('close')">
    <!-- Tab bar -->
    <div class="tab-bar">
      <button
        :class="['tab-btn', { active: activeTab === 'settings' }]"
        @click="activeTab = 'settings'"
      >
        Settings
      </button>
      <button
        :class="['tab-btn', { active: activeTab === 'presets' }]"
        @click="activeTab = 'presets'"
      >
        Presets
      </button>
    </div>

    <!-- Presets Tab -->
    <div v-if="activeTab === 'presets'">
      <div class="form-section">
        <div class="section-title">Option Presets</div>
        <div class="help-text" style="margin-bottom: var(--spacing-3)">
          Save named option groups and share them across decks.
        </div>

        <!-- Create new preset -->
        <div class="form-group">
          <div class="rename-row">
            <input
              v-model="newPresetName"
              type="text"
              class="form-input"
              placeholder="New preset name..."
              @keyup.enter="handleCreatePreset"
            />
            <Button variant="primary" size="sm" @click="handleCreatePreset">
              Save Current as Preset
            </Button>
          </div>
        </div>

        <!-- Preset list -->
        <div v-if="presets.length === 0" class="help-text">No presets yet.</div>
        <div v-for="preset of presets" :key="preset.id" class="preset-item">
          <div v-if="renamingPresetId === preset.id" class="rename-row">
            <input
              v-model="renamingPresetName"
              type="text"
              class="form-input"
              @keyup.enter="confirmRenamePreset"
              @keyup.escape="renamingPresetId = null"
            />
            <Button variant="primary" size="sm" @click="confirmRenamePreset">Save</Button>
            <Button variant="secondary" size="sm" @click="renamingPresetId = null">Cancel</Button>
          </div>
          <template v-else>
            <div class="preset-name">
              {{ preset.name }}
              <span v-if="settings.presetId === preset.id" class="preset-active-badge">active</span>
            </div>
            <div class="preset-actions">
              <Button variant="primary" size="sm" @click="handleApplyPreset(preset.id)">
                Apply
              </Button>
              <Button variant="secondary" size="sm" @click="handleClonePreset(preset.id)">
                Clone
              </Button>
              <button
                class="rename-icon-btn"
                title="Rename preset"
                @click="startRenamingPreset(preset.id, preset.name)"
              >
                <Pencil :size="14" />
              </button>
              <Button variant="secondary" size="sm" @click="handleExportPreset(preset.id)">
                Export
              </Button>
              <Button variant="danger" size="sm" @click="deletePreset(preset.id)">Delete</Button>
            </div>
          </template>
        </div>

        <!-- Import preset -->
        <div class="form-group" style="margin-top: var(--spacing-4)">
          <Button
            v-if="!showImportField"
            variant="secondary"
            size="sm"
            @click="showImportField = true"
          >
            Import Preset from JSON
          </Button>
          <template v-else>
            <textarea
              v-model="importJsonText"
              class="form-input"
              rows="4"
              placeholder="Paste preset JSON here..."
            />
            <div class="rename-row" style="margin-top: var(--spacing-2)">
              <Button variant="primary" size="sm" @click="handleImportPreset">Import</Button>
              <Button
                variant="secondary"
                size="sm"
                @click="
                  showImportField = false;
                  importJsonText = '';
                "
              >
                Cancel
              </Button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Settings Tab -->
    <div v-if="activeTab === 'settings'">
      <!-- Deck Management (synced decks only) -->
      <div v-if="deckNode && isSynced" class="form-section">
        <div class="section-title">Deck</div>

        <div v-if="!isRenaming" class="deck-name-display">
          <div class="deck-name-row">
            <span class="deck-full-name">{{ deckNode.fullName }}</span>
            <button class="rename-icon-btn" title="Rename deck" @click="startRename">
              <Pencil :size="14" />
            </button>
          </div>
          <span class="deck-card-count">{{ deckNode.cardCount }} cards</span>
        </div>

        <!-- Rename inline -->
        <div v-if="isRenaming" class="form-group">
          <label class="form-label">New Name</label>
          <div class="rename-row">
            <input
              v-model="renameValue"
              type="text"
              class="form-input"
              @keyup.enter="confirmRename"
              @keyup.escape="isRenaming = false"
            />
            <Button variant="primary" size="sm" @click="confirmRename">Save</Button>
            <Button variant="secondary" size="sm" @click="isRenaming = false">Cancel</Button>
          </div>
          <div class="help-text">Only renames this deck segment, not parent path</div>
        </div>

        <!-- Export options -->
        <div v-if="!isRenaming" class="export-section">
          <div class="form-group">
            <label class="form-label">Export Format</label>
            <select v-model="exportFormat" class="form-select">
              <option value="apkg">Anki Package (.apkg)</option>
              <option value="csv">CSV (.csv)</option>
              <option value="json">JSON (.json)</option>
            </select>
          </div>

          <template v-if="exportFormat !== 'apkg'">
            <div class="form-group">
              <label class="form-label">Scope</label>
              <select v-model="exportScope" class="form-select">
                <option value="deck">Current Deck</option>
                <option value="all">All Cards</option>
              </select>
            </div>

            <div class="form-group">
              <label class="toggle-row">
                <span class="form-label" style="margin-bottom: 0">Include Scheduling</span>
                <input type="checkbox" v-model="exportIncludeScheduling" />
              </label>
              <div class="help-text">Include review history and scheduling data</div>
            </div>

            <div class="form-group">
              <label class="toggle-row">
                <span class="form-label" style="margin-bottom: 0">Include HTML</span>
                <input type="checkbox" v-model="exportIncludeHtml" />
              </label>
              <div class="help-text">Keep HTML markup in field values</div>
            </div>
          </template>

          <div class="deck-actions">
            <Button variant="secondary" size="sm" :disabled="isExporting" @click="handleExport">
              {{ isExporting ? "Exporting..." : "Export" }}
            </Button>
          </div>
        </div>
      </div>

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
          <div class="help-text">
            When disabled, cards are shown sequentially without spaced repetition
          </div>
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
              updateSetting(
                'algorithm',
                ($event.target as HTMLSelectElement).value as 'sm2' | 'fsrs',
              )
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
              updateSetting(
                'dailyNewLimit',
                parseInt(($event.target as HTMLInputElement).value, 10),
              )
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

      <div v-if="settings.enabled" class="form-section">
        <div class="section-title">Schedule</div>
        <div class="form-group">
          <label class="form-label">Learn Ahead Limit (minutes)</label>
          <input
            type="number"
            class="form-input"
            :value="settings.learnAheadMins ?? 20"
            min="0"
            max="120"
            @change="
              updateSetting(
                'learnAheadMins',
                parseInt(($event.target as HTMLInputElement).value, 10),
              )
            "
          />
          <div class="help-text">
            When the queue is empty, study cards due within this many minutes (0 = off)
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Day Rollover Hour</label>
          <input
            type="number"
            class="form-input"
            :value="settings.rolloverHour ?? 4"
            min="0"
            max="23"
            @change="
              updateSetting('rolloverHour', parseInt(($event.target as HTMLInputElement).value, 10))
            "
          />
          <div class="help-text">
            Hour (0-23) when "today" starts. Set to 4 so late-night reviews count as the same day.
          </div>
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
            @change="
              updateSm2Param('learningSteps', parseSteps(($event.target as HTMLInputElement).value))
            "
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
            @change="
              updateSm2Param(
                'graduatingInterval',
                parseInt(($event.target as HTMLInputElement).value, 10),
              )
            "
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
            @change="
              updateSm2Param(
                'easyInterval',
                parseInt(($event.target as HTMLInputElement).value, 10),
              )
            "
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
            @change="
              updateSm2Param(
                'relearningSteps',
                parseSteps(($event.target as HTMLInputElement).value),
              )
            "
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
            @change="
              updateSm2Param(
                'lapseNewInterval',
                parseFloat(($event.target as HTMLInputElement).value),
              )
            "
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
            @change="
              updateSm2Param(
                'minLapseInterval',
                parseInt(($event.target as HTMLInputElement).value, 10),
              )
            "
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
            @change="
              updateSm2Param('startingEase', parseFloat(($event.target as HTMLInputElement).value))
            "
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
            @change="
              updateSm2Param('easyBonus', parseFloat(($event.target as HTMLInputElement).value))
            "
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
            @change="
              updateSm2Param(
                'hardMultiplier',
                parseFloat(($event.target as HTMLInputElement).value),
              )
            "
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
            @change="
              updateSm2Param(
                'intervalModifier',
                parseFloat(($event.target as HTMLInputElement).value),
              )
            "
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
            @change="
              updateSm2Param(
                'maximumInterval',
                parseInt(($event.target as HTMLInputElement).value, 10),
              )
            "
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
          <div class="help-text">
            How much you want to remember (0.9 = 90% retention recommended)
          </div>
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

      <!-- Auto-Advance -->
      <div v-if="settings.enabled" class="form-section">
        <div class="section-title">Auto-Advance</div>
        <div class="help-text" style="margin-bottom: var(--spacing-3)">
          Automatically flip and advance cards for passive review (e.g. audio cards).
        </div>
        <div class="form-group">
          <label class="form-label">Auto-Flip Delay (seconds)</label>
          <input
            type="number"
            class="form-input"
            :value="autoAdvance.autoFlipDelaySecs"
            min="0"
            max="300"
            @change="
              updateAutoAdvance(
                'autoFlipDelaySecs',
                parseInt(($event.target as HTMLInputElement).value, 10),
              )
            "
          />
          <div class="help-text">Seconds before auto-flipping the card (0 = off)</div>
        </div>
        <div class="form-group">
          <label class="form-label">Auto-Advance Delay (seconds)</label>
          <input
            type="number"
            class="form-input"
            :value="autoAdvance.autoAdvanceDelaySecs"
            min="0"
            max="300"
            @change="
              updateAutoAdvance(
                'autoAdvanceDelaySecs',
                parseInt(($event.target as HTMLInputElement).value, 10),
              )
            "
          />
          <div class="help-text">Seconds after flip before moving to next card (0 = off)</div>
        </div>
        <div class="form-group">
          <label class="form-label">Auto-Advance Answer</label>
          <select
            class="form-select"
            :value="autoAdvance.autoAdvanceAnswer"
            @change="
              updateAutoAdvance(
                'autoAdvanceAnswer',
                ($event.target as HTMLSelectElement).value as 'again' | 'hard' | 'good' | 'easy',
              )
            "
          >
            <option value="again">Again</option>
            <option value="hard">Hard</option>
            <option value="good">Good</option>
            <option value="easy">Easy</option>
          </select>
          <div class="help-text">Answer to auto-submit when auto-advancing</div>
        </div>
      </div>

      <!-- Easy Days -->
      <div v-if="settings.enabled" class="form-section">
        <div class="section-title">Easy Days</div>
        <div class="help-text" style="margin-bottom: var(--spacing-3)">
          Reduce or eliminate reviews on specific days. Set to 0% to skip a day entirely.
        </div>
        <div
          v-for="day of [0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]"
          :key="day"
          class="form-group easy-day-row"
        >
          <label class="form-label" style="margin-bottom: 0; min-width: 90px">
            {{ DAY_NAMES[day] }}
          </label>
          <input
            type="range"
            class="easy-day-slider"
            :value="easyDays[day]"
            min="0"
            max="1"
            step="0.25"
            @input="updateEasyDay(day, parseFloat(($event.target as HTMLInputElement).value))"
          />
          <span class="easy-day-value">{{ Math.round(easyDays[day] * 100) }}%</span>
        </div>
      </div>

      <!-- Load Balancer -->
      <div v-if="settings.enabled" class="form-section">
        <div class="section-title">Load Balancer</div>
        <div class="form-group">
          <label class="toggle-row">
            <span class="form-label" style="margin-bottom: 0">Enable Load Balancer</span>
            <input
              type="checkbox"
              :checked="loadBalancer.enabled"
              @change="updateLoadBalancer('enabled', ($event.target as HTMLInputElement).checked)"
            />
          </label>
          <div class="help-text">
            Spread reviews across days to avoid large spikes on any single day
          </div>
        </div>
        <div v-if="loadBalancer.enabled" class="form-group">
          <label class="form-label">Fuzz Factor</label>
          <input
            type="number"
            class="form-input"
            :value="loadBalancer.fuzzFactor"
            min="0"
            max="0.25"
            step="0.01"
            @change="
              updateLoadBalancer(
                'fuzzFactor',
                parseFloat(($event.target as HTMLInputElement).value),
              )
            "
          />
          <div class="help-text">
            Fraction of interval to randomize (0.05 = +/-5%). Higher = more spread.
          </div>
        </div>
      </div>

      <!-- Danger zone at the bottom -->
      <div v-if="deckNode && isSynced" class="form-section danger-zone">
        <div class="section-title danger-title">Danger Zone</div>
        <div v-if="!showDeleteConfirm" class="danger-zone-content">
          <div class="danger-zone-description">
            Permanently delete this deck and all {{ deckNode.cardCount }} cards.
          </div>
          <Button variant="danger" size="sm" @click="showDeleteConfirm = true">Delete Deck</Button>
        </div>
        <div v-else class="delete-confirm">
          <p class="delete-warning">
            Delete "<strong>{{ deckNode.fullName }}</strong
            >" and all its {{ deckNode.cardCount }} cards? This cannot be undone.
          </p>
          <div class="delete-actions">
            <Button variant="danger" size="sm" @click="confirmDelete">Delete</Button>
            <Button variant="secondary" size="sm" @click="showDeleteConfirm = false">Cancel</Button>
          </div>
        </div>
      </div>
    </div>
    <!-- end settings tab -->

    <template #footer>
      <Button variant="secondary" @click="emit('close')">Cancel</Button>
      <Button v-if="activeTab === 'settings'" variant="primary" @click="handleSave"
        >Save Settings</Button
      >
    </template>
  </Modal>
</template>

<style scoped>
.tab-bar {
  display: flex;
  gap: var(--spacing-1);
  margin-bottom: var(--spacing-4);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--spacing-2);
}
.tab-btn {
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}
.tab-btn:hover {
  color: var(--color-text-primary);
}
.tab-btn.active {
  color: var(--color-text-primary);
  border-bottom-color: var(--color-border-focus);
}
.preset-item {
  padding: var(--spacing-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  margin-bottom: var(--spacing-2);
}
.preset-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-2);
}
.preset-active-badge {
  font-size: var(--font-size-xs);
  color: var(--color-success, #22c55e);
  font-weight: var(--font-weight-normal);
  margin-left: var(--spacing-2);
}
.preset-actions {
  display: flex;
  gap: var(--spacing-1);
  flex-wrap: wrap;
  align-items: center;
}
.easy-day-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  margin-bottom: var(--spacing-2);
}
.easy-day-slider {
  flex: 1;
  accent-color: var(--color-border-focus);
}
.easy-day-value {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  min-width: 40px;
  text-align: right;
}
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
.deck-name-display {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-0-5);
  margin-bottom: var(--spacing-3);
}
.deck-name-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}
.deck-full-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-primary);
  word-break: break-word;
}
.rename-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--color-text-tertiary);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}
.rename-icon-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}
.deck-card-count {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
.export-section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}
.deck-actions {
  display: flex;
  gap: var(--spacing-2);
}
.rename-row {
  display: flex;
  gap: var(--spacing-2);
  align-items: center;
}
.rename-row .form-input {
  flex: 1;
}
.delete-confirm {
  padding: var(--spacing-3);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-sm);
}
.delete-warning {
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  margin: 0 0 var(--spacing-3) 0;
}
.delete-actions {
  display: flex;
  gap: var(--spacing-2);
}
.danger-zone {
  border-top: 1px solid var(--color-border);
  padding-top: var(--spacing-4);
}
.danger-title {
  color: var(--color-error);
}
.danger-zone-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-3);
}
.danger-zone-description {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}
</style>
