"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import Loading from "./Loading";

/**
 * If role !== "admin" → redirect to /. Wrap all /admin/** pages.
 */
export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { role, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (role !== "admin") {
      router.replace("/");
    }
  }, [role, loading, router, pathname]);

  if (loading) return <Loading />;
  if (role !== "admin") return null;
  return <>{children}</>;
}
