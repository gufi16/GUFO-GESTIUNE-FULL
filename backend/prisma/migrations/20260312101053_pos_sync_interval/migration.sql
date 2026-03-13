/*
  Warnings:

  - You are about to drop the column `isVisibleInPos` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "posSyncInterval" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "isVisibleInPos";
