# Launch checklist – NexSupply web (production ready)

This document covers environment variables, run instructions, and manual test steps for Client and Admin flows. Use it before deploying to Vercel.

---

## 1. Environment variables

Set these in Vercel (or `.env.local` for local dev). **Do not** expose service account keys to the client.

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Yes | Firebase Web API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes | Firebase Auth domain (e.g. `your-project.firebaseapp.com`) |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Yes | Firebase project ID |
| `NEXT_PUBLIC_API_URL` | Yes | Backend base URL (e.g. `https://api.your-domain.com`). Used by the Next API proxy only (server-side). |

- Client never calls the backend directly; all API calls go to `/api/proxy/...`, which the server forwards to `NEXT_PUBLIC_API_URL`. This avoids CORS.
- Firebase is client-only (guarded with `typeof window`); AuthProvider wraps the app and does not break SSR.

---

## 2. Run dev and build

From repo root or `apps/web`:

```bash
# Install (if needed)
npm install

# Development
npm run dev
# Open http://localhost:3000

# Production build
npm run build

# Start production server (after build)
npm run start
```

- Ensure **backend** is running and reachable at `NEXT_PUBLIC_API_URL` when testing.
- `npm run build` must pass with no TypeScript errors.

---

## 3. Manual test – Client flow

1. **Sign in**
   - Open app, sign in with Google.
   - Confirm you are logged in (no redirect loop, no SSR errors).

2. **Photo upload**
   - Go to Upload (or `/upload`).
   - Select an image (JPEG/PNG/GIF/WebP, max 25 MB).
   - Click **Analyze product**.
   - Confirm states: **Preparing…** → **Uploading…** → **Analyzing…**.
   - On success, you are redirected to `/report/[projectId]`.
   - On error, a clear error message is shown (no stub).

3. **Report page (H-report)**
   - Confirm **Project ID** and **Status** are shown.
   - Confirm **Product category** and **Estimated margin** come from real data (or “Still analyzing” with **Refresh** if pending).
   - Confirm disclaimer text is visible.
   - Click **Refresh**; no automatic polling.

4. **Blueprint request**
   - From report, go to **Request Blueprint**.
   - Optionally fill: quantity, target price, lead time, special requirements.
   - Click **Start Blueprint Analysis**.
   - Confirm success message only (no redirect required).
   - Confirm no error; backend should transition to WAITING_PAYMENT (and optional USER_PROVIDED claims stored).

5. **User evidence upload**
   - On report page, scroll to **Evidence documents**.
   - Select a PDF or image (allowed types, max 25 MB).
   - Confirm states: **Preparing…** → **Uploading…** → **Registering…**.
   - After upload, evidence list refreshes and shows: filename, MIME type, created time, virus_scan_status.
   - No delete or edit buttons.

---

## 4. Manual test – Admin flow

1. **Sign in as admin**
   - Use an account with Firebase custom claim `role: "admin"`.
   - Go to admin list (e.g. `/admin`), then open a project.

2. **Admin project page**
   - Confirm project header, factory candidates, execution plan, approval section, evidence section, Phase-G mark sent, Phase-H eligibility.

3. **Evidence section**
   - **List:** evidence_id, filename, mime, size, created_at, uploader, virus_scan_status, **Open**.
   - **Open:** if no `download_url` in list, call signed-url endpoint and open returned URL in new tab. Errors shown on page.
   - **Upload:** choose file → initiate → PUT to upload_url → complete. After success, list refreshes.

4. **Phase-G Mark as Sent**
   - For each execution step, a checklist of evidence items is shown.
   - Select at least one evidence to enable **Mark as Sent**.
   - Click **Mark as Sent** (irreversible warning shown).
   - Confirm Idempotency-Key is sent; after success, blueprint review and evidence list reload.
   - If already recorded, info message and button disabled.

5. **Phase-H trigger and display**
   - After a successful Phase-G mark sent, Phase-H is triggered automatically (or run manually if endpoint exists).
   - **Automation Eligibility** section shows: **eligible** (true/false), **reasons**, **blocked_by**, **evaluated_at**.
   - If no result yet, message: complete at least one Phase-G to trigger evaluation.

---

## 5. cURL examples (evidence and Phase-H)

Use these against the **backend** at `NEXT_PUBLIC_API_URL` (or via proxy with same path). Replace `API_BASE`, `TOKEN`, `PROJECT_ID`, `EVIDENCE_ID`, `STEP` as needed.

**List evidence (admin/internal):**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/internal/projects/PROJECT_ID/evidence"
```

**Initiate evidence upload (internal):**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"original_filename":"doc.pdf","mime_type":"application/pdf","size_bytes":1024}' \
  "$API_BASE/internal/projects/PROJECT_ID/evidence/initiate"
```

**Complete evidence upload (Idempotency-Key required):**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: evidence-complete:PROJECT_ID:GCS_PATH" \
  -d '{"gcs_path":"projects/PROJECT_ID/evidence/...","original_filename":"doc.pdf","mime_type":"application/pdf","size_bytes":1024}' \
  "$API_BASE/internal/projects/PROJECT_ID/evidence/complete"
```

**Get signed download URL (Open evidence):**

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_BASE/internal/projects/PROJECT_ID/evidence/EVIDENCE_ID/signed-url"
```

**Mark as sent (Phase-G, Idempotency-Key required):**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: mark-sent:PROJECT_ID:STEP:UNIQUE" \
  -d '{"step":"STEP","evidence_ids":["EVIDENCE_UUID_1","EVIDENCE_UUID_2"]}' \
  "$API_BASE/internal/projects/PROJECT_ID/mark-sent"
```

**Run Phase-H (automation eligibility):**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: run-phase-h:PROJECT_ID:YYYY-MM-DD" \
  -d '{}' \
  "$API_BASE/internal/projects/PROJECT_ID/run-phase-h"
```

Response: `ok` (boolean), `eligible` (boolean, optional). Blueprint-review includes `claims.automation_eligibility` with latest `eligible`, `reasons`, `blocked_by`, `evaluated_at`.

---

## 6. Hard rules (reminder)

- No stubs for uploads or report data.
- No edit or delete; append-only writes.
- No optimistic UI.
- All irreversible actions show warning text.
- All write actions include Idempotency-Key.
- Admin pages require role admin (Firebase custom claim).
- Public evidence upload/list: project owner only.

---

## 7. Deploy to Vercel

1. Connect repo; set env vars in Vercel dashboard.
2. Build command: `npm run build` (from `apps/web` or monorepo root as configured).
3. Output: Next.js default (e.g. `.next`).
4. Ensure `NEXT_PUBLIC_API_URL` points to your live backend; the proxy will forward all client API calls there.
