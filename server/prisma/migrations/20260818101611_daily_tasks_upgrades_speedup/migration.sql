-- AlterTable
ALTER TABLE "Farm" ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "streakClaimedOn" TEXT,
ADD COLUMN     "streakDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tasksDay" TEXT,
ADD COLUMN     "tutorialDone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tutorialStep" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MachineState" ADD COLUMN     "extraSlots" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "name" TEXT;

-- CreateTable
CREATE TABLE "DailyTask" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "rewardCoins" INTEGER NOT NULL,
    "rewardHay" DECIMAL(24,4) NOT NULL,
    "rewardXp" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyTask_farmId_day_idx" ON "DailyTask"("farmId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "DailyTask_farmId_day_kind_key" ON "DailyTask"("farmId", "day", "kind");

-- CreateIndex
CREATE INDEX "Order_expiresAt_idx" ON "Order"("expiresAt");

-- CreateIndex
CREATE INDEX "User_name_idx" ON "User"("name");

-- AddForeignKey
ALTER TABLE "DailyTask" ADD CONSTRAINT "DailyTask_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
