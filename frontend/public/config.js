// Lokales Default-Config — leer, damit auf VITE_*-Build-Time-Vars
// zurueckgefallen wird. In Production wird diese Datei vom Compose-File
// mit echten Werten ueberschrieben (Volume-Mount auf nginx-Container).
window.__APP_CONFIG__ = {};
