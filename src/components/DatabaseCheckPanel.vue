<script setup lang="ts">
import { ref, watch } from "vue";
import {
  ankiDataSig,
  activeViewSig,
  getActiveSqliteBytes,
} from "../stores";
import { createDatabase } from "../utils/sql";
import {
  checkDatabaseIntegrity,
  applyFix,
  type IntegrityIssue,
  type IssueSeverity,
} from "../utils/integrityCheck";
import { withDbMutation } from "../stores";
import Button from "../design-system/components/primitives/Button.vue";
import Modal from "../design-system/components/primitives/Modal.vue";

const issues = ref<IntegrityIssue[]>([]);
const hasChecked = ref(false);
const isChecking = ref(false);
const expandedIssues = ref(new Set<string>());

// Fix confirmation
const confirmFix = ref<IntegrityIssue | null>(null);
const isFixing = ref(false);
const fixResult = ref<{ type: string; count: number } | null>(null);

const severityOrder: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

function severityLabel(s: IssueSeverity): string {
  return s === "error" ? "Error" : s === "warning" ? "Warning" : "Info";
}

function severityColor(s: IssueSeverity): string {
  return s === "error"
    ? "var(--color-danger, #ef4444)"
    : s === "warning"
      ? "var(--color-warning, #f59e0b)"
      : "var(--color-primary)";
}

function toggleIssue(type: string) {
  const next = new Set(expandedIssues.value);
  if (next.has(type)) {
    next.delete(type);
  } else {
    next.add(type);
  }
  expandedIssues.value = next;
}

async function runCheck() {
  const bytes = getActiveSqliteBytes();
  if (!bytes) return;

  isChecking.value = true;
  hasChecked.value = false;
  fixResult.value = null;

  // Use rAF to let UI update
  requestAnimationFrame(async () => {
    try {
      const db = await createDatabase(bytes);
      try {
        const results = checkDatabaseIntegrity(db);
        results.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
        issues.value = results;
      } finally {
        db.close();
      }
    } catch (err) {
      console.error("Integrity check failed:", err);
      issues.value = [];
    }

    hasChecked.value = true;
    isChecking.value = false;

    // Auto-expand first few
    const initial = new Set<string>();
    for (let i = 0; i < Math.min(3, issues.value.length); i++) {
      initial.add(issues.value[i]!.type);
    }
    expandedIssues.value = initial;
  });
}

function handleFix(issue: IntegrityIssue) {
  confirmFix.value = issue;
}

async function confirmRepair() {
  const issue = confirmFix.value;
  if (!issue) return;

  isFixing.value = true;

  try {
    let fixedCount = 0;
    await withDbMutation((db) => {
      fixedCount = applyFix(db, issue.type);
    });

    fixResult.value = { type: issue.title, count: fixedCount };
    confirmFix.value = null;

    // Re-run the check to update results
    await runCheckDirect();
  } catch (err) {
    console.error("Repair failed:", err);
  } finally {
    isFixing.value = false;
  }
}

/** Run check without the rAF delay (used after a fix). */
async function runCheckDirect() {
  const bytes = getActiveSqliteBytes();
  if (!bytes) return;

  try {
    const db = await createDatabase(bytes);
    try {
      const results = checkDatabaseIntegrity(db);
      results.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
      issues.value = results;
    } finally {
      db.close();
    }
  } catch {
    // keep existing results
  }
  hasChecked.value = true;
}

function goBack() {
  activeViewSig.value = "browse";
}

const errorCount = () => issues.value.filter((i) => i.severity === "error").length;
const warningCount = () => issues.value.filter((i) => i.severity === "warning").length;

// Reset when data changes
watch(ankiDataSig, () => {
  issues.value = [];
  hasChecked.value = false;
  fixResult.value = null;
});
</script>

