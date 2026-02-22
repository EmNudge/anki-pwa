<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import {
  commandPaletteOpenSig,
  commandPaletteInitialParentSig,
  openCommandPalette,
  type Command,
} from "../commandPaletteStore";
import { Search } from "lucide-vue-next";

const props = defineProps<{
  commands: Command[];
}>();

const searchQuery = ref("");
const selectedIndex = ref(0);
const breadcrumb = ref<string[]>([]);
const selectedCommand = ref<Command | null>(null);
const inputRef = ref<HTMLInputElement>();

// Commands at current breadcrumb level
const commandsAtCurrentLevel = computed(() => {
  let list = props.commands;
  for (const id of breadcrumb.value) {
    const next = list.find((c) => c.id === id);
    list = next?.children ?? [];
  }
  return list;
});

// Filter commands based on search
const filteredCommands = computed(() => {
  const commands = commandsAtCurrentLevel.value;
  const query = searchQuery.value.toLowerCase();
  if (!query) return commands;
  return commands.filter((cmd) => cmd.title.toLowerCase().includes(query));
});

// Reset selection when filtered commands change
watch(filteredCommands, (commands) => {
  selectedIndex.value = 0;
  selectedCommand.value = commands[0] ?? null;
});

// Update selected command when index changes
watch(selectedIndex, (index) => {
  selectedCommand.value = filteredCommands.value[index] ?? null;
});

// Focus input when opened
watch(commandPaletteOpenSig, (isOpen) => {
  if (isOpen) {
    nextTick(() => inputRef.value?.focus());
    searchQuery.value = "";

    const initialParent = commandPaletteInitialParentSig.value;
    if (initialParent) {
      breadcrumb.value = [initialParent];
    } else {
      breadcrumb.value = [];
    }
    selectedIndex.value = 0;
  }
});

function handleKeyDown(e: KeyboardEvent) {
  const commands = filteredCommands.value;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedIndex.value = Math.min(selectedIndex.value + 1, commands.length - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const selected = commands[selectedIndex.value];
    if (selected) executeCommand(selected);
  } else if (e.key === "Escape") {
    e.preventDefault();
    if (breadcrumb.value.length > 0) {
      goBack();
    } else {
      closeCommandPalette();
    }
  } else if (e.key === "Backspace" && searchQuery.value === "" && breadcrumb.value.length > 0) {
    e.preventDefault();
    goBack();
  }
}

function executeCommand(cmd: Command) {
  if (cmd.children && cmd.children.length > 0) {
    breadcrumb.value = [...breadcrumb.value, cmd.id];
    searchQuery.value = "";
  } else if (cmd.handler) {
    const result = cmd.handler();
    if (!result?.keepOpen) {
      closeCommandPalette();
    }
  }
}

function goBack() {
  breadcrumb.value = breadcrumb.value.slice(0, -1);
  searchQuery.value = "";
}

function closeCommandPalette() {
  commandPaletteOpenSig.value = false;
}

function matchesHotkey(e: KeyboardEvent, hotkey: string): boolean {
  const parts = hotkey.toLowerCase().split("+").map((s) => s.trim());
  const partSet = new Set(parts);
  const key =
    parts.find((p) => p !== "ctrl" && p !== "cmd" && p !== "meta" && p !== "shift" && p !== "alt") ?? "";
  const needsCtrl = partSet.has("ctrl");
  const needsMeta = partSet.has("cmd") || partSet.has("meta");
  const needsShift = partSet.has("shift");
  const needsAlt = partSet.has("alt");

  return (
    (needsCtrl ? e.ctrlKey : !e.ctrlKey || needsMeta) &&
    (needsMeta ? e.metaKey : !e.metaKey || needsCtrl) &&
    (needsShift ? e.shiftKey : !e.shiftKey) &&
    (needsAlt ? e.altKey : !e.altKey) &&
    e.key.toLowerCase() === key
  );
}

function highlightParts(title: string, query: string): { before: string; match: string; after: string } | null {
  if (!query) return null;
  const lowerTitle = title.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerTitle.indexOf(lowerQuery);
  if (index === -1) return null;
  return {
    before: title.slice(0, index),
    match: title.slice(index, index + query.length),
    after: title.slice(index + query.length),
  };
}

// Open palette with Cmd/Ctrl + K
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openCommandPalette();
    return;
  }

  // Global hotkeys for commands (only when palette is closed and not typing)
  if (
    commandPaletteOpenSig.value ||
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement
  ) {
    return;
  }

  const flatten = (list: Command[]): Command[] =>
    list.flatMap((c) => [c, ...(c.children ? flatten(c.children) : [])]);
  const commands = flatten(props.commands);
  for (const cmd of commands) {
    if (cmd.hotkey && matchesHotkey(e, cmd.hotkey)) {
      e.preventDefault();
      cmd.handler?.();
      break;
    }
  }
}

