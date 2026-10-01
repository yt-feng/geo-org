# Checked decision models in new Chinese drafts

Run 36785055537, row 709, passed the old HTML/source structure gate but failed
independent review after three drafts. Its final draft called A and B mutually
exclusive under 80 hours although the authored costs were 40 + 48 - 12 = 76.
Earlier revisions also changed comparisons, zero-gain conditions, and source
modality while repairing other findings. Rewriting one published article did not
address that recurring generation failure.

New Chinese drafts and supplied editorial revisions now include `decision_checks`:

- Exact calculations use decimal strings and `Fraction`, with a bounded AST
  interpreter. There is no `eval`, call, attribute, exponent, or external I/O.
- Resource checks deduct shared prerequisites once and reject a claim that budget
  alone excludes the joint option when it fits. Quantified capacity cannot omit
  the budget group. This syntactic guard does not infer every possible resource
  model from prose.
- Cases execute ordered rules and compare the computed choice with the authored
  recommendation. Duplicate inputs, constant-only cases, early unconditional
  fallbacks, division by zero, stale body quotes, and excessive intermediate
  numeric size fail the gate. The scheme supports different article models; it
  does not encode row 709 or a fixed industry framework.
- Each check quotes the current visible body. Rewrites must regenerate checks;
  the audit retains results and errors as revision feedback. Arithmetic failures
  use the existing attempt limit and do not incur an independent paid review.

These checks prove only submitted arithmetic and cases. Independent source and
semantic review remains required. It must assess missing coverage, consistency
with the complete article, and every submitted check ID individually. Incomplete
coverage findings survive a format-only review repair. A checked draft cannot
publish through the invalid-review-JSON fallback. No scores are manufactured and
no unresolved factual blocker is waived.

Already passed legacy drafts can still resume through existing verification.
Checked drafts carry a separate check fingerprint, recompute their checks on
resume, and preserve that fingerprint after a fresh source-metadata review. The
visible-article fingerprint stays compatible with offline translation. EN/AR
translate the reviewed visible article; the Chinese check sidecar is not rendered
or translated.

Regression evidence includes the actual row 709 final article and independent
blockers (authored content and source provenance only), not third-party source
bodies. The regression demonstrates that old structural acceptance alone passed
that article and the new joint-budget check rejects its 76 <= 80 contradiction.

## Compact shared models and bounded recovery

Recovery run 36793098401 exposed another problem: revision 4 repeated the same
ordered program in all 23 cases. Its check sidecar was 27,883 bytes and the full
article JSON was 50,643 bytes. Independent review also correctly identified
missing interactions between resource feasibility and the error gate; arithmetic
success did not establish semantic completeness.

Version 2 defines `models` once, with default inputs, derived expressions and
ordered rules. Each case supplies a model name, numeric input overrides, its
current-body quote and expected choice. There are no per-case rule overrides.
Version 1 remains readable. Prompt-only conversion preserves every case, input,
program, ID and computed outcome; stored audits and their fingerprints are not
rewritten. The real 23-case fixture falls to 5,632 check bytes, with identical
computed results. Duplicate effective inputs remain prohibited after inheritance.

Revision prompts avoid repeating successful case input traces already present in
the article and state common instructions once. They retain all historical IDs,
problem text, statuses, independent findings, numeric errors and final choices.
Author-only `revision_response` can share one explanation via `issue_ids` when
the same change, location and verification truly applies. Validation expands the
IDs and still rejects missing, duplicate, unknown or malformed obligations.
Independent blocker and coverage review remains per ID; it is never grouped away.

New drafting instructions ask for one complete ordered rule system, with other
tables referring to its scope, and explicit interacting boundaries. This avoids
recreating partial conditions in multiple places. None of the compaction changes
raises the attempt count, per-request token limits, daily spend rules or run cap.

A length-limited completion is still rejected, including syntactically valid
partial JSON. When its transport finishes cleanly, confirmed provider usage is
recorded before the existing bounded recovery. Missing stream terminators,
malformed frames, decreasing usage counts and totals inconsistent with their
parts retain the full token reservation. No pricing window or spending limit
changes, and this accounting repair never grants content acceptance.

## Reviewer contract failures retain the article

Recovery run 36796063312 revision 5 had a 25/30 review, complete coverage of all
53 submitted IDs, and three concise, concrete Chinese findings. The previous
validator wrongly required at least 20 characters per finding and then counted
those valid IDs as absent. That integration error started an unnecessary author
rewrite, which introduced new quote mismatches and a new unrepresented threshold.

Coverage findings now require nonempty text and each submitted ID exactly once;
there is no arbitrary minimum prose length. Missing or malformed reviewer IDs,
fields and verdicts receive one bounded review-only repair on the same article
and checks. If the repair is still invalid or the provider cannot complete it,
the checkpoint remains `review_pending` and stops. A checked article without
valid review JSON also stays pending. Resuming verifies both stored fingerprints
and reviews that exact draft without an author or auxiliary metadata request.

Actual incomplete coverage, missing decision cases, unsupported claims and
unresolved historical findings remain publication blockers. A failed format
repair preserves the first review's findings even when a provider or cost-window
exception interrupts the second request. Schema diagnostics are recorded
separately and do not become requests for the author to change the article.
These transitions neither manufacture a review verdict nor reuse revision 5 as
authority to ignore the later revision's substantive blocker. A new editorial
revision still needs a fresh independent review of all current and historical
obligations.
