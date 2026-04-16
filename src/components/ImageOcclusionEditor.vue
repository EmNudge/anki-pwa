<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { useImageOcclusionEditor, type IoTool } from "../composables/useImageOcclusionEditor";
import type { OcclusionShape } from "../utils/imageOcclusion";
import Button from "../design-system/components/primitives/Button.vue";

const props = defineProps<{
  imageUrl: string;
  modelValue: OcclusionShape[];
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [shapes: OcclusionShape[]];
}>();

const svgRef = ref<SVGSVGElement | null>(null);
const imageNaturalWidth = ref(800);
const imageNaturalHeight = ref(600);
const imageLoaded = ref(false);

const editor = useImageOcclusionEditor(props.modelValue);

// Sync external model → editor
watch(
  () => props.modelValue,
  (val) => {
    if (JSON.stringify(val) !== JSON.stringify(editor.shapes.value)) {
      editor.setShapes(val);
    }
  },
);

// Sync editor → external model
watch(
  () => editor.shapes.value,
  (val) => {
    emit("update:modelValue", val);
  },
  { deep: true },
);

// Load image to get natural dimensions
onMounted(() => {
  const img = new Image();
  img.onload = () => {
    imageNaturalWidth.value = img.naturalWidth;
    imageNaturalHeight.value = img.naturalHeight;
    imageLoaded.value = true;
  };
  img.src = props.imageUrl;
});

// Keyboard handling
function onKeydown(e: KeyboardEvent) {
  if (props.readonly) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    if (editor.selectedShapeId.value) {
      e.preventDefault();
      editor.deleteSelectedShape();
    }
  }
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));

// Convert screen pointer coords to SVG viewBox coords
function toSvgPoint(e: PointerEvent): { x: number; y: number } | null {
  const svg = svgRef.value;
  if (!svg) return null;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const inv = ctm.inverse();
  return {
    x: inv.a * e.clientX + inv.c * e.clientY + inv.e,
    y: inv.b * e.clientX + inv.d * e.clientY + inv.f,
  };
}

// Drag state for move
let dragState: { shapeId: string; startX: number; startY: number; origX: number; origY: number } | null = null;

function onPointerDown(e: PointerEvent) {
  if (props.readonly) return;
  const pt = toSvgPoint(e);
  if (!pt) return;

  if (editor.activeTool.value === "select") {
    // Check if clicking on a shape
    const target = e.target as Element;
    const shapeEl = target.closest("[data-shape-id]");
    if (shapeEl) {
      const id = shapeEl.getAttribute("data-shape-id")!;
      editor.selectShape(id);
      const shape = editor.shapes.value.find((s) => s.id === id);
      if (shape) {
        dragState = { shapeId: id, startX: pt.x, startY: pt.y, origX: shape.x, origY: shape.y };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }
    } else {
      editor.selectShape(null);
    }
  } else {
    editor.startDraw(pt.x, pt.y);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
}

function onPointerMove(e: PointerEvent) {
  if (props.readonly) return;
  const pt = toSvgPoint(e);
  if (!pt) return;

  if (editor.isDrawing.value) {
    editor.updateDraw(pt.x, pt.y);
  } else if (dragState) {
    const dx = pt.x - dragState.startX;
    const dy = pt.y - dragState.startY;
    editor.resizeShape(dragState.shapeId, {
      x: dragState.origX + dx,
      y: dragState.origY + dy,
      width: editor.shapes.value.find((s) => s.id === dragState!.shapeId)!.width,
      height: editor.shapes.value.find((s) => s.id === dragState!.shapeId)!.height,
    });
  }
}

function onPointerUp(_e: PointerEvent) {
  if (editor.isDrawing.value) {
    editor.endDraw();
  }
  dragState = null;
}

const tools: { key: IoTool; label: string }[] = [
  { key: "select", label: "Select" },
  { key: "rect", label: "Rectangle" },
  { key: "ellipse", label: "Ellipse" },
];
</script>

<template>
  <div class="io-editor">
    <div v-if="!readonly" class="io-toolbar">
      <Button
        v-for="tool in tools"
        :key="tool.key"
        :variant="editor.activeTool.value === tool.key ? 'primary' : 'secondary'"
        size="sm"
        @click="editor.setTool(tool.key)"
      >
        {{ tool.label }}
      </Button>
      <Button
        variant="danger"
        size="sm"
        :disabled="!editor.selectedShapeId.value"
        @click="editor.deleteSelectedShape()"
      >
        Delete
      </Button>
    </div>
    <div class="io-canvas-wrapper">
      <svg
        v-if="imageLoaded"
        ref="svgRef"
        class="io-canvas"
        :viewBox="`0 0 ${imageNaturalWidth} ${imageNaturalHeight}`"
        preserveAspectRatio="xMidYMid meet"
        @pointerdown.prevent="onPointerDown"
        @pointermove.prevent="onPointerMove"
        @pointerup.prevent="onPointerUp"
      >
        <image :href="imageUrl" :width="imageNaturalWidth" :height="imageNaturalHeight" />

        <template v-for="shape in editor.shapes.value" :key="shape.id">
          <rect
            v-if="shape.type === 'rect'"
            :data-shape-id="shape.id"
            :x="shape.x"
            :y="shape.y"
            :width="shape.width"
            :height="shape.height"
            fill="#ffeba2"
            fill-opacity="0.6"
            stroke="#2d2d2d"
            stroke-width="1"
            :class="{ 'io-shape': true, 'io-shape-selected': shape.id === editor.selectedShapeId.value }"
            style="cursor: pointer"
          />
          <ellipse
            v-else-if="shape.type === 'ellipse'"
            :data-shape-id="shape.id"
            :cx="shape.x + shape.width / 2"
            :cy="shape.y + shape.height / 2"
            :rx="shape.width / 2"
            :ry="shape.height / 2"
            fill="#ffeba2"
            fill-opacity="0.6"
            stroke="#2d2d2d"
            stroke-width="1"
            :class="{ 'io-shape': true, 'io-shape-selected': shape.id === editor.selectedShapeId.value }"
            style="cursor: pointer"
          />
          <!-- Ordinal label -->
          <text
            :x="shape.x + shape.width / 2"
            :y="shape.y + shape.height / 2"
            text-anchor="middle"
            dominant-baseline="central"
            font-size="16"
            font-weight="bold"
            fill="#333"
            pointer-events="none"
          >
            {{ shape.ordinal }}
          </text>
        </template>

        <!-- Selection outline -->
        <rect
          v-if="editor.selectedShape.value"
          :x="editor.selectedShape.value.x - 2"
          :y="editor.selectedShape.value.y - 2"
          :width="editor.selectedShape.value.width + 4"
          :height="editor.selectedShape.value.height + 4"
          fill="none"
          stroke="#2196f3"
          stroke-width="2"
          stroke-dasharray="6 3"
          pointer-events="none"
        />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.io-editor {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.io-toolbar {
  display: flex;
  gap: var(--spacing-1);
  flex-wrap: wrap;
}

.io-canvas-wrapper {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-surface-elevated);
}

.io-canvas {
  display: block;
  width: 100%;
  height: auto;
  max-height: 60vh;
  touch-action: none;
  user-select: none;
}

.io-shape-selected {
  stroke: #2196f3;
  stroke-width: 2;
}
</style>
