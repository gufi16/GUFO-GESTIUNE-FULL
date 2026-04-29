ALTER TABLE "TransferDoc"
  ADD COLUMN "eTransportOperationType" TEXT,
  ADD COLUMN "eTransportPartnerCountry" TEXT,
  ADD COLUMN "eTransportPartnerCui" TEXT,
  ADD COLUMN "eTransportPartnerName" TEXT,
  ADD COLUMN "eTransportInternalRef" TEXT,
  ADD COLUMN "eTransportStartScope" TEXT,
  ADD COLUMN "eTransportEndScope" TEXT;
