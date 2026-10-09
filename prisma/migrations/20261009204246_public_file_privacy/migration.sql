/*
  Warnings:

  - You are about to drop the column `customer_email` on the `uploads` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "billing_credits" ADD COLUMN     "storage_key" TEXT;

-- AlterTable
ALTER TABLE "uploads" DROP COLUMN "customer_email";
