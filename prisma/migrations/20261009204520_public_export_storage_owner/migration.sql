/*
  Warnings:

  - You are about to drop the column `storage_key` on the `billing_credits` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "billing_credits" DROP COLUMN "storage_key";

-- AlterTable
ALTER TABLE "export_jobs" ADD COLUMN     "storage_key" TEXT;
