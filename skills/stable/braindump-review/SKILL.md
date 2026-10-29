---
name: braindump-review
description: Review brain dump files and surface unanswered product-level questions.
---

# Brain Dump Review Skill

## Purpose

The user has been recording raw thoughts and answering earlier review questions in
`docs/braindump/`. Read that history as a continuing conversation and surface only gaps that have
not already been answered or queued. Do not produce a summary or report.

The goal is to prompt another round of brain dumping. A good item here is one the user can
answer by talking it through, and that answer would materially clarify the project's product
behavior, scope, or acceptance criteria. Each review is a living document with a dedicated answer
area.

Treat the product or feature named by the user as the review scope. Review that subject as a
complete, fully working final state. Do not reduce it to a proof, demonstration, MVP, initial
release, or presumed delivery subset. Narrow the review only when the user's source material or
current request explicitly defines a narrower product or feature scope.

## What you do

1. **Find the brain dump folder**
   - Default: `docs/braindump/` in the current working directory
   - If the user specified a different path, use that
   - If the folder is empty or doesn't exist, tell the user and stop

2. **Read the complete chronological record**:
   - Read every raw file whose basename matches `YYYYMMDD-HHMMSS-dump.md`, sorted by basename.
   - Read every review file whose basename matches `*-dump-review.md`, sorted by basename.
   - Ignore every `_archive` folder and everything beneath it. Ignore other generated files.
   - Require at least one raw brain dump. If none exists, explain what was searched and stop.

   Treat raw dumps as the user's original product record. In review files, treat completed text
   under `*Answer*` as the user's subsequent thinking and decisions. Use the matching question and
   `*Why this matters*` only as context. Recognize three literal answer markers:

   - An answer whose only nonblank content is `-TBD-` is unresolved and already queued; do not
     generate another version of it.
   - An answer whose only nonblank content is `-OUT-OF-SCOPE-` is a permanent exclusion. The user
     has declared that topic out of scope. Never re-ask it or a reworded variant, and never surface
     the underlying decision as a new item. Reopen it only when newer user-authored raw material
     clearly brings the topic back into project scope.
   - An answer whose only nonblank content is `-IMPLEMENTATION-` hands the topic to engineering.
     The need is real, but its details are not a product decision. Never re-ask it, a reworded
     variant, or a more detailed version of the same decision as a new item.

3. **Choose the output path once** before starting analysis. Use the current timestamp to create
   one path named `YYYYMMDD-HHMMSS-dump-review.md` in the same `docs/braindump/` folder.
   Reuse that exact path for the rest of the run. Do not call date/time again to choose another
   review filename during the same run.

4. **Spawn a subagent** to do the analysis. Pass it the full contents of the raw dumps and prior
   reviews, clearly labeled as separate groups, and instruct it to:

   - Build a complete picture from the raw dumps and completed review answers.
   - Treat a completed answer as resolved unless newer source material contradicts or explicitly
     reopens it.
   - Treat every existing `-TBD-` review item as already queued. Never repeat it or produce a
     differently worded version of the same underlying decision.
   - Treat every existing `-OUT-OF-SCOPE-` review item as a permanent exclusion. Never re-ask it,
     produce a reworded variant, or surface its underlying decision as a new item.
   - Treat every existing `-IMPLEMENTATION-` review item as handed to engineering. Never re-ask it
     or surface a more detailed version of its decision as a new item.
   - Compare by meaning, not shared wording. Do not ask again about a topic merely because a more
     detailed formulation is possible.
   - Respect statements that a topic is out of scope, deferred, or owned by implementation, whether
     expressed as an `-OUT-OF-SCOPE-` marker or in free-text answer prose. Reopen one only when
     newer user-authored material clearly brings it back into project scope.
   - Evaluate the full intended final state of the product or feature. Do not assume that the user
     only needs enough requirements for a proof, demonstration, MVP, or initial release.
   - Identify only remaining product-level gaps, tensions, or shallow areas using the criteria
     below.
   - Generate between 1 and 10 new numbered items. Do not pad the output to reach ten.
   - If no genuinely new item remains, return only the literal `NO_NEW_REVIEW_ITEMS`.
   - Otherwise return the items in the output format below.

   The prior reviews are decision history, not an invitation to critique or expand every earlier
   answer.

5. **Handle an empty result.** If the subagent returns `NO_NEW_REVIEW_ITEMS`, do not create a
   review file. Tell the user that the existing record contains no new unanswered product-level
   gaps. Report how many review files were considered and how many existing `-TBD-` items remain.

