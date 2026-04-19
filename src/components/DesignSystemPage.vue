<script setup lang="ts">
import { ref } from "vue";
import {
  Alert,
  Button,
  Checkbox,
  Disclosure,
  ListItem,
  Modal,
  Select,
  TextInput,
  Textarea,
  Tooltip,
} from "../design-system";
import { Star, ChevronRight, Trash2, Plus, Download, Settings, RotateCcw } from "lucide-vue-next";

const demoModalOpen = ref(false);
const demoModalSize = ref<"sm" | "md" | "lg" | "xl">("md");

const pillTab = ref("tab1");
const underlineTab = ref("fields");

const demoText = ref("Hello world");
const demoNumber = ref(42);
const demoSelect = ref("option2");
const demoCheckA = ref(true);
const demoCheckB = ref(false);
const demoTextarea = ref("Some multiline\ncontent here");

function openModal(size: "sm" | "md" | "lg" | "xl") {
  demoModalSize.value = size;
  demoModalOpen.value = true;
}
</script>

<template>
  <div class="ds-page">
    <h1 class="ds-page-title">Design System</h1>

    <!-- BUTTONS -->
    <section class="ds-section">
      <h2 class="ds-section-title">Button</h2>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Variants</h3>
        <div class="ds-row">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="danger-outline">Danger Outline</Button>
          <Button variant="warning">Warning</Button>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Sizes</h3>
        <div class="ds-row ds-row--align-end">
          <Button size="xs">XSmall</Button>
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">States</h3>
        <div class="ds-row">
          <Button disabled>Disabled</Button>
          <Button loading>Loading</Button>
          <Button variant="secondary" disabled>Disabled Secondary</Button>
          <Button variant="danger" loading>Loading Danger</Button>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">With Icons</h3>
        <div class="ds-row">
          <Button>
            <template #iconLeft><Plus :size="16" /></template>
            Create
          </Button>
          <Button variant="secondary">
            <template #iconRight><ChevronRight :size="16" /></template>
            Next
          </Button>
          <Button variant="ghost">
            <template #iconLeft><Settings :size="16" /></template>
            Settings
          </Button>
          <Button variant="danger">
            <template #iconLeft><Trash2 :size="16" /></template>
            Delete
          </Button>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Full Width</h3>
        <div class="ds-stack" style="max-width: 400px">
          <Button full-width>Full Width Primary</Button>
          <Button variant="secondary" full-width>Full Width Secondary</Button>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Square (Icon-Only)</h3>
        <div class="ds-row">
          <Button variant="ghost" size="xs" square><Settings :size="14" /></Button>
          <Button variant="secondary" size="sm" square><Settings :size="14" /></Button>
          <Button variant="secondary" size="md" square><Settings :size="16" /></Button>
          <Button variant="ghost" size="sm" square><Trash2 :size="14" /></Button>
          <Button variant="danger-outline" size="sm" square><Trash2 :size="14" /></Button>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">All Variants × Sizes</h3>
        <table class="ds-table">
          <thead>
            <tr>
              <th></th>
              <th>XSmall</th>
              <th>Small</th>
              <th>Medium</th>
              <th>Large</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="variant in [
                'primary',
                'secondary',
                'ghost',
                'danger',
                'danger-outline',
                'warning',
              ] as const"
              :key="variant"
            >
              <td class="ds-table-label">{{ variant }}</td>
              <td><Button :variant="variant" size="xs">Button</Button></td>
              <td><Button :variant="variant" size="sm">Button</Button></td>
              <td><Button :variant="variant" size="md">Button</Button></td>
              <td><Button :variant="variant" size="lg">Button</Button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- MODAL -->
    <section class="ds-section">
      <h2 class="ds-section-title">Modal</h2>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Sizes</h3>
        <div class="ds-row">
          <Button variant="secondary" @click="openModal('sm')">Small (500px)</Button>
          <Button variant="secondary" @click="openModal('md')">Medium (800px)</Button>
          <Button variant="secondary" @click="openModal('lg')">Large (1000px)</Button>
          <Button variant="secondary" @click="openModal('xl')">XL (1200px)</Button>
        </div>
      </div>

      <Modal
        :is-open="demoModalOpen"
        :title="`Modal — ${demoModalSize}`"
        :size="demoModalSize"
        @close="demoModalOpen = false"
      >
        <p style="margin: 0; color: var(--color-text-secondary)">
          This is a <strong>{{ demoModalSize }}</strong> modal. It supports a title, close button,
          Escape key, and click-outside to dismiss.
        </p>
        <template #footer>
          <Button variant="ghost" @click="demoModalOpen = false">Cancel</Button>
          <Button @click="demoModalOpen = false">Confirm</Button>
        </template>
      </Modal>
    </section>

    <!-- TOOLTIP -->
    <section class="ds-section">
      <h2 class="ds-section-title">Tooltip</h2>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Hover to see tooltips</h3>
        <div class="ds-row">
          <Tooltip text="This is a tooltip">
            <Button variant="secondary">Hover me</Button>
          </Tooltip>
          <Tooltip text="Download your data">
            <Button variant="ghost">
              <template #iconLeft><Download :size="16" /></template>
              Download
            </Button>
          </Tooltip>
          <Tooltip text="Star this item">
            <Button variant="secondary" size="sm">
              <template #iconLeft><Star :size="14" /></template>
              Star
            </Button>
          </Tooltip>
        </div>
      </div>
    </section>

    <!-- TABS -->
    <section class="ds-section">
      <h2 class="ds-section-title">Tabs</h2>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Pill Tabs (Navigation / Period Selector)</h3>
        <div class="demo-pill-tabs">
          <button
            v-for="t in [
              { id: 'tab1', label: 'Overview' },
              { id: 'tab2', label: 'Details' },
              { id: 'tab3', label: 'Settings' },
              { id: 'tab4', label: 'History' },
            ]"
            :key="t.id"
            :class="['demo-pill-tab', { 'demo-pill-tab--active': pillTab === t.id }]"
            @click="pillTab = t.id"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="demo-tab-content">
          Active: <strong>{{ pillTab }}</strong>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Segmented Tabs (Stats Period Selector)</h3>
        <div class="demo-segment-tabs">
          <button
            v-for="t in ['1 Month', '3 Months', '1 Year', 'All Time']"
            :key="t"
            :class="['demo-segment-tab', { 'demo-segment-tab--active': t === '1 Year' }]"
          >
            {{ t }}
          </button>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Underline Tabs (Content Panels)</h3>
        <div class="demo-underline-tabs">
          <button
            v-for="t in [
              { id: 'fields', label: 'Fields' },
              { id: 'templates', label: 'Templates' },
              { id: 'css', label: 'CSS' },
            ]"
            :key="t.id"
            :class="['demo-underline-tab', { 'demo-underline-tab--active': underlineTab === t.id }]"
            @click="underlineTab = t.id"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="demo-tab-content">
          Active: <strong>{{ underlineTab }}</strong>
        </div>
      </div>
    </section>

    <!-- TABLE -->
    <section class="ds-section">
      <h2 class="ds-section-title">Table</h2>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Data Table</h3>
        <div class="demo-table-wrapper">
          <table class="demo-table">
            <thead>
              <tr>
                <th>Front</th>
                <th>Back</th>
                <th>Deck</th>
                <th>Due</th>
                <th>Interval</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>What is spaced repetition?</td>
                <td>A learning technique that increases intervals...</td>
                <td>Study Methods</td>
                <td>Today</td>
                <td>3d</td>
              </tr>
              <tr class="demo-tr--selected">
                <td>What is active recall?</td>
                <td>The practice of stimulating memory during...</td>
                <td>Study Methods</td>
                <td>Tomorrow</td>
                <td>7d</td>
              </tr>
              <tr>
                <td>What is interleaving?</td>
                <td>Mixing different topics during study sessions...</td>
                <td>Study Methods</td>
                <td>In 3 days</td>
                <td>14d</td>
              </tr>
              <tr class="demo-tr--multi-selected">
                <td>Mitochondria function?</td>
                <td>Powerhouse of the cell, produces ATP...</td>
                <td>Biology</td>
                <td>In 5 days</td>
                <td>21d</td>
              </tr>
              <tr class="demo-tr--multi-selected">
                <td>What is osmosis?</td>
                <td>Movement of water through a semipermeable...</td>
                <td>Biology</td>
                <td>In 8 days</td>
                <td>30d</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Compact Table with Badges</h3>
        <div class="demo-table-wrapper">
          <table class="demo-table demo-table--compact">
            <thead>
              <tr>
                <th>Date</th>
                <th>Rating</th>
                <th>Interval</th>
                <th>Ease</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Apr 18, 10:32</td>
                <td><span class="demo-badge demo-badge--easy">Easy</span></td>
                <td>21d</td>
                <td>2.80</td>
              </tr>
              <tr>
                <td>Apr 15, 09:14</td>
                <td><span class="demo-badge demo-badge--good">Good</span></td>
                <td>7d</td>
                <td>2.50</td>
              </tr>
              <tr>
                <td>Apr 14, 16:45</td>
                <td><span class="demo-badge demo-badge--hard">Hard</span></td>
                <td>3d</td>
                <td>2.30</td>
              </tr>
              <tr>
                <td>Apr 13, 11:20</td>
                <td><span class="demo-badge demo-badge--again">Again</span></td>
                <td>10m</td>
                <td>2.50</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- COLORS -->
    <section class="ds-section">
      <h2 class="ds-section-title">Colors</h2>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Primary (Violet)</h3>
        <div class="ds-swatch-row">
          <div
            v-for="n in [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]"
            :key="n"
            class="ds-swatch-cell"
          >
            <div class="ds-swatch" :style="{ background: `var(--color-primary-${n})` }" />
            <span class="ds-swatch-label">{{ n }}</span>
          </div>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Neutral (Zinc)</h3>
        <div class="ds-swatch-row">
          <div
            v-for="n in [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]"
            :key="n"
            class="ds-swatch-cell"
          >
            <div class="ds-swatch" :style="{ background: `var(--color-neutral-${n})` }" />
            <span class="ds-swatch-label">{{ n }}</span>
          </div>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Semantic</h3>
        <div class="ds-swatch-row">
          <div class="ds-swatch-cell">
            <div class="ds-swatch" style="background: var(--color-success)" />
            <span class="ds-swatch-label">Success</span>
          </div>
          <div class="ds-swatch-cell">
            <div class="ds-swatch" style="background: var(--color-error)" />
            <span class="ds-swatch-label">Error</span>
          </div>
          <div class="ds-swatch-cell">
            <div class="ds-swatch" style="background: var(--color-warning)" />
            <span class="ds-swatch-label">Warning</span>
          </div>
          <div class="ds-swatch-cell">
            <div class="ds-swatch" style="background: var(--color-primary)" />
            <span class="ds-swatch-label">Primary</span>
          </div>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Surface & Text</h3>
        <div class="ds-swatch-row">
          <div class="ds-swatch-cell">
            <div
              class="ds-swatch ds-swatch--bordered"
              style="background: var(--color-background)"
            />
            <span class="ds-swatch-label">Background</span>
          </div>
          <div class="ds-swatch-cell">
            <div class="ds-swatch ds-swatch--bordered" style="background: var(--color-surface)" />
            <span class="ds-swatch-label">Surface</span>
          </div>
          <div class="ds-swatch-cell">
            <div
              class="ds-swatch ds-swatch--bordered"
              style="background: var(--color-surface-elevated)"
            />
            <span class="ds-swatch-label">Elevated</span>
          </div>
          <div class="ds-swatch-cell">
            <div class="ds-swatch" style="background: var(--color-text-primary)" />
            <span class="ds-swatch-label">Text Primary</span>
          </div>
          <div class="ds-swatch-cell">
            <div class="ds-swatch" style="background: var(--color-text-secondary)" />
            <span class="ds-swatch-label">Text Secondary</span>
          </div>
          <div class="ds-swatch-cell">
            <div class="ds-swatch" style="background: var(--color-text-tertiary)" />
            <span class="ds-swatch-label">Text Tertiary</span>
          </div>
        </div>
      </div>
    </section>

    <!-- TYPOGRAPHY -->
    <section class="ds-section">
      <h2 class="ds-section-title">Typography</h2>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Font Sizes</h3>
        <div class="ds-stack">
          <div
            v-for="size in ['2xs', 'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl']"
            :key="size"
            class="ds-type-row"
          >
            <span class="ds-type-label">{{ size }}</span>
            <span :style="{ fontSize: `var(--font-size-${size})` }">The quick brown fox</span>
          </div>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Font Weights</h3>
        <div class="ds-stack">
          <span style="font-weight: var(--font-weight-normal)"
            >Normal (400) — The quick brown fox</span
          >
          <span style="font-weight: var(--font-weight-medium)"
            >Medium (500) — The quick brown fox</span
          >
          <span style="font-weight: var(--font-weight-semibold)"
            >Semibold (600) — The quick brown fox</span
          >
          <span style="font-weight: var(--font-weight-bold)">Bold (700) — The quick brown fox</span>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Font Families</h3>
        <div class="ds-stack">
          <span style="font-family: var(--font-family-sans)">Sans — Inter, system-ui</span>
          <span style="font-family: var(--font-family-mono); font-size: var(--font-size-sm)"
            >Mono — JetBrains Mono, Fira Code</span
          >
        </div>
      </div>
    </section>

    <!-- SPACING -->
    <section class="ds-section">
      <h2 class="ds-section-title">Spacing</h2>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Scale (base unit: 4px)</h3>
        <div class="ds-stack">
          <div v-for="n in [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24]" :key="n" class="ds-spacing-row">
            <span class="ds-spacing-label"
              >{{ n }} <span class="ds-spacing-px">({{ n * 4 }}px)</span></span
            >
            <div class="ds-spacing-bar" :style="{ width: `var(--spacing-${n})` }" />
          </div>
        </div>
      </div>
    </section>

    <!-- BORDER RADIUS -->
    <section class="ds-section">
      <h2 class="ds-section-title">Border Radius</h2>

      <div class="ds-subsection">
        <div class="ds-row">
          <div
            v-for="r in ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', 'full']"
            :key="r"
            class="ds-radius-cell"
          >
            <div class="ds-radius-box" :style="{ borderRadius: `var(--radius-${r})` }" />
            <span class="ds-swatch-label">{{ r }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- SHADOWS -->
    <section class="ds-section">
      <h2 class="ds-section-title">Shadows</h2>

      <div class="ds-subsection">
        <div class="ds-row">
          <div v-for="s in ['xs', 'sm', 'base', 'md', 'lg', 'xl']" :key="s" class="ds-shadow-cell">
            <div class="ds-shadow-box" :style="{ boxShadow: `var(--shadow-${s})` }" />
            <span class="ds-swatch-label">{{ s }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- ALERT -->
    <section class="ds-section">
      <h2 class="ds-section-title">Alert</h2>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Variants</h3>
        <div class="ds-stack">
          <Alert variant="info">Collection synced successfully.</Alert>
          <Alert variant="success">Backup created successfully.</Alert>
          <Alert variant="error">Import failed: invalid file format.</Alert>
          <Alert variant="warning">
            <strong>Push will overwrite the server collection</strong> with your local copy.
          </Alert>
        </div>
      </div>
    </section>

    <!-- DISCLOSURE -->
    <section class="ds-section">
      <h2 class="ds-section-title">Disclosure</h2>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Collapsible Sections</h3>
        <div class="ds-stack">
          <Disclosure summary="Auto-Backup Settings">
            <div class="ds-stack" style="font-size: var(--font-size-sm)">
              <label style="display: flex; align-items: center; gap: var(--spacing-2)">
                <input type="checkbox" checked /> Enable periodic auto-backup
              </label>
              <label style="display: flex; align-items: center; gap: var(--spacing-2)">
                <input type="checkbox" /> Backup before sync
              </label>
            </div>
          </Disclosure>
          <Disclosure summary="Setup guide">
            <p style="margin: 0; font-size: var(--font-size-sm)">
              Your sync server must allow CORS requests from this origin. See the documentation for
              more details on configuring your server.
            </p>
          </Disclosure>
          <Disclosure summary="Template syntax help">
            <div class="ds-stack" style="font-size: var(--font-size-sm)">
              <p style="margin: 0">
                <code>&#123;&#123; FieldName &#125;&#125;</code> — Insert field value
              </p>
              <p style="margin: 0">
                <code>&#123;&#123; FrontSide &#125;&#125;</code> — Insert front template content
              </p>
            </div>
          </Disclosure>
        </div>
      </div>
    </section>

    <!-- INPUTS -->
    <section class="ds-section">
      <h2 class="ds-section-title">Inputs</h2>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Text Input</h3>
        <div class="ds-stack" style="max-width: 400px">
          <TextInput v-model="demoText" placeholder="Enter text..." />
          <TextInput v-model="demoText" size="sm" placeholder="Small input" />
          <TextInput v-model="demoText" size="lg" placeholder="Large input" />
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Number Input</h3>
        <div class="ds-row" style="max-width: 400px">
          <TextInput
            v-model="demoNumber"
            type="number"
            :full-width="false"
            min="0"
            max="100"
            style="width: 120px"
          />
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">States</h3>
        <div class="ds-stack" style="max-width: 400px">
          <TextInput placeholder="Default" />
          <TextInput error placeholder="Error state" />
          <TextInput disabled placeholder="Disabled" />
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Select</h3>
        <div class="ds-stack" style="max-width: 400px">
          <Select v-model="demoSelect">
            <option value="option1">Option 1</option>
            <option value="option2">Option 2</option>
            <option value="option3">Option 3</option>
          </Select>
          <Select v-model="demoSelect" size="sm">
            <option value="option1">Small Select</option>
            <option value="option2">Option 2</option>
          </Select>
          <Select v-model="demoSelect" size="lg">
            <option value="option1">Large Select</option>
            <option value="option2">Option 2</option>
          </Select>
          <Select error>
            <option>Error state</option>
          </Select>
          <Select disabled>
            <option>Disabled</option>
          </Select>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Checkbox</h3>
        <div class="ds-stack">
          <Checkbox v-model="demoCheckA" label="Enable auto-backup" />
          <Checkbox v-model="demoCheckB" label="Include scheduling data" />
          <Checkbox :model-value="true" size="sm" label="Small checkbox" />
          <Checkbox :model-value="false" size="lg" label="Large checkbox" />
          <Checkbox :model-value="false" disabled label="Disabled" />
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Textarea</h3>
        <div class="ds-stack" style="max-width: 400px">
          <Textarea v-model="demoTextarea" placeholder="Enter longer text..." />
          <Textarea size="sm" placeholder="Small textarea" />
          <Textarea error placeholder="Error state" />
          <Textarea disabled placeholder="Disabled" />
        </div>
      </div>
    </section>

    <!-- LIST ITEM -->
    <section class="ds-section">
      <h2 class="ds-section-title">List Item</h2>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Default</h3>
        <div class="ds-stack">
          <ListItem>
            <span style="font-size: var(--font-size-sm); font-weight: var(--font-weight-medium)"
              >Manual Backup</span
            >
            <span style="font-size: var(--font-size-xs); color: var(--color-text-secondary)"
              >Apr 18, 2026 10:32 AM · 4.2 MB</span
            >
            <template #actions>
              <Button variant="secondary" size="sm" square title="Restore"
                ><RotateCcw :size="14"
              /></Button>
              <Button variant="secondary" size="sm" square title="Download"
                ><Download :size="14"
              /></Button>
              <Button variant="danger-outline" size="sm" square title="Delete"
                ><Trash2 :size="14"
              /></Button>
            </template>
          </ListItem>
          <ListItem>
            <span style="font-size: var(--font-size-sm); font-weight: var(--font-weight-medium)"
              >Auto Backup</span
            >
            <span style="font-size: var(--font-size-xs); color: var(--color-text-secondary)"
              >Apr 17, 2026 3:15 PM · 4.1 MB</span
            >
            <template #actions>
              <Button variant="secondary" size="sm" square title="Restore"
                ><RotateCcw :size="14"
              /></Button>
              <Button variant="secondary" size="sm" square title="Download"
                ><Download :size="14"
              /></Button>
              <Button variant="danger-outline" size="sm" square title="Delete"
                ><Trash2 :size="14"
              /></Button>
            </template>
          </ListItem>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Active State</h3>
        <div class="ds-stack">
          <ListItem :active="true">
            <span style="font-size: var(--font-size-sm); font-weight: var(--font-weight-medium)"
              >Core Spanish Vocab</span
            >
            <span style="font-size: var(--font-size-xs); color: var(--color-text-secondary)"
              >1,200 cards · Updated today</span
            >
          </ListItem>
          <ListItem>
            <span style="font-size: var(--font-size-sm); font-weight: var(--font-weight-medium)"
              >Biology 101</span
            >
            <span style="font-size: var(--font-size-xs); color: var(--color-text-secondary)"
              >450 cards · Updated 3 days ago</span
            >
          </ListItem>
        </div>
      </div>

      <div class="ds-subsection">
        <h3 class="ds-subsection-title">Non-Clickable</h3>
        <div class="ds-stack">
          <ListItem :clickable="false">
            <span style="font-size: var(--font-size-sm); font-weight: var(--font-weight-medium)"
              >Static item with no hover</span
            >
            <span style="font-size: var(--font-size-xs); color: var(--color-text-secondary)"
              >This item is display-only</span
            >
          </ListItem>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ds-page {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--spacing-8) var(--spacing-4) var(--spacing-16);
}

.ds-page-title {
  margin: 0 0 var(--spacing-8);
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text-primary);
}

