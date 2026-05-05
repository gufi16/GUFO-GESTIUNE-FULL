CREATE TABLE "CompanyAnafCredential" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "certSerial" TEXT,
  "certPasswordEnc" TEXT,
  "certFilename" TEXT,
  "certUploadedAt" TIMESTAMP(3),
  "efacturaOauthAccessToken" TEXT,
  "efacturaOauthRefreshToken" TEXT,
  "efacturaOauthAccessTokenExpiresAt" TIMESTAMP(3),
  "efacturaOauthRefreshTokenExpiresAt" TIMESTAMP(3),
  "efacturaOauthConnectedAt" TIMESTAMP(3),
  "efacturaOauthLastError" TEXT,
  "etrtransportOauthAccessToken" TEXT,
  "etrtransportOauthRefreshToken" TEXT,
  "etrtransportOauthAccessTokenExpiresAt" TIMESTAMP(3),
  "etrtransportOauthRefreshTokenExpiresAt" TIMESTAMP(3),
  "etrtransportOauthConnectedAt" TIMESTAMP(3),
  "etrtransportOauthLastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyAnafCredential_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompanyAnafCredential_tenantId_companyId_idx"
  ON "CompanyAnafCredential"("tenantId", "companyId");

CREATE INDEX "CompanyAnafCredential_companyId_isDefault_idx"
  ON "CompanyAnafCredential"("companyId", "isDefault");

ALTER TABLE "CompanyAnafCredential"
  ADD CONSTRAINT "CompanyAnafCredential_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CompanyAnafCredential"
  ADD CONSTRAINT "CompanyAnafCredential_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
