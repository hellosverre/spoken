import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "@fontsource-variable/sora";
import "./theme/base.css";
// Structure every theme builds on: layout, states, motion hooks.
import "./theme/plain/components.css";
// The active look. To swap themes, point these two imports at another folder.
import "./theme/signal/tokens.css";
import "./theme/signal/skin.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
