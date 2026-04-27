# Spec · Image-Storage über Garage S3

**Datum:** 2026-04-27
**Iteration:** 6
**Vorgänger:** Iteration 5 (Frontend Auth über Keycloak)

## Motivation

ADR-011 sieht Garage S3 für optionalen Image-Upload vor — User kann Bilder ins eigene Bucket-Prefix laden, von verschiedenen Geräten zugreifen. Pixel-Daten laufen *nicht* durch FastAPI, sondern direkt Browser↔Garage via Pre-Signed URLs. Das Backend speichert nur Metadaten und vermittelt Auth.

## Ziel

- Backend bietet `/api/v1/images/*` Endpoints (init, confirm, list, url, delete).
- Pre-Signed URLs (PUT für Upload, GET für Download) per Aufruf, 15 min Lebensdauer.
- Bucket-Key-Konvention `<user_id>/originals/<image_id>`, Defense-in-Depth-Check beim Issue.
- DB-Tabelle `images` mit Lifecycle (`pending → ready` / `failed`).
- Tests gegen einen lokalen MinIO-Container (S3-API-kompatibel mit Garage). Production wird Garage, lokale Entwicklung darf MinIO oder Garage sein.
- Frontend `Library`-Page mit Upload (Drag & Drop), List, Delete.

## Nicht-Ziel

- Kein Editor-Integration (lädt Bild aus Library zur Bearbeitung) — folgt in Iteration 8+.
- Kein Sharing zwischen Usern.
- Kein Multi-Image-Upload, keine Folder.
- Keine Lifecycle-Rules, kein Quota-Management — Backlog.

## Datenmodell (Soll)

```sql
CREATE TABLE images (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bucket_key        TEXT UNIQUE NOT NULL,
    original_filename TEXT NOT NULL,
    content_type      TEXT NOT NULL,
    size_bytes        BIGINT,
    upload_state      TEXT NOT NULL CHECK (upload_state IN ('pending','ready','failed')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at      TIMESTAMPTZ
);

CREATE INDEX idx_images_user_id ON images(user_id);
CREATE INDEX idx_images_state   ON images(upload_state);
```

## Endpoints

### POST /api/v1/images
Init: Image-Row anlegen, Pre-Signed PUT-URL erzeugen.
```json
// Request
{ "filename": "IMG.JPG", "content_type": "image/jpeg", "size_bytes": 4500000 }
// Response 201
{ "id": "...", "upload_url": "https://garage/...?X-Amz-Signature=...", "expires_in": 900 }
```
Fehler: 413 (>200 MB), 415 (unerlaubter content_type).

### POST /api/v1/images/{id}/confirm
Backend macht S3 HEAD, setzt `upload_state=ready`. Liefert vollständiges `ImageOut`.
Fehler: 404 (Image gehört nicht zum User), 409 (Object existiert nicht im Bucket).

### GET /api/v1/images
Listet Images des Users, Default-Filter `state=ready`, Default-Sort `-created_at`.

### GET /api/v1/images/{id}/url
Pre-Signed GET-URL für direkten Download.
```json
{ "url": "https://garage/...", "expires_in": 900 }
```

### DELETE /api/v1/images/{id}
Löscht S3-Object und DB-Row. Bei S3-Fehler: DB-Row auf `state=failed`, Re-Try-Job folgt später (Backlog).

## Settings (`app/config.py`)

```python
garage_s3_endpoint: str = "http://localhost:3900"
garage_s3_region: str = "garage"
garage_s3_bucket: str = "lumen-images"
garage_s3_access_key_id: str = ""
garage_s3_secret_access_key: str = ""
presigned_url_expires_in: int = 900
max_image_size_bytes: int = 200 * 1024 * 1024
```

## Content-Type-Whitelist

```
image/jpeg
image/png
image/tiff
image/x-canon-cr2
image/x-canon-cr3
image/x-nikon-nef
image/x-sony-arw
image/x-fuji-raf
image/x-adobe-dng
```

## Bucket-Key-Sicherheit

Der Backend-Code generiert den Key serverseitig basierend auf `user_id` und einer neuen `image_id`. Der Browser sieht den Key nie als Eingabe — er bekommt nur eine Pre-Signed URL, in der Bucket+Key bereits eingebrannt sind. Damit kann ein User nicht in den Bucket-Prefix eines anderen Users uploaden.

