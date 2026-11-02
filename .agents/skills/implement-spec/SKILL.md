---
name: implement-spec
description: Coordinate a multi-ticket spec as a dependency graph on one integration branch.
---
# Implement spec
Build the task dependency graph. Only independent ready tasks may run in parallel, each in isolated worktrees/sandboxes and scoped branches. Integrate through reviewed commits; resolve conflicts explicitly. No sub-agent gets production credentials or merge/deploy authority. Run end-to-end validation on the final integrated SHA and complete two-axis review before PR handoff.