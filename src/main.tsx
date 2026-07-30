import React from "react";
import ReactDOM from "react-dom/client";
import Overlay from "./components/Overlay";
import { AppProvider, ThemeProvider, ExpandedLayoutProvider } from "./contexts";
import "./global.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AppRoutes from "./routes";

// Visually flags a locally-run dev window (`npm run tauri dev`) green so it's
// never mistaken for a production build (blue) when both happen to be open
// at once. `import.meta.env.DEV` is true only for the Vite dev server that
// `tauri dev` launches — any built exe, local (`tauri build`) or from the
// GitHub release workflow, runs the `vite build` output and stays blue.
if (import.meta.env.DEV) {
  document.documentElement.classList.add("dev-build");
}

const currentWindow = getCurrentWindow();
const windowLabel = currentWindow.label;

if (windowLabel.startsWith("capture-overlay-")) {
  const monitorIndex = parseInt(windowLabel.split("-")[2], 10) || 0;
  // Render overlay without providers
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <Overlay monitorIndex={monitorIndex} />
    </React.StrictMode>
  );
} else {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider defaultTheme="light">
        <AppProvider>
          <ExpandedLayoutProvider>
            <AppRoutes />
          </ExpandedLayoutProvider>
        </AppProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
}