onMounted(() => window.addEventListener("keydown", onGlobalKeydown));
onUnmounted(() => window.removeEventListener("keydown", onGlobalKeydown));
</script>

<template>
  <div v-if="commandPaletteOpenSig" class="command-palette-overlay" @click="closeCommandPalette">
    <div class="command-palette-container" @click.stop>
      <div class="command-palette">
        <div class="command-palette-header">
          <div v-if="breadcrumb.length > 0" class="command-palette-breadcrumb">
            <button class="breadcrumb-back" @click="goBack">&larr; Back</button>
            <template v-for="(item, index) in breadcrumb" :key="item">
              <span v-if="index > 0" class="breadcrumb-separator">/</span>
              <span class="breadcrumb-item">{{ item }}</span>
            </template>
          </div>
          <div class="command-palette-search">
            <span class="command-palette-search-icon"><Search :size="16" /></span>
            <input
              ref="inputRef"
              class="command-palette-input"
              type="text"
              placeholder="Type a command or search..."
              :value="searchQuery"
              @input="searchQuery = ($event.target as HTMLInputElement).value"
              @keydown="handleKeyDown"
            />
          </div>
        </div>

        <div class="command-palette-results">
          <template v-if="filteredCommands.length > 0">
            <div
              v-for="(cmd, index) in filteredCommands"
              :key="cmd.id"
              :class="['command-palette-item', { selected: index === selectedIndex }]"
              @click="executeCommand(cmd)"
              @mouseenter="selectedIndex = index"
            >
              <div class="command-item-content">
                <span v-if="cmd.icon" class="command-item-icon">
                  <component :is="cmd.icon" :size="16" />
                </span>
                <span class="command-item-title">
                  <template v-if="highlightParts(cmd.title, searchQuery)">
                    {{ highlightParts(cmd.title, searchQuery)!.before

                    }}<span
                      class="command-item-title-highlight"
                      >{{ highlightParts(cmd.title, searchQuery)!.match }}</span
                    >{{ highlightParts(cmd.title, searchQuery)!.after }}
                  </template>
                  <template v-else>{{ cmd.title }}</template>
                </span>
                <span v-if="cmd.label" class="command-item-label">{{ cmd.label }}</span>
              </div>
              <span v-if="cmd.children && cmd.children.length > 0" class="command-item-arrow"
                >&rarr;</span
              >
              <div
                v-if="!cmd.children && cmd.hotkey && breadcrumb.length === 0"
                class="command-item-hotkey"
              >
                <kbd
                  v-for="key in cmd.hotkey.split('+').map(k => k.trim())"
                  :key="key"
                  class="command-item-kbd"
                  >{{ key }}</kbd
                >
              </div>
            </div>
          </template>
          <div v-else class="command-palette-empty">No commands found</div>
        </div>

        <div class="command-palette-footer">
          <div class="footer-hint"><kbd>&uarr;&darr;</kbd> Navigate</div>
          <div class="footer-hint"><kbd>Enter</kbd> Select</div>
          <div class="footer-hint"><kbd>Esc</kbd> Close</div>
        </div>
      </div>

      <div
        v-if="selectedCommand?.metadata && selectedCommand.metadata.length > 0"
        class="command-palette-side-view"
      >
        <div class="side-view-header">{{ selectedCommand.title }}</div>
        <div class="side-view-content">
          <div v-for="item in selectedCommand.metadata" :key="item.label" class="metadata-item">
            <div class="metadata-label">{{ item.label }}</div>
            <div class="metadata-value">
              <template v-if="typeof item.value === 'string'">{{ item.value }}</template>
              <component v-else :is="item.value" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.command-palette-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-overlay);
  backdrop-filter: blur(12px);
  z-index: calc(var(--z-index-modal) + 100);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 20vh;
  animation: fadeIn var(--duration-fast) var(--ease-out);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.command-palette-container {
  display: flex;
  gap: var(--spacing-4);
  animation: slideDown var(--duration-base) var(--ease-out);
}

