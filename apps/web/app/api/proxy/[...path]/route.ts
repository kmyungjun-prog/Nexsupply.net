/**
 * API proxy: forwards client requests to backend (NEXT_PUBLIC_API_URL).
 * Forwards method, body, query. Forwards Authorization and Idempotency-Key headers.
 * Returns backend response as-is. Avoids CORS; no backend changes required.
 */

import { NextRequest, NextResponse } from "next/server";

const BACKEND_BASE = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "";

type RouteParams = { path: string[] };

export async function GET(
  request: NextRequest,
  context: { params: RouteParams }
) {
  return proxy("GET", context.params, request);
}

export async function POST(
  request: NextRequest,
  context: { params: RouteParams }
) {
  return proxy("POST", context.params, request);
}

export async function PUT(
  request: NextRequest,
  context: { params: RouteParams }
) {
  return proxy("PUT", context.params, request);
}

async function proxy(
  method: string,
  params: RouteParams,
  request?: NextRequest
) {
  if (!BACKEND_BASE) {
    return NextResponse.json(
      { message: "NEXT_PUBLIC_API_URL not configured" },
      { status: 502 }
    );
  }
  const pathStr = Array.isArray(params.path) ? params.path.join("/") : "";
  const search = request?.nextUrl?.search ?? "";
  const url = `${BACKEND_BASE}/${pathStr}${search}`;

  const headers: Record<string, string> = {};
  const auth = request?.headers.get("authorization");
  if (auth) headers["Authorization"] = auth;
  const idem = request?.headers.get("idempotency-key");
  if (idem) headers["Idempotency-Key"] = idem;
  const contentType = request?.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;

  const init: RequestInit = {
    method,
    headers,
  };
  if (request && (method === "POST" || method === "PUT") && request.body) {
    init.body = request.body;
  }

  try {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { message: err instanceof Error ? err.message : "Proxy request failed" },
      { status: 502 }
    );
  }
}
