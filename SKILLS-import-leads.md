# import-leads: what each skill does

Part 3 for `import-leads`, the first job plugin. Two skills, in the same five
slots as the other skill files: what it does, when it runs, what it reads and
writes, what it does not do, and the judgment it carries.

This plugin owns no database and no schema file. A job plugin is named for its
job, and this one's job is taking a lead list from wherever it lives and landing
it in the CRM correctly. It reads the source list, reads its judgment from
Process artifacts, and reads and writes Salesforce.

Written 2026-08-25. The plugin and skill names are Sarah's, confirmed the same
day: the tier-2 placeholder name `list-building` is retired, because this
imports lists rather than builds them, and the old name stays free for a plugin
that actually builds lists.

---

## What this is a rebuild of

The reference set contains a lead-list import skill that ran this exact
pipeline in production, and it is the most used and most refined thing in the
reference. The rebuild rule, Sarah's call on 2026-08-25: **change the least
possible.** The pipeline shape, the ordering, the gates and the hard-won
refinements all carry over as they are. What moves is identity, not logic, and
identity moves into three homes:

- **Config holds identifiers.** The org, the field-name map, file paths.
- **Process holds judgment.** The rules the organisation decided, written as
  artifacts a person and a skill can both read.
- **The run confirms the rest.** Anything that is neither an identifier nor a
  standing rule is asked about at the moment it matters.

Nothing organisation-specific from the reference appears in this repository:
not its picklist values, not its record type ids, not its field API names, not
its routing. Each of those becomes a config entry or a Process artifact that
the installing organisation fills with its own answers.

---

## Rules that apply to both skills

The marketplace's shared rules apply where they reach: a hard confirmation gate
before any write, previews shown in full inline, route to `setup` on first run
when the foundation's config is absent, and record only sources actually
opened. Five more belong to this plugin.

- **Nothing is invented to complete a row.** Every filled value names its
  source: the list, the CRM, or an enrichment answer with the tool that gave
  it. A value with no source is refused. A thin row that says it is thin beats
  a thin row that looks finished.
- **Never guess a person.** An owner comes from a routing artifact or from an
  explicit confirmation, never from a default and never from a guess.
- **Fill blanks only, in both directions.** An enrichment result never
  overwrites a value the source list provided, and a writeback to the source
  never overwrites a value already there.
- **Anything metered or paid is named and confirmed before it runs.** The
  reference ran a paid email-verification pass only on an explicit yes, and
  that rule generalises to every step that costs money.
- **No credentials, tokens or keys, ever**, in any file, property or preview.

---

## Where the judgment lives

Config sits at `~/.claude/import-leads.config.json` and holds identifiers
only: the org, the field-name map including any custom fields the org wants
filled (a LinkedIn URL field, a persona field), and the path to the company
alias map. The alias map itself is a user-owned file at a configurable path,
the same pattern as the artifact-type taxonomy, so a team can keep it in a
repo and change it by pull request.

Three Process artifacts carry the organisation's rules, read at run time:

1. **The required-fields rule.** Which fields the org requires on a contact
   before it may be created, and the value the org uses for the lead source.
2. **The campaign member-status grid.** Which member status a row gets, by
   campaign type and by what is known about the person's engagement.
3. **Personas, optional.** The persona list and its title-mapping rules. When
   this artifact exists, the persona step runs and unclear titles are flagged
   for review rather than guessed. When it does not exist, the step is skipped
   without complaint. Sarah's call, 2026-08-25.

A routing artifact is a fourth, also optional: absent, every owner is
confirmed by hand, which is the honest default for an org that has no routing.

A missing required artifact is named, not worked around. `check` says which
artifact is missing and that `process:new` is where it gets written. `run`
refuses the step that needs it rather than inventing a fallback, because a
grid this plugin invents is exactly the thing the design says lives in
Process. No plugin calls another plugin's skill.

---

## run

**What it does.** Takes one named list and lands the approved rows in
Salesforce: cleaned, deduped, matched to accounts, on the right campaigns with
the right member statuses, verified, and written back to the source.

**When it runs.** A lead list arrives: a conference follow-up, a content-
download export, a vendor handoff, a spreadsheet somebody kept.

**What it reads and writes.** Reads the one source the user named, a CSV file
or a Notion page or database, never a search. Reads Salesforce to match
accounts and contacts, showing what it found for confirmation rather than
asking anyone to type what it could look up. Reads the Process artifacts
above. Writes contacts, accounts, campaigns and campaign memberships, each
push behind the confirmation summary. Writes back to a Notion source only into
blank fields.

**The pipeline, kept from the reference in order:**

1. **Scope.** One named source. The scope gate refuses rather than narrows,
   because there is no approval gate in front of a read: half a scope is
   refused as hard as none, and a source nobody named is never read.
2. **Map and normalise columns**, preserving the source's own column names for
   the writeback.
3. **Enrich, blanks only.** Gaps are named, and whatever enrichment the
   session actually has connected is offered the gaps. The plugin carries no
   enrichment vendor code at all; providers ship their own plugins, and this
   plugin's side is the gate. Paid verification runs only on a named yes.
4. **Personas**, only when the artifact exists. Unclear titles are flagged,
   never guessed.
