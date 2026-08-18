# After the install runs

Two things the install cannot do for you. Both take a few minutes in the Notion
UI, and both are worth doing before anyone else touches the workspace.

The install flow prints this list when it finishes. It is repeated here so it
survives the terminal scrollback.

---

## 1. Convert every Status property to the status property type

**Why it is not automatic.** The API can create a status property, but it cannot
create or rename its options. Sending options with the type is rejected outright:

```
ALTER COLUMN "Status" SET STATUS('Draft':yellow, 'Published':green)
  -> 400 validation_error, "Expected ADD, DROP, RENAME, or ALTER keyword"
```

Convert through the API and you get Notion's defaults, Not started / In progress
/ Done, on every database. That is wrong for four of the six and it silently
discards the values the design chose. **So the install ships them as selects with
the right values, and you convert them by hand.**

**What you gain by converting.** Status properties carry three groups, To-do, In
progress and Complete. Grouping is what makes a rollup like `Percent complete`
possible, and it is what board views group by without extra configuration.

**How, per database.** Open the database, click the `Status` property, change its
type to Status, then drag each option into the right group.

| Database | Options, in order | To-do | In progress | Complete |
|---|---|---|---|---|
| Process | Draft, Active, Archive | Draft | Active | Archive |
| Software | Evaluating, Active, Sunsetting, Retired, Rejected | Evaluating | Active, Sunsetting | Retired, Rejected |
| Memos | Draft, Published, Canceled | Draft | | Published, Canceled |
| Projects | Intake, Scoped, In progress, Done, Canceled | Intake, Scoped | In progress | Done, Canceled |
| Calendar | Idea, Planned, Confirmed, Done, Canceled | Idea, Planned | Confirmed | Done, Canceled |

**Tasks is already a status property and does not need converting.** It ships
that way because `Percent complete` on Projects rolls up task status by group,
and that rollup only exists for status properties.

**It ships with Notion's three defaults, which are too few. Add these.**

| Option | Group | Why it earns a place |
|---|---|---|
| Not started | To-do | Ships by default |
| In progress | In progress | Ships by default |
| **Blocked** | In progress | Waiting on someone else. Distinct from not started, because somebody has already tried |
| **Paused** | In progress | Deliberately stopped by us. Distinct from blocked, because nothing external is holding it |
| Done | Complete | Ships by default |
| **Canceled** | Complete | Decided against. Counts as complete so it stops dragging `Percent complete` down forever |

**Blocked and Paused are the pair worth keeping separate.** Blocked is somebody
else's move, so the action is to chase. Paused is our own decision, so the action
is to revisit. Collapsing them loses which one it is, and that is the whole
question anyone asks about a stalled task.

**Canceled belongs in Complete, not in its own limbo.** A cancelled task that
sits outside Complete holds a project below 100% forever, and the first person to
notice will close it as Done instead, which loses the record that it was dropped.

**Check it worked.** Open a project with tasks and confirm `Percent complete`
shows a number. If it is blank, the rollup lost its target during the conversion
and needs pointing back at `Status` with Percent per group, Complete.

---

## 2. Customise the layout on each database

**Why it is not automatic.** The API reaches the schema and the view
configuration. It does not reach the page layout, which is where property
grouping, the tabbed sections and the pop-out sidebar live. Those are UI only.

**Without this step every row page is a flat list of every property in an order
nobody chose.** On a database with twenty-plus properties that is the single
biggest reason a well-built workspace is unpleasant to use.

**What to do, per database:**

1. Open any row, then `...` and **Customize layout**.
2. **Group the properties** into sections that match how somebody reads the row.
   For Software that is: what it is, who owns it, the contract, risk, and the
   pointers. For Process: what and who, then freshness, then the relations.
3. **Move the related databases into tabs** across the top rather than leaving
   them inline. A project with tasks, calendar rows, memos and artifacts is four
   tabs, not four stacked lists.
4. **Put the rarely-read properties in the sidebar**, so the page opens on the
   content rather than on `Created time`.
5. **Apply to all pages** in the database when Notion offers, or you have done it
   for one row only.

### Screenshots

Screenshots of the intended layout live in `docs/layout/`, referenced from the
README.

- `docs/layout/software-row.png`
- `docs/layout/project-row.png`
- `docs/layout/process-row.png`

**Nothing in a screenshot may show real workspace data.** This repository is
public. Take them against the test workspace, or blur, before committing.

**Not yet taken.** The three files above do not exist. Until they do, this
section is instructions without pictures, which is the part it most needs.