.ds-section {
  margin-bottom: var(--spacing-10);
}

.ds-section-title {
  margin: 0 0 var(--spacing-4);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  padding-bottom: var(--spacing-2);
  border-bottom: 1px solid var(--color-border);
}

.ds-subsection {
  margin-bottom: var(--spacing-6);
}

.ds-subsection-title {
  margin: 0 0 var(--spacing-3);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
}

.ds-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-3);
  align-items: center;
}

.ds-row--align-end {
  align-items: flex-end;
}

.ds-stack {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

/* Table for variant × size matrix */
.ds-table {
  border-collapse: collapse;
  width: auto;
}

.ds-table th,
.ds-table td {
  padding: var(--spacing-3);
  text-align: left;
  vertical-align: middle;
}

.ds-table th {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
}

.ds-table-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  text-transform: capitalize;
}

/* Swatches */
.ds-swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-2);
}

.ds-swatch-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-1);
}

.ds-swatch {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
}

.ds-swatch--bordered {
  border: 1px solid var(--color-border);
}

.ds-swatch-label {
  font-size: var(--font-size-2xs);
  color: var(--color-text-tertiary);
  font-family: var(--font-family-mono);
}

/* Typography samples */
.ds-type-row {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-4);
}

.ds-type-label {
  width: 48px;
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  font-family: var(--font-family-mono);
  color: var(--color-text-tertiary);
  text-align: right;
}

