-- AlterEnum
ALTER TYPE "RefType" ADD VALUE 'PRODUCTION';

-- CreateTable
CREATE TABLE "ProductionDoc" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionDocItem" (
    "id" TEXT NOT NULL,
    "productionDocId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionDocItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionDoc_tenantId_idx" ON "ProductionDoc"("tenantId");

-- CreateIndex
CREATE INDEX "ProductionDoc_locationId_idx" ON "ProductionDoc"("locationId");

-- CreateIndex
CREATE INDEX "ProductionDoc_docDate_idx" ON "ProductionDoc"("docDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionDoc_tenantId_docNo_key" ON "ProductionDoc"("tenantId", "docNo");

-- CreateIndex
CREATE INDEX "ProductionDocItem_productionDocId_idx" ON "ProductionDocItem"("productionDocId");

-- CreateIndex
CREATE INDEX "ProductionDocItem_productId_idx" ON "ProductionDocItem"("productId");

-- AddForeignKey
ALTER TABLE "ProductionDoc" ADD CONSTRAINT "ProductionDoc_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionDoc" ADD CONSTRAINT "ProductionDoc_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionDocItem" ADD CONSTRAINT "ProductionDocItem_productionDocId_fkey" FOREIGN KEY ("productionDocId") REFERENCES "ProductionDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionDocItem" ADD CONSTRAINT "ProductionDocItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
