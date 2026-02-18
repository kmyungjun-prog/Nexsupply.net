"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

/** Blueprint-request page is no longer used; redirect to home. */
export default function BlueprintRequestPage() {
  const router = useRouter();
  const { loading } = useAuth();
  const params = useParams();

  useEffect(() => {
    if (loading) return;
    router.replace("/");
  }, [loading, router]);

  if (params?.projectId) {
    return (
      <div className="container">
        <p className="text-muted">Redirecting…</p>
      </div>
    );
  }
  return null;
}
