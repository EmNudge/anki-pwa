import { ref, type Ref } from "vue";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Ref<Theme>;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const theme = ref<Theme>("light");

function isTheme(value: string): value is Theme {
  return value === "light" || value === "dark";
}

const savedTheme = localStorage.getItem("theme");
if (savedTheme && isTheme(savedTheme)) {
  theme.value = savedTheme;
  document.documentElement.setAttribute("data-theme", savedTheme);
} else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
  theme.value = "dark";
  document.documentElement.setAttribute("data-theme", "dark");
} else {
  document.documentElement.setAttribute("data-theme", theme.value);
}

function setTheme(newTheme: Theme) {
  theme.value = newTheme;
  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);
}

function toggleTheme() {
  const newTheme = theme.value === "light" ? "dark" : "light";
  setTheme(newTheme);
}

export function useTheme(): ThemeContextValue {
  return { theme, toggleTheme, setTheme };
}
