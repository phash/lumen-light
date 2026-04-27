/**
 * Run-Time-Konfiguration. In Production wird /config.js vor dem Modul-
 * Bundle geladen und setzt window.__APP_CONFIG__. Lokal/in Tests wird
 * auf Vite-Build-Time-Env-Vars zurueckgefallen.
 *
 * So braucht es genau ein Container-Image fuer alle Deployments — der
 * Unterschied liegt nur in der gemounteten /config.js.
 */
export interface RuntimeConfig {
  KEYCLOAK_AUTHORITY: string;
  KEYCLOAK_CLIENT_ID: string;
  API_BASE: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<RuntimeConfig>;
  }
}

function loadConfig(): RuntimeConfig {
  const fromWindow = (typeof window !== "undefined" && window.__APP_CONFIG__) || {};

  const config: RuntimeConfig = {
    KEYCLOAK_AUTHORITY:
      fromWindow.KEYCLOAK_AUTHORITY ?? import.meta.env.VITE_KEYCLOAK_AUTHORITY,
    KEYCLOAK_CLIENT_ID:
      fromWindow.KEYCLOAK_CLIENT_ID ?? import.meta.env.VITE_KEYCLOAK_CLIENT_ID,
    API_BASE: fromWindow.API_BASE ?? import.meta.env.VITE_API_BASE,
  };

  for (const [key, value] of Object.entries(config)) {
    if (!value) {
      throw new Error(
        `Run-Time-Config '${key}' fehlt — weder window.__APP_CONFIG__ noch VITE_${key} ist gesetzt.`,
      );
    }
  }
  return config;
}

export const RUNTIME_CONFIG = loadConfig();
