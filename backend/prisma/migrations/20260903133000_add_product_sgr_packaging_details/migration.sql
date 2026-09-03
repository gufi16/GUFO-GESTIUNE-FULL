CREATE TYPE "SgrPackagingType" AS ENUM ('PET', 'METAL', 'STICLA');

ALTER TABLE "Product"
  ADD COLUMN "sgrPackagingType" "SgrPackagingType",
  ADD COLUMN "sgrVolumeLiters" DECIMAL(8,3) NOT NULL DEFAULT 0;
