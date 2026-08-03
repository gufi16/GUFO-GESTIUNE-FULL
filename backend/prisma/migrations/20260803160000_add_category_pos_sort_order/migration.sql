-- Add configurable POS sort order for product categories.
ALTER TABLE "Category"
ADD COLUMN "posSortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Category_tenantId_companyId_posSortOrder_idx"
ON "Category"("tenantId", "companyId", "posSortOrder");
