ALTER TABLE "VatRate"
ADD COLUMN "fiscalCode" VARCHAR(1);

UPDATE "VatRate"
SET "fiscalCode" = CASE
  WHEN "rate" = 19 THEN 'A'
  WHEN "rate" = 9 THEN 'B'
  WHEN "rate" = 5 THEN 'C'
  WHEN "rate" = 0 THEN 'D'
  ELSE NULL
END
WHERE "fiscalCode" IS NULL;

CREATE UNIQUE INDEX "VatRate_tenantId_fiscalCode_key" ON "VatRate"("tenantId", "fiscalCode");
