import "@testing-library/jest-dom/vitest";

// Run-Time-Config in Tests stubben — sonst wirft runtime-config.ts beim Import,
// weil weder window.__APP_CONFIG__ noch VITE_*-Build-Vars gesetzt sind.
(window as Window & { __APP_CONFIG__?: unknown }).__APP_CONFIG__ = {
  KEYCLOAK_AUTHORITY: "http://test-keycloak/realms/lumen",
  KEYCLOAK_CLIENT_ID: "lumen-frontend",
  API_BASE: "http://test-api/api/v1",
};
