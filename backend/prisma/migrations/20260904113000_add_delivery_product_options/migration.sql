CREATE TYPE "DeliveryOptionSelectionMode" AS ENUM ('SINGLE', 'MULTIPLE');

CREATE TABLE "DeliveryOptionGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "selectionMode" "DeliveryOptionSelectionMode" NOT NULL DEFAULT 'MULTIPLE',
    "minSelections" INTEGER NOT NULL DEFAULT 0,
    "maxSelections" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryOptionGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryProductOptionGroup" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryProductOptionGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryOptionGroupItem" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceAdjustment" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryOptionGroupItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryProductOptionGroup_productId_groupId_key" ON "DeliveryProductOptionGroup"("productId", "groupId");
CREATE UNIQUE INDEX "DeliveryOptionGroupItem_groupId_productId_key" ON "DeliveryOptionGroupItem"("groupId", "productId");
CREATE INDEX "DeliveryOptionGroup_tenantId_companyId_idx" ON "DeliveryOptionGroup"("tenantId", "companyId");
CREATE INDEX "DeliveryOptionGroup_tenantId_isActive_sortOrder_idx" ON "DeliveryOptionGroup"("tenantId", "isActive", "sortOrder");
CREATE INDEX "DeliveryProductOptionGroup_productId_sortOrder_idx" ON "DeliveryProductOptionGroup"("productId", "sortOrder");
CREATE INDEX "DeliveryProductOptionGroup_groupId_sortOrder_idx" ON "DeliveryProductOptionGroup"("groupId", "sortOrder");
CREATE INDEX "DeliveryOptionGroupItem_groupId_sortOrder_idx" ON "DeliveryOptionGroupItem"("groupId", "sortOrder");
CREATE INDEX "DeliveryOptionGroupItem_productId_idx" ON "DeliveryOptionGroupItem"("productId");

ALTER TABLE "DeliveryProductOptionGroup" ADD CONSTRAINT "DeliveryProductOptionGroup_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryProductOptionGroup" ADD CONSTRAINT "DeliveryProductOptionGroup_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "DeliveryOptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryOptionGroupItem" ADD CONSTRAINT "DeliveryOptionGroupItem_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "DeliveryOptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryOptionGroupItem" ADD CONSTRAINT "DeliveryOptionGroupItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
