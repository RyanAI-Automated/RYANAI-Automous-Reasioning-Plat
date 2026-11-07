CREATE TABLE "brain_knowledge" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "source" TEXT,
  "category" TEXT NOT NULL DEFAULT 'general',
  "tags" TEXT[] NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "brain_knowledge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "brain_knowledge_fingerprint_key" ON "brain_knowledge"("fingerprint");
CREATE INDEX "brain_knowledge_active_priority_updated_at_idx" ON "brain_knowledge"("active","priority","updated_at");
CREATE INDEX "brain_knowledge_expires_at_idx" ON "brain_knowledge"("expires_at");
