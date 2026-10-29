---
name: braindump-answer
description: Walk through unanswered braindump review questions one at a time.
---

# Braindump Answer

Guide the user through unresolved braindump review questions. Ask one question per turn. After
each response, save the direct answer immediately, apply the same response to every other question
it sufficiently answers, and only then present the next unresolved question.

## Locate the reviews

1. Use a folder supplied by the user. Otherwise, use `docs/braindump/` in the current project.
2. Ignore every `_archive` folder and everything beneath it.
3. Find regular files directly in the selected folder whose basenames match
   `*-dump-review.md`. These are the review files created by `braindump-review`.
4. Sort the files by basename from oldest to newest. Within each file, keep the numbered item
   order. If the user names a specific review file, limit the session to that file.
5. If the folder or matching files do not exist, explain what was searched and stop without
   creating or changing anything.

## Identify unanswered items

Treat an item as unanswered only when all of these conditions are true:

- It is a numbered review item with a `*Why this matters*` section and an `*Answer*` section.
- The answer section's only nonblank content is the literal placeholder `-TBD-`.
- The placeholder appears after `*Answer*` and before the next unindented `---` separator, or
  before the end of the file for the final item.

Do not treat `TBD` text in a question, rationale, or completed answer as an unanswered item.
Never replace a partial match or a placeholder outside an answer section.

Select the first unanswered item in the sorted order that has not been skipped this session (see
[Skip](#skip)). After every answer, re-scan every eligible
review file in the selected scope instead of relying only on conversation memory.

## Present one question

Show only one unanswered item at a time. Include:

- The review filename and item number.
- The full question or consideration text.
- The full text beneath `*Why this matters*`.
- A short invitation to type or dictate the answer, or to reply **Skip** to come back to it
  later.

Use a clear conversational format such as:

```text
Question 3 from 20260115-143000-dump-review.md

[Question or consideration]

Why it matters: [Explanation]

Type or dictate your answer when you're ready, or reply Skip to come back to it later.
```

Do not change the file while presenting a question. End the turn and wait for the user's
response.

## Capture and format the answer

Treat the user's next response as the answer only when it clearly responds to the pending
question. If the user asks a separate question, answer it without changing the review file and
keep the review question pending.

For a typed or dictated answer:

1. Preserve the user's meaning, decisions, names, numbers, qualifications, and uncertainty.
2. Lightly clean dictated text for punctuation, capitalization, paragraphs, and obvious verbal
   filler. Do not add facts, commitments, or reasoning the user did not provide.
3. Preserve intentional Markdown lists or code. If the user asks for a verbatim answer, change
   nothing except the indentation needed by the review document.
4. If the response is blank or does not contain an answer, ask again and do not edit the file.
5. Format the answer as readable Markdown. Prefix every nonblank answer line with the same
   indentation used by the `-TBD-` line. This keeps bullets, numbered lists, and `---` text inside
   the current review item.

Do not combine the answer with the question or the "Why this matters" explanation.

## Skip

When the user replies **Skip**, leave the file unchanged and continue with the next unanswered
item. Skips are remembered only for this session.

- The first skip moves the item to the end of this session's queue. It comes back once, after
  every other unanswered item has been presented. When it comes back, say in one line that this is
  the last time it will be asked this session.
- A second skip leaves the item `-TBD-`. Do not present it again this session unless the user asks.

A skipped item is still unanswered, so reconciliation may resolve it from a later answer.

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
answer. Do not present the next question until the full gate succeeds.

1. Keep the user's just-saved response available as the only source for this reconciliation pass.
2. Re-read every eligible review file in the selected scope and collect every other item whose
   answer section still contains only `-TBD-`. Include unresolved items before and after the direct
   item, across both earlier and later review files, including items skipped this session.
3. Compare the response with every collected item by meaning, not shared wording. Mark an item as
   resolved only when the response materially and sufficiently supplies the product decision that
   item requests.
4. For each additionally resolved item, create a concise, standalone answer derived only from the
   response. Tailor the wording to the specific question instead of copying the full response.
   Preserve relevant decisions, constraints, names, numbers, examples, qualifications, and
   uncertainty.
5. Leave `-TBD-` unchanged when the response answers only part of an item, depends on weak
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
   the response, then continue.

A response may resolve no additional items, one additional item, or several. Always perform the
full scan and verification before continuing.

## Continue or finish

After the direct save and reconciliation gate both succeed, briefly confirm the directly updated
filename and item number. Re-scan the eligible review files immediately:

- If another unanswered item exists that has not been skipped, present it in the same response
  and invite the user's next answer. Otherwise, present the next item skipped once, in the order
  it was skipped.
- If no unanswered items remain except those skipped twice, tell the user that the selected scope
  is complete. Report how many review files were checked and which items were skipped twice and
  are still `-TBD-`. Do not create a new review or modify completed answers.
