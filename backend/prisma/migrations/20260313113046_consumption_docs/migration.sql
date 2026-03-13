-- AlterEnum
ALTER TYPE "RefType" ADD VALUE 'CONSUMPTION';

-- CreateTable
CREATE TABLE "ConsumptionDoc" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "saleId" TEXT,
    "docNo" TEXT NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsumptionDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumptionDocItem" (
    "id" TEXT NOT NULL,
    "consumptionDocId" TEXT NOT NULL,
    "finishedProductId" TEXT,
    "ingredientId" TEXT NOT NULL,
    "qty" DECIMAL(65,30) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsumptionDocItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsumptionDoc_tenantId_idx" ON "ConsumptionDoc"("tenantId");

-- CreateIndex
CREATE INDEX "ConsumptionDoc_locationId_idx" ON "ConsumptionDoc"("locationId");

-- CreateIndex
CREATE INDEX "ConsumptionDoc_saleId_idx" ON "ConsumptionDoc"("saleId");

-- CreateIndex
CREATE INDEX "ConsumptionDoc_docDate_idx" ON "ConsumptionDoc"("docDate");

-- CreateIndex
CREATE UNIQUE INDEX "ConsumptionDoc_tenantId_docNo_key" ON "ConsumptionDoc"("tenantId", "docNo");

-- CreateIndex
CREATE INDEX "ConsumptionDocItem_consumptionDocId_idx" ON "ConsumptionDocItem"("consumptionDocId");

-- CreateIndex
CREATE INDEX "ConsumptionDocItem_finishedProductId_idx" ON "ConsumptionDocItem"("finishedProductId");

-- CreateIndex
CREATE INDEX "ConsumptionDocItem_ingredientId_idx" ON "ConsumptionDocItem"("ingredientId");

-- AddForeignKey
ALTER TABLE "ConsumptionDoc" ADD CONSTRAINT "ConsumptionDoc_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionDoc" ADD CONSTRAINT "ConsumptionDoc_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionDoc" ADD CONSTRAINT "ConsumptionDoc_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionDocItem" ADD CONSTRAINT "ConsumptionDocItem_consumptionDocId_fkey" FOREIGN KEY ("consumptionDocId") REFERENCES "ConsumptionDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionDocItem" ADD CONSTRAINT "ConsumptionDocItem_finishedProductId_fkey" FOREIGN KEY ("finishedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionDocItem" ADD CONSTRAINT "ConsumptionDocItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
