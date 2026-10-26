# Security cleanup

## What this change did

This change removed `db_cluster-24-09-2026@07-14-43.backup.gz` from the repository. It also added database dump patterns to `.gitignore`.

The file was a Postgres dump of a new Supabase project. It held schema and migration tables only. The `vault.secrets` table had no rows. The dump had no role password hashes. The repository is public, so the schema was visible to everyone.

## What you must still do

Removing a file does not remove it from Git history. Anyone can still download it from old commits.

1. Decide if you need to remove it from history. The risk is low, because the file had no user data.
2. To remove it, run `git filter-repo --path 'db_cluster-24-09-2026@07-14-43.backup.gz' --invert-paths` on a fresh clone. Then force-push every branch. This rewrites history. Tell all contributors first.
3. Ask GitHub Support to remove cached views of the old commits.
4. Fix the secret scan. The Gitleaks job (`.github/workflows/secret-scan.yml`) fails on every run because the `GITLEAKS_LICENSE` secret is missing. It does not scan anything now. Add the license secret, or run the free `gitleaks` command line tool on a full clone.
5. After the scan runs, rotate any key that it finds in Git history.

## Rules for the future

- Never commit database dumps or `.env` files.
- Keep the repository private when it holds deployment configuration.
