# 05 · Frontend-Konzept

## Routen

```
/             Landing-Seite (öffentlich)
/login        Login-Form
/register     Registrierungs-Form
/editor       Hauptanwendung (geschützt)
/account      User-Settings (geschützt)
```

Geschützte Routen via Auth-Guard-Component, die bei fehlendem Token nach `/login` redirected.

## Component-Tree

```
<App>
  <Router>
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/editor" element={<Editor />} />
        <Route path="/account" element={<Account />} />
      </Route>
    </Routes>
  </Router>
</App>

<Editor>
  <EditorHeader />              ← Logo, Datei öffnen, Export, User-Menü
  <EditorLayout>
    <CanvasArea>                ← Drop-Zone, WebGL-Canvas
      <BeforeAfterToggle />
      <ZoomControls />
    </CanvasArea>
    <RightPanel>
      <Histogram canvas={…} />
      <AdjustmentGroup name="Licht">
        <Slider for="exposure" />
        <Slider for="contrast" />
        ...
      </AdjustmentGroup>
      <AdjustmentGroup name="Farbe">
        ...
      </AdjustmentGroup>
      <PresetPanel>
        <PresetList />
        <SavePresetDialog />
      </PresetPanel>
    </RightPanel>
  </EditorLayout>
</Editor>
```

## State-Management

### Stores (Zustand)

```ts
// stores/auth.ts
interface AuthStore {
  user: User | null;
  accessToken: string | null;
  login: (email, password) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

// stores/editor.ts
interface EditorStore {
  imageData: ImageBitmap | null;          // aktuelles Bild
  adjustments: Adjustments;                // Slider-Werte
  bypass: boolean;                         // Vorher/Nachher
  setAdjustment: (key, value) => void;
  resetAdjustments: () => void;
  applyPreset: (preset: Preset) => void;
}

// stores/presets.ts
interface PresetStore {
  presets: Preset[];
  loading: boolean;
  fetchAll: () => Promise<void>;
  save: (name, adjustments) => Promise<Preset>;
  remove: (id) => Promise<void>;
}
```

Editor-State NICHT in URL serialisieren (zu groß, ändert sich zu oft). Stattdessen letzte Session in `IndexedDB` speichern.

## WebGL-Pipeline

### Reihenfolge der Operationen (im Fragment-Shader)

Mathematisch korrekte Reihenfolge — siehe `frontend/lightroom-light.jsx` für die konkrete GLSL-Implementierung.

```
sRGB-Eingang (Texture)
        │
        ▼
[1] sRGB → Linear        (Gamma 2.4-Approximation)
        │
        ▼
[2] Weißabgleich         (R/B-Skala für Temperatur, G/RB für Tint)
        │
        ▼
[3] Belichtung           (× 2^stops)
        │
        ▼
[4] Linear → sRGB        (für perzeptive Tonwertarbeit)
        │
        ▼
[5] Tonwertbereiche      (Lichter, Tiefen, Weiß, Schwarz via Luminanz-Masken)
        │
        ▼
[6] Kontrast             (um 0.5 in sRGB)
        │
        ▼
[7] HSL-Konvertierung
        │
        ▼
[8] Dynamik              (Sättigung-Boost mit (1−s)²-Schutz)
        │
        ▼
[9] Sättigung            (linear)
        │
        ▼
[10] HSL → sRGB
        │
        ▼
Ausgabe-Pixel
```

### Pipeline-Erweiterung später

Wenn lokale Anpassungen dazukommen, wird die Pipeline mehrstufig:

```
Texture → Pass 1 (Adjustments) → Texture A
Texture → Pass 2 (Maskenberechnung KI) → Mask-Texture
Texture A + Mask → Pass 3 (lokale Adjustments) → Texture B
Texture B → Pass 4 (finale Schärfe / Rauschen) → Display
```

Dafür: WebGL-Framebuffer-Objekte (FBOs), Ping-Pong-Rendering. Architektur-Vorschlag in Phase 5 der Roadmap.

### Performance

| Bildgröße | Single-Pass-Render | Slider-Update |
|---|---|---|
| 12 MP | < 5 ms | flüssig |
| 24 MP | 8–12 ms | flüssig |
| 50 MP | 25–40 ms | spürbar bei Drag |
| 100 MP | > 70 ms | träge |

**Strategie:** Display-Texture auf max. 2048 px breite Variante runterskalieren für Live-Vorschau. Beim Export wird die Pipeline einmalig auf der Originalauflösung gefahren.

## Slider-Verhalten (Lightroom-Pattern)

- **Klick + horizontal ziehen** auf der Spur: Wert ändern
- **Doppelklick** auf Spur oder Label: Reset auf Default
- **Hover über Wert**: zeigt Vorher/Nachher in Live-Vorschau
- **Tastatur**: ←/→ ändert um `step`, Shift+←/→ um `step × 10`
- **Numerischer Direkt-Eingabe**: Klick auf den Wert macht ihn editierbar

Alle Slider haben:
- Mittelmarkierung am Default-Wert
- Gefärbter Track-Abschnitt vom Default zum aktuellen Wert (zeigt Richtung der Abweichung)
- Tabular-Nums für saubere Wertanzeige

## Preset-Anwendung

Beim Klick auf einen Preset-Namen:

```js
const applyPreset = (preset) => {
  // Komplett ersetzen, NICHT mergen, damit der Reset auf Default-Werten konsistent ist
  setAdjustments({ ...defaultAdjustments(), ...preset.adjustments });
};
```

Optional: Animation der Slider-Bewegung über 200 ms via `requestAnimationFrame` für visuelles Feedback.

## Tastenkürzel

| Taste | Aktion |
|---|---|
| `\` | Vorher/Nachher umschalten |
| `0` | Alle Adjustments zurücksetzen |
| `Cmd/Ctrl + S` | Aktuelle Adjustments als neuen Preset speichern (Dialog) |
| `Cmd/Ctrl + E` | Export-Dialog öffnen |
| `Cmd/Ctrl + O` | Datei-Öffnen-Dialog |

## Mobile / Tablet

Für die PWA-Variante (Stretch nach MVP):
- Right-Panel wird zur Bottom-Sheet
- Slider gleich, aber breiter (Touch-freundlicher)
- Pinch-to-Zoom auf Canvas
- Vorher/Nachher per Long-Press

## Build & Deployment

```bash
npm run build         # Vite produziert /dist mit hash-getaggten Assets
```

Deployment: `dist/` per `rsync` auf den VPS, Nginx liefert statisch aus.
