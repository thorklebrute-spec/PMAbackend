-- Enable the pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a cron job to run the mark-missed-days function daily at midnight UTC
SELECT cron.schedule(
  'mark-missed-days-daily',
  '0 0 * * *', -- Daily at midnight UTC
  'SELECT net.http_post(
    url := ''https://cvlelmjjunrawmkzafzl.supabase.co/functions/v1/mark-missed-days'',
    headers := ''{"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2bGVsbWpqdW5yYXdta3phZnpsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDU5NTE0MywiZXhwIjoyMDY2MTcxMTQzfQ.ZjWkWnqPoeujvwIO1GSELS9YskKY0mF7OL2MSycUxsw", "Content-Type": "application/json"}'',
    body := ''{}''
  );'
); 