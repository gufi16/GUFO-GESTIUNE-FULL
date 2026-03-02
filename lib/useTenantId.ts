"use client";

import { useSearchParams } from "next/navigation";

export function useTenantId(): string {
  const searchParams = useSearchParams();
  return searchParams.get("tenantId") || "";
}