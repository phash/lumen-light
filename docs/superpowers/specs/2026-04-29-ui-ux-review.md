# UI/UX-Review · Lumen · light · 2026-04-29

> Reviewer-Agent-Output, archiviert. Findings priorisiert P1/P2/P3.
> Daraus abgeleitet: Onboarding-Steps + sofort-Fixes (siehe Commit-Log).

## Quick Take

Editor-Architektur ist diszipliniert (klares Stateless-Komposit, `data-testid`-Disziplin, sinnvolle Sektion-Reihenfolge mit Persistenz, hilfreiche Tooltips). Schwachstellen liegen weniger im Funktionsumfang als in Onboarding-Mikromomenten, Mobile-Tauglichkeit und Konsistenz: Sidebar auf <600px komplett unsichtbar, Toolbar quetscht 9 Buttons in einer Reihe, Begriffe wie „Klarheit/Dynamik/Lichter retten" sind ohne Tour fuer Hobby-Fotografen nicht durchgaengig erschlossen, in mehreren Dialogen fehlen Standard-Pattern (Esc-Close, Focus-Trap, role="dialog"). Smart-Suggestion-Banner zeigt rohe Genre-Slugs ("portrait" statt "Portrait"), Marketplace nutzt `window.confirm` fuer kritischen Datenverlust-Pfad.

## P1 — Sofort fixen (vor Beta)

- **Editor-Sidebar fehlt komplett auf Mobile.** Auf <600px verschwindet die 320px-Aside hinter `flex-1`-Main. Fix: Drawer- oder Sheet-Pattern.
- **Smart-Suggestion zeigt rohen Slug** in `EditorBanners.tsx:55` → `GENRE_LABEL`-Map nutzen.
- **`window.confirm` fuer Datenverlust im Marketplace** (`Marketplace.tsx:284`) — durch Inline-Confirm ersetzen.
- **Toolbar laeuft auf Tablet/Mobile aus dem Bildschirm** (9 Buttons, ~720px) — Wrap oder Sekundaerleiste.
- **Slider per Touch nicht verlaesslich bedienbar** — `h-5` zu klein, Apple HIG fordert 44px. Hit-Area ueber Wrapper-Padding aufblasen.
- **Mask-Handles 16px** — auf Mobile unbedienbar. `w-6 h-6` minimum.
- **Dialoge fangen Esc nicht** — gemeinsamer Dialog-Wrapper mit `keydown listener` + `role="dialog"` + `aria-modal`.
- **Genre-/Status-Filter-Buttons fehlt `aria-pressed`** — Filter-Set fuer Screenreader-User unsichtbar.
- **Empty-State im Editor verschluckt Drop-Events** — Drag-Counter mit Highlight.
- **Library-Upload ohne Drag-Highlight.**

## P2 — Vor Public-Launch

- Header-Burger-Menue zeigt User-Email + Logout/Feedback nicht.
- Marketplace-Modal-Backdrop schliesst auf Drag-End — `mousedown`-Tracking.
- Toolbar-Buttons brauchen Icon-Konsistenz (Bypass hat Icon, alle anderen Text).
- `\` als Bypass-Hotkey ist auf DE-Layout AltGr+ß — alternativer Hotkey.
- PresetDialog laed Thumbs sequenziell ohne Skeleton.
- Account-Handle-Validierung erst beim Speichern (client-seitige Regex on-blur).
- Admin-User-Sperre ohne Confirm-Dialog.
- Admin-User-Tabelle ohne Sort/Filter (>50 Nutzer unbrauchbar).
- Admin-Stats-Strip alle 7 Kacheln gleichgewichtet — kritische amber-markieren.
- Feedback-Dialog 1.2s Auto-Close zu kurz auf langsamem Netz.
- File-Picker hat keinen Hinweis, dass nur 1 Bild gleichzeitig.

## P3 — Nice-to-have / Backlog

- Lens-Sektion „manuell ueberschrieben" braucht Reset-Auto-Button.
- HSL-Panel: pro-Achse-Reset (statt nur „alle 24 zurueck").
- Tonkurve: Snap-To-Grid bei Shift.
- Compare-Snapshot ist DataURL — fuer 50MP-RAW 200MB+ RAM.
- Marketplace fehlt URL-State (`useSearchParams`).
- Datenexport-Button ohne Erfolgs-Toast.
- Datenschutz/Impressum nur im Landing-Footer — DSGVO will jederzeit erreichbar.

## Onboarding-Empfehlungen (uebernommen)

Tour zeigt erlebbare Aha-Momente, keine Feature-Aufzaehlung:

1. Beispielbild laden (Pulsierender Highlight, &lt;5s Aha)
2. Auto-Ton — *„Ein Klick. Lumen analysiert das Bild."*
3. Slider-Doppelklick = Reset — *„Loest das ‚habe ich was kaputt gemacht'-Problem."*
4. Bypass / Vorher-Nachher — *„Augen-Icon halten zeigt Original."*
5. Beschneiden — *„R fuer Beschneiden."*
6. Preset speichern — *„10 Presets sind angelegt — speichere deinen eigenen Look."*
7. Export — *„Cmd+E. JPEG fuer Web, PNG fuer Druck."*

Crop-Pipeline + Masken NICHT in Tour — stattdessen First-Time-Hint im Modus.

## Lobenswert

- Tooltip-Microcopy auf Slidern (`adjustments.ts:97-126`) ist exzellent fuer Hobby-Fotografen.
- Sidebar-Sektion-Reihenfolge mit `defaultOpen={"Licht"}` + Persistenz richtig.
- Stateless-Komposit `EditorOverlayCanvas`/`Toolbar`/`Banners`/`Sidebar` mit Editor.tsx als Orchestrator.
- Honeypot + Char-Counter + auto-Fokus im FeedbackDialog ist mustergueltig.
- Skeleton-Loading im Marketplace mit Empty-State-Filter-Reset.
- `data-testid`-Disziplin durchgaengig.