/* Spacing bars */
.ds-spacing-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
}

.ds-spacing-label {
  width: 80px;
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
  color: var(--color-text-secondary);
  text-align: right;
}

.ds-spacing-px {
  color: var(--color-text-tertiary);
}

.ds-spacing-bar {
  height: 12px;
  background: var(--color-primary-400);
  border-radius: var(--radius-sm);
  min-width: 4px;
}

/* Radius boxes */
.ds-radius-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-1);
}

.ds-radius-box {
  width: 56px;
  height: 56px;
  background: var(--color-primary-100);
  border: 2px solid var(--color-primary-400);
}

/* Shadow boxes */
.ds-shadow-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-2);
}

.ds-shadow-box {
  width: 80px;
  height: 56px;
  background: var(--color-surface);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
}

/* ── Pill Tabs (from StatusBar.vue) ── */
.demo-pill-tabs {
  display: flex;
  gap: var(--spacing-1);
}

.demo-pill-tab {
  padding: var(--spacing-1-5) var(--spacing-3);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
  white-space: nowrap;
}

.demo-pill-tab:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

.demo-pill-tab--active {
  color: var(--color-primary);
  background: var(--color-surface-elevated);
}

/* ── Segmented Tabs (from StatsPeriodSelector.vue) ── */
.demo-segment-tabs {
  display: inline-flex;
  gap: var(--spacing-1);
  background: var(--color-neutral-100);
  border-radius: var(--radius-lg);
  padding: var(--spacing-0-5);
}

