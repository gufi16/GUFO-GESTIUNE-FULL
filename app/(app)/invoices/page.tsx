import { Suspense } from "react";
import InvoicesClient from "./InvoicesClient";

export default function InvoicesPage() {
  return (
    <Suspense fallback={<div style={{ fontSize: 12, opacity: 0.75 }}>Se încarcă…</div>}>
      <InvoicesClient />
    </Suspense>
  );
}