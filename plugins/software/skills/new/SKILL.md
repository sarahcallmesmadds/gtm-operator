---
name: new
description: Add one tool to the Software directory, filled in conversation. Use when the user says "add this tool", "we just bought", "put Gong in the directory", "write down what we use for", or notices a tool everybody uses was never written down. Checks for a duplicate before drafting; never guesses an owner or an importance; writes nothing without an explicit yes.
allowed-tools: Write, Bash(node:*), mcp__*__notion-fetch, mcp__*__notion-query-data-sources, mcp__*__notion-create-pages, mcp__*__notion-update-page
---

# new

One tool, added to the directory, with the five questions answered: what we
use, who to ask, what breaks without it, what we are committed to, and
whether it can go near our data.

## How this skill works

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" directory
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" duplicates <rows.json> <name>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" check <proposed.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" create <tool.json>
node "${CLAUDE_PLUGIN_ROOT}/scripts/software.js" prove <tool.json> <readback.json> <created-url>
```

If config is absent the script refuses and names `setup`. Never invent a
select value; fetch the live options before choosing any. Preview everything
inline and write only on an explicit yes.

---

## Step 1. The duplicate check, before drafting

Run `directory`, send its query, and pass the saved rows to `duplicates`
with the proposed name. An exact match means this is `update`'s job, not a
second row. A near match is a question to settle before drafting, with the
test below.

**Is this one tool or several.** The most common structural mistake in a
tool directory: Google Workspace, Salesforce with three paid add-ons, an AWS
account with nine services. **One row per thing you could cancel
separately.** If dropping it means a separate conversation with a vendor and
a separate line on a bill, it is its own row. If it goes away when the
parent goes away, it is a sentence in the parent's Notes. The test is about
the contract, deliberately, because the contract is what this database
tracks and everybody can answer it.

## Step 2. Fill the row, asking the questions properly

- **`Importance` is never asked as "how important is it".** Everybody says
  very. Ask what stops working and how quickly, and pick the value from the
  answer: blocks revenue work the same day, degrades work that week, or
  Standard, which exists so the honest answer has a home. The What It Does
  For Us section ends with what breaks if it stops, which is what makes the
  chosen value checkable.
- **`Notice deadline` is computed, not asked.** Nobody knows the date off
  the top of their head. Ask how much notice the contract requires, then
  compute the date from the contract end. Thirty days before 2026-12-31 is
  2026-12-01.
- **`Annual cost` is annualised on the way in.** A monthly price is
  multiplied by twelve, and an estimate is fine and expected. The billing
  shape, the tier and its limits go in Notes.
- **`Contract link` is a Google Drive link.** A PDF in Drive can be read
  through the link; a PDF uploaded into Notion cannot, which is measured and
  is why the property carries its own description. The script raises a link
  into Notion as a question.
- **Person fields are filled only with people the user names**, as ids or
  `me`. An empty person field asks a question; a guessed one answers it
  wrongly. If one proves unfillable, `Admins` is the designed one to drop.
- **Unknown is a real value** on `Renews`, `AI access`, `Stores PII`,
  `SOC 2` and `SSO`. Blank means nobody looked; Unknown means somebody
  looked and could not tell, which is a different row on a list of work.

## Step 3. The body: four light sections

What It Does For Us (plain language, for somebody who has never heard of the
tool, ending with what breaks if it stops), How To Get Access (who to ask or
"single sign-on, just log in" — the script refuses a bare department),
Vendor Contacts (our rep, the escalation path, or "no rep, we are on our
own"), and Notes only if there is something for it.

**Ceiling of 400 words across the required sections.** Over it, the script
raises a question rather than trimming: this row is an index entry, and
length means a Technical Reference is owed in the Process library.

**No credentials, tokens or keys, ever.** Not in a property, not in the
body, not in a preview. Name the vault or the variable. This page already
holds the login URL, which makes it the most tempting place in the design to
put a password.

## Step 4. Preview, then write, then prove

Show the full row and body inline and wait for the yes. Create the page,
read it back, and run `prove` with the url the create returned. A create
call that returned without an error proves nothing.

**The Artifacts and Integrates with relations are not written**, and the
output says so. Name what should be linked so a person can make the links.

---

## What this skill does not do

- **Does not guess `Importance`**, an owner, or a contract fact it cannot
  verify. An empty `Notice deadline` is a question; a guessed one is a
  missed renewal.
- **Does not create a second row** for something already in the directory.
- **Does not write depth.** How a tool is wired is a Technical Reference in
  the Process library, related through Artifacts.
- **Does not touch `Last reviewed` after creation.** It is stamped once
  here, and after that only a confirmed `review` moves it.
