CREATE TYPE "DeliveryCustomerAuthProvider" AS ENUM ('PASSWORD', 'GOOGLE', 'FACEBOOK');

CREATE TABLE "DeliveryCustomerAccount" (
  "id" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "fullName" TEXT NOT NULL,
  "passwordHash" TEXT,
  "authProvider" "DeliveryCustomerAuthProvider" NOT NULL DEFAULT 'PASSWORD',
  "providerUserId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryCustomerAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryCustomerSession" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryCustomerSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeliveryCustomerAddress" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "addressLine" TEXT NOT NULL,
  "details" TEXT,
  "city" TEXT,
  "county" TEXT,
  "country" TEXT,
  "postalCode" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryCustomerAddress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryCustomerAccount_email_key" ON "DeliveryCustomerAccount"("email");
CREATE UNIQUE INDEX "DeliveryCustomerAccount_phone_key" ON "DeliveryCustomerAccount"("phone");
CREATE UNIQUE INDEX "DeliveryCustomerAccount_authProvider_providerUserId_key" ON "DeliveryCustomerAccount"("authProvider", "providerUserId");
CREATE INDEX "DeliveryCustomerAccount_createdAt_idx" ON "DeliveryCustomerAccount"("createdAt");

CREATE INDEX "DeliveryCustomerSession_customerId_idx" ON "DeliveryCustomerSession"("customerId");
CREATE INDEX "DeliveryCustomerSession_expiresAt_idx" ON "DeliveryCustomerSession"("expiresAt");
CREATE INDEX "DeliveryCustomerSession_revokedAt_idx" ON "DeliveryCustomerSession"("revokedAt");

CREATE INDEX "DeliveryCustomerAddress_customerId_idx" ON "DeliveryCustomerAddress"("customerId");
CREATE INDEX "DeliveryCustomerAddress_customerId_isDefault_idx" ON "DeliveryCustomerAddress"("customerId", "isDefault");

ALTER TABLE "DeliveryCustomerSession"
ADD CONSTRAINT "DeliveryCustomerSession_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "DeliveryCustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DeliveryCustomerAddress"
ADD CONSTRAINT "DeliveryCustomerAddress_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "DeliveryCustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