Defense in Depth: Beim `/confirm` und `/{id}/url` prüft das Backend, dass der gespeicherte `bucket_key` mit `<user_id>/` beginnt — falls jemals durch einen Bug ein falscher Key in die DB käme, schlägt der Aufruf fehl.

## S3-Client

`boto3` (sync) für `presign_url`, `head_object`, `delete_object`. Diese Calls sind millisekunden-schnell — kein async-Wrapper nötig. Bei Bedarf später Migration auf `aioboto3`.

`app/storage.py` (neu) kapselt:
```python
class StorageService:
    def __init__(self, settings): ...
    def init_upload(self, user_id, image_id, filename, content_type, size) -> tuple[str, str]:
        """Erzeugt bucket_key und Pre-Signed PUT-URL."""
    def confirm_upload(self, bucket_key) -> int:
        """HEAD object, gibt size_bytes zurueck. KeyError bei Nicht-Existenz."""
    def get_download_url(self, bucket_key) -> str: ...
    def delete(self, bucket_key) -> None: ...
```

## Tests

`backend/tests/test_storage.py` (Service-Unit, gegen MinIO):
- `presigned_put_url_can_actually_upload`
- `head_object_returns_size_after_upload`
- `head_object_raises_on_missing_object`
- `delete_object_removes_it`

`backend/tests/test_images_api.py` (HTTP, gegen MinIO + FastAPI):
- `test_init_returns_url_and_id`
- `test_init_too_large_returns_413`
- `test_init_unsupported_type_returns_415`
- `test_confirm_marks_ready_after_upload`
- `test_confirm_409_if_not_uploaded`
- `test_confirm_404_for_other_users_image`
- `test_list_default_returns_only_ready`
- `test_list_state_filter_pending`
- `test_get_url_returns_signed`
- `test_delete_removes_db_and_object`
- `test_user_b_cannot_get_user_a_image_url`
- `test_user_b_cannot_delete_user_a_image`
- `test_bucket_key_uses_user_prefix`

Erwartet: ~13 neue Tests, total ~39.

## Frontend

- `src/pages/Library.tsx` — Drag&Drop-Zone (z. B. via `react-dropzone` oder selbst gebaut), Liste der Images mit Filename + Größe + Datum, Klick öffnet Original-URL, Delete-Button mit Confirm.
- `src/api/client.ts` erweitern: `listImages`, `initUpload`, `confirmUpload`, `getImageUrl`, `deleteImage`.
- `src/api/upload.ts` — Helfer: `uploadImage(file, api)` macht den ganzen Flow: init → PUT direkt zur Pre-Signed URL → confirm.
- Header: neuen Link "Library" hinzufügen.
- Library ist `RequireAuth`-geschützt.
- Tests: `library.test.tsx` (Liste rendert), `upload.test.ts` (Upload-Flow mit Mock-fetch).

## Akzeptanzkriterien

1. Backend: ~13 neue Tests grün, Suite total ≥ 39 grün.
2. Frontend: Library-Page mit Upload + List + Delete, mind. 4 neue Tests grün.
3. tsc + ESLint + Build: 0 Errors.
4. Pre-Signed URL funktioniert end-to-end gegen MinIO im Test (`presigned_put_url_can_actually_upload`).
5. Tenant-Isolation explizit getestet: User B kann nicht GET-URL/DELETE auf User A's Image.
6. Bucket-Key folgt der `<user_id>/originals/<image_id>`-Konvention (Test).

## Risiken

- **boto3 in async-FastAPI:** sync-Calls in async-Endpoints — bei wenigen Calls pro Request OK; bei Last evtl. `run_in_threadpool`. Für It 6 reicht der direkte Aufruf.
- **MinIO vs. Garage:** beide implementieren S3-API-Standard, sollten kompatibel sein. Wenn ein Edge-Case in Garage anders ist (Pre-Signed-URL-Format z. B.), würde sich das in Iteration 7 (Production) zeigen — Re-Test mit echtem Garage.
- **CORS auf dem Bucket:** Browser-PUT braucht CORS auf dem Bucket. MinIO/Garage-CORS-Config ist Teil von Iteration 7 (Production-Init-Script). Tests im Backend gehen über boto3 (kein CORS-Issue).
