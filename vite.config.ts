import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import inspect from "vite-plugin-inspect";
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
      "~": new URL("./src", import.meta.url).pathname,
    },
  },
  server: {
    proxy: {
      "/ollama": {
        target: "http://localhost:11434",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ""),
      },
    },
  },
  plugins: [
    vue(),
    inspect(),
    tailwindcss(),
  ],
});
