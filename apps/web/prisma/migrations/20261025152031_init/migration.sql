-- CreateEnum
CREATE TYPE "Role" AS ENUM ('AGENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "CpcvStatus" AS ENUM ('DRAFT', 'PROVING', 'MINTED', 'SETTLED', 'CANCELLED', 'WRITTEN_OFF', 'FAILED');

-- CreateEnum
CREATE TYPE "AuthDecision" AS ENUM ('APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ChainStatus" AS ENUM ('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Passkey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKeyCose" BYTEA NOT NULL,
    "publicKeyP256" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL,
    "transports" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "userId" TEXT NOT NULL,
    "smartAccount" TEXT NOT NULL,
    "agentField" TEXT NOT NULL,
    "lithicCardToken" TEXT,
    "cardLast4" TEXT,
    "cardEnabledOnChain" BOOLEAN NOT NULL DEFAULT false,
    "signerKind" TEXT NOT NULL DEFAULT 'passkey',
    "cachedPosition" JSONB,
    "cachedAt" TIMESTAMP(3),

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Cpcv" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "piiEncrypted" BYTEA NOT NULL,
    "totalCommissionCents" BIGINT NOT NULL,
    "agentCommissionCents" BIGINT NOT NULL,
    "escrituraDay" INTEGER NOT NULL,
    "commitment" TEXT NOT NULL,
    "nullifier" TEXT NOT NULL,
    "proof" JSONB,
    "status" "CpcvStatus" NOT NULL DEFAULT 'DRAFT',
    "noteId" INTEGER,
    "mintTxHash" TEXT,
    "settleTxHash" TEXT,
    "cancelTxHash" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cpcv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAuthorization" (
    "id" TEXT NOT NULL,
    "lithicToken" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "merchant" TEXT NOT NULL,
    "decision" "AuthDecision" NOT NULL,
    "declineReason" TEXT,
    "chainStatus" "ChainStatus" NOT NULL DEFAULT 'PENDING',
    "fromBalanceStroops" BIGINT,
    "fromCreditStroops" BIGINT,
    "txHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChainEvent" (
    "id" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "eventIdx" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "protocolTs" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PoolSnapshot" (
    "id" TEXT NOT NULL,
    "protocolTs" BIGINT NOT NULL,
    "seniorAssets" BIGINT NOT NULL,
    "juniorAssets" BIGINT NOT NULL,
    "feesAccrued" BIGINT NOT NULL,
    "totalDebt" BIGINT NOT NULL,
    "poolCash" BIGINT NOT NULL,
    "sharePrice" TEXT NOT NULL,
    "shareSupply" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoolSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "teurc" TEXT NOT NULL,
    "cpcvNote" TEXT NOT NULL,
    "advancePool" TEXT NOT NULL,
    "wasmHashes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerCursor" (
    "id" TEXT NOT NULL,
    "lastLedger" INTEGER NOT NULL,

    CONSTRAINT "IndexerCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "EmailCode_email_idx" ON "EmailCode"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_smartAccount_key" ON "Agent"("smartAccount");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_lithicCardToken_key" ON "Agent"("lithicCardToken");

-- CreateIndex
CREATE UNIQUE INDEX "Cpcv_noteId_key" ON "Cpcv"("noteId");

-- CreateIndex
CREATE UNIQUE INDEX "CardAuthorization_lithicToken_key" ON "CardAuthorization"("lithicToken");

-- CreateIndex
CREATE INDEX "CardAuthorization_agentId_createdAt_idx" ON "CardAuthorization"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "ChainEvent_type_ledger_idx" ON "ChainEvent"("type", "ledger");

-- CreateIndex
CREATE UNIQUE INDEX "ChainEvent_txHash_eventIdx_key" ON "ChainEvent"("txHash", "eventIdx");

-- CreateIndex
CREATE INDEX "PoolSnapshot_protocolTs_idx" ON "PoolSnapshot"("protocolTs");

-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cpcv" ADD CONSTRAINT "Cpcv_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardAuthorization" ADD CONSTRAINT "CardAuthorization_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
