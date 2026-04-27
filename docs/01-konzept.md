# 01 · Konzept

## Vision

Ein browser-basierter, self-hosted RAW-Entwickler, der die wichtigsten 80 % der Lightroom-Funktionalität abdeckt — ohne Subscription, ohne Cloud-Zwang, mit **vom User kontrollierter Datensouveränität**.

Arbeitsname: **Lumen · light**

**Datensouveränität in der Praxis:** Bilder bleiben standardmäßig auf dem Gerät, das sie bearbeitet. Wer sie hochladen will (für Multi-Device-Sync, Archiv, Sharing), entscheidet das pro Bild bewusst — nichts wandert *automatisch* zum Server. Upload geht direkt vom Browser zum eigenen S3-Bucket (Garage), das Backend speichert nur Metadaten, niemals Pixeldaten.

## Problem

Lightroom ist Marktstandard, aber:
- Subscription-Modell ohne Eigentumsperspektive
- Bibliothek liegt zwingend in der Adobe Cloud (oder nur lokal mit Einschränkungen)
- Kein Self-Hosting möglich
- Geschlossenes Ökosystem für Presets

Open-Source-Alternativen (darktable, RawTherapee) sind funktional stark, aber Desktop-only und haben eine Lernkurve, die Hobbyisten oft abschreckt.

Es fehlt ein **moderner, schlanker, browser-nativer Mittelweg**: simpel wie Lightroom, frei wie darktable, deploybar auf eigener Infrastruktur.

## Zielgruppe

**Primär:** Hobbyfotografen und Enthusiasten, die
- ihre Bilder nicht in eine fremde Cloud laden wollen,
- keine Adobe-Subscription mehr zahlen wollen,
- 90 % ihrer Bearbeitungen mit Belichtung/Kontrast/WB/Sättigung erledigen,
- gerne mit eigenen Presets arbeiten.

**Sekundär:** Fotografenkollektive, Vereine, kleine Studios, die einen geteilten Preset-Pool wollen.

**Nicht-Zielgruppe:** Professionelle Retuscheure mit Pixel-genauen Composit-Anforderungen — das bleibt Photoshop-Territorium.

## USP

| Lightroom | darktable | **Lumen · light** |
|---|---|---|
| Cloud-zwang | Desktop-only | Browser, self-hosted |
| Subscription | Frei, aber komplex | Frei, schlank |
| Geschlossenes Preset-Format | XMP, technisch | JSON, teilbar |
| Adobe-Account nötig | Lokales Filesystem | Eigene User-Accounts |

## Scope MVP (16 Wochen)

**Drin:**
- JPEG/PNG-Bearbeitung im Browser via WebGL2
- 10 Basis-Adjustments: Belichtung, Kontrast, Lichter, Tiefen, Weiß, Schwarz, Temperatur, Tint, Dynamik, Sättigung
- Live-Histogramm
- Vorher/Nachher-Vergleich
- Beschneiden + Begradigen
- Objektivkorrektur via Lensfun-Profil-DB (clientseitig, statisch)
- Presets: speichern, anwenden, löschen, umbenennen
- **Auth via Keycloak** (eigener Realm `lumen`, OIDC Authorization Code + PKCE)
- **Optionaler Image-Upload nach Garage S3** (per-User-Bucket-Prefix, Pre-Signed URLs, Pixel laufen direkt Browser↔Garage)
- JPEG-Export in beliebiger Auflösung (lokal; optionales Hochladen ins Bucket)
- Self-hosting via Docker Compose

**Drin als Stretch (Wochen 17–22):**
- RAW-Decoding via libraw-wasm im Browser
- Auto-Adjust per einfacher Heuristik (Histogramm-basiert)

**Nicht drin im MVP:**
- Lokale Anpassungen (Verlaufsfilter, Radial, Pinsel)
- KI-Masken (Motiv, Himmel, Person)
- Spot Removal / Heilung
- HSL-Farbkanäle
- Gradationskurve
- Bibliotheksverwaltung im Lightroom-Stil (Sterne, Flags, Sammlungen)
- Geräte-Tethering
- Preset-Marketplace

Diese Punkte landen nach dem MVP auf der Backlog-Liste, nach Nutzer-Feedback priorisiert.

## Erfolgskriterien

Das MVP ist erfolgreich, wenn:
1. Ein Bild von Drag-and-Drop bis Export in unter 30 Sekunden bearbeitet werden kann.
2. Die Shader-Pipeline auf einem Mittelklasse-Laptop (Intel Iris Xe / M1) bei einem 24-MP-Bild bei jedem Slider-Move flüssig (≥30 fps) reagiert.
3. Eigene Presets über Geräte hinweg synchronisiert werden (Single-Sign-On via Keycloak).
4. Optional hochgeladene Bilder können auf einem zweiten Gerät weiter bearbeitet werden.
5. Die ganze Stack via `docker compose up -d` auf einem 4-GB-VPS läuft (oder als Add-On in einem bestehenden `caddy-proxy`-Cluster wie MRD Production).

## Nicht-Ziele

- **Photoshop-Konkurrenz:** Pixel-Painting, Composing, generative Fülle bleiben außen vor.
- **Mobile-App:** Web-PWA reicht. Keine native iOS/Android-App.
- **Dateiverwaltung:** Lumen ist ein Editor, kein Asset-Manager. Bilder bleiben im Filesystem des Users.

## Differenzierung gegenüber bestehenden Web-Editoren

| Tool | Schwäche | Lumen löst das durch |
|---|---|---|
| Photopea | Photoshop-Klon, kein RAW-Workflow | RAW-First, Schieberegler-Workflow |
| Pixlr | Reines Filter-Spielzeug | Echte sRGB↔Linear-Pipeline |
| Adobe Web | Adobe-Ökosystem | Self-hosted, kein Vendor-Lock-in |