.demo-segment-tab {
  padding: var(--spacing-1) var(--spacing-3);
  border: none;
  background: transparent;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  color: var(--color-neutral-600);
  cursor: pointer;
  transition: all 0.15s ease;
}

.demo-segment-tab:hover {
  color: var(--color-neutral-900);
}

.demo-segment-tab--active {
  background: var(--color-surface);
  color: var(--color-neutral-900);
  font-weight: var(--font-weight-medium);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}

/* ── Underline Tabs (from SchedulerSettings.vue / NoteTypeManager.vue) ── */
.demo-underline-tabs {
  display: flex;
  gap: var(--spacing-1);
  border-bottom: 1px solid var(--color-border);
}

.demo-underline-tab {
  padding: var(--spacing-1) var(--spacing-3);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--color-text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  cursor: pointer;
  transition: var(--transition-colors);
  box-shadow: none;
}

.demo-underline-tab:hover {
  color: var(--color-text-primary);
}

.demo-underline-tab--active {
  color: var(--color-text-primary);
  border-bottom-color: var(--color-border-focus);
}

.demo-tab-content {
  margin-top: var(--spacing-3);
  padding: var(--spacing-3);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

/* ── Data Table ── */
.demo-table-wrapper {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.demo-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-xs);
  table-layout: auto;
}