<template>
  <main class="db-check">
    <div class="db-check__container">
      <div class="db-check__header">
        <div class="db-check__title-row">
          <button class="db-check__back-btn" @click="goBack" title="Back to Browse">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <h1 class="db-check__title">Database Check</h1>
        </div>
        <p class="db-check__subtitle">
          Verify collection integrity and repair common issues.
        </p>
      </div>

      <!-- Action bar -->
      <div class="db-check__actions">
        <Button
          variant="primary"
          size="md"
          :loading="isChecking"
          :disabled="!ankiDataSig || !getActiveSqliteBytes()"
          @click="runCheck"
        >
          {{ hasChecked ? 'Re-run Check' : 'Check Database' }}
        </Button>

        <div v-if="fixResult" class="db-check__fix-toast">
          Fixed {{ fixResult.count }} item{{ fixResult.count !== 1 ? 's' : '' }}
          ({{ fixResult.type }})
        </div>
      </div>

      <!-- Results -->
      <div v-if="hasChecked" class="db-check__results">
        <!-- Summary -->
        <div v-if="issues.length === 0" class="db-check__pass">
          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
          <p>No issues found. Your collection looks healthy!</p>
        </div>

        <template v-else>
          <div class="db-check__summary">
            <span v-if="errorCount() > 0" class="db-check__summary-badge db-check__summary-badge--error">
              {{ errorCount() }} error{{ errorCount() !== 1 ? 's' : '' }}
            </span>
            <span v-if="warningCount() > 0" class="db-check__summary-badge db-check__summary-badge--warning">
              {{ warningCount() }} warning{{ warningCount() !== 1 ? 's' : '' }}
            </span>
            <span class="db-check__summary-total">
              {{ issues.length }} issue{{ issues.length !== 1 ? 's' : '' }} found
            </span>
          </div>

          <!-- Issue groups -->
          <div
            v-for="issue in issues"
            :key="issue.type"
            class="db-check__issue"
          >
            <button
              class="db-check__issue-header"
              @click="toggleIssue(issue.type)"
            >
              <svg
                :class="['db-check__chevron', { 'db-check__chevron--open': expandedIssues.has(issue.type) }]"
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m9 18 6-6-6-6"/>
              </svg>

              <span
                class="db-check__severity-dot"
                :style="{ background: severityColor(issue.severity) }"
                :title="severityLabel(issue.severity)"
              />

              <span class="db-check__issue-title">{{ issue.title }}</span>

              <span class="db-check__issue-count">
                {{ issue.count }} item{{ issue.count !== 1 ? 's' : '' }}
              </span>

              <span class="db-check__severity-tag" :data-severity="issue.severity">
                {{ severityLabel(issue.severity) }}
              </span>
            </button>

            <div
              v-if="expandedIssues.has(issue.type)"
              class="db-check__issue-body"
            >
              <p class="db-check__issue-desc">{{ issue.description }}</p>

              <ul class="db-check__details">
                <li v-for="(detail, idx) in issue.details" :key="idx">
                  {{ detail }}
                </li>
                <li v-if="issue.count > issue.details.length" class="db-check__details-more">
                  ...and {{ issue.count - issue.details.length }} more
                </li>
              </ul>

              <div v-if="issue.fixable" class="db-check__issue-fix">
                <Button
                  variant="primary"
                  size="sm"
                  @click.stop="handleFix(issue)"
                >
                  Fix {{ issue.title }}
                </Button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- No deck loaded -->
      <div v-else-if="!ankiDataSig || !getActiveSqliteBytes()" class="db-check__empty">
        <p>No synced collection loaded. Import or sync a collection first.</p>
      </div>
    </div>

    <!-- Fix confirmation modal -->
    <Modal
      :is-open="!!confirmFix"
      :title="`Fix: ${confirmFix?.title ?? ''}`"
      size="sm"
      @close="confirmFix = null"
    >
      <div v-if="confirmFix" class="db-check__confirm">
        <p>{{ confirmFix.description }}</p>
        <p>
          This will automatically fix <strong>{{ confirmFix.count }}</strong>
          item{{ confirmFix.count !== 1 ? 's' : '' }}. This cannot be undone.
        </p>
      </div>
      <template #footer>
        <Button variant="secondary" size="sm" @click="confirmFix = null">Cancel</Button>
        <Button variant="primary" size="sm" :loading="isFixing" @click="confirmRepair">
          Apply Fix
        </Button>
      </template>
    </Modal>
  </main>
</template>

<style scoped>
.db-check {
  min-height: calc(100vh - 44px);
  padding: var(--spacing-6) var(--spacing-4);
}

.db-check__container {
  max-width: 900px;
  margin: 0 auto;
}

