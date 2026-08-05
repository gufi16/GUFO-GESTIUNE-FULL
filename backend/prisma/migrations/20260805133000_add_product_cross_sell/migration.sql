CREATE TABLE "ProductCrossSell" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceProductId" TEXT NOT NULL,
    "targetProductId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCrossSell_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductCrossSell_sourceProductId_targetProductId_key" ON "ProductCrossSell"("sourceProductId", "targetProductId");
CREATE INDEX "ProductCrossSell_tenantId_idx" ON "ProductCrossSell"("tenantId");
CREATE INDEX "ProductCrossSell_sourceProductId_sortOrder_idx" ON "ProductCrossSell"("sourceProductId", "sortOrder");
CREATE INDEX "ProductCrossSell_targetProductId_idx" ON "ProductCrossSell"("targetProductId");

ALTER TABLE "ProductCrossSell"
ADD CONSTRAINT "ProductCrossSell_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductCrossSell"
ADD CONSTRAINT "ProductCrossSell_sourceProductId_fkey"
FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductCrossSell"
ADD CONSTRAINT "ProductCrossSell_targetProductId_fkey"
FOREIGN KEY ("targetProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
