<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed } from "vue";
import katexCss from "katex/dist/katex.min.css?raw";
import type { Theme } from "../design-system/hooks/useTheme";

const props = defineProps<{
  cardHtml: string;
  cardCss: string;
  theme: Theme;
}>();

const emit = defineEmits<{
  audioButtonClick: [src: string];
  backgroundDetected: [color: string | null];
  typeAnswerInput: [value: string];
  typeAnswerSubmit: [];
}>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

const TYPEANS_STYLES = `
  .typeans-input {
    display: block;
    width: 100%;
    max-width: 400px;
    margin: 0.75rem auto;
    padding: 0.5rem 0.75rem;
    font-size: 1rem;
    font-family: inherit;
    border: 2px solid #888;
    border-radius: 6px;
    text-align: center;
    outline: none;
    transition: border-color 0.15s;
  }
  .typeans-input:focus {
    border-color: #4a90d9;
  }
  :where(html[data-theme="dark"]) .typeans-input {
    background: #27272a;
    color: #f4f4f5;
    border-color: #52525b;
  }
  :where(html[data-theme="dark"]) .typeans-input:focus {
    border-color: #60a5fa;
  }
  #typeans {
    display: block;
    text-align: center;
    margin: 0.5rem auto;
    font-family: monospace;
    font-size: 1rem;
  }
  .typeans-correct {
    color: #0a0;
  }
  :where(html[data-theme="dark"]) .typeans-correct {
    color: #4ade80;
  }
  .typeans-row {
    margin: 0.25rem 0;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .typeGood {
    color: #0a0;
  }
  :where(html[data-theme="dark"]) .typeGood {
    color: #4ade80;
  }
  .typeBad {
    color: #f00;
  }
  :where(html[data-theme="dark"]) .typeBad {
    color: #f87171;
  }
  .typeMissed {
    color: #888;
    text-decoration: line-through;
  }
  :where(html[data-theme="dark"]) .typeMissed {
    color: #a1a1aa;
  }
`;

const BASE_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: system-ui, -apple-system, sans-serif;
    overflow: hidden;
  }
  :where(html[data-theme="light"]) body { color: #18181b; }
  :where(html[data-theme="dark"]) body { color: #f4f4f5; }
  img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  hr { margin: 1rem 0; border: none; border-top: 1px solid; opacity: 0.5; }
  :where(html[data-theme="light"]) hr { border-color: #e4e4e7; }
  :where(html[data-theme="dark"]) hr { border-color: #3f3f46; }
  .audio-container {
    display: inline-flex;
    align-items: center;
  }
  .audio-container button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem;
    color: inherit;
  }
  .audio-container button svg { pointer-events: none; }
  audio { display: none; }
  ${TYPEANS_STYLES}
`;

// srcdoc excludes theme so theme changes don't cause full iframe reloads
const srcdoc = computed(() => {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${BASE_STYLES}</style>
<style>${katexCss}</style>
${props.cardCss ? `<style>${props.cardCss}</style>` : ""}
</head>
<body class="card">
${props.cardHtml}
</body>
</html>`;
});

function setupIframe() {
  const iframe = iframeRef.value;
  if (!iframe?.contentDocument) return;

  const doc = iframe.contentDocument;
  const body = doc.body;
  if (!body) return;

  // Set initial theme
  doc.documentElement.dataset.theme = props.theme;

  // Resize observer to auto-size iframe height to content
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => updateHeight());
  resizeObserver.observe(body);

  // Listen for image loads to retrigger height measurement
  for (const img of doc.querySelectorAll("img")) {
    img.addEventListener("load", updateHeight);
  }

  // Wire up audio buttons — emit raw src attribute to parent for playback
  for (const btn of doc.querySelectorAll<HTMLElement>(".audio-container button")) {
    btn.addEventListener("click", () => {
      const audio = btn.closest(".audio-container")?.querySelector("audio");
      const src = audio?.getAttribute("src");
      if (src) {
        emit("audioButtonClick", src);
      }
    });
  }

  // Wire up type-answer input fields
  const typeans = doc.querySelector<HTMLInputElement>('input.typeans-input');
  if (typeans) {
    // Focus the input automatically
    setTimeout(() => typeans.focus(), 50);

    // Emit input value as user types
    typeans.addEventListener("input", () => {
      emit("typeAnswerInput", typeans.value);
    });

    // Enter key submits/reveals
    typeans.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        emit("typeAnswerSubmit");
      }
    });

    // Prevent keyboard shortcuts from leaking through the iframe
    typeans.addEventListener("keydown", (e) => {
      // Allow Enter (handled above), Tab, and modifier combos to pass through
      if (e.key === "Enter" || e.key === "Tab") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Stop all other keys from bubbling to parent document
      e.stopPropagation();
    });
  }

  updateHeight();
  emitBackgroundColor(body);
}

function emitBackgroundColor(body: HTMLElement) {
  const bg = getComputedStyle(body).backgroundColor;
  // "rgba(0, 0, 0, 0)" or "transparent" means no explicit background set
  const isTransparent = !bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)";
  emit("backgroundDetected", isTransparent ? null : bg);
}

function updateHeight() {
  const iframe = iframeRef.value;
  if (!iframe?.contentDocument?.body) return;
  iframe.style.height = `${iframe.contentDocument.body.scrollHeight}px`;
}

// Update theme without full iframe reload
watch(
  () => props.theme,
  (newTheme) => {
    const doc = iframeRef.value?.contentDocument;
    if (doc?.documentElement) {
      doc.documentElement.dataset.theme = newTheme;
    }
  },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<template>
  <iframe
    ref="iframeRef"
    :srcdoc="srcdoc"
    sandbox="allow-same-origin allow-scripts"
    class="sandboxed-card"
    @load="setupIframe"
  />
</template>

<style scoped>
.sandboxed-card {
  width: 100%;
  min-height: 100px;
  border: none;
  overflow: hidden;
  display: block;
}
</style>
