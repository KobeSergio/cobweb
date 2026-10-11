-- Render job state (docs/specs/2026-10-12-render-job-state.md, sections 4 to 8): the functions the
-- render worker calls as it claims a paid or waived job, seeds and runs its batches, flips the job
-- to finalizing when the last batch lands, stores the CIDs and records a failure, and the one the
-- creator calls to retry a failed render. The five service functions take the job id and nothing
-- else about the caller: only the service role runs them (the worker authenticates with it, as the
-- lock functions' server code does). art_render_retry runs as the signed-in creator and checks the
-- owner through private.lock_owned_collection, as art_unlock does. A function that writes the
-- collection row locks it first and the job row second, the order art_unlock uses, so no two
-- functions wait on each other in opposite orders; art_batch_start and art_batch_done lock the job
-- row alone, which serializes two deliveries of one job. The collection follows a real job:
-- rendering while it renders or finalizes, rendered once done, art_locked again after a final
-- failure. A placeholder job never moves the collection's status, and no write moves a deployed
-- collection: the reveal flow (Phase 5) owns its status.

-- ---------------------------------------------------------------------------------------------
-- render_jobs: the base URI, the placeholder image directory, the collage and the error code
-- ---------------------------------------------------------------------------------------------
alter table public.render_jobs
  -- Each batch directory has its own CID on its batch row (section 5).
  drop column images_cid,
  -- What the contract gets: ipfs://<cid>/ for generative and 1/1, ipfs://<cid>/metadata.json for
  -- a single asset and the placeholder.
  add column base_uri text check (base_uri is null or base_uri ~ '^ipfs://[a-z2-7]{59}/'),
  -- The placeholder's image directory; set on placeholder jobs only. Its metadata CID is metadata_cid.
  add column placeholder_image_cid text
    check (placeholder_image_cid is null or placeholder_image_cid ~ '^[a-z2-7]{59}$'),
  -- The storage key of the preview collage the worker wrote; null when there is none.
  add column collage_key text check (collage_key is null or char_length(collage_key) between 1 and 256),
  -- RenderProblem.code, or the worker's own (dead-letter, payment-mismatch, cid-mismatch). error
  -- keeps the sentence.
  add column error_code text check (error_code is null or char_length(error_code) between 1 and 40),
  drop constraint render_jobs_done_has_metadata,
  add constraint render_jobs_done_complete
    check (state <> 'done' or (metadata_cid is not null and base_uri is not null));

-- ---------------------------------------------------------------------------------------------
-- render_batches: the CAR size, the error code, the run's times, a CID that is one
-- ---------------------------------------------------------------------------------------------
alter table public.render_batches
  add column images_size bigint check (images_size is null or images_size >= 0),
  add column error_code text check (error_code is null or char_length(error_code) between 1 and 40),
  add column started_at timestamptz,
  add column finished_at timestamptz,
  add constraint render_batches_images_cid_valid check (images_cid is null or images_cid ~ '^[a-z2-7]{59}$'),
  -- A done batch has its directory: the job's list of batch CIDs never has a hole.
  add constraint render_batches_done_has_cid check (state <> 'done' or images_cid is not null);
