ALTER TABLE "Product"
ADD COLUMN "posSortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Product_posSortOrder_idx" ON "Product"("posSortOrder");
