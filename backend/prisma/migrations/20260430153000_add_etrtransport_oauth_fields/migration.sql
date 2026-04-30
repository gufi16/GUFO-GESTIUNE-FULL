ALTER TABLE "Company"
  ADD COLUMN IF NOT EXISTS "etrtransportOauthClientId" TEXT,
  ADD COLUMN IF NOT EXISTS "etrtransportOauthClientSecret" TEXT,
  ADD COLUMN IF NOT EXISTS "etrtransportOauthRedirectUri" TEXT,
  ADD COLUMN IF NOT EXISTS "etrtransportOauthAccessToken" TEXT,
  ADD COLUMN IF NOT EXISTS "etrtransportOauthRefreshToken" TEXT,
  ADD COLUMN IF NOT EXISTS "etrtransportOauthAccessTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "etrtransportOauthRefreshTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "etrtransportOauthConnectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "etrtransportOauthLastError" TEXT;
