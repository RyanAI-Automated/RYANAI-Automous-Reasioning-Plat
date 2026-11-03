/** Reject common credential formats before task comments enter the durable evidence ledger. */
export function containsTaskCommentSecretMaterial(value: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(value)
    || /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|nvapi-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/.test(value)
    || /\b(?:DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|OPENAI_API_KEY|NVIDIA_API_KEY|QWEN_API_KEY|LOGIC_API_KEY|REDIS_URL)\s*=\s*\S+/i.test(value);
}
