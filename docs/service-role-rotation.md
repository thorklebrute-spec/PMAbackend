# Service role credential rotation

Do not copy the credential out of `sql/migration_add_cron_job.sql`. Treat that value as compromised because it is stored in the repository.

1. In the Supabase dashboard, roll the JWT secret. That invalidates the anon key and the service-role key together.
2. Update Render environment variables `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` with the new values. Do not commit them.
3. Redeploy the backend only after those variables are saved.
4. Confirm a normal signed-in request still works.
5. The database cron command created by `migration_add_cron_job.sql` still contains the old bearer token. Unschedule or replace that cron in the SQL editor without pasting the old token into a file or a chat.
6. Removing the token from the SQL file does not invalidate a key that is already in git history. Rotation is what turns it off.
