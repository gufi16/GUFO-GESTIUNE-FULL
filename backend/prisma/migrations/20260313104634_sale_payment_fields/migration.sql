-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CASH', 'CARD', 'MIXED');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "cardAmount" DECIMAL(12,2),
ADD COLUMN     "cashAmount" DECIMAL(12,2),
ADD COLUMN     "operatorName" TEXT,
ADD COLUMN     "paymentType" "PaymentType" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "receiptNo" TEXT;

-- CreateIndex
CREATE INDEX "Sale_soldAt_idx" ON "Sale"("soldAt");
