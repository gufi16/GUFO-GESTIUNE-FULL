CREATE TABLE "TenantBackup" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT,
  "createdByUserId" TEXT,
  "label" TEXT,
  "fileName" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
  "tableCounts" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TenantBackup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TenantBackup_tenantId_createdAt_idx" ON "TenantBackup"("tenantId", "createdAt");
CREATE INDEX "TenantBackup_companyId_idx" ON "TenantBackup"("companyId");

ALTER TABLE "TenantBackup"
ADD CONSTRAINT "TenantBackup_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
