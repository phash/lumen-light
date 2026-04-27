# arc42 §10 · Qualitätsanforderungen

Messbare Qualitätsziele für Lumen · light. Jedes Ziel hat ein Akzeptanzkriterium, das im Test oder Monitoring belegbar ist.

## Performance

| Ziel | Akzeptanzkriterium | Messung |
|---|---|---|
| Live-Vorschau bleibt flüssig | ≥ 30 fps bei 24 MP-Bild auf Mittelklasse-Laptop (Intel Iris Xe / Apple M1) während Slider-Drag | manueller Test mit Beispiel-RAW + Performance-DevTools |
| Bild-Öffnen schnell | < 1 s vom Drop bis erstes Render bei JPEG ≤ 30 MP | manueller Test, Performance-Mark im Frontend |
| Backend-Latenz | p95 < 100 ms für `/presets`-GET bei 100 Presets | Lasttest mit `wrk` o.ä. (später, wenn produktiv) |

## Bildqualität

| Ziel | Akzeptanzkriterium | Messung |
|---|---|---|
| sRGB↔Linear-Korrektheit | Roundtrip srgb→linear→srgb auf einer Test-Textur ist `≤ 1/255` Abweichung pro Kanal | Snapshot-Test in Vitest mit headless WebGL2 |
| Adjustments-Reihenfolge stabil | Pipeline-Reihenfolge (siehe `05-frontend-konzept.md`) ist im Shader-Source dokumentiert und durch Test gegen Referenz-Pixel abgesichert | Pixel-genauer Test gegen Goldwerte |

## Sicherheit

| Ziel | Akzeptanzkriterium | Messung |
|---|---|---|
| Tenant-Isolation | User A kann unter keinem Endpoint Daten von User B lesen oder ändern | Backend-Test pro Endpoint |
| Refresh-Token-Rotation | Alter Refresh-Token wird beim Refresh ungültig (Replay-Schutz) | Backend-Test |
| Passwort-Hash | bcrypt cost ≥ 12, Passwort nie in API-Antworten | Backend-Test + Audit `app/auth.py` |
| JWT-Secret | Mindestens 256 bit, niemals im Code, läuft aus 15 min | Audit `app/config.py` + `.env.example` |

## Wartbarkeit

| Ziel | Akzeptanzkriterium | Messung |
|---|---|---|
| Test-Abdeckung Backend | ≥ 80 % Lines, jeder Endpoint hat mind. einen Test | `pytest --cov=app` |
| Adjustment-Schema synchron | Pydantic-Modell und Frontend-Typen stammen beide aus `backend/schemas/adjustments.schema.json` (Single Source of Truth) | Schema-Test in CI vergleicht generierte Typen mit Quelle |
| Kein `any` im Frontend-API-Client | TypeScript strict, keine `as any`-Casts auf API-Schnittstellen | `tsc --noEmit` in CI |

## Datenschutz

| Ziel | Akzeptanzkriterium | Messung |
|---|---|---|
| Pixel-Daten verlassen den Client nicht | Backend hat keinen Endpoint, der Bilddaten annimmt oder zurückgibt | Audit `app/routers/`, kein `multipart/form-data` |
| Nur notwendige User-Daten gespeichert | DB speichert nur `email`, `password_hash`, `created_at` für User | Audit Schema |

## Verfügbarkeit

| Ziel | Akzeptanzkriterium | Messung |
|---|---|---|
| Service-Verfügbarkeit | ≥ 99 % monatlich (Single-Node-Limits akzeptiert) | Uptime-Monitor von Caddy-Logs |
| Recovery-Zeit | Wiederherstellung aus letztem Backup < 30 min | Disaster-Recovery-Drill 1×/Quartal |
