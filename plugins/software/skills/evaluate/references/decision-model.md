# Software evaluation decision model

This is the operative reference for `software:evaluate`. It keeps the main
skill short while making the evidence and recommendation contract inspectable.

## Source matrix

| Source | It may prove | It does not prove |
|---|---|---|
| Software directory | Recorded tools, owners, contract facts, importance, risk, and dependencies | That a stale row is still true |
| Box, Google Drive, DocuSign | Signed terms, proposals, security documents, implementation plans | Adoption or business value |
| Ramp, QuickBooks | Observed spend, booked obligations, payment history | Terms absent from the record, active use, or value |
| Gmail | Named vendor threads, quotes, renewal or procurement context in the user's mailbox | Organization-wide agreement or adoption |
| Slack | Named workflow consequences and internal experience in approved channels or conversations | Paid status, exact usage, or contract terms |
| Google Calendar | Vendor and internal meeting metadata | What was decided or said |
| Granola | Notes or transcripts from approved meetings | Facts beyond the recording and attendee scope |
| Gong | Transcript-derived call evidence from approved calls | Raw transcript coverage unless the connected surface returns it |
| Vendor docs and web | Public capabilities, pricing, security claims, and alternatives | Internal adoption or successful implementation |
| User collateral or export | Facts in that exact artifact | Live usage after its date or outside its scope |

Use the strongest source for the claim, not one universal hierarchy. Signed
terms govern obligations. Finance governs observed payments. Telemetry or a
dated export governs measured adoption. Internal conversations govern stated
workflow impact. Vendor sources govern vendor claims. Show credible conflicts
with both dates and leave them unresolved. The checker copies every assessment
conflict into the deliverable; draft prose cannot drop it.

## Recommendation precedence and meaning

Apply states in this order:

1. Validate scope, provenance, coverage, and dependencies.
2. Test an evidenced hard stop.
3. At a final stage, test terminal-positive outcomes.
4. Test the active or incomplete POC state.
5. Test a bounded new POC.
6. Test bounded research.
7. Test a documented deferral.
8. Otherwise return `Insufficient evidence`.

- `Stop`: evidence shows the need is not real, the current stack meets it, or
  a material blocker cannot be resolved. Missing evidence alone is not Stop.
- `Defer`: the need is validated, but a timing, priority, budget, or ownership
  constraint blocks this decision window. Name a revisit trigger and date.
- `Continue research`: an active decision has a decision-critical gap closable
  through bounded research without using the product.
- `Run POC`: problem, use cases, success criteria, owner, and timebox are
  explicit; the uncertainty needs hands-on use; no hard blocker decides it.
- `Complete POC`: the POC is running or ended without planned results. Name the
  missing criterion evidence and completion step.
- `Buy candidate`, `Buy named alternative`, and `Build`: every common and
  outcome-specific terminal gate below passes.
- `Insufficient evidence`: scope or provenance is invalid, a material conflict
  blocks classification, no justified bounded next step exists, or a terminal
  tie is unresolved.

## Stage ceiling

| Stage | Highest positive recommendation |
|---|---|
| Research | Continue research or Run POC |
| Demo | Run POC |
| POC planned, running, or incomplete | Complete POC |
| POC complete or final decision | Buy candidate, Buy named alternative, or Build, if its gates pass |

Research and demos cannot justify purchase. A POC with missing results can
justify finishing the POC, not buying.

## Terminal-positive gates

Every Buy or Build outcome requires evidence that:

- the business problem is real and materially unmet, beyond vendor claims;
- the problem and concrete use cases are explicit;
- success criteria were met with evidence beyond vendor claims;
- current-stack overlap is resolved;
- implementation and migration work is understood;
- material security and data risks are addressed or have named owners;
- dependency coverage is complete;
- no material data gap undermines the conclusion; and
- every accepted-scope `knownBlockers` entry is resolved by non-vendor,
  option-bound `blocker-resolution` evidence with a verified structured value.

Except for the decision-wide business need, each terminal gate is
option-specific. Its evidence record's structured `value.optionId` must match
the candidate, named alternative, or build being tested. A candidate POC,
quote, implementation plan, or security review cannot qualify another option.

