import { Suspense } from "react";
import ReceiptsClient from "./ReceiptsClient";

export default function ReceiptsPage() {
  return (
    <Suspense fallback={<div style={{ fontSize: 12, opacity: 0.75 }}>Se încarcă…</div>}>
      <ReceiptsClient />
    </Suspense>
  );
}