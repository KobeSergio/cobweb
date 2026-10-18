# Layer and asset upload: specification

Companion plan: [../plans/2026-10-08-art-upload.md](../plans/2026-10-08-art-upload.md).
Product decisions: [../MASTER_PLAN.md](../MASTER_PLAN.md#decisions) and
[PLAN.md decision 10](../PLAN.md). Rows written: [2026-10-08-art-tables.md](2026-10-08-art-tables.md)
section 4.8. Screens: [2026-10-03-creator-flow-ui.md](2026-10-03-creator-flow-ui.md) section 4.3.

## 1. Goal

Make uploads real. A creator's layer images, 1/1 and single-asset files and the pre-reveal
placeholder go from the browser straight to object storage by presigned URL, are recorded as
`uploads` rows, and are served back to the screens. The browser does the fast checks it already
does; the server admits, signs, confirms and records.

Third of Phase 3's five sub-projects. The Art screens still keep layers and tokens in the browser
store; moving them onto the art tables is the next sub-project, which will link traits to the
upload rows this one writes.

## 2. Scope

### In scope

- A server-side storage module over the S3 API: key building, presigned PUT and GET, HEAD, delete,
  configured by environment variables. Local development points it at Supabase's S3-compatible
  endpoint; production at an AWS bucket. Same code, same SDK.
- Three server actions: `admitUpload`, `confirmUpload`, `deleteUpload`.
- A route handler, `GET /api/uploads/[id]`, that redirects to a short-lived signed URL for the
  file or its thumbnail.
- A real `startUpload` for the existing queue: hash, admit, PUT the file and (for images) a
  browser-made thumbnail, confirm.
- The folder-upload and assets hooks use it, so upload rows are written and the screens show
  stored files rather than object URLs.
- The 5 GB project cap and the per-kind size and type limits, enforced at admission.
- A declared bucket in the local Supabase config so storage exists after every reset.

### Out of scope

- Layer, trait and token rows (screen wiring sub-project). After this sub-project, `uploads` rows
  may exist with no trait pointing at them; that is allowed.
- Server-side pixel and hash verification of stored objects. The render pipeline (Phase 4) reads
  every file and fails a job with a clear error if a file does not match its row.
- CloudFront, lifecycle deletion after 90 days, and copying objects when a project is duplicated.
  The key shape leaves room for all three.

  > **18 October 2026:** The lifecycle deletion landed as a daily cron in the app, not as R2's rules, which count from each
  > object's upload ([2026-10-17-production-hardening.md](2026-10-17-production-hardening.md), decision 6): a
  > collection's `layers`, `assets` and `placeholders` folders go 90 days after its deploy and its final render, and
  > its thumbnails stay. `record_upload` now runs for the service role alone, so a row's size is the one the upload
  > action read from storage.
- Resumable multipart uploads (decided 8 October 2026: single PUT, retry restarts).

### Decisions carried in

- PLAN.md decision 10: layers upload straight to S3 by presigned URL; thumbnails are made in the
  browser at upload; render Lambdas read the same bucket.
- Content-hash keys so duplicate files share one object within a project (art tables 4.8).
- Key shape `<collection id>/<folder>/<name>[.<ext>]` with the first segment pinned to the
  collection, enforced by the `uploads.storage_key` check and `record_upload`.
- Limits: layer images PNG, square, at most 2048 on a side, 10 MB, one canvas size per project;
  1/1 assets PNG, JPG or WebP to 20 MB; GIF to 10 MB; MP4 to 50 MB; 5 GB of files per project.

## 3. Storage layout

| Folder         | Holds                                       | Name                                |
| -------------- | ------------------------------------------- | ----------------------------------- |
| `layers`       | layer images (`kind = layer_image`)         | `<sha256>.png`                      |
| `assets`       | 1/1 and single-asset files (`kind = asset`) | `<sha256>.<png, jpg, webp, gif or mp4>` |
| `placeholders` | the pre-reveal file (`kind = placeholder`)  | same as assets                      |
| `thumbnails`   | browser-made previews (`kind = thumbnail`)  | `<sha256 of the original>.webp`     |

All under `<collection id>/`. The SHA-256 is of the original file's bytes, computed in the
browser with `crypto.subtle.digest`, lowercase hex. A thumbnail's name reuses the original's hash
so the two are paired without a join; its own `content_hash` column holds the thumbnail's hash.

The bucket is private. Nothing is served by public URL; see section 7.

## 4. Module layout

| Path                                                      | Responsibility                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/web/src/lib/storage/config.ts`                      | reads the `ART_S3_*` variables, builds one `S3Client`; server only               |
| `apps/web/src/lib/storage/keys.ts`                        | `storageKey(collectionId, kind, hash, ext)`, `extensionFor(mime)`; pure          |
| `apps/web/src/lib/storage/objects.ts`                     | `presignPut`, `presignGet`, `headObject`, `deleteObjects`; thin SDK wrappers     |
| `apps/web/src/lib/storage/admission.ts`                   | `admissionProblem(kind, file, canvas)`: the per-kind rules; pure, unit-tested    |
| `apps/web/src/app/actions/uploads.ts`                     | `admitUpload`, `confirmUpload`, `deleteUpload`                                   |
| `apps/web/src/app/api/uploads/[id]/route.ts`              | the redirecting GET                                                              |
| `apps/web/src/components/art/uploads/hash.ts`             | `sha256Hex(file)` in the browser                                                 |
| `apps/web/src/components/art/uploads/thumbnail.ts`        | `makeThumbnail(file, 256)`: canvas to WebP, aspect preserved                     |
| `apps/web/src/components/art/uploads/resumable-upload.ts` | `createUploader(target)` returns the queue's `StartUpload`; the simulation goes  |

## 5. Admission rules

`admissionProblem(kind, { mime, bytes, width, height }, canvas)` returns a creator-facing
sentence or null. The browser runs it first (so the queue never starts a doomed upload) and the
server runs it again inside `admitUpload`.

| Kind          | Types          | Bytes         | Pixels                                                            |
| ------------- | -------------- | ------------- | ----------------------------------------------------------------- |
| `layer_image` | PNG            | at most 10 MB | square, at most 2048; equal to the project canvas when one is set |
| `asset`       | PNG, JPG, WebP | at most 20 MB | any; width and height required                                    |
| `asset`       | GIF            | at most 10 MB | any                                                               |
| `asset`       | MP4            | at most 50 MB | none                                                              |
| `placeholder` | as `asset`     | as `asset`    | as `asset`                                                        |
| `thumbnail`   | WebP           | at most 1 MB  | at most 256 on a side                                             |

Project cap: the sum of `uploads.bytes` for the collection plus the new file must stay at or
under 5 GB (5,368,709,120 bytes), with the message "This project has reached its 5 GB of files.
Delete some files to upload more." The first admitted layer image sets `collections.canvas_width`
and `canvas_height`; later ones must match.

Wording follows the existing browser checks: "Not a PNG file.", "21 MB is over the 20 MB limit.",
"Must be square: 1000 x 900.", "Every layer image must be 1000 x 1000 in this project."

## 6. The flow

```
browser                                   server                              bucket
check file (existing) -> hash -> thumbnail
admitUpload(meta) ---------------------->  session, ownership, lock,
                                           admission rules, project cap,
                                           dedupe lookup
<------ { existing: true, upload }         (hash already recorded: done)
<------ { putUrl, key, thumbPutUrl?, thumbKey? }
PUT file ------------------------------------------------------------------>  object
PUT thumbnail (images) ---------------------------------------------------->  object
confirmUpload(key, thumbKey, meta) ----->  HEAD both (exist, size, type) ----> HEAD
                                           record_upload for each
<------ { upload: UploadRecord }
```

- `admitUpload` input: `collectionId`, `kind` (`layer_image`, `asset` or `placeholder`),
  `fileName`, `mime`, `bytes`, `width`, `height` (null for video), `contentHash`, and for images
  `thumbnail: { mime: 'image/webp', bytes, width, height, contentHash }`. It returns either
  `{ existing: true, upload }` when a row with that hash and kind exists, or
  `{ existing: false, key, putUrl, thumbnail?: { key, putUrl } }`. URLs are valid 15 minutes and
  bound to the content type and length.
- `confirmUpload` input: the keys and the same metadata. It HEADs each object, refuses with
  "The upload did not arrive in full. Try again." when the size or type differs, then calls
  `record_upload` for the file and the thumbnail. It returns `UploadRecord`:
  `{ id, kind, fileName, mime, mediaType, bytes, width, height, url, thumbnailUrl }` where the
  URLs are `/api/uploads/<id>` and `/api/uploads/<id>?variant=thumb`.
- `deleteUpload(uploadId)` deletes the row (and the thumbnail row that shares its hash) under
  the creator's session; a 23503 from a trait that still uses it becomes "This image is used by a
  trait. Remove the trait first."; then it deletes the objects, best effort, and reports success
  even if an object delete fails (the row is gone; a sweep can collect orphans).
- Every action verifies the session with `getVerifiedUser`, checks ownership with a
  `collections` read under RLS, and refuses when `art_locked_at` is set with "The art is locked and
  cannot change." The database repeats all three.
- Presigned PUTs carry `Content-Type` and `Content-Length` conditions, so a client cannot upload
  something other than what it declared.

## 7. Serving

`GET /api/uploads/[id]?variant=thumb`:

1. Session through `getSessionUser`; without one, 404.
2. Read the `uploads` row under RLS; a row the caller cannot see is a 404 (no probing).
3. Presign a GET for the row's key (or, with `variant=thumb`, the thumbnail row's key found by
   `(collection_id, content_hash, kind = thumbnail)`; fall back to the original when there is
   none) valid for one hour, and respond `302` with `Cache-Control: private, max-age=3000`.

Image tags in the screens use these URLs. Signing is local computation, so a Layers page with
500 traits costs nothing but the row read.

## 8. The transfer

`createUploader({ collectionId, kind, canvas })` returns a `StartUpload`. For each file it:

1. Hashes the file and, for images, draws a 256 px WebP thumbnail on a canvas.
2. Calls `admitUpload`. On `existing: true` it emits `done` at once with the record.
3. PUTs the file by XHR (fetch has no upload progress), reporting `sentBytes` from the progress
   event; then PUTs the thumbnail.
4. Calls `confirmUpload` and emits `done` with `url` and `uploadId`.

`UploadProgress` gains `uploadId?: string` and `record?: UploadRecord`. Pause aborts the XHR and
resume starts the PUT again from zero; retry does the same after a failure. The failure copy
becomes "The upload stopped. Retry to upload it again." The queue's constructor already takes a
`StartUpload`; `useUploadQueue(concurrency, start)` passes it through.

The simulated `startUpload` is deleted. `UploadQueue` keeps its shape and tests.

## 9. Hook changes

- `useFolderUpload` builds its queue with `createUploader({ collectionId, kind: 'layer_image',
  canvas })`. `finish()` hands `UploadedImage { url, name, uploadId }` to `mergeUpload`, with `url`
  the `/api/uploads/<id>` URL, so traits in the browser store carry the stored image and its
  upload id (the next sub-project writes them to rows). Object URLs are revoked once the stored
  URL is known.
- `useAssetItems` takes an uploader too; `AssetItem` gains `uploadId` and switches `url` to the
  served URL on `done`; `remove` calls `deleteUpload`.
- `Trait` in the browser store gains an optional `uploadId`; `UploadedAsset` gains `uploadId`.
  Sample data has none, which is fine: sample mode never uploads.

## 10. Configuration

Server-only variables, added to `apps/web/.env.example` with comments:

| Variable                   | Local (from `supabase status`)  | Production                      |
| -------------------------- | ------------------------------- | ------------------------------- |
| `ART_S3_ENDPOINT`          | `STORAGE_S3_URL`                | unset (AWS)                     |
| `ART_S3_REGION`            | `S3_PROTOCOL_REGION`            | the bucket's region             |
| `ART_S3_BUCKET`            | `art`                           | the bucket name                 |
| `ART_S3_ACCESS_KEY_ID`     | `S3_PROTOCOL_ACCESS_KEY_ID`     | an IAM key scoped to the bucket |
| `ART_S3_SECRET_ACCESS_KEY` | `S3_PROTOCOL_ACCESS_KEY_SECRET` | its secret                      |
| `ART_S3_FORCE_PATH_STYLE`  | `1`                             | unset                           |

`supabase/config.toml` declares `[storage.buckets.art]` (private, 50 MiB limit, the five
allowed MIME types) so `supabase db reset` recreates it. Never printed, never sent to the browser.
`pnpm --filter @cobweb/web verify:local` is unaffected; a new `verify:storage` script (section
11) exercises the bucket.

New dependencies in `apps/web`: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.

## 11. Testing

- Unit (vitest, web): `admissionProblem` for every row of the table in section 5, the cap
  message, canvas mismatch; `storageKey` and `extensionFor`; `sha256Hex` against a known digest
  (Node's Web Crypto); `createUploader` with a fake `fetch` and XHR driving the state machine:
  existing, success, failed PUT then retry, pause and resume, confirm refusal.
- Integration, `apps/web/scripts/verify-storage.ts`, run with local Supabase: presign a PUT, PUT a
  small PNG, HEAD it, record it through the actions' shared helper, sign a GET the way the route
  handler does, delete, and confirm the object is gone. Refuses to run against anything but
  localhost, like `verify:local`.
- Browser: drop a folder of PNGs on the Layers screen of a fresh generative collection; every
  trait thumbnail shows from `/api/uploads/...`; the local bucket holds the objects; the `uploads`
  table holds a layer image and a thumbnail row per file with the right keys. Then the Assets
  screen: a JPG, a GIF and an MP4 on a single-asset project, and a delete.

## 12. Acceptance criteria

- [x] `pnpm --filter @cobweb/web verify:storage` passes against local Supabase storage.
- [x] Unit tests cover every admission row, the cap, the key shape, the hash and the uploader's
      state machine; `pnpm typecheck && pnpm lint && pnpm test` pass at the root.
- [x] A folder upload in the browser writes one `layer_image` and one `thumbnail` row per file,
      objects land under `<collection id>/layers/` and `/thumbnails/`, and the Layers screen shows
      them through `/api/uploads/`.
- [x] A file whose hash the project already has uploads nothing and reuses the row.
- [x] A second creator's session gets 404 from `/api/uploads/<id>` for the first creator's file.
- [x] A 5 GB project refuses the next file with the cap message (checked by inserting rows that
      sum to the cap with the service role in `verify:storage`, not by uploading 5 GB).
- [x] `docs/MASTER_PLAN.md` Phase 3 names this sub-project as landed and the next one (wiring
      the Art screens); the creator flow spec's section 5 notes `UploadedAsset` now carries
      `uploadId`.

Checked on 8 October 2026: unit tests, `verify:storage` (12 checks) and `verify:local` (153)
pass; the browser walk (Playwright with the dev wallet, sample data off) uploaded a folder of
five PNGs into one layer image and one thumbnail row each with the canvas set to 64 x 64, served
them through `/api/uploads/`, returned 404 to an anonymous request, and on a single-asset project
added a PNG, replaced it with a GIF (the PNG's row and objects were deleted) and served the GIF.
Hash reuse is proved by the uploader test and the 23505 check in `verify:storage`; the browser did
not re-drop a folder, and no MP4 was uploaded. The folder upload is shown only with
`NEXT_PUBLIC_DEMO_DATA=0`.
