---
name: braindump-interview
description: Interview the user through unanswered braindump review questions using suggested multiple-choice answers drawn from the project record. A faster replacement for braindump-answer that writes the same answers into the same review files.
---

# Braindump Interview

Fill unresolved braindump review questions through a guided interview. For each question, read the
project record, work out what the user has most likely already decided or would reasonably choose,
and offer those as multiple-choice suggestions. The user picks, adjusts, or writes their own. The
agent then writes a clean answer into the review file, applies it to every other question it
sufficiently answers, and moves on.

The end result in the files matches `braindump-answer`: each `-TBD-` placeholder is replaced by
an indented Markdown answer, or by one of the literal markers that `braindump-review` and
`braindump-to-prd` understand: `-OUT-OF-SCOPE-` or `-IMPLEMENTATION-`. Only the way answers are collected is different. The user should be choosing
from good options, not writing every answer from a blank page.

## Locate the reviews

1. Use a folder supplied by the user. Otherwise, use `docs/braindump/` in the current project.
2. Ignore every `_archive` folder and everything beneath it.
3. Find regular files directly in the selected folder whose basenames match
   `*-dump-review.md`. These are the review files created by `braindump-review`.
4. Sort the files by basename from oldest to newest. Within each file, keep the numbered item
   order. If the user names a specific review file, limit the session to that file.
5. If the folder or matching files do not exist, explain what was searched and stop without
   creating or changing anything.

## Load the project record once

Before asking anything, read the full record a single time and keep it in working context for the
session:

- Every raw dump whose basename matches `YYYYMMDD-HHMMSS-dump.md`, sorted by basename.
- Every review file in the folder, including completed answers in files outside the selected
  scope. Completed answers are the user's decisions; questions and `*Why this matters*` text are
  only context.
- `docs/concepts/REQUIREMENTS.md`, if it exists, as supporting context only.

This record is the only source for suggested answers. Do not re-read the whole record before every
question; re-read only the review files, as required by the save and reconciliation rules below.

## Identify unanswered items

Treat an item as unanswered only when all of these conditions are true:

- It is a numbered review item with a `*Why this matters*` section and an `*Answer*` section.
- The answer section's only nonblank content is the literal placeholder `-TBD-`.
- The placeholder appears after `*Answer*` and before the next unindented `---` separator, or
  before the end of the file for the final item.

Do not treat `TBD` text in a question, rationale, or completed answer as an unanswered item.
Never replace a partial match or a placeholder outside an answer section.

At the start, tell the user in one line how many unanswered items exist and in how many files.
Then select the first unanswered item in sorted order. After every save, re-scan every eligible
review file in the selected scope instead of relying only on conversation memory.

## Prepare the suggestions

For the selected item, think it through before asking:

1. **Break it into decisions.** Many review items bundle several parts, such as a question
   followed by a bulleted "please describe" list. Split the item into its distinct product
   decisions. Use one to four decisions per item. If an item truly has more, group closely related
   parts so that no decision is lost, and keep each group a single clear choice.
2. **Draft options for each decision.** Write two to four concrete, mutually exclusive options.
   Each option is a complete answer to that decision in plain product language, short enough to
   read at a glance, with a one-line description of what choosing it implies.
