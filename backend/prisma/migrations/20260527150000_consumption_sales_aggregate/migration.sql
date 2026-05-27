ALTER TYPE "ConsumptionDocSource" ADD VALUE IF NOT EXISTS 'SALES_AGGREGATE';

ALTER TABLE "Sale"
ADD COLUMN "consumptionBatchDocId" TEXT,
ADD COLUMN "consumptionBatchProcessedAt" TIMESTAMP(3);

ALTER TABLE "ConsumptionDoc"
ADD COLUMN "sourcePeriodStart" TIMESTAMP(3),
ADD COLUMN "sourcePeriodEnd" TIMESTAMP(3);

ALTER TABLE "Sale"
ADD CONSTRAINT "Sale_consumptionBatchDocId_fkey"
FOREIGN KEY ("consumptionBatchDocId") REFERENCES "ConsumptionDoc"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Sale_consumptionBatchDocId_idx" ON "Sale"("consumptionBatchDocId");
CREATE INDEX "Sale_consumptionBatchProcessedAt_idx" ON "Sale"("consumptionBatchProcessedAt");