.demo-table th {
  padding: var(--spacing-1-5) var(--spacing-2);
  text-align: left;
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  white-space: nowrap;
}

.demo-table td {
  padding: var(--spacing-1) var(--spacing-2);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-primary);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.demo-table tbody tr:last-child td {
  border-bottom: none;
}

.demo-table tbody tr {
  cursor: pointer;
  transition: background 0.1s;
}

.demo-table tbody tr:hover {
  background: var(--color-surface-elevated);
}

.demo-tr--selected {
  background: var(--color-surface-elevated);
}

.demo-tr--multi-selected {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

.demo-table--compact {
  font-size: var(--font-size-2xs);
}

.demo-table--compact th {
  color: var(--color-text-tertiary);
}

/* ── Rating Badges ── */
.demo-badge {
  display: inline-block;
  padding: 0 var(--spacing-1-5);
  border-radius: var(--radius-xs);
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-2xs);
}

.demo-badge--again {
  background: var(--color-error-100);
  color: var(--color-error-700);
}

.demo-badge--hard {
  background: var(--color-warning-100);
  color: var(--color-warning-700);
}

.demo-badge--good {
  background: var(--color-success-100);
  color: var(--color-success-700);
}

.demo-badge--easy {
  background: var(--color-primary-100);
  color: var(--color-primary-700);
}
</style>
