# RyanAI conversation attachment storage

RyanAI stores conversation files in the private Supabase Storage bucket `ryanai-attachments`. Message rows retain attachment metadata and object paths; they do not store file bytes or permanent public URLs.

## Enforced limits

The migration `20261030130000_attachment_quota_enforcement.sql` adds a Storage database trigger with the following defaults:

| Limit | Value |
| --- | ---: |
| Individual file | 20 MiB |
| Files per message | 8 |
| Combined files per message | 40 MiB |
| Stored files per account | 500 MiB |
| Upload requests per account | 100 per hour |
| Conversation archive import/export | 250 MiB |

The trigger derives the account, conversation, and message from the object path, verifies that the conversation belongs to that account, and checks the stored object size. A transaction-scoped advisory lock serializes quota checks per account so concurrent uploads cannot bypass the limits. Upload events are retained for 48 hours and pruned for that account during the next upload.

The client also validates the allowlisted extension/MIME pair and common file signatures. These client checks improve feedback but are not a security boundary; the private bucket policies and database trigger remain authoritative.

## Upload and download flow

1. The authenticated client requests a signed upload URL for a new random object path.
2. The browser uploads to that signed URL and reports byte progress; the user can cancel an in-flight request.
3. A failed or cancelled batch attempts to remove every reserved object path. The selected files remain available for a manual retry.
4. The message row stores metadata and the private object path.
5. Downloads and previews use short-lived signed read URLs. The application checks that the path belongs to the current user and conversation before signing.
6. Conversation export packages original attachment bytes in a TAR archive. Import validates the archive and file metadata, generates new IDs/object paths, and uploads into a newly created conversation.

## Deployment requirements

- Apply the private-bucket migration `20261030120000_private_conversation_attachments.sql` first.
- Apply `20261030130000_attachment_quota_enforcement.sql` before enabling the account/message quotas.
- Verify the bucket is private and test the storage policies with two separate authenticated accounts.
- Confirm the deployed Storage service populates `storage.objects.metadata->>'size'` for signed uploads before rollout.
- Back up the database and confirm object-storage backup/retention settings before production rollout.

## Known follow-up controls

The quota migration does not implement malware scanning or a scheduled orphan-object lifecycle. Do not delete rows directly from `storage.objects` as a cleanup shortcut; use the Storage API/service so the underlying object is removed as well. A scheduled, service-role cleanup worker and an approved retention policy must be implemented and tested separately. Cross-account RLS and browser/mobile end-to-end verification are still required before production sign-off.
