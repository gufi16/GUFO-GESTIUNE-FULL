ALTER TABLE "TransferDoc"
  ADD COLUMN IF NOT EXISTS "eTransportTransportDocType" TEXT,
  ADD COLUMN IF NOT EXISTS "eTransportTransportDocNo" TEXT,
  ADD COLUMN IF NOT EXISTS "eTransportTransportDocDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "eTransportTransportDocNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "eTransportExtraInfo" TEXT;

ALTER TABLE "ETransportNotice"
  ADD COLUMN IF NOT EXISTS "transportDocType" TEXT,
  ADD COLUMN IF NOT EXISTS "transportDocNo" TEXT,
  ADD COLUMN IF NOT EXISTS "transportDocDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "transportDocNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "extraInfo" TEXT;
