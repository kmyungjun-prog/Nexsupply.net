import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import admin from "firebase-admin";
import { AppError } from "./errors.js";

export type Role = "user" | "auditor" | "admin" | "system";

export type AuthContext = {
  uid: string;
  role: Role;
  token: admin.auth.DecodedIdToken;
};

function initFirebaseAdminOnce() {
  if (admin.apps.length > 0) return;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountJson && typeof serviceAccountJson === "string") {
    try {
      const sa = JSON.parse(serviceAccountJson) as Record<string, unknown> & { project_id?: string };
      admin.initializeApp({
        projectId: (sa.project_id as string) ?? process.env.FIREBASE_PROJECT_ID,
        credential: admin.credential.cert(sa as admin.ServiceAccount),
      });
      return;
    } catch (e) {
      console.warn("FIREBASE_SERVICE_ACCOUNT_KEY parse failed, falling back to ADC:", e);
    }
  }

  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.GCP_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT,
    credential: admin.credential.applicationDefault(),
  });
}

function coerceRole(x: unknown): Role {
  if (x === "user" || x === "auditor" || x === "admin" || x === "system") return x;
  return "user";
}

export async function authenticate(req: FastifyRequest, _reply: FastifyReply) {
  initFirebaseAdminOnce();

  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    throw new AppError({ statusCode: 401, code: "UNAUTHORIZED", message: "Missing Authorization: Bearer <token>" });
  }

  let decoded: admin.auth.DecodedIdToken;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch (err) {
    req.log.warn({ err }, "Firebase ID token verification failed");
    throw new AppError({ statusCode: 401, code: "UNAUTHORIZED", message: "Invalid or expired token" });
  }

  const role = coerceRole((decoded as any).role ?? (decoded as any).claims?.role);
  req.auth = { uid: decoded.uid, role, token: decoded };
}

export function requireRole(minRole: Role | Role[]) {
  const allowed = new Set(Array.isArray(minRole) ? minRole : [minRole]);
  return async (req: FastifyRequest) => {
    if (!req.auth) throw new AppError({ statusCode: 401, code: "UNAUTHORIZED", message: "Not authenticated" });
    if (!allowed.has(req.auth.role)) {
      throw new AppError({ statusCode: 403, code: "FORBIDDEN", message: "Insufficient role" });
    }
  };
}

export async function registerAuth(fastify: FastifyInstance) {
  // Fastify 타입 확장: req.auth
  fastify.decorateRequest("auth", undefined);
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