.db-check__header {
  margin-bottom: var(--spacing-6);
}

.db-check__title-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.db-check__back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-1);
  color: var(--color-text-secondary);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.db-check__back-btn:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.db-check__back-btn:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
  box-shadow: var(--shadow-focus-ring);
}

.db-check__title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.db-check__subtitle {
  margin: var(--spacing-1) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

/* Actions */
.db-check__actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-4);
  margin-bottom: var(--spacing-6);
}

.db-check__fix-toast {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-success, #22c55e);
}

/* Results */
.db-check__results {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.db-check__pass {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-8);
  color: var(--color-success, #22c55e);
  text-align: center;
}

.db-check__pass p {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.db-check__summary {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  margin-bottom: var(--spacing-2);
}

.db-check__summary-badge {
  padding: var(--spacing-0-5) var(--spacing-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  border-radius: var(--radius-full);
}

.db-check__summary-badge--error {
  color: var(--color-danger, #ef4444);
  background: color-mix(in srgb, var(--color-danger, #ef4444) 12%, transparent);
}

.db-check__summary-badge--warning {
  color: var(--color-warning, #f59e0b);
  background: color-mix(in srgb, var(--color-warning, #f59e0b) 12%, transparent);
}

.db-check__summary-total {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
}

.db-check__empty {
  text-align: center;
  padding: var(--spacing-8);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

/* Issue cards */
.db-check__issue {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.db-check__issue-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  width: 100%;
  padding: var(--spacing-3) var(--spacing-4);
  background: var(--color-surface-elevated);
  border: none;
  cursor: pointer;
  text-align: left;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  transition: var(--transition-colors);
  box-shadow: none;
}

.db-check__issue-header:hover {
  background: var(--color-surface-hover);
}

.db-check__issue-header:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: -2px;
  box-shadow: var(--shadow-focus-ring);
}

.db-check__chevron {
  flex-shrink: 0;
  transition: transform 0.15s ease;
  color: var(--color-text-tertiary);
}

.db-check__chevron--open {
  transform: rotate(90deg);
}

.db-check__severity-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
}

.db-check__issue-title {
  flex: 1;
  min-width: 0;
  font-weight: var(--font-weight-medium);
}

.db-check__issue-count {
  flex-shrink: 0;
  padding: var(--spacing-0-5) var(--spacing-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border-radius: var(--radius-full);
}

.db-check__severity-tag {
  flex-shrink: 0;
  padding: var(--spacing-0-5) var(--spacing-2);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  border-radius: var(--radius-full);
}

.db-check__severity-tag[data-severity="error"] {
  color: var(--color-danger, #ef4444);
  background: color-mix(in srgb, var(--color-danger, #ef4444) 12%, transparent);
}

.db-check__severity-tag[data-severity="warning"] {
  color: var(--color-warning, #f59e0b);
  background: color-mix(in srgb, var(--color-warning, #f59e0b) 12%, transparent);
}

.db-check__severity-tag[data-severity="info"] {
  color: var(--color-primary);
  background: var(--color-primary-50);
}

/* Issue body */
.db-check__issue-body {
  border-top: 1px solid var(--color-border);
  padding: var(--spacing-4);
}

.db-check__issue-desc {
  margin: 0 0 var(--spacing-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: var(--line-height-relaxed);
}

.db-check__details {
  margin: 0 0 var(--spacing-3);
  padding: var(--spacing-3);
  list-style: none;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
  color: var(--color-text-secondary);
  max-height: 200px;
  overflow-y: auto;
}

.db-check__details li {
  padding: var(--spacing-0-5) 0;
}

.db-check__details li + li {
  border-top: 1px solid var(--color-border);
}

.db-check__details-more {
  color: var(--color-text-tertiary);
  font-style: italic;
}

.db-check__issue-fix {
  display: flex;
  justify-content: flex-end;
}

/* Confirm modal */
.db-check__confirm p {
  margin: 0 0 var(--spacing-2);
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  line-height: var(--line-height-relaxed);
}

.db-check__confirm p:last-child {
  margin-bottom: 0;
}

@media (max-width: 600px) {
  .db-check__issue-header {
    flex-wrap: wrap;
  }

  .db-check__severity-tag {
    order: -1;
    margin-left: auto;
  }
}
</style>
