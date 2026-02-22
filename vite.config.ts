import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import inspect from "vite-plugin-inspect";
import path from "path";
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@dweb-browser/zstd-wasm'],
  },
  build: {
    target: 'es2020',
  },
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "src"),
    },
  },
  plugins: [
    vue(),
    inspect(),
    tailwindcss(),
  ],
});
