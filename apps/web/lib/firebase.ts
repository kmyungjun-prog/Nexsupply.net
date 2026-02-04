/**
 * Firebase client-only setup. No server SDK.
 * Only initializes in browser to avoid SSR break (getApps/initializeApp are client-only).
 */

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

function getApp(): FirebaseApp | null {
  if (typeof window === "undefined") return null;
  if (!config.apiKey || !config.authDomain || !config.projectId) return null;
  if (getApps().length > 0) return getApps()[0] as FirebaseApp;
  return initializeApp(config);
}

export function getFirebaseAuth(): Auth | null {
  const app = getApp();
  return app ? getAuth(app) : null;
}
