ALTER TABLE "ConsumptionDoc"
ADD COLUMN "aggregateParentId" TEXT;

ALTER TABLE "ConsumptionDoc"
ADD CONSTRAINT "ConsumptionDoc_aggregateParentId_fkey"
FOREIGN KEY ("aggregateParentId") REFERENCES "ConsumptionDoc"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ConsumptionDoc_aggregateParentId_idx" ON "ConsumptionDoc"("aggregateParentId");
