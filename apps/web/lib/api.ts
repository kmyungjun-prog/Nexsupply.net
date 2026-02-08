/**
 * API helper: client always calls relative /api/proxy/... (Next API proxy forwards to NEXT_PUBLIC_API_URL).
 * Avoids CORS. get(path), post(path, body, idempotencyKey?). Authorization Bearer and Idempotency-Key forwarded.
 */

function buildUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const normalized = path.startsWith("/") ? path.slice(1) : path;
  return `/api/proxy/${normalized}`;
}

export async function get<T>(
  path: string,
  token: string | null
): Promise<T> {
  const url = buildUrl(path);
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const raw = await res.text();
  const data = (() => {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  if (!res.ok) {
    const err = data as { message?: string; error?: { message?: string } };
    const msg = err?.error?.message ?? err?.message ?? (raw && raw.length < 200 ? raw : res.statusText);
    throw new Error(msg);
  }
  return data as T;
}

export async function post<T>(
  path: string,
  body: unknown,
  token: string | null,
  idempotencyKey?: string
): Promise<T> {
  const url = buildUrl(path);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    duplex: "half",
  } as RequestInit & { duplex: string });
  const raw = await res.text();
  const data = (() => {
    try {
      return JSON.parse(raw) as { message?: string; error?: { message?: string } };
    } catch {
      return {};
    }
  })();
  if (!res.ok) {
    const msg = data?.error?.message ?? data?.message ?? (raw && raw.length < 200 ? raw : res.statusText);
    throw new Error(msg);
  }
  return data as T;
}
