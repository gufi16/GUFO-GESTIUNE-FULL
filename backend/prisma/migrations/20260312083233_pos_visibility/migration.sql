-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "isVisibleInPos" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isVisibleInPos" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isVisibleInPos" BOOLEAN NOT NULL DEFAULT true;
