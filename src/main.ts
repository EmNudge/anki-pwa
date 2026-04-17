import { createApp } from "vue";
import { registerSW } from "virtual:pwa-register";
import "./design-system/tokens/index.css";
import "./index.css";
import "katex/dist/katex.min.css";
import App from "./App.vue";

registerSW({
  onNeedRefresh() {
    // New content available — reload to pick it up
    window.location.reload();
  },
});

const app = createApp(App);
app.mount("#root");
