# arc42 — Lumen · light

arc42-konforme Architektur-Dokumentation. Dies ist das **lokale Pendant** zur Doku-Struktur in MRD (Project `aacc8f75-9b15-48b5-a7ce-8efa8ee01a7d`); beide Seiten werden synchron gehalten.

Die ausführlichen Dokumente liegen in `docs/0X-*.md`. Diese arc42-Übersicht mappt sie auf die zwölf arc42-Kapitel und ergänzt das, was arc42 zusätzlich verlangt.

## arc42-Kapitel-Mapping

| arc42-Kapitel | Quelle |
|---|---|
| 1. Einführung & Ziele | [`docs/01-konzept.md`](../01-konzept.md) (Vision, Zielgruppe, MVP-Scope, Erfolgskriterien) |
| 2. Randbedingungen | [`docs/01-konzept.md`](../01-konzept.md) (Nicht-Ziele, Differenzierung) + [`docs/07-tech-entscheidungen.md`](../07-tech-entscheidungen.md) (ADR-008 Self-Hosted) |
| 3. Kontextabgrenzung | [`docs/02-architektur.md`](../02-architektur.md) §"Drei-Schichten-Aufbau" — Browser ↔ Backend ↔ Postgres |
| 4. Lösungsstrategie | [`docs/02-architektur.md`](../02-architektur.md) §"Leitprinzip" — Schwergewicht im Browser, Backend schlank |
| 5. Bausteinsicht | [`docs/02-architektur.md`](../02-architektur.md) §"Frontend-Stack" + §"Backend-Stack" |
| 6. Laufzeitsicht | [`docs/02-architektur.md`](../02-architektur.md) §"Datenflüsse" + [`docs/05-frontend-konzept.md`](../05-frontend-konzept.md) §"WebGL-Pipeline" |
| 7. Verteilungssicht | [`docs/02-architektur.md`](../02-architektur.md) §"Deployment-Architektur" + [`docs/arc42/07-deployment.md`](07-deployment.md) (Cluster-spezifisch) |
| 8. Querschnittliche Konzepte | [`docs/03-datenmodell.md`](../03-datenmodell.md) (Schema-Evolution) + [`docs/04-api-spezifikation.md`](../04-api-spezifikation.md) (Auth, Errors, Versioning) |
| 9. Architekturentscheidungen | [`docs/07-tech-entscheidungen.md`](../07-tech-entscheidungen.md) (ADR-001 bis ADR-009) |
| 10. Qualitätsanforderungen | [`docs/01-konzept.md`](../01-konzept.md) §"Erfolgskriterien" + [`docs/arc42/10-qualitaet.md`](10-qualitaet.md) |
| 11. Risiken & technische Schulden | [`docs/08-risiken-offene-fragen.md`](../08-risiken-offene-fragen.md) |
| 12. Glossar | [`docs/arc42/12-glossar.md`](12-glossar.md) |

## Lokal ergänzte Kapitel

Wo arc42 mehr verlangt als die Konzept-Dokumente liefern, gibt es ein eigenes Dokument hier:

- [`07-deployment.md`](07-deployment.md) — konkrete Verteilung auf MRD Production Cluster
- [`10-qualitaet.md`](10-qualitaet.md) — messbare Qualitätsziele, Test-Strategie
- [`12-glossar.md`](12-glossar.md) — Fachbegriffe (Adjustment, sRGB↔Linear, Vibrance, Tonwertbereiche, …)

## Synchronisation mit MRD

Wenn ein Konzept-Dokument hier geändert wird, wird das entsprechende MRD-Document aktualisiert:

```
docs/01-konzept.md            ↔ MRD-Doc e57dc81c (Konzept · Vision, Scope, MVP)
docs/02-architektur.md        ↔ MRD-Doc adfdc341 (Systemarchitektur)
docs/03-datenmodell.md        ↔ MRD-Doc 3d42b82c (Datenmodell)
docs/04-api-spezifikation.md  ↔ MRD-Doc d5d9b634 (API-Spezifikation)
docs/05-frontend-konzept.md   ↔ MRD-Doc a165614c (Frontend-Konzept)
docs/06-roadmap.md            ↔ MRD-Doc ea2abc0b (Roadmap)
docs/07-tech-entscheidungen.md↔ MRD-Doc 5491edf1 (ADRs)
docs/08-risiken-offene-fragen ↔ MRD-Doc 627f3346 (Risiken)
```
