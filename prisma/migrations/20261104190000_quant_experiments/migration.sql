CREATE TABLE "quant_experiments" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "strategy" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "result" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quant_experiments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quant_experiments_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "quant_experiments_user_created_idx"
  ON "quant_experiments"("user_id", "created_at" DESC);
