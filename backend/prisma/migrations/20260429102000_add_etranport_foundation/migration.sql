ALTER TABLE "Location"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "county" TEXT,
  ADD COLUMN "country" TEXT DEFAULT 'RO',
  ADD COLUMN "postalCode" TEXT;

ALTER TABLE "Product"
  ADD COLUMN "ncCode" TEXT,
  ADD COLUMN "isFiscalRiskProduct" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "grossWeightKg" DECIMAL(65,30) NOT NULL DEFAULT 0;

ALTER TABLE "TransferDoc"
  ADD COLUMN "trailerNo" TEXT,
  ADD COLUMN "eTransportCandidate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "eTransportRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "eTransportDeclaredStart" TIMESTAMP(3),
  ADD COLUMN "eTransportVehicleMaxMassKg" DECIMAL(65,30),
  ADD COLUMN "eTransportOrganizer" TEXT,
  ADD COLUMN "eTransportOperator" TEXT,
  ADD COLUMN "eTransportUit" TEXT,
  ADD COLUMN "eTransportStatus" TEXT,
  ADD COLUMN "eTransportUploadIndex" TEXT,
  ADD COLUMN "eTransportDownloadId" TEXT,
  ADD COLUMN "eTransportPreparedXml" TEXT,
  ADD COLUMN "eTransportErrorText" TEXT;