`Buy candidate` and `Buy named alternative` also require verified current price
and material terms. Material-terms evidence comes from `signed-terms` and uses
a verified `material-terms` value bound to that option ID. An alternative is named and carries its own evidence; the
candidate failing does not make an alternative pass.

`Build` also requires a technical spike or equivalent, understood always-on,
integration, data, security, reliability, and support behaviors, verified build
and maintenance cost, a named operating owner evidenced beyond vendor claims
without an unacknowledged key-person dependency, and evidence of
maintainability. A feature checklist is
not a build case.

## Terminal tie rule

When more than one terminal outcome passes, select one only when its verified,
comparable cost, fit, risk, implementation, and exit evidence is no worse on
every dimension and strictly better on at least one priority the user named in
the accepted scope. Assessment cannot introduce or change priorities.
These metrics are normalized so a higher value is better; the source ledger
must show the normalization. In the assessment input, each `metricEvidence`
entry is a non-empty list of evidence IDs, never a boolean. A qualifying record
uses criterion `decision-metric:<metric>` and a verified `normalized-score`
value bound to the same option ID, metric, numeric score, and
`higher-is-better` direction. A score without that record cannot resolve a tie.

An accountable user may resolve a remaining tradeoff by naming the option,
date, and accepted evidenced downside. That statement becomes a dated decision
criterion. Without strict dominance or that accountable choice, return
`Insufficient evidence`. Never hide the tie in a weighted score.

The cited record must itself be a `user-statement` from the named accountable
person on that date. Its verified `accountable-choice` value repeats the option
ID, person, date, and accepted downside. Matching those fields across unrelated
records or relying on a vendor claim does not resolve a tie.

## Normalized evidence examples

```json
{
  "id": "signed-quote-2026-08-20",
  "sourceKind": "signed-terms",
  "locator": "contract:vendor/order-form/2026-08-20",
  "observedAt": "2026-08-20",
  "claim": "The annual subscription price is the recorded amount.",
  "classification": "observed-fact",
  "criterion": "price",
  "stance": "supports",
  "scope": { "provider": "docusign", "account": "Procurement" },
  "value": { "kind": "money", "amount": 12000, "currency": "USD", "period": "annual", "optionId": "candidate", "verified": true }
}
```

```json
{
  "id": "vendor-feature-page",
  "sourceKind": "vendor-web",
  "locator": "https://vendor.example/features",
  "observedAt": "2026-08-28",
  "claim": "The vendor says its product supports the named integration.",
  "classification": "vendor-claim",
  "criterion": "success-criterion",
  "stance": "supports",
  "scope": { "url": "https://vendor.example/features" },
  "value": { "kind": "option-evidence", "optionId": "candidate", "successCriterion": "The live workflow meets its named accuracy target.", "verified": false }
}
```

The second record is a labeled vendor claim. It cannot by itself prove that a
success criterion was met in the user's work.

Material terms use the same option binding, with a `signed-terms` record whose
structured value is `{ "kind": "material-terms", "optionId": "candidate",
"verified": true }`. Its accepted boundary names Box, Google Drive, DocuSign,
or the exact user export as provider and inherits that provider's exact folder,
account, artifact, and date bounds. Both semantic signed-terms coverage and the
provider coverage must say searched. A public vendor terms page does not satisfy this gate.

## Assessment request shape

The deterministic assessor consumes evidence IDs. Terminal options have type
`candidate`, `alternative`, or `build` and a `gates` object. Common gate keys
are `businessNeed`, `success`, `overlap`, `implementation`, `migration`, and
`security`, each a list of evidence IDs, plus `noMaterialGaps: true`. Buy
options add `price` and `terms`. Build adds `technicalSpike`,
`operatingBehaviors`, `buildCost`, `technicalOwner`, and `maintainability`.
The candidate option has ID `candidate` and exactly repeats the accepted
candidate name. An alternative has the exact name-bound ID
`alternative:<name>` and a different non-empty name. The single internal build
uses ID `build` and name `Internal build`. An ID cannot be relabeled or changed
to another option type while retaining its evidence.

Use `facts.hardStop` only with `kind`, `reason`, and hard-stop evidence IDs.
Use `facts.pocMissingCriteria` for an unfinished POC. Each entry is
`{ "criterion": <an exact accepted success criterion>, "completionStep": <the bounded step that produces its missing result> }`.
The list must equal every accepted success criterion that lacks passing,
non-vendor candidate evidence; a partial or invented gap list cannot justify
`Complete POC`.
A new POC needs
`facts.pocPlan` with owner, from, to, `handsOnUncertainty: true`, and
`noHardBlocker: true`; its end cannot fall after a supplied required decision
date. Research gaps each name `gap` and `boundedNextStep`.
Deferral names constraint, trigger, revisit date, and evidence IDs, alongside
business-need evidence IDs.

## Required output

Lead with the recommendation and ceiling. Include these sections in order. If
one could not be established, say that plainly instead of filling it with
generic prose.

1. Recommendation and confidence
2. Problem and use cases
3. What the evidence proved
4. Current stack and overlap
5. Alternatives, including stay-put and a viable build option when applicable
6. Cost and total ownership picture
7. Implementation, migration, security, and governance
8. Decision roles and required approvals
9. Conditions for the next gate
10. Data gaps
11. Coverage and sources

Every decision-relevant factual claim has a stable ID in the draft's claim
ledger. A ledger entry projects exactly one evidence record, copies its claim
text exactly, and preserves that record's criterion, stance, and evidence ID.
Every report section is a non-empty list of those ledger IDs. The checker
expands the IDs into source claims instead of accepting free-form prose beside
a citation marker. Represent a conflict with separate entries for the
supporting and contradicting records. If the evidence carries a structured
value, the entry also names its exact `valueKind`; the evidence index preserves
whether that value was verified. The checker rejects
a hard-stop citation dressed up as pricing, a business-need claim repeated as
unrelated filler, a stance mismatch, and a structured-value-kind mismatch. Use an
explicit `data-gap` record for what could not be established. That record may
appear in the required section whose subject it explains, as well as in Data
gaps, so a missing price, alternative, security answer, or owner is not mislabeled
as a positive fact merely to keep a section non-empty. Use a `coverage`
record for the source-coverage statement. Coverage distinguishes searched,
unavailable, and not searched. Its source set and each entry's boundary exactly
match the approved scope.
Coverage is copied exactly from the validated assessment, including unavailable
reasons and search boundaries. The draft also copies `dataGaps` exactly; the
checker injects those assessed unavailable and unsearched entries into the Data
gaps section and preserves them at top level. The draft also carries the assessment's exact
`evaluationContext`, `stageCeiling`, `recommendation`, `nextStep`, and
`selectedOption`. The checked output preserves them together with the
deterministic reason and per-option gate results, injects the accepted context
into Problem and use cases, and injects a validated next step into Conditions
for the next gate. The final checker refuses missing sections, an assessment
mismatch, a deterministic-field mismatch, an unsupported claim, or incomplete
coverage.

## Worked edge cases

### Strong demo, no hands-on proof

The demo covers every requested feature and public pricing is available. Stage
is still `demo`. The maximum is `Run POC`; vendor demonstrations cannot prove
success in the user's work.

### Running POC with one criterion missing

Four of five success criteria have results. The correct state is `Complete
POC`, naming the fifth result and its completion step. It is not a Buy.

### Candidate versus build tie

Both pass every gate. Candidate has lower implementation risk; build has lower
exit cost. Neither is no worse on all five dimensions. Without a dated
accountable preference that accepts the downside, return `Insufficient
evidence`.

### Replacement target with an empty relation

The target's `Integrates with` field is empty, but another Software row points
to it. The reverse row is an affected dependency. Omitting it invalidates the
directory/dependency proof.

### Conflicting contract and payment evidence

Signed terms and a finance record show different amounts. Signed terms govern
the obligation; finance governs the observed payment. Show both, with dates.
If the discrepancy blocks comparable TCO, the recommendation is `Insufficient
evidence`, not whichever number makes an option win.

### Unknown pricing

No reliable current price was found. State pricing as unknown and identify the
comparison it blocks. The candidate and any named alternative without verified
price cannot receive a Buy recommendation.

### Net-new candidate absent from Software

Absence is acceptable only after the complete, count-checked directory survey
finds no exact candidate row and scope classifies it as net-new. A missing named
existing or replacement row is a refusal.
