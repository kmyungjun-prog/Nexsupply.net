# Debug: Next.js routing and root route

## Why `src/pages` can break routing

This project uses **App Router only** (the `app/` directory). Next.js supports two routing systems:

1. **App Router** – `app/` (and optionally `src/app/`). File-based routing with `page.tsx`, `layout.tsx`, etc.
2. **Pages Router (legacy)** – `pages/` (and optionally `src/pages/`). File-based routing with `index.tsx`, `_app.tsx`, etc.

If **both** exist, Next.js can:

- Resolve the same URL from two places (e.g. `/` from `app/page.tsx` and `pages/index.tsx` or `src/pages/index.tsx`).
- Prefer one over the other depending on version and config, leading to 404s or wrong pages.
- Confuse imports (e.g. `@/` pointing at `src/` vs project root).

So **do not add or restore `src/pages`** (or a top-level `pages/` used for routing). Keep a single routing system: **App Router** under `app/`.

**Current state:** This app has no `src/pages` and no `pages/` used for routes. All routes live under `app/`. The path alias `@/*` points at the **project root** (`apps/web`), so `@/lib/auth` resolves to `apps/web/lib/auth`, not `src/lib`.

---

## Steps to clear cache and restart dev

If the root route (`/`) returns 404 or the wrong page:

1. **Stop the dev server** (Ctrl+C).

2. **Remove the Next.js build cache:**
   ```bash
   cd apps/web
   rm -rf .next
   ```
   On Windows (PowerShell):
   ```powershell
   cd apps\web
   Remove-Item -Recurse -Force .next
   ```

3. **Restart the dev server:**
   ```bash
   npm run dev
   ```

4. **Open** `http://localhost:3000` and confirm `GET /` returns 200 and the home page (NexSupply sign-in / nav).

---

## Checklist

- [ ] No `src/pages` or conflicting `pages/` used for routes.
- [ ] `@/*` in `tsconfig.json` has `baseUrl: "."` and `paths: { "@/*": ["./*"] }` so `@/` = project root.
- [ ] Root route: `app/page.tsx` exports a default React component; `app/layout.tsx` wraps children.
- [ ] No `basePath` or middleware that changes the root URL.
