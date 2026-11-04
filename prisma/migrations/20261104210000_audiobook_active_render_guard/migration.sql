-- Enforce at most one active render per audiobook project even under concurrent API requests.
CREATE UNIQUE INDEX "audiobook_render_jobs_one_active_per_project"
  ON "audiobook_render_jobs"("project_id")
  WHERE "status" IN ('queued', 'running', 'cancel_requested');
