ALTER TABLE "Uom"
ADD COLUMN "standardCode" TEXT;

ALTER TABLE "SalesInvoiceItem"
ADD COLUMN "uomStandardCode" TEXT;
