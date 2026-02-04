# Evidence flow – backend endpoints (SOW v1.3)

Source of truth: **NexSupply_SOW_v1.3_Final.pdf**. This doc describes evidence upload, signed URL policy, and Auditor Desk behavior.

## Endpoints used (admin/system only)

All evidence APIs are **internal**. Auth: `Authorization: Bearer <Firebase ID token>`. Base URL: `NEXT_PUBLIC_API_URL`.

| Purpose | Method | Path |
|--------|--------|------|
| List evidence for project | GET | `/internal/projects/:id/evidence` |
| Get signed upload URL | POST | `/internal/projects/:id/evidence/initiate` |
| Register after upload | POST | `/internal/projects/:id/evidence/complete` |
| Get short-lived download URL (Auditor Desk document viewer) | GET | `/internal/projects/:id/evidence/:evidenceId/signed-url` |
| Mark step as sent with evidence | POST | `/internal/projects/:id/mark-sent` |
| Run Phase-H (automation eligibility) | POST | `/internal/projects/:id/run-phase-h` |

- **Signed URL expiry (SOW):** 10–15 minutes. Upload: 15 min. Download: 10 min.
- **Idempotency:** Use `Idempotency-Key` header for `mark-sent` and `evidence/complete` (irreversible actions).
- **Upload flow:** `initiate` → browser `PUT` to `upload_url` with `upload_headers` → `complete` with `gcs_path` and metadata. Append-only; no update or delete.

---

## Upload policy (SOW: file type, size, integrity)

- **Allowed MIME types:** `application/pdf`, `image/jpeg`, `image/png`, `image/gif`, `image/webp`.
- **Max file size:** 25 MB. Enforced on `initiate` and `complete`.
- **Filename sanitization:** Basename only; non-alphanumeric (except `._-`) replaced with `_`; max 200 chars.
- **evidence_files metadata:** `original_filename`, `mime_type`, `size_bytes`, `sha256`, `virus_scan_status` (stored; default PENDING). No edit or delete.

---

## GCS bucket CORS (browser PUT from frontend)

For **browser PUT** from the Next.js app (localhost and Vercel) to the signed upload URL, the GCS bucket must allow CORS.

Example **cors.json** (use with `gsutil cors set cors.json gs://YOUR_BUCKET`):

```json
[
  {
    "origin": ["http://localhost:3000", "https://*.vercel.app"],
    "method": ["GET", "HEAD", "PUT"],
    "responseHeader": ["Content-Type", "Content-Length", "Content-Disposition"],
    "maxAgeSeconds": 3600
  }
]
```

- Replace or extend `origin` with your actual frontend origins (e.g. `https://your-app.vercel.app`).
- `PUT` is required for direct upload; `GET`/`HEAD` for optional health checks.

---

## cURL examples

Assume `API_BASE=https://your-api.example.com` and `TOKEN=<Firebase ID token>`.

### 1. List evidence

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/internal/projects/PROJECT_ID/evidence"
```

### 2. Initiate upload (get signed URL)

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"original_filename":"doc.pdf","mime_type":"application/pdf","size_bytes":1024}' \
  "$API_BASE/internal/projects/PROJECT_ID/evidence/initiate"
```

Response: `upload_url`, `upload_headers` (e.g. `{"Content-Type":"application/pdf"}`), `gcs_path`, `upload_expires_at`.

### 3. Upload file (PUT to signed URL)

Use the `upload_url` and `upload_headers` from step 2. The browser (or curl) must send the **same** `Content-Type` as in `upload_headers`.

```bash
# Example: upload a local file
curl -s -X PUT -H "Content-Type: application/pdf" \
  --data-binary @doc.pdf \
  "SIGNED_UPLOAD_URL_FROM_INITIATE"
```

### 4. Complete upload (register evidence_files row)

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: evidence-complete:PROJECT_ID:GCS_PATH_FROM_INITIATE" \
  -d '{
    "gcs_path": "projects/PROJECT_ID/evidence/abc123_doc.pdf",
    "original_filename": "doc.pdf",
    "mime_type": "application/pdf",
    "size_bytes": 1024
  }' \
  "$API_BASE/internal/projects/PROJECT_ID/evidence/complete"
```

Response: `evidence_id`, `gcs_path`.

### 5. Get download signed URL (Auditor Desk document viewer)

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/internal/projects/PROJECT_ID/evidence/EVIDENCE_ID/signed-url"
```

Response: `url` (short-lived, e.g. 10 min), `expires_at`. Open `url` in browser to view/download.

### 6. Mark as sent (Phase-G)

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: mark-sent:PROJECT_ID:STEP:UNIQUE" \
  -d '{"step":"step-id","evidence_ids":["EVIDENCE_UUID_1","EVIDENCE_UUID_2"]}' \
  "$API_BASE/internal/projects/PROJECT_ID/mark-sent"
```

### 7. Run Phase-H (automation eligibility)

Admin/system only. Idempotent; append-only `automation_eligibility` claim. Run after at least one Phase-G mark-sent.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: run-phase-h:PROJECT_ID:YYYY-MM-DD" \
  -d '{}' \
  "$API_BASE/internal/projects/PROJECT_ID/run-phase-h"
```

Response: `ok` (boolean), `eligible` (boolean, optional). Blueprint-review includes `claims.automation_eligibility` (latest: `eligible`, `reasons`, `blocked_by`, `evaluated_at`).

---

## User-side evidence upload

The **user dashboard** (report / blueprint-request) may need document upload capability (SOW: “문서 업로드”). Currently only **admin** evidence upload exists (`/internal/.../evidence/initiate` and `.../complete`). If user-side upload is required later, add a **public** (or project-owner–scoped) endpoint set (e.g. `POST /projects/:id/evidence/initiate` and `.../complete`) and wire the report page stub to it. No such endpoint exists today; the report page shows a disabled stub and a note.

---

## Summary

- **Backend:** GCS v4 signed URLs, content-type and short expiry; evidence list includes `virus_scan_status`; upload policy (mime, size) and filename sanitization enforced; download signed URL via `GET .../evidence/:evidenceId/signed-url`. Append-only; no delete/update.
- **Frontend:** Admin project page lists evidence, allows upload (initiate → PUT → complete), refresh after upload; Open uses signed-url endpoint; irreversible actions labeled; idempotency keys sent where required.
- **Operational:** Configure GCS CORS for browser PUT from your frontend origins; respect max file size and allowed MIME types in client UX.
