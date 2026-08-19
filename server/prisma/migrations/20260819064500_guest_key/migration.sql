-- Passcode-only play: the browser keeps a farm key, we keep its SHA-256.
-- Nullable, so every existing wallet account is untouched.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "guestKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_guestKey_key" ON "User"("guestKey");
