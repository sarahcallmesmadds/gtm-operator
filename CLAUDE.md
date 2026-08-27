# gtm-operator

A Claude Code marketplace that builds a go-to-market operating system in Notion.
The design is one plugin per foundation object under `plugins/`, plus job
plugins named for the work they do, built from the design documents at the
root. `setup`, `calendar`, `process`, `memos`, `projects`, `software` and
`import-leads` are built.

**The design lives in the design documents, not in this file.** `DECISIONS.md`
at the root holds the reasoning and the reversals, each plugin's own
`SCHEMA.md` defines its database, each plugin's own `SKILLS.md` defines its
skills, and `plugins/setup/scripts/manifest.js` is the machine-readable
definition of what an install creates. Restating any of it here would be a
copy, and copies drift.

## Layout

- `plugins/setup/`: creates every database, wires the relations, writes the one
  config file the other foundation plugins read. The only plugin that creates
  the foundation's databases or touches the foundation's config. A job plugin may keep
  a private config file of its own, which no other plugin reads or writes;
  `plugins/import-leads/` is the first such plugin, defined by
  `plugins/import-leads/SKILLS.md`. It vendors nothing from `shared/` and reads no
  foundation config
- `plugins/setup/scripts/manifest.js`: what gets created, in one file
- `plugins/calendar/`, `plugins/process/`, `plugins/memos/`,
  `plugins/projects/`, `plugins/software/`: writing plugins. Each reads config
  through its vendored copy of `shared/config-read.js` and creates no databases
- `shared/`: the source of every vendored file. `node scripts/vendor.js` copies
  it into each plugin, which declares what it wants in its own manifest under
  `gtmOperator.vendor`. **Re-vendor after touching `shared/`**, or a plugin runs
  against a copy that is one edit behind
- `plugins/<name>/SCHEMA.md`: one per database, except `plugins/projects/SCHEMA.md`, which covers
  Projects and Tasks because they are one job
- `plugins/<name>/SKILLS.md`: one per plugin
- `tests/`: run by `sh tests/run.sh`

## Rules that are not obvious from the code

**This repository is public.** Nothing goes in it that is not meant to be
published, and that includes the history: a commit is published the moment it is
pushed, and a force push does not make GitHub forget, because the pre-rewrite
commits stay reachable through a pull request's stored refs until GitHub
collects them. A test fixture is a publishing surface like any other file, so a
captured API response has its free text redacted and its identifiers remapped
before it lands here, keeping the mapping consistent so relations still resolve.

**The reference set is deliberately unnamed.** It is an export of the internal
skills and schemas from a prior engagement, and "the reference" is the term
throughout. Do not reintroduce the organisation's name, its repository names or
its file paths anywhere in this repository. Recorded in `DECISIONS.md`, which
nothing loads automatically.

**Notion testing happens under the `Plugins testing` page and nowhere else**, in
the real workspace, by Sarah's decision on 2026-08-17. Everything created there
is deleted afterwards and the page read back to confirm it is empty. Nothing is
created anywhere else in that workspace.

**The page id is deliberately not written here**, because this repository is
public. It is in the gtm-operator handoff.

**Deleting that test data is not reversible from here**, which is worth knowing
before you start rather than after. The connected Notion client has no delete
and no restore command. The only route is to replace the parent page's content
with nothing and pass `allow_deleting_content`, which sends every child not
named in the new content to the trash, cascading to everything beneath them.
Getting any of it back is a click in the Notion trash by a person. So read the
page and confirm what is on it before emptying it, and expect to be able to
undo nothing yourself.

**The unmeasured statement gets written down here, not by the skill.** `check`
can send one thing this plugin has never watched run, the statement that adds a
lost select value back, and it reports what happened rather than recording it.
Recording it is a job in this repository: put what it did in `DECISIONS.md`,
dated. The skill deliberately does not, because it ships as a plugin and
`DECISIONS.md` is a file here, so an installed copy writing to that name would be
writing into a stranger's working directory.

**No skill is named or created without Sarah's explicit yes.** This covers new
skills and renames of existing ones.

**A create call that returned without an error proves nothing.** Notion accepts
some things it cannot do and discards them silently, and which failure you get
depends on the property type: a view carrying a rollup filter is created and
reported as created, and the filter itself is silently discarded, while a
relative date filter is stored, reads back correctly and matches nothing.
Anything built against this API is proved by reading it back, and a view is
proved by the rows it returns rather than by the filter it reports. The
measurements behind this are dated in `DECISIONS.md`.

**A count written beside the thing it counts is a copy.** Derive it from
`manifest.js` or point a reader at `node plugins/setup/scripts/manifest.js
--summary`. `tests/manifest-agrees-with-design.test.js` enforces this under
`plugins/` only. The root documents are deliberately outside it, and that gap is
documented in the test rather than hidden.

## Verifying a change

`sh tests/run.sh` runs every suite. A check is proved by breaking the thing it
watches and confirming it goes red, and where that has not been done the test
file says so rather than letting a green tick imply it.
