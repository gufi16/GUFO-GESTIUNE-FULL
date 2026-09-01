ALTER TABLE "DeliveryCustomerPaymentMethod"
ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT '';

ALTER TABLE "DeliveryCardVerificationAttempt"
ADD COLUMN "integrationId" TEXT NOT NULL DEFAULT '';

DROP INDEX "DeliveryCustomerPaymentMethod_customerId_provider_cardUniqueReference_key";

CREATE UNIQUE INDEX "DeliveryCustomerPaymentMethod_customerId_provider_integrationId_cardUniqueReference_key"
ON "DeliveryCustomerPaymentMethod"("customerId", "provider", "integrationId", "cardUniqueReference");

CREATE INDEX "DeliveryCustomerPaymentMethod_customerId_integrationId_isActive_idx"
ON "DeliveryCustomerPaymentMethod"("customerId", "integrationId", "isActive");

CREATE INDEX "DeliveryCardVerificationAttempt_customerId_integrationId_idx"
ON "DeliveryCardVerificationAttempt"("customerId", "integrationId");
