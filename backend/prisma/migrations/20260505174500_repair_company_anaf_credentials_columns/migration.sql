ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "label" TEXT;
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "certSerial" TEXT;
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "certPasswordEnc" TEXT;
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "certFilename" TEXT;
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "certUploadedAt" TIMESTAMP(3);

ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "efacturaOauthAccessToken" TEXT;
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "efacturaOauthRefreshToken" TEXT;
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "efacturaOauthAccessTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "efacturaOauthRefreshTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "efacturaOauthConnectedAt" TIMESTAMP(3);
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "efacturaOauthLastError" TEXT;

ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "etrtransportOauthAccessToken" TEXT;
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "etrtransportOauthRefreshToken" TEXT;
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "etrtransportOauthAccessTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "etrtransportOauthRefreshTokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "etrtransportOauthConnectedAt" TIMESTAMP(3);
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "etrtransportOauthLastError" TEXT;

ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "CompanyAnafCredential" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "CompanyAnafCredential_tenantId_companyId_idx"
  ON "CompanyAnafCredential"("tenantId", "companyId");

CREATE INDEX IF NOT EXISTS "CompanyAnafCredential_companyId_isDefault_idx"
  ON "CompanyAnafCredential"("companyId", "isDefault");
