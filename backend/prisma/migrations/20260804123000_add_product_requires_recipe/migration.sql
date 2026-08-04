ALTER TABLE "Product"
ADD COLUMN "requiresRecipe" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Product"
SET "requiresRecipe" = true
WHERE "class" IN ('PRODUS_FIN', 'SEMIFABRICATE');
