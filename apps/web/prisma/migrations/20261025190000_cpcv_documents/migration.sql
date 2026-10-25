-- CreateTable
CREATE TABLE "CpcvDocument" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "contentEncrypted" BYTEA NOT NULL,
    "extractionEncrypted" BYTEA,
    "extractionError" TEXT,
    "cpcvId" TEXT,

    CONSTRAINT "CpcvDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CpcvDocument_cpcvId_key" ON "CpcvDocument"("cpcvId");

-- AddForeignKey
ALTER TABLE "CpcvDocument" ADD CONSTRAINT "CpcvDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CpcvDocument" ADD CONSTRAINT "CpcvDocument_cpcvId_fkey" FOREIGN KEY ("cpcvId") REFERENCES "Cpcv"("id") ON DELETE CASCADE ON UPDATE CASCADE;
