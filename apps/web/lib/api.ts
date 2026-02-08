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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string })?.message ?? res.statusText);
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string })?.message ?? res.statusText);
  return data as T;
}
