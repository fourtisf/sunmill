-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "wallet" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Farm" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "coins" BIGINT NOT NULL DEFAULT 640,
    "hay" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "siloCap" INTEGER NOT NULL DEFAULT 60,
    "barnCap" INTEGER NOT NULL DEFAULT 60,
    "ordersFilledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Farm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tile" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "crop" TEXT,
    "plantedAt" TIMESTAMP(3),

    CONSTRAINT "Tile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineState" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "machine" TEXT NOT NULL,
    "jobs" JSONB NOT NULL DEFAULT '[]',
    "done" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "MachineState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PenState" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "pen" TEXT NOT NULL,
    "animals" JSONB NOT NULL,

    CONSTRAINT "PenState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "who" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "coins" INTEGER NOT NULL,
    "xp" INTEGER NOT NULL,
    "hay" DECIMAL(24,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ledger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "coinsDelta" BIGINT NOT NULL DEFAULT 0,
    "hayDelta" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "xpDelta" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'settled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HayTransfer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "wallet" TEXT NOT NULL,
    "txHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "ledgerId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HayTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_wallet_key" ON "User"("wallet");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Farm_userId_key" ON "Farm"("userId");

-- CreateIndex
CREATE INDEX "Tile_farmId_idx" ON "Tile"("farmId");

-- CreateIndex
CREATE UNIQUE INDEX "Tile_farmId_index_key" ON "Tile"("farmId", "index");

-- CreateIndex
CREATE INDEX "MachineState_farmId_idx" ON "MachineState"("farmId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineState_farmId_machine_key" ON "MachineState"("farmId", "machine");

-- CreateIndex
CREATE INDEX "PenState_farmId_idx" ON "PenState"("farmId");

-- CreateIndex
CREATE UNIQUE INDEX "PenState_farmId_pen_key" ON "PenState"("farmId", "pen");

-- CreateIndex
CREATE INDEX "InventoryItem_farmId_idx" ON "InventoryItem"("farmId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_farmId_item_key" ON "InventoryItem"("farmId", "item");

-- CreateIndex
CREATE INDEX "Order_farmId_createdAt_idx" ON "Order"("farmId", "createdAt");

-- CreateIndex
CREATE INDEX "Ledger_userId_createdAt_idx" ON "Ledger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Ledger_kind_createdAt_idx" ON "Ledger"("kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HayTransfer_txHash_key" ON "HayTransfer"("txHash");

-- CreateIndex
CREATE INDEX "HayTransfer_userId_createdAt_idx" ON "HayTransfer"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "HayTransfer_status_idx" ON "HayTransfer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AuthNonce_nonce_key" ON "AuthNonce"("nonce");

-- CreateIndex
CREATE INDEX "AuthNonce_address_idx" ON "AuthNonce"("address");

-- CreateIndex
CREATE INDEX "AuthNonce_expiresAt_idx" ON "AuthNonce"("expiresAt");

-- AddForeignKey
ALTER TABLE "Farm" ADD CONSTRAINT "Farm_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tile" ADD CONSTRAINT "Tile_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineState" ADD CONSTRAINT "MachineState_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenState" ADD CONSTRAINT "PenState_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HayTransfer" ADD CONSTRAINT "HayTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