6. **Perform a semantic duplicate check before writing.** Compare every returned item with every
   numbered item and completed answer in the existing review files:

   - Remove an item when an earlier question asks for substantially the same decision, whether
     that earlier item is answered, still `-TBD-`, or marked `-OUT-OF-SCOPE-` or `-IMPLEMENTATION-`.
   - Remove an item when a completed answer already supplies the decision it seeks.
   - Remove an item when its underlying decision matches an earlier item marked `-OUT-OF-SCOPE-`,
     unless newer user-authored raw material clearly reopens that topic.
   - Keep a reconciliation question only when the source record contains a material contradiction
     that affects product scope or behavior. State the conflicting decisions directly.
   - Renumber surviving items and update the count in the introductory line.
   - If no items survive, follow Step 5 and do not create a file.

7. **Check for an exact existing review** while preserving living-document answers. Compare the
   remaining output with every existing `*-dump-review.md` file:

   - For comparison only, normalize every existing `*Answer*` section by replacing the lines
     after its heading up to, but not including, the next `---` separator with the literal
     placeholder `-TBD-`. For the final item, replace the lines through the end of the file.
   - Ignore trailing whitespace differences after normalizing the answer sections.
   - If the normalized existing review matches the returned review, do not create a duplicate or
     overwrite the user's answers. Reuse and report the existing filename instead.

8. **Save the output to the single preselected path** if no matching review already exists.
   Write the checked output, present the new items to the user, and report the filename.

## What the subagent should look for

Tell the subagent to scan for unresolved product decisions after accounting for prior answers:
- Product outcomes, authority, or scope mentioned but never defined
- Assumptions that materially affect user-visible behavior or acceptance criteria
- Contradictions between raw dumps and completed answers, or between completed answers
- Missing user perspectives or incomplete first-time and core user experiences
- Product-visible unhappy paths whose expected behavior requires an owner decision
- Business-model choices that affect the complete product or feature requirements
- Nonfunctional requirements that affect the finished product, including security, privacy,
  accessibility, performance, reliability, compliance, support, and operational expectations
- Edge cases that materially change the stated product behavior

## What makes a good item

Each item must ask for a product-owner decision whose answer would change project scope,
user-visible behavior, or acceptance criteria. Invite elaboration rather than a yes/no answer:
- Good: "What recovery behavior should the project offer after a user approves a destructive action?"
- Weak: "Have you thought about recovery?"

Items can also be observations or considerations rather than questions:
- "You've described several subscription tiers but have not decided which entitlements the project
  must enforce. Consider defining the complete entitlement behavior for the finished product."

Do not include:
- A semantic repeat of any prior review question
- A topic already resolved by a completed answer
- A topic already represented by an unresolved `-TBD-` item
- A topic already marked `-OUT-OF-SCOPE-` in a prior review
- A topic already marked `-IMPLEMENTATION-` in a prior review
- A topic the user declared out of scope, deferred, or implementation-owned in answer prose
- Implementation design such as libraries, schemas, hosting topology, retry algorithms, or
  internal component handoffs unless the user must choose between product-visible outcomes
- Low-level implementation detail that does not affect product behavior, acceptance criteria,
  compliance obligations, or operational expectations

Do not inflate the item count by splitting one underlying decision into several questions.

## Output format

When new items exist, return exactly this structure with the actual count `N` (no preamble,
summary, or closing commentary):

```
Here are N new questions and considerations based on your brain dumps and prior reviews:

1. [Question or consideration]

   *Why this matters*
   [One-sentence explanation]

   *Answer*
   -TBD-

---

2. [Question or consideration]

   *Why this matters*
   [One-sentence explanation]

   *Answer*
   -TBD-

... (through N, where N is between 1 and 10)
```

Use the headings `*Why this matters*` and `*Answer*` exactly as shown. Put each heading on its own
line, put its content on the following line, and keep the content indented beneath the numbered
item. Insert an unindented `---` horizontal rule, with a blank line before and after it, between
items only. Every answer must start as the literal placeholder `-TBD-`.

After the subagent returns, apply the semantic and exact duplicate checks above. If an exact review
exists, display that living document with its current answers and note its filename. Otherwise,
write the checked new review to the single preselected
`docs/braindump/YYYYMMDD-HHMMSS-dump-review.md` path, display it, and note the filename.

The user can replace `-TBD-` directly in the review file as their thinking develops, or use
`braindump` for another round of raw notes. To retire a question permanently, the user can replace
its `-TBD-` with the literal `-OUT-OF-SCOPE-`; later reviews will never re-ask that topic unless
newer raw notes clearly bring it back into scope.
