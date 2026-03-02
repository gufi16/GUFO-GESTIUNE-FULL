import { Suspense } from "react";
import PartnersClient from "./PartnersClient";

export default function PartnersPage() {
  return (
    <Suspense fallback={<div style={{ fontSize: 12, opacity: 0.75 }}>Se încarcă…</div>}>
      <PartnersClient />
    </Suspense>
  );
}