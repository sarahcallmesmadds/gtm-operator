# software

The Software directory: what we use, who owns it, what we pay and when that
comes round again, and what would break if it went away.

It answers five questions, and every field earns itself against one of them:
what do we use and who uses it; who do I ask; what breaks if this goes away;
what are we committed to and when does that come round again; and can we let
this near our data.

**It is an index, not a manual.** Depth about how a tool is wired lives in
the Process library as a Technical Reference, related through `Artifacts`. A
Software row growing long is a Technical Reference waiting to be written,
which is why the body carries a 400-word ceiling and the script asks rather
than trims at it.

## The skills

| Skill | What it does |
|---|---|
| `new` | Adds one tool, filled in conversation, after checking for a duplicate. Asks what breaks and how fast rather than how important it feels |
| `update` | Changes the facts that changed, one row at a time, with no sweep in the way. Never moves `Last reviewed` |
| `review` | The full pass, walking the four groups in order, and the only skill after creation that moves `Last reviewed` — on an explicit confirmation |
| `contracts` | What is coming up and what happens if you do nothing, ordered by consequence rather than by date, ending with a count of the rows it could not assess |
| `backfill` | Finds the tools you already pay for from agreements, spend, accounting, a named contract folder, your own mailbox and bounded Slack context, offered as candidates approved one at a time. Never fills a person or the review stamp. Importance needs exact Slack evidence and the row-level yes |
| `evaluate` | A read-only, source-backed decision workflow for a candidate, replacement, demo, POC, or build-versus-buy question. Proves the full current directory and its reverse dependencies before applying a stage ceiling |

`backfill` packages Box and Google Drive for one named contract folder, Gmail
for a bounded search in the user's own mailbox, DocuSign for signed agreements,
Ramp and QuickBooks for spend evidence, and Slack for bounded evidence of what
breaks if a tool disappears. Every external connector is read-only; Notion is
the only service this plugin writes to.

`evaluate` can additionally use meeting metadata from Google Calendar, approved
Granola notes or transcripts, transcript-derived Gong evidence, and current
vendor or independent web sources. Every read stays inside a named account,
folder, conversation, meeting, call, mailbox, domain, and date range. Its stage
ceiling is deliberate: research or a demo may justify more research or a POC;
an unfinished POC may justify completing it; only a complete POC or final
decision can reach Buy or Build, and then only when every evidence gate passes.

The result is returned inline. It does not buy, contact a vendor, create or
change a Software row, or create a decision memo. After the user decides it may
offer `software:new`, `software:update`, or `process:new` as a separate handoff
with that skill's own preview, confirmation, and read-back proof.

## What is deliberately not built

- **No `find`.** The questions people ask a tool directory are view
  questions, answered by filtering fields the schema already has. The one
  question needing computation is the contract deadlines, and they have
  their own skill. A single search across all six databases is the obvious
  tier-two plugin, and building a fourth per-plugin find first would make
  that harder.
- **No scheduled runs.** `contracts` is fired by a person. v1 has no
  unattended runs anywhere in the marketplace.
- **No delete.** A tool that is gone goes to `Retired` and the row stays,
  which is what keeps the record of what was dropped.
- **No Tool Changelog.** Right idea, wrong version: its unattended watchers
  keep it out of v1, and when it ships it is a foundation plugin, because it
  owns a database.
- **No renewal decision workflow yet.** `software:renew` follows a separate
  plan and is not part of this release.

## The rules the scripts hold

- `Last reviewed` moves at a `new` creation and on a confirmed review, and
  nothing else moves it: not `update` whatever it changed, not `contracts`
  reading the row, and not a backfill creation, which deliberately leaves it
  empty so the row shows up for review. An edit that resets the freshness
  stamp suppresses the staleness warning for a whole cadence period.
- A person is never guessed. Four fields here are people, and an empty
  person field asks a question where a wrong one answers it.
- No credentials, tokens or keys, ever. This database holds the login URL,
  which makes it the most tempting place in the design to put a password.
- Every write is proved by reading the page back. A create call that
  returned without an error proves nothing.
- Every contracts report ends with what it could not assess, because an
  empty date does not match a date filter in Notion, and a report that
  silently omits half the directory reads as "nothing is due".
- Every evaluation recommendation is bounded by its evidence stage. Missing or
  conflicting proof closes the gate; it never defaults to a positive answer.

Needs the `setup` plugin, which it reads config from and never calls.
