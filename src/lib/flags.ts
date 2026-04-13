import { ref } from "vue";

export interface FlagDefinition {
  flag: number;
  label: string;
  color: string;
}

const DEFAULT_FLAGS: FlagDefinition[] = [
  { flag: 1, label: "Red", color: "#ff6b6b" },
  { flag: 2, label: "Orange", color: "#ffa94d" },
  { flag: 3, label: "Green", color: "#69db7c" },
  { flag: 4, label: "Blue", color: "#74c0fc" },
  { flag: 5, label: "Pink", color: "#f783ac" },
  { flag: 6, label: "Turquoise", color: "#63e6be" },
  { flag: 7, label: "Purple", color: "#b197fc" },
];

const STORAGE_KEY = "custom-flag-labels";

function loadCustomLabels(): Record<number, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Reactive ref holding custom flag label overrides (flag number → custom name) */
export const customFlagLabelsSig = ref<Record<number, string>>(loadCustomLabels());

/** Get the resolved flag definitions, with custom labels applied */
export function getFlags(): FlagDefinition[] {
  const custom = customFlagLabelsSig.value;
  return DEFAULT_FLAGS.map((f) => ({
    ...f,
    label: custom[f.flag] || f.label,
  }));
}

/** Get a single flag's resolved label */
export function getFlagLabel(flag: number): string {
  if (flag === 0) return "None";
  const custom = customFlagLabelsSig.value;
  const def = DEFAULT_FLAGS.find((f) => f.flag === flag);
  return custom[flag] || def?.label || `Flag ${flag}`;
}

/** Get a single flag's color */
export function getFlagColor(flag: number): string | undefined {
  return DEFAULT_FLAGS.find((f) => f.flag === flag)?.color;
}

/** Get the default (color-based) label for a flag */
export function getDefaultFlagLabel(flag: number): string {
  return DEFAULT_FLAGS.find((f) => f.flag === flag)?.label ?? `Flag ${flag}`;
}

/** Rename a flag. Pass empty string to reset to default. */
export function renameFlag(flag: number, name: string) {
  const custom = { ...customFlagLabelsSig.value };
  if (name.trim()) {
    custom[flag] = name.trim();
  } else {
    delete custom[flag];
  }
  customFlagLabelsSig.value = custom;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
}
