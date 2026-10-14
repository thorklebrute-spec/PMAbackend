# Account deletion operations

`POST /internal/deletion-storage-sweep` retries profile-picture cleanup for deletion jobs whose `storage_status` is `pending`. It also deletes receipt rows only when the job is `completed`, storage is `settled`, and `expires_at` is in the past. Unfinished jobs are left in place.

## Scheduler

Set `DELETION_SWEEP_TOKEN` on the server. The value is an environment variable, not a key in the repository. Call:

```text
POST /internal/deletion-storage-sweep
x-deletion-sweep-token: <DELETION_SWEEP_TOKEN>
```

The response is counts only: `swept`, `pending`, and `removedReceipts`. It does not include user ids, emails, or receipts.

If the token is unset, the route returns 503 `sweep_not_configured` and the process logs that pending storage jobs are unresolved. A wrong token returns 401.

Until a Render cron calls this route on a schedule, an operator must call it. That manual call is required. Pending rows remain and each failed retry logs `Pending storage deletion remains` with the user id and the stable code `storage_cleanup_failed`. The raw provider message is not stored on the job. The failure is not discarded.

After the backend deploy, add a Render cron job. Do not put the token in the repository or in this document.

- Schedule: `*/15 * * * *`
- Command: `curl -fsS -X POST -H "x-deletion-sweep-token: $DELETION_SWEEP_TOKEN" "$RENDER_EXTERNAL_URL/internal/deletion-storage-sweep"`
- The cron service needs the same `DELETION_SWEEP_TOKEN` value as the web service, and `RENDER_EXTERNAL_URL` set to the backend origin.
- A non-zero curl exit means the sweep did not finish. Render should keep the log. The next run retries pending rows.
- The deployment order is in `docs/account-deletion-deploy.md`.

## What a pending job means

Account deletion can finish while a profile picture is still stored. The account status route does not mention storage. The job row stays `storage_status = pending` until a sweep removes the files. A sweep that fails leaves the row pending and updates `last_error`.

## Receipt expiry

Status checks return `unknown` after 24 hours. Expiry does not delete an `in_progress`, `blocked`, or storage-`pending` job, and it does not transfer receipt ownership. The original receipt can still reclaim a blocked job immediately, or a stale `in_progress` job, after the status window has passed. A different receipt cannot. Only a completed job with settled storage is eligible for receipt-row removal.
