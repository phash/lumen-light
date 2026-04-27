// Beispiel fuer Production. Auf dem VPS als
// /opt/lumen/deployment/config.prod.js abgelegt und vom lumen-web-Container
// nach /usr/share/nginx/html/config.js gemountet (siehe docker-compose.prod.yml).
window.__APP_CONFIG__ = {
  KEYCLOAK_AUTHORITY: "https://auth.mr-development.de/realms/lumen",
  KEYCLOAK_CLIENT_ID: "lumen-frontend",
  API_BASE: "/api/v1",
};
