-- Render job state (docs/specs/2026-10-12-render-job-state.md, section 4): `finalizing`, the state
-- between the last batch landing and the metadata being stored. In a file of its own because the
-- Supabase CLI applies each migration file in one transaction, and Postgres refuses to use an enum
-- value in the transaction that added it ("unsafe use of new value", 55P04). The functions in
-- 20261012010000_render_job_state.sql compare against it, so it is committed first.
alter type public.render_state add value 'finalizing' after 'rendering';
