/*
  Warnings:

  - You are about to drop the `applications` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "applications" DROP CONSTRAINT "applications_job_id_fkey";

-- DropForeignKey
ALTER TABLE "applications" DROP CONSTRAINT "applications_user_id_fkey";

-- DropTable
DROP TABLE "applications";

-- DropEnum
DROP TYPE "ApplicationStatus";
