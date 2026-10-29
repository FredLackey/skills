# braindump-interview

## What this skill does

`braindump-interview` fills in the unanswered questions that `braindump-review` writes to
`*-dump-review.md` files. It replaces `braindump-answer` and produces the same file results, but
it is faster to use.

`braindump-answer` shows one question and waits for the user to write or dictate a full answer.
`braindump-interview` reads the brain dumps and earlier answers first, then splits each question
into its separate decisions. For each decision it suggests two to four likely answers. The user
picks options, adds a short note, or types their own answer. The agent writes a clean answer into
the review file.

## How it is used

Run it from a repository that has review files in:

```text
docs/braindump/
```

For each unanswered item (an `*Answer*` section that holds only `-TBD-`), the skill:

1. Shows the question and its `*Why this matters*` text.
2. Asks every decision in that item at once, as multiple-choice questions. It uses the harness's
   structured question tool if there is one. Otherwise it lists lettered options, and the user
   replies with something like `1A 2C 3B`.
3. Marks an option as recommended when the brain dumps or earlier answers already point to it,
   and names the source.
4. Writes the answer as soon as the user replies, then shows what was written so mistakes are
   easy to spot and fix.
5. Checks every other unanswered item and fills in any that the new answer fully settles, just as
   `braindump-answer` does.

Besides choosing options, the user can reply **Out of scope** (writes `-OUT-OF-SCOPE-`, which
later reviews never ask about again), **Implementation** (writes `-IMPLEMENTATION-`, which hands
the details to engineering so later reviews and the PRD never ask about them), **Skip** (leaves the item as `-TBD-` and asks it once more at the end of the session), or **Stop**.

## What it creates or edits

It edits only the `-TBD-` lines in existing `docs/braindump/*-dump-review.md` files. It never
creates review files, never touches `_archive` folders, and never overwrites an answer it did not
write unless the user names that item.

## Workflow position

```text
braindump -> braindump-review -> braindump-interview -> braindump-to-prd / poc-create-prd
```