.command-palette {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  width: 640px;
  max-width: 90vw;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.command-palette-side-view {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  width: 400px;
  max-width: 40vw;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.side-view-header {
  padding: var(--spacing-4);
  border-bottom: 1px solid var(--color-border);
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.side-view-content {
  padding: var(--spacing-4);
  overflow-y: auto;
  flex: 1;
}

.metadata-item { margin-bottom: var(--spacing-3); }
.metadata-label { font-size: var(--font-size-xs); color: var(--color-text-tertiary); font-weight: var(--font-weight-medium); margin-bottom: var(--spacing-1); }
.metadata-value { font-size: var(--font-size-sm); color: var(--color-text-primary); white-space: pre-wrap; word-break: break-word; }

:deep(.metadata-value-code) {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  background: var(--color-surface-elevated);
  padding: var(--spacing-2);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

:deep(.template-variable) {
  color: var(--color-primary-600);
  font-weight: var(--font-weight-semibold);
  background: var(--color-primary-50);
  padding: 0 var(--spacing-0-5);
  border-radius: var(--radius-xs);
}

:root[data-theme="dark"] :deep(.template-variable) {
  color: var(--color-primary-400);
  background: var(--color-primary-950);
}

:deep(.card-preview-container) { margin-top: var(--spacing-2); }
:deep(.card-preview) {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
:deep(.card-preview-badge) {
  padding: var(--spacing-1) var(--spacing-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  background: var(--color-surface-elevated);
  border-bottom: 1px solid var(--color-border);
}
:deep(.card-preview-content) {
  padding: var(--spacing-2);
  font-size: var(--font-size-sm);
  max-height: 200px;
  overflow-y: auto;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-20px); }
  to { opacity: 1; transform: translateY(0); }
}

.command-palette-header {
  padding: var(--spacing-4);
  border-bottom: 1px solid var(--color-border);
}

.command-palette-breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  margin-bottom: var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.breadcrumb-item { display: flex; align-items: center; gap: var(--spacing-1); }
.breadcrumb-separator { color: var(--color-text-tertiary); }
.breadcrumb-back {
  background: none;
  border: none;
  color: var(--color-primary-500);
  cursor: pointer;
  padding: var(--spacing-1) var(--spacing-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  transition: var(--transition-colors);
}
.breadcrumb-back:hover { background: var(--color-surface-elevated); }

.command-palette-search { position: relative; display: flex; align-items: center; }
.command-palette-search-icon { position: absolute; left: var(--spacing-3); color: var(--color-text-tertiary); pointer-events: none; }
.command-palette-input {
  width: 100%;
  padding: var(--spacing-3) var(--spacing-3) var(--spacing-3) var(--spacing-10);
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  font-family: var(--font-family-sans);
  outline: none;
}
.command-palette-input::placeholder { color: var(--color-text-tertiary); }

.command-palette-results { overflow-y: auto; max-height: 400px; }

.command-palette-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-3) var(--spacing-4);
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: var(--transition-colors);
}
.command-palette-item:hover { background: var(--color-neutral-100); }
:root[data-theme="dark"] .command-palette-item:hover { background: var(--color-neutral-200); }
.command-palette-item.selected { background: var(--color-neutral-200); border-left-color: var(--color-primary-500); }
:root[data-theme="dark"] .command-palette-item.selected { background: var(--color-neutral-300); border-left-color: var(--color-primary-400); }
.command-palette-item.selected .command-item-title { color: var(--color-text-primary); font-weight: var(--font-weight-semibold); }

.command-item-content { display: flex; align-items: center; gap: var(--spacing-3); flex: 1; }
.command-item-icon { color: var(--color-text-tertiary); font-size: var(--font-size-lg); }
.command-item-title { color: var(--color-text-primary); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); }
.command-item-label {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--spacing-2);
  height: 18px;
  border-radius: var(--radius-sm);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  font-size: var(--font-size-2xs);
  margin-left: var(--spacing-2);
  white-space: nowrap;
}
.command-item-title-highlight {
  background: var(--color-primary-100);
  color: var(--color-primary-700);
  font-weight: var(--font-weight-semibold);
  border-radius: var(--radius-xs);
  padding: 0 var(--spacing-0-5);
}
:root[data-theme="dark"] .command-item-title-highlight { background: var(--color-primary-900); color: var(--color-primary-300); }

.command-item-hotkey { display: flex; gap: var(--spacing-1); }
.command-item-kbd {
  padding: var(--spacing-1) var(--spacing-2);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
  color: var(--color-text-secondary);
  min-width: 24px;
  text-align: center;
}
.command-item-arrow { color: var(--color-text-tertiary); font-size: var(--font-size-sm); }

.command-palette-empty { padding: var(--spacing-8); text-align: center; color: var(--color-text-tertiary); font-size: var(--font-size-sm); }

.command-palette-footer {
  padding: var(--spacing-2) var(--spacing-4);
  border-top: 1px solid var(--color-border);
  display: flex;
  gap: var(--spacing-4);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
.footer-hint { display: flex; align-items: center; gap: var(--spacing-1); }
.footer-hint kbd {
  padding: var(--spacing-0-5) var(--spacing-1);
  background: var(--color-surface-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
}
</style>