3. **Ground the options in the record.**
   - When the dumps or completed answers already point to an answer, make it the first option,
     label it as recommended, and name the source in its description (for example, "Matches
     answer 4 in 20261021-081338-dump-review.md").
   - When the record contains a contradiction, offer each side as its own option and say where
     each comes from.
   - When the record is silent, offer sensible, distinct product choices, and do not label one as
     recommended unless a choice is clearly the conventional default.
   - Never invent facts, names, numbers, or commitments that are presented as the user's. Options
     are proposals until the user picks them.
4. **Allow more than one pick only when the choices can stack**, such as "which of these
   capabilities are included." Otherwise the options must be single-choice.

Stay at the product level, as `braindump-review` does. Options describe capabilities, rules, who
controls what, and what users see, not how it is built. Do not offer libraries, schemas, hosting,
specific values, durations, field names, or other implementation choices unless the question
itself asks for a product-visible outcome that depends on one. When a decision needs a value, offer
"configurable, with a default chosen during implementation" as an option, and say who can change
it. When the whole item asks only for implementation detail, say so in one line and recommend the
**Implementation** reply.

## Ask the user

Ask about one review item per turn, but ask all of that item's decisions together.

Start with a short header showing:

- The review filename and item number, and how many unanswered items remain.
- The full question or consideration text.
- The full text beneath `*Why this matters*`.

Then present the decisions:

- **When the harness provides a structured multiple-choice question tool**, use it. Put each
  decision in as its own question in a single call, within the tool's limits. Many such tools
  allow up to four questions per call, two to four options per question, and a free-text answer.
  Keep option labels short and put the details in the option description. If the tool does not
  add a free-text choice automatically, add one.
- **Otherwise**, present the decisions as a numbered list with lettered options. Ask the user to
  reply compactly, for example `1A 2C 3B, plus: email only for now`, or to type their own wording
  for any decision.

Always tell the user, in one line, that they may also reply with:

- **Out of scope**: the whole item is excluded from the product. This writes `-OUT-OF-SCOPE-`.
- **Implementation**: the need is real, but engineering decides the details. This writes
  `-IMPLEMENTATION-`.
- **Skip**: leave this item as `-TBD-` for now. It comes back once, after every other item.
- **Stop**: end the session.
- Their own free-form answer, typed or dictated, in place of the options.

Do not change any file while a question is pending. End the turn and wait for the user's response.

## Turn the response into an answer

Treat the response as the answer only when it clearly responds to the pending item. If the user
asks a separate question, answer it without changing any review file and ask the pending item
again.

- **Out of scope:** the answer is the literal `-OUT-OF-SCOPE-` and nothing else.
- **Implementation:** the answer is the literal `-IMPLEMENTATION-` and nothing else.
- **Skip:** leave the file unchanged and continue with the next item. The first skip moves the
  item to the end of this session's queue; it comes back once after every other item has been
  presented. When it comes back, say in one line that this is the last time it will be asked this
  session. A second skip leaves it `-TBD-` and it is not presented again this session unless the
  user asks. Skips are remembered only for this session.
- **Stop:** report what was answered this session and how many items remain, then stop.
- **Selections, notes, or free text:** compose the answer as follows.
  1. Base the answer only on the options the user selected, the user's notes, and the user's own
     wording. Do not add facts, commitments, or reasoning that is not in one of those.
  2. When the item has several decisions, write one bullet per decision, each stating the chosen
     answer as a decision. Fold the user's notes into the matching bullet. When it has a single
     decision, write it as a short paragraph.
  3. When the user wrote or dictated their own answer, preserve their meaning, decisions, names,
     numbers, qualifications, and uncertainty. Lightly clean dictated text for punctuation,
     capitalization, paragraphs, and obvious verbal filler. If the user asks for a verbatim
     answer, change nothing except the indentation needed by the review document.
  4. If the user chose an option for some decisions and gave no answer for others, record only
     the decisions they made and mark each unanswered part with the line `Still open: [part]`.
  5. If the response is blank or contains no answer, ask again and do not edit the file.
  6. Prefix every nonblank answer line with the same indentation used by the `-TBD-` line. This
     keeps bullets, numbered lists, and `---` text inside the current review item.

Do not combine the answer with the question or the "Why this matters" explanation. Do not ask the
user to approve the composed answer before saving it. Saving immediately keeps the interview fast.
Show the saved answer afterward so the user can correct it.

## Save safely

Immediately before editing, re-read the selected item and confirm that its answer is still the
sole `-TBD-` placeholder. If the file changed or the placeholder was already answered, do not
overwrite it. Explain what changed, re-scan the reviews, and present the next unanswered item.

Replace only the selected placeholder line with the formatted answer. Use an exact, minimal
patch; do not rewrite, reformat, or reorder any other content in the file. Then re-read the item
and verify that:

- The question and `*Why this matters*` text are unchanged.
- The `*Answer*` section contains the formatted response.
- Adjacent item separators and later placeholders are unchanged.

If verification fails, report the problem and stop before making another edit.

## Reconcile the response across unanswered items

Treat this reconciliation as a mandatory blocking gate after every successfully saved direct
answer. Do not present the next question until the full gate succeeds. Skip this gate when the
saved answer is `-OUT-OF-SCOPE-` or `-IMPLEMENTATION-`, because a marker never answers another
item.

1. Keep the just-saved answer available as the only source for this reconciliation pass.
2. Re-read every eligible review file in the selected scope and collect every other item whose
   answer section still contains only `-TBD-`. Include unresolved items before and after the direct
   item, across both earlier and later review files, including items skipped this session.
3. Compare the answer with every collected item by meaning, not shared wording. Mark an item as
   resolved only when the answer materially and sufficiently supplies the product decision that
   item requests.
4. For each additionally resolved item, create a concise, standalone answer derived only from the
   saved answer. Tailor the wording to the specific question instead of copying the full answer.
   Preserve relevant decisions, constraints, names, numbers, examples, qualifications, and
   uncertainty.
5. Leave `-TBD-` unchanged when the answer covers only part of an item, depends on weak
   implication, or requires facts or decisions the user did not provide. Never overwrite a
   completed answer.
6. Immediately before each additional edit, re-read the item and confirm that its answer is still
   the sole `-TBD-` placeholder. Apply an exact, minimal patch that changes only that placeholder.
   If the item changed, leave it untouched and re-scan the selected scope.
7. After all supported answers are written, re-read every changed item. Verify that each answer is
   under the correct question and that its question, `*Why this matters*` text, separators, and
   neighboring items are unchanged.
8. If any write or verification fails, report the problem and stop. Do not present another
   question. Otherwise, briefly identify every additional filename and item number resolved by
   the answer, then continue.

Partial overlap is still useful. When a saved answer only partly covers a later item, do not write
to that item, but use the overlap when preparing its suggestions: the option that follows from the
earlier answer becomes the recommended option, and its description cites the earlier answer.

## Continue or finish

After the direct save and the reconciliation gate both succeed, reply in this order in the same
turn:

1. One line confirming the directly updated filename and item number, followed by the saved answer
   exactly as written, so the user can spot a mistake.
2. One line listing any additional items resolved by reconciliation.
3. Re-scan the eligible review files. If another unanswered item exists that has not been
   skipped, prepare its suggestions and present it immediately. Otherwise, present the next item
   skipped once, in the order it was skipped.

If the user asks to change a saved answer, re-read that item, confirm it still holds the answer
this session wrote, replace only that answer with a minimal patch, verify it as in "Save safely,"
and then return to the pending item. Do not change answers that this session did not write unless
the user explicitly names the item.

When no unanswered items remain except those skipped twice, tell the user that the selected
scope is complete. Report how many review files were checked, how many items were answered
directly, how many were resolved by reconciliation, how many were marked out of scope or
implementation, and which items were skipped twice and are still `-TBD-`. Do not create a new review or modify completed answers.
