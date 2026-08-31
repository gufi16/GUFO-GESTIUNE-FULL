CREATE TYPE "DeliveryPaymentAttemptStatus" AS ENUM ('PENDING', 'REDIRECTED', 'PAID', 'FAILED', 'EXPIRED');

CREATE TABLE "DeliveryPaymentAttempt" (
  "id" TEXT NOT NULL,
  "customerId" TEXT,
  "tenantId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "methodCode" TEXT NOT NULL,
  "status" "DeliveryPaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
  "vivaOrderCode" TEXT,
  "vivaTransactionId" TEXT,
  "externalOrderId" TEXT,
  "currency" "CurrencyCode" NOT NULL DEFAULT 'RON',
  "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "checkoutUrl" TEXT,
  "requestPayloadJson" JSONB,
  "responsePayloadJson" JSONB,
  "checkoutPayloadJson" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryPaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryPaymentAttempt_vivaOrderCode_key" ON "DeliveryPaymentAttempt"("vivaOrderCode");
CREATE INDEX "DeliveryPaymentAttempt_customerId_idx" ON "DeliveryPaymentAttempt"("customerId");
CREATE INDEX "DeliveryPaymentAttempt_tenantId_idx" ON "DeliveryPaymentAttempt"("tenantId");
CREATE INDEX "DeliveryPaymentAttempt_locationId_idx" ON "DeliveryPaymentAttempt"("locationId");
CREATE INDEX "DeliveryPaymentAttempt_integrationId_idx" ON "DeliveryPaymentAttempt"("integrationId");
CREATE INDEX "DeliveryPaymentAttempt_status_idx" ON "DeliveryPaymentAttempt"("status");
CREATE INDEX "DeliveryPaymentAttempt_createdAt_idx" ON "DeliveryPaymentAttempt"("createdAt");

ALTER TABLE "DeliveryPaymentAttempt"
ADD CONSTRAINT "DeliveryPaymentAttempt_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "DeliveryCustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DeliveryPaymentAttempt"
ADD CONSTRAINT "DeliveryPaymentAttempt_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryPaymentAttempt"
ADD CONSTRAINT "DeliveryPaymentAttempt_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryPaymentAttempt"
ADD CONSTRAINT "DeliveryPaymentAttempt_integrationId_fkey"
FOREIGN KEY ("integrationId") REFERENCES "ExternalIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryPaymentAttempt"
ADD CONSTRAINT "DeliveryPaymentAttempt_externalOrderId_fkey"
FOREIGN KEY ("externalOrderId") REFERENCES "ExternalOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
