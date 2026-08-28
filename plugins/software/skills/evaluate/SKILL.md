---
name: evaluate
description: Evaluate or compare a new tool, replacement, vendor demo, proof of concept, or build-versus-buy question with bounded, source-backed evidence. Use for "evaluate this tool", "should we buy or replace this", "help with a vendor demo or POC decision", "build versus buy", or "does this overlap our stack". Read-only: it never buys, contacts a vendor, or changes the Software directory.
allowed-tools:
  - Write
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-reference:*)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-run-start:*)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-run-cleanup:*)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-scope:*)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-survey:*)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-attest-related:*)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-directory-proof:*)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-dependencies:*)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" scan-evidence-file:*)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" read-scanned-evidence-file:*)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-evidence:*)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-assess:*)'
  - 'Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-check:*)'
  - WebSearch
  - WebFetch
  - mcp__*__notion-fetch
  - mcp__*__notion-query-data-sources
  - mcp__plugin_software_box__search_files
  - mcp__plugin_software_box__read_file_content
  - mcp__plugin_software_box__download_file_content
  - mcp__plugin_software_google-drive__search_files
  - mcp__plugin_software_google-drive__read_file_content
  - mcp__plugin_software_google-drive__download_file_content
  - mcp__plugin_software_gmail__search_threads
  - mcp__plugin_software_gmail__get_message
  - mcp__plugin_software_gmail__get_thread
  - mcp__plugin_software_gmail__list_threads
  - mcp__plugin_software_slack__search_messages_and_files
  - mcp__plugin_software_slack__read_channel
  - mcp__plugin_software_slack__read_thread
  - mcp__plugin_software_slack__slack_search_channels
  - mcp__plugin_software_slack__slack_search_public_and_private
  - mcp__plugin_software_slack__slack_read_channel
  - mcp__plugin_software_slack__slack_read_thread
  - mcp__plugin_software_slack__slack_read_file
  - mcp__plugin_software_ramp__*get*
  - mcp__plugin_software_ramp__*list*
  - mcp__plugin_software_ramp__*search*
  - mcp__plugin_software_ramp__*read*
  - mcp__plugin_software_ramp__*query*
  - mcp__plugin_software_quickbooks__qbo_accounting_get_ap_aging_detail
  - mcp__plugin_software_quickbooks__qbo_accounting_get_ap_aging_summary
  - mcp__plugin_software_quickbooks__profit_loss_quickbooks_account
  - mcp__plugin_software_quickbooks__cash_flow_quickbooks_account
  - mcp__plugin_software_quickbooks__company_info
  - mcp__plugin_software_docusign__*get*
  - mcp__plugin_software_docusign__*list*
  - mcp__plugin_software_docusign__*search*
  - mcp__plugin_software_docusign__*read*
  - mcp__plugin_software_docusign__*download*
  - mcp__plugin_software_docusign__*fetch*
  - mcp__plugin_software_google-calendar__*get*
  - mcp__plugin_software_google-calendar__*list*
  - mcp__plugin_software_google-calendar__*search*
  - mcp__plugin_software_granola__search_meetings
  - mcp__plugin_software_granola__get_meeting_transcript
  - mcp__plugin_software_gong__*get*
  - mcp__plugin_software_gong__*list*
  - mcp__plugin_software_gong__*search*
  - mcp__plugin_software_gong__*read*
  - mcp__plugin_software_gong__*query*
hooks:
  PreToolUse:
    - matcher: "mcp__plugin_software_(box|google-drive|gmail|slack|ramp|quickbooks|docusign|google-calendar|granola|gong)__.*"
      hooks:
        - type: command
          command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/guard-evidence-safety.js"'
    - matcher: "WebSearch|WebFetch|mcp__.*__notion[-_](fetch|query[-_]data[-_]sources)"
      hooks:
        - type: command
          command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/guard-evidence-safety.js"'
    - matcher: "Write"
      hooks:
        - type: command
          command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/guard-evidence-safety.js"'
  PostToolUse:
    - matcher: "WebSearch|WebFetch|mcp__plugin_software_(box|google-drive|gmail|slack|ramp|quickbooks|docusign|google-calendar|granola|gong)__.*|mcp__.*__notion[-_](fetch|query[-_]data[-_]sources)"
      hooks:
        - type: command
          command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/guard-evidence-safety.js"'
---

# evaluate

