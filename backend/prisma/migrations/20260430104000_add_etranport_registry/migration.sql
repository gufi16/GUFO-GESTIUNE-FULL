CREATE TABLE "ETransportNotice" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT,
  "noticeNo" TEXT NOT NULL,
  "sourceType" TEXT,
  "sourceId" TEXT,
  "sourceDocNo" TEXT,
  "operationType" TEXT,
  "partnerCountry" TEXT,
  "partnerCui" TEXT,
  "partnerName" TEXT,
  "internalRef" TEXT,
  "startScope" TEXT,
  "endScope" TEXT,
  "startAddress" TEXT,
  "endAddress" TEXT,
  "startBorderPoint" TEXT,
  "endBorderPoint" TEXT,
  "candidate" BOOLEAN NOT NULL DEFAULT false,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "declaredStart" TIMESTAMP(3),
  "vehicleNo" TEXT,
  "trailerNo" TEXT,
  "vehicleMaxMassKg" DECIMAL(18,3),
  "organizerCountry" TEXT,
  "organizerCode" TEXT,
  "organizerName" TEXT,
  "operatorName" TEXT,
  "uit" TEXT,
  "status" TEXT,
  "uploadIndex" TEXT,
  "downloadId" TEXT,
  "preparedXml" TEXT,
  "errorText" TEXT,
  "totalGrossWeightKg" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "totalValueRon" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ETransportNotice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ETransportNoticeItem" (
  "id" TEXT NOT NULL,
  "noticeId" TEXT NOT NULL,
  "productId" TEXT,
  "sourceItemId" TEXT,
  "lineNo" INTEGER NOT NULL DEFAULT 1,
  "sku" TEXT,
  "name" TEXT NOT NULL,
  "ncCode" TEXT,
  "fiscalRisk" BOOLEAN NOT NULL DEFAULT false,
  "uomCode" TEXT,
  "qty" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "unitPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "lineValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "grossWeightPerUnitKg" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "grossWeightTotalKg" DECIMAL(18,3) NOT NULL DEFAULT 0,
  "internalReference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ETransportNoticeItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ETransportNotice_tenantId_companyId_noticeNo_key"
ON "ETransportNotice"("tenantId", "companyId", "noticeNo");

CREATE INDEX "ETransportNotice_tenantId_idx" ON "ETransportNotice"("tenantId");
CREATE INDEX "ETransportNotice_tenantId_companyId_idx" ON "ETransportNotice"("tenantId", "companyId");
CREATE INDEX "ETransportNotice_companyId_idx" ON "ETransportNotice"("companyId");
CREATE INDEX "ETransportNotice_sourceType_sourceId_idx" ON "ETransportNotice"("sourceType", "sourceId");
CREATE INDEX "ETransportNotice_status_idx" ON "ETransportNotice"("status");
CREATE INDEX "ETransportNotice_declaredStart_idx" ON "ETransportNotice"("declaredStart");

CREATE INDEX "ETransportNoticeItem_noticeId_idx" ON "ETransportNoticeItem"("noticeId");
CREATE INDEX "ETransportNoticeItem_productId_idx" ON "ETransportNoticeItem"("productId");
CREATE INDEX "ETransportNoticeItem_sourceItemId_idx" ON "ETransportNoticeItem"("sourceItemId");

ALTER TABLE "ETransportNotice"
ADD CONSTRAINT "ETransportNotice_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ETransportNotice"
ADD CONSTRAINT "ETransportNotice_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ETransportNoticeItem"
ADD CONSTRAINT "ETransportNoticeItem_noticeId_fkey"
FOREIGN KEY ("noticeId") REFERENCES "ETransportNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ETransportNoticeItem"
ADD CONSTRAINT "ETransportNoticeItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
