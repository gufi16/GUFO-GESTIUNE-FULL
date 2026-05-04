ALTER TABLE "ETransportNotice"
  ADD COLUMN IF NOT EXISTS "partnerAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "organizerAddress" TEXT;
