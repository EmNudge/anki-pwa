import { createApp } from "vue";
import "./design-system/tokens/index.css";
import "./index.css";
import "katex/dist/katex.min.css";
import App from "./App.vue";

const app = createApp(App);
app.mount("#root");
