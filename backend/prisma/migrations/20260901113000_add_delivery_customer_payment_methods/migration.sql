CREATE TABLE "DeliveryCustomerPaymentMethod" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "cardUniqueReference" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "brand" TEXT,
    "maskedPan" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryCustomerPaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryCustomerPaymentMethod_customerId_provider_cardUniqueReference_key"
ON "DeliveryCustomerPaymentMethod"("customerId", "provider", "cardUniqueReference");

CREATE INDEX "DeliveryCustomerPaymentMethod_customerId_isDefault_idx"
ON "DeliveryCustomerPaymentMethod"("customerId", "isDefault");

ALTER TABLE "DeliveryCustomerPaymentMethod"
ADD CONSTRAINT "DeliveryCustomerPaymentMethod_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "DeliveryCustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
