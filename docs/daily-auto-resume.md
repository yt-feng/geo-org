# Automatic continuation of daily articles

Production scheduled runs and manual main runs without `resume_run_id` first
select the next unpublished topic from the current checkout. They look for its
newest eligible checkpoint before any research discovery or paid model request.
Explicit manual resumes keep their existing path. Preview and branch runs do
not discover production work automatically.

The small `daily-insight-checkpoint-RUN-ATTEMPT` artifact contains a manifest and
only the Chinese/English/Arabic audit JSON files that exist. The manifest binds
repository, event, main ref, run ID, run attempt, event head SHA, and a hash of
the complete selected topic (row, title, context, category and keywords). Every
file has its own size and SHA256. The GitHub archive digest is verified before
safe extraction. The original larger review artifact is retained for diagnosis
and explicit legacy recovery.

Only completed failure/cancellation runs of the exact daily workflow on main
qualify. Legacy artifacts without this manifest are never guessed to be a
checkpoint. The selector reads the workflow definition at each event head and
requires the versioned producer marker, seal command and attempt-bound upload
contract. Definitions are cached by SHA. Proven legacy failures do not consume
artifact lookups, so pre-feature failures cannot prevent the first checkpoint
from being created. Unreadable or partial producer definitions fail closed.
For a capable run with no checkpoint, the exact attempt's jobs must prove the
production generation step was skipped, or that it was a preview. A started or
unknown production step stops selection with a run/attempt receipt, because
seal/upload failure must not discard newer findings or reset an older budget.
A saved Chinese pass must pass the current saved-pass validator, including
known factual and historical blockers. The existing first-invalid-JSON fallback
with no known or historical findings remains unchanged and visibly recorded;
that unavailable review is not described as completed semantic approval. A failed audit
must contain its brief, source identities and complete last draft. Known
translation findings remain bound to the Chinese source and become required
repairs. Restoring a checkpoint never changes a failure to a pass.

Source URLs are reread through the existing research validator. IDs, order,
excerpt windows, body lengths and excerpt SHA256 must match. Actual source
content or URL drift makes an automatic run explicitly abandon the old draft
and research afresh; the decision is saved in `.artifacts/resume-selection.json`.
Fetch failures, malformed provenance and access-check pages fail without
starting fresh paid work. Explicit manual resumes continue to reject drift.

Discovery covers runs created in the previous 14 days, using GitHub's server-side
creation filter and total count. An older run's recent rerun does not extend
this window. If 30 results do not cover the whole window, selection stops before
choosing any checkpoint or declaring there is no saved history. An omitted
older-created run may have rerun recently and contain the latest findings.
Discovery is bounded to 30 returned runs, 10 artifact lookups, three
archive downloads, 120 seconds total and 30 seconds per API request. Archives
are capped at 10 MB compressed, 30.1 MB expanded and 10 MB per audit, with at most
four files. ZIP paths, duplicate names, symlinks, missing files and checksum
changes are rejected. Selection failures do not start a fresh paid draft.

A chain allows at most two automatic continuations; each keeps the existing
maximum of three additional draft attempts and current request/token budgets.
This count applies inside the 14-day discoverable artifact window; it is not a
permanent topic spending ledger after records expire.
Once those continuations are exhausted, the saved history requires an authored
repair or explicit manual continuation. An interruption before new drafting
carries the unchanged selected history under the incremented count. A newer
incomplete audit is recorded as incomplete and blocks automatic rollback to an
older pass. Audit writes are atomic, so an interrupted write leaves the previous
complete JSON intact. No workflow dispatch loop is introduced.
