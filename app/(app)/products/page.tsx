import { Suspense } from "react";
import ProductsClient from "./ProductsClient";

export default function ProductsPage() {
  return (
    <Suspense fallback={<div style={{ fontSize: 12, opacity: 0.75 }}>Se încarcă…</div>}>
      <ProductsClient />
    </Suspense>
  );
}