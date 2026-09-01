CREATE TABLE "DeliveryCardVerificationAttempt" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "DeliveryPaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "vivaOrderCode" TEXT,
    "vivaTransactionId" TEXT,
    "checkoutUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryCardVerificationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeliveryCardVerificationAttempt_vivaOrderCode_key"
ON "DeliveryCardVerificationAttempt"("vivaOrderCode");
CREATE INDEX "DeliveryCardVerificationAttempt_customerId_idx"
ON "DeliveryCardVerificationAttempt"("customerId");
CREATE INDEX "DeliveryCardVerificationAttempt_status_idx"
ON "DeliveryCardVerificationAttempt"("status");
