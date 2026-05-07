DROP INDEX IF EXISTS "ExternalOrder_platform_externalOrderId_key";

CREATE UNIQUE INDEX "ExternalOrder_tenantId_platform_externalOrderId_key"
ON "ExternalOrder"("tenantId", "platform", "externalOrderId");