A read-only decision workflow. The full source contract, stage gates,
recommendation rules, output template, and edge cases are in
`references/decision-model.md`; run `evaluate-reference` and load its complete
output before assessing anything. This fixed command is the narrow read surface
for the shipped reference; no general filesystem Read permission is required.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-reference
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-run-start
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-run-cleanup <run-dir>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-scope <request.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-survey <request.json> <scope.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-attest-related <scope.json> <survey-plan.json> <artifact-pages.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-directory-proof <scope.json> <survey-plan.json> <before-manifest.json> <software-rows.json> <after-manifest.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-dependencies <scope.json> <directory-proof.json> <artifact-pages.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" scan-evidence-file <path>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" read-scanned-evidence-file <scope.json> <path>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-evidence <scope.json> <evidence.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-assess <request.json> <scope.json> <dependencies.json> <evidence.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" evaluate-check <draft.json> <assessment.json>
```

## 1. Establish and validate the read scope

Use facts already supplied. Ask only for missing candidate, vendor, problem,
concrete use cases, exact stage, current tool or workflow, decision date,
success criteria or blockers, and source boundaries. The exact stage values are
`research`, `demo`, `POC planned`, `POC running`, `POC incomplete`, `POC
complete`, and `final decision`. An incomplete POC ended without every planned
result; a running POC has not ended.

Run `evaluate-run-start` first. Put every request, raw response envelope,
scope, page body, evidence record, assessment, and draft inside its private
mode-0700 `runDir`; never write evaluation content into the repository or the
caller's working tree. Treat cleanup as a `finally`: run `evaluate-run-cleanup`
after success and after every refusal before returning. A new start refuses while
the pointer names an existing run. Start, stale-pointer replacement, and cleanup
hold the same private pointer lock, so cleanup cannot detach a newly started run
from its guard pointer. Clean the exact interrupted run before retrying.

Write the request JSON inside `runDir` and run `evaluate-scope` before any external read. A
common-word product name needs a category qualifier before any search. Gmail is
the authenticated user's own mailbox. Slack names channels or direct-message
conversations; at least one locator is required and direct messages are never
`all` or an all-DM alias. Connected file sources name folders; `user-export`
names the exact absolute artifact path that every normalized export record must use. `signed-terms`
names Box, Google Drive, DocuSign, or that user export as its provider and inherits
the provider's exact approved locator and dates. Financial and
signing systems name the account. Every external source has a date range.
When supplied, `artifactMaxAgeDays` is a positive whole number; an invalid
explicit limit is a refusal, not a route to the default.

If scope validation refuses, do not read the valid-looking half. Fix the scope
or stop.

Before the first read, write the `scopeFile` returned by `evaluate-run-start`
with `{ "scope": <the unchanged evaluate-scope output>,
"softwareDataSourceUrl": <the evaluate-survey softwareDataSourceUrl>,
"surveyPlanFile": <absolute private path to the saved plan>,
"softwareDetailsFile": <absolute private path reserved for the saved details result>,
"notionPageIds": [] }`. The PreToolUse guard refuses connector, Notion, and web
reads without that private file. The start command writes only a mode-0600 private
pointer path, never boundaries or evidence, in the user's private temporary directory. Every connector discovery call must carry an accepted locator
and both accepted date bounds in its actual tool input; exact-ID follow-ups for
an approved meeting or call stay constrained to that one accepted ID. Gmail
searches and lists carry the accepted date predicates; the search hook records
only returned message and thread IDs, and a later `get_message` or `get_thread`
may name exactly one of those IDs without repeating unsupported date fields. Use a
query/read surface that retains the bounds everywhere it supports them or stop.
Slack's packaged search uses its `after` and `before` Unix-timestamp fields;
packaged channel and thread reads use Unix timestamps in `oldest` and `latest`;
the older message-and-file search carries `after:YYYY-MM-DD` and
`before:YYYY-MM-DD` in its query. Use the field names provided by the selected
method. The guard normalizes timestamp fields back to the accepted calendar
days and refuses missing, competing, or out-of-range bounds.
Every web call names an approved domain.
Gmail's `before:` operator is exclusive, so its exact upper predicate is the
calendar day after the accepted inclusive `to` day; the guard computes and
enforces that translation.
After the complete Software details query is saved at `softwareDetailsFile`, replace `notionPageIds` with only the
candidate, replacement, affected Software, and directly related Process page
identities present in those complete rows before fetching their bodies. The guard
revalidates every listed and requested page identity from the canonical plan and
its own mode-0600 PostToolUse capture of the completed details responses, deriving only the candidate or replacement root,
its outbound and reverse-only Software dependencies, and their directly related
Process artifacts. For a net-new candidate, every current Software row is affected
for overlap analysis, so fetch every current Software body and every Process page
directly related from those rows. The model-written details artifact is still required for final
directory proof, but it cannot authorize a page read. A mutable list or saved
response cannot authorize an unrelated surveyed page.
Never add a page found outside that affected set. Cleanup removes the scope file and every
other run artifact together.

Never accept a credential in chat or in a file. Use an already connected source
or a scrubbed export. A local `user-export` boundary names its exact absolute
path. Run `read-scanned-evidence-file`; it scans and reads that accepted path in
one operation, returning content only when the scan is clean. `scan-evidence-file`
is the metadata-only preflight. A failed scan stops the workflow without printing
the matched value.

Box and Google Drive content reads use an exact-ID continuation. Their bounded
folder search must run first. The search hook records only the returned file IDs
inside the active private run; a later read or download is allowed only for one
of those IDs under the same unchanged scope and provider boundary. A file ID
typed or found elsewhere is not authorized.

## 2. Prove the current directory and dependencies

Run `evaluate-survey`. Execute its five steps in order under the one survey-run
identifier. Preserve each raw Notion response envelope. Consume every
continuation until `has_more` is false. Notion SQL does not expose
`last_edited_time`, so the manifest includes every decision-relevant Software
field plus `createdTime`; the checker fingerprints those values as the row
revision. If the surface does not return every planned manifest field, a stable
page identity, or a reliable completion signal, fail closed.
Each saved query artifact also copies the exact `query` string sent to Notion.
Do not reconstruct or label it afterward: the checker recomputes the request
fingerprint from that SQL and refuses a filter, limit, view, or different table.

The manifest runs before the detailed whole-directory query and again after
all related Software and Process reads. Fetch each candidate, replacement
target, outbound dependency, and reverse-only dependent as a page so its
Software body is present in `softwareBodies`. Fetch every `Artifacts` Process
page linked from those rows into `pages`, including both recognizable Type and
body, because dependency, wiring, or teardown detail may exist only there.
For a net-new candidate, treat the complete current Software directory as the
affected overlap set and fetch all of those bodies and directly linked Process
pages even when there is no replacement root.
Resolve Process Type through the config-recorded property and option names;
never normalize a shipped Type name by hand. If any `Integrates with` relation
in the complete directory, or an affected row's `Artifacts` relation, reaches
Notion's measured 100-item relation cap, stop because the relation is not
provably complete.
`artifact-pages.json` carries both lists, bound to the scope and survey run.
The PostToolUse guard records the before manifest, complete details retrieval,
every authorized page fetch, and after manifest in a mode-0600 sequence artifact
the model cannot write. It refuses a details query before the first manifest, a
page fetch before complete details, and a final manifest before the fixed
related-read attestation. It scans every response for credential shapes before
persisting any response content. Fetches within the Software group or within the
Process group may finish concurrently: the guard serializes its sequence updates
so no successful response can be lost. For every fetched page, copy the
response's exact page URL, properties, and complete body text into the matching
`artifact-pages.json` entry. Copy its page edit timestamp when present so the
artifact remains exactly response-bound, but do not treat a generic page edit
as a freshness review. The deterministic checker always uses the bookended
Software row's config-resolved `Last reviewed` date or the Process page's
config-resolved `Last checked for accuracy` date. A missing authoritative date
is a freshness gap. Failed
responses, wrong-page responses, and normalized fields that differ from the
captured response are refused.
Run `evaluate-attest-related` on the saved scope, plan, and both page-read
lists. It passes only when the hook captured every affected Software fetch
before every related Process fetch and the two exact fetched identity sets match
the completed details survey. Copy only its passing `precedingExecutions` into the saved
`manifest-after` artifact immediately after executing that final query. The
fixed command computes each artifact fingerprint; do not recreate a hash by
hand. `evaluate-directory-proof` then compares all five saved phase artifacts
with the hook-owned sequence. Page reads moved outside the bookends, reordered,
omitted, or edited afterward fail closed.

Run `evaluate-directory-proof`, then `evaluate-dependencies`. The dependency
step combines the target's outbound `Integrates with` values with every
reverse-only row that points at it. A one-way relation means the target's own
empty relation does not prove a zero blast radius. Do not assess a replacement
when a related artifact is missing, unreadable, unrelated, or too stale.

Any normalized `software-directory` evidence record must carry a verified
`software-directory-proof` value with the exact `directoryProofId`,
`dependenciesId`, and `surveyRunId` returned by those two commands. Do not
reuse a record from an earlier survey, even when the approved scope is the same.

## 3. Gather and normalize evidence

Read only approved sources. Use the strongest source for each claim: signed
terms for obligations, finance records for observed payments, dated telemetry
or an export for measured adoption, internal conversations for stated workflow
impact, and vendor sources for vendor claims. Calendar metadata does not prove
what was said. Gong's hosted MCP returns transcript-derived answers, not raw
transcript coverage. Label that distinction.

Every normalized record carries `id`, `sourceKind`, `locator`, `observedAt`
when available, `claim`, `classification` (`observed-fact`, `user-statement`,
or `vendor-claim`), `criterion`, `stance`, and the exact source boundary in
`scope`. Every coverage entry repeats that source's exact approved boundary;
the source set is exact. Unknown and not searched are different coverage states.
No evidence may be dated after the evaluation's `asOf` day.

When sources disagree, keep both, with dates. Do not select the convenient
value. Run `evaluate-evidence`; correct boundary, provenance, date, or secret
failures before assessment.

For any recommendation to buy, verify current pricing from a reliable source.
If current price is unavailable, say unknown and name the decision it blocks.
Do not estimate a price into a buy case.
Material terms also come from `signed-terms` and carry a verified
`material-terms` structured value bound to the same option ID.

## 4. Assess and check

Build the assessment request from evidence IDs, not unsupported booleans. Any
tie-breaking priorities must already be named in the accepted scope; assessment
cannot add or change them.
Every option-specific terminal record carries that option's ID in its
structured `value`; evidence for the candidate cannot qualify an alternative or
build. The candidate option uses ID `candidate` and the exact name accepted in
scope. A named alternative uses the exact ID `alternative:<name>` and a build
uses ID `build` with name `Internal build`; changing a type or name therefore
changes or invalidates its evidence binding. Run
`evaluate-assess`. The script applies the precedence, stage ceiling, terminal
gates, dependency coverage, evidence conflicts, and deterministic tie rule in
the reference. For a running or incomplete POC, each `pocMissingCriteria` entry
must name one exact accepted success criterion and the bounded `completionStep`
that will produce its missing result. The list must cover exactly every accepted
criterion still missing passing non-vendor candidate evidence. Never promote the
answer above its output.

Draft the inline evaluation in the required order and attach a claim-to-source
ledger plus exact coverage. Each ledger entry projects exactly one evidence
record: copy that record's `claim` text exactly, preserve its `criterion` and
`stance`, and name `valueKind` for any structured value. An explicitly unverified
vendor value remains visible as a labeled claim but cannot satisfy a terminal gate.
Each section is a non-empty list of claim-ledger IDs, not free-form factual
prose; `evaluate-check` expands those IDs into the source claims, so an uncited
assertion cannot ride beside a valid marker. Assessed conflicts are copied into
the checked report even if the draft does not name them. Put the assessment's
exact `evaluationContext`, `stageCeiling`, `recommendation`, `nextStep`, and
`selectedOption` (`null` when there is none), plus its exact deterministic
`reason` and `optionResults`, in the draft. `evaluationContext` preserves the
accepted candidate, problem, use cases, criteria, priorities, and decision
window after private-run cleanup. `nextStep` preserves the validated owner and
timebox for a POC, every research gap and bounded step, the exact unfinished-POC
work, or the deferral trigger. Every evidence ID in `requiredEvidenceIds` must appear through a ledger
claim in at least one section; terminal gate citations cannot be summarized
away. Run `evaluate-check`. Return only a passing checked
report. The checked output preserves those deterministic fields and is the
deliverable; it has no create or update payload.

## 5. Handoffs are offers, never implied writes

This skill does not buy the tool, contact a vendor, create a Software row,
change a row, or write a decision memo. After the user decides, it may offer:

- `software:new` to record a candidate under evaluation.
- `software:update` after real status or contract facts change.
- `process:new` to record a final, durable Strategy Decision when Process is
  installed.

The user invokes that separate skill, sees its full preview, confirms it, and
gets read-back proof. An evaluation recommendation is not write authorization.

Do not route an active-tool review here (`software:review`), an existing
contract deadline (`software:contracts`), or a renewal decision
(`software:renew`, not built in this release).