5. **Company names normalised** against the alias map.
6. **Accounts matched or created.** A created account gets its website set
   when the list carries a domain, because that is what makes the next
   import's matching better.
7. **Dedupe against the CRM**, by email, in batched queries. Duplicates and
   cross-account conflicts are always presented, never auto-resolved.
8. **Multi-event detection, mandatory before campaign setup.** A list that
   covers several events or assets becomes several campaigns, and the signals
   (dates, locations, event names) are checked even outside the obvious
   column.
9. **Campaigns matched or created**, member statuses from the grid.
10. **The confirmation summary**: creates, updates, excluded rows and campaign
    assignments, shown in full, with an explicit yes before any push.
11. **Push in batches with partial-success semantics.** A duplicate campaign
    membership failing individually is expected, not an error.
12. **Verify** by querying back the records the creates returned, by id. The
    reference verified through a custom provenance field; a generic org does
    not have one, so the returned ids are the proof.
13. **Writeback** when the source was Notion: link each created record on its
    source row, fill email only if blank. A writeback failure is reported and
    never fails the run, because the CRM is the system of record.

**What it does not do.**

- Never writes without the confirmation summary and an explicit yes.
- Never guesses a person, an owner, or a persona.
- Never overwrites a source-provided value, in the CRM or in the source.
- Never auto-resolves a duplicate or a cross-account conflict.
- Never pads a row to pass the required-fields rule. A row that cannot meet it
  is refused with the gap named.
- Never reads outside the one named source.
- Never sends email, and never posts anywhere. The reference posted summaries
  to chat; that is cut, because announcing is not the plugin's job and the
  default has to work for someone with nothing else connected. The run's own
  report is the record.
- Never runs unattended. Nothing schedules it.

**The judgment it carries.** Three things.

1. **Whether two records are the same person or the same company.** Shown as a
   match with its evidence, decided by the person. The alias map holds the
   answers already settled so they are not re-asked.
2. **Whether this is one campaign or several.** The multi-event check is
   mandatory because the expensive mistake is one campaign wrapped around
   three events, discovered after the memberships are written.
3. **Which member status each row gets**, read from the grid and never from a
   built-in table. When the grid does not cover a row, that is a question, not
   a default.

---

## check

**What it does.** Says whether an import would work, before anyone is
mid-import, and what it would do. Two halves. The standing half: the required
artifacts exist in Process, config points at an org, the connection is alive.
The per-list half, when handed a list: how many rows would be new, how many
match existing records, how many are ambiguous, and which rows fail the
required-fields rule, with the failing field named per row.

**When it runs.** Before the first import ever, after anything about the org's
rules changes, and before a big list where finding out mid-run would be
expensive.

**What it reads and writes.** Reads the config, the Process artifacts, the CRM
and the list. **Writes nothing at all**, anywhere, and never runs a paid step.

**What it does not do.**

- Never fixes what it finds. A missing artifact is named, with `process:new`
  as the place it gets written. A dead connection is reported, not repaired.
- Never turns into the import. It hands its findings to `run` and stops.

**The judgment it carries.** Telling the three kinds of not-ready apart: a row
that can never import (refused, with the gap named), a row that needs a
person's answer (ambiguous match, uncovered status), and a setup that is not
ready at all (missing artifact, no org). Collapsing those into one number
would make the preview useless, so they are reported separately, the same
distinction the foundation's audit makes between empty and unknown.

---

## Why there is no enrichment skill

Enrichment providers ship their own plugins and skills, so a skill here that
just enriches would duplicate what the vendor maintains. The seam is step 3 of
`run`: the gaps are named, whatever is connected is offered them, and the gate
does the rest. A filled value names its source or it is refused, and person
fields stay empty whatever a tool claims. There is nothing to configure, so
there is nothing to be locked into, and someone with no enrichment tool still
gets a working import with its gaps named honestly.

---

## Salesforce, and what has actually been measured

v1 writes Salesforce and nothing else, the same one-store rule as the backend
choice: an untested store half-works and the plugin gets blamed. The reference
ran on the Salesforce CLI rather than on any MCP connection, so the CLI is the
assumed surface here too.

**Nothing in this design has run against a real org.** No Salesforce surface
is connected on the machine this was designed on, and the CLI is not
installed. Every Salesforce behaviour named above (matching, batched creates,
partial-success semantics, member-status creation) is carried from the
reference as design intent, not as a measurement of this rebuild. The live
acceptance run against a real org is the release gate, the same rule
`calendar` set: this plugin is not finished until it has pushed one real row,
verified it by reading it back, and been torn down cleanly. A free Developer
Edition org is the intended target for that run.

---

## Open

1. **The Salesforce surface is assumed, not measured.** The CLI, its auth, and
   what its create and query calls actually return all need a measurement
   session against a real org before anything is built on them.
2. **Contacts versus leads.** The reference wrote contacts with accounts, and
   this design follows it. An org that works lead-first is real and unhandled,
   and supporting it is a design decision, not a flag.
3. **The alias map's shape** is undefined beyond "a user-owned file". It
   should be settled in the build against real examples, not invented here.
4. **What `check` can say about a Notion source** without the foundation
   installed. The plugin should work for someone using only Salesforce, and
   where that line sits (which halves of `check` still run) needs one
   deliberate pass in the build.
