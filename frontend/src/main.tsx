import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root nicht gefunden");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: Service-Worker fuer Offline-Cache. Failt graceful, weil Lumen
// auch ohne SW vollstaendig funktioniert. In dev-Mode (vite serve) kein
// SW-Registrieren — sonst kaeme die alte Cache-Version trotz Hot-Reload.
if (
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  import.meta.env.PROD
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => {
        /* SW-Registration optional — ignorieren */
      });
  });
}
