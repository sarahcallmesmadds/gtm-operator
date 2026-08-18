# After the install runs

Two things the install cannot do for you. Both take a few minutes in the Notion
UI, and both are worth doing before anyone else touches the workspace.

The install flow prints this list when it finishes. It is repeated here so it
survives the terminal scrollback.

---

## 1. Convert every Status property to the status property type

**Why it is not automatic.** The API cannot make a status property at all. Both
DDL forms were measured on 2026-08-18 and both are refused at the parser, before
anything about the options is even considered:

```
ALTER COLUMN "Status" SET STATUS('Draft':yellow, 'Published':green)
  -> 400 validation_error, "Expected ADD, DROP, RENAME, or ALTER keyword"

ADD COLUMN "Stage" STATUS('Draft':yellow, 'Published':green)
  -> 400 validation_error, same parser error
```

There is no route to one through this API, with or without options. **So the
install ships all six as selects carrying the right values, and you convert them
by hand.**

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
| Tasks | Not started, In progress, Blocked, Done, Canceled | Not started | In progress, Blocked | Done, Canceled |

**Tasks is on that list, and this document used to say it was not.** Until
2026-08-18 it said Tasks already shipped as a status property and needed no
conversion, which was wrong in a way that mattered: anybody following it would
have skipped the one conversion that something else depends on. `Percent
complete` on Projects rolls up task status by group, group rollups exist only on
status properties, and so the rollup stays empty until Tasks is converted.
`schema.js` has always created it as a select like the other five, and there was
never any code that could have done otherwise.

**Blocked earns its place**, and it is the one option here that is not obvious.
It is somebody else's move, so the action is to chase, where not started means
nobody has begun. Collapsing the two loses which it is, and that is the first
thing anyone asks about a stalled task.

**Canceled belongs in Complete, not in its own limbo.** A cancelled task that
sits outside Complete holds a project below 100% forever, and the first person to
notice will close it as Done instead, which loses the record that it was dropped.

**Check it worked, and check it in the UI.** Open a project with tasks and
confirm `Percent complete` shows a number. If it is blank, the rollup lost its
target during the conversion and needs pointing back at `Status` with Percent per
group, Complete. This has to be read on the page: rollup and formula values
cannot be read through the API at all, and on 2026-08-18 two wrong aggregations
were returned by the API looking correct and were caught only by eye.

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
