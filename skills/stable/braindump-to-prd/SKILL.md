---
name: braindump-to-prd
description: Create or update a Product Requirements Document from brain dump files.
---

# Braindump to PRD

Turn the contents of `docs/braindump/` into a Product Requirements Document that a junior
developer or product manager can build from. On first run it creates `docs/concepts/REQUIREMENTS.md`.
On subsequent runs, update that file only when the user explicitly authorizes an update (see
[Mandatory update authorization](#mandatory-update-authorization)). It also interviews the user
through every open question, applies each response to every other open question it fully answers,
and then asks whether to fold the answers into the PRD.

Treat the product or feature named by the user as the requirements scope. Document that subject as
a complete, fully working final state. Do not reduce it to a proof, demonstration, MVP, initial
release, or presumed delivery subset. Narrow the PRD only when the user's source material or current
request explicitly defines a narrower product or feature scope.

## Product altitude

A PRD is written for and by a product owner. It records what the product must let people do, the
rules it must enforce, who controls what, and how success is judged. It does not record how the
product is built.

| Belongs in the PRD (product) | Belongs to implementation |
|---|---|
| Capabilities and abilities | Specific values, durations, limits, and defaults |
| Business rules and constraints | Field names, key formats, and record structures |
| Who can see, change, or control something | Tables, storage locations, and data layouts |
| What users see when something goes wrong | Algorithms, schedules, retries, and job mechanics |
| Outcomes that acceptance tests can check | Internal component handoffs and API shapes |
| Technology choices the owner explicitly mandated | Technology choices the owner did not make |

Apply this test to every requirement and every open question:

> Would a different answer change what a user can do, see, or control, or change how the product
> is accepted? If not, it is implementation.

Worked example: the source material says repeated checks of a shared repository need a cool-off
period.

- **Product (write this):** "Repeated checks of a repository shared by several workspaces are
  throttled by a cool-off period. The cool-off is a system setting that the system administrator
  can view and change."
- **Implementation (never ask this):** how long the cool-off is, what its setting key is named,
  or which table stores it.

### Configurable values

When a capability needs a value, record that the value exists, that it is configurable, and who
can change it. Write "default chosen during implementation" instead of a number. Never turn the
value into an open question. Record a specific value only when the user explicitly stated one, and
present it as the default, not as a fixed rule.

### The product owner's implementation ideas

The user may describe how they would build something, such as a table layout or a naming scheme.
Extract the product requirement behind the idea and write that as the requirement. Preserve the
idea itself, faithfully and briefly, under "Implementation notes from the product owner" in the
technical section. Mark those notes as guidance for engineers. Do not elaborate on them, derive
further requirements from them, or ask follow-up questions about them.

## Answer markers

The skill recognizes these literal answer markers. Review files use `-TBD-` as their placeholder;
the PRD uses `--TBD--`.

| Marker | Meaning |
|---|---|
| `-TBD-` / `--TBD--` | Unresolved. |
| `-OUT-OF-SCOPE-` | The topic is excluded from the product. |
| `-IMPLEMENTATION-` | The need is real, but the decision belongs to engineering. |

Never copy a literal marker into the body of the PRD.

## Mandatory update authorization

Treat an update to an existing `docs/concepts/REQUIREMENTS.md` as authorized only when one of
these is true:

- The user's current request explicitly asks to update, refresh, rewrite, revise, or sync the
  existing PRD or requirements.
- The user answered "yes" (or an equivalent clear affirmative) to this skill's exact question
  "Should I proceed with updating the PRD now?" in the current conversation.

A request to create, write, or generate a PRD is not update authorization.

Do not infer update authorization from any of the following:

- The requirements file already exists.
- The skill has been run before or is invoked by name.
- Brain dump files are newer or appear to contain changes.
- The inspector returns any particular route or reports no pending interview answers.
- The existing requirements file has uncommitted edits.

Without authorization, do not read source files for an update, do not spawn a PRD-writing
subagent, and do not modify the body of the file. Ask the proceed question instead (see
[Endings](#endings)).

## Endings

Every run ends with exactly one of these as its final line. Activity reports required by other
instructions, such as commit and push results, may come before it, but never after it.

1. **Not enough information:** the report from Step 3.
2. **Ready to update:** exactly `Should I proceed with updating the PRD now?`, optionally preceded
   by one short sentence of context, such as "All open questions in the PRD are answered." or
   "Two skipped questions remain open."
3. **Interview stopped with questions still open:** one line stating how many questions remain
   open and that running this skill again resumes the interview. Use it when the user said Stop,
   or when the interview ended with no answers to fold into the PRD.
4. **Done:** one line with the file path and version, plus one sentence about what changed. If
   open questions remain, add how many and that running this skill again asks them.

Never end by telling the user to ask for something, never offer a menu of alternatives, and never
list mismatches between the PRD body and recorded answers for the user to act on. A mismatch is
either a decision (ask it in the interview) or a consequence of an answer the user already gave
(the next update applies it).

## Before Step 1: Route the run

From the project root, run the bundled inspector before reading any brain dumps:

```bash
<skill-directory>/scripts/inspect_requirements.mjs .
```

Use the script's JSON `route` value exactly:

- `interview_pending_answers`: skip Steps 1–5 and continue at Step 6 with the existing
  `docs/concepts/REQUIREMENTS.md`.
- `ready_for_update`: every open question has an answer that has not yet been folded into the
  PRD. If the current request explicitly authorizes an update, continue at Step 1 for an update.
  Otherwise, go to Step 7.
- `create_or_update_prd` and the requirements file does not exist: continue at Step 1 for a
  first-time creation.
- `create_or_update_prd`, the requirements file exists, and the current request explicitly
  authorizes an update: continue at Step 1 for an update.
- `create_or_update_prd`, the requirements file exists, and the current request does not
  authorize an update: go to Step 7.

Do not replace this check with an inferred or visual inspection. The script deliberately counts
only an exact `--TBD--` placeholder in a `**ANSWER**` block as pending, and any other answer
content as answered but not yet applied.

## Step 1: Find and read the source material

Read the following files in `docs/braindump/`, sorted by filename so the timestamped files stay
in chronological order:

- Raw brain dumps named `YYYYMMDD-HHMMSS-dump.md`.
- Brain dump reviews named `YYYYMMDD-HHMMSS-dump-review.md`.

Treat completed content under each review item's `*Answer*` heading as source material. Use the
matching question and `*Why this matters*` text only to understand the answer's context. Do not
treat generated questions, rationales, or an answer whose only nonblank content is `-TBD-` as a
user decision, requirement, or assumption.

Treat an answer whose only nonblank content is `-OUT-OF-SCOPE-` as an explicit exclusion:

- Do not create a requirement from the associated question or rationale.
- Use the question only to identify the excluded topic.
- Record that topic in `Out of scope` when doing so helps define the product boundary.

Treat an answer whose only nonblank content is `-IMPLEMENTATION-` as a deferral to engineering:

- Do not create an open question from the associated question.
- Record the underlying need in plain language under `Deferred to implementation`.

If the folder doesn't exist or has no raw dump files, tell the user and stop.

## Step 2: Check whether a PRD already exists

Check for `docs/concepts/REQUIREMENTS.md`.

- **If it does not exist**: this is a first-time creation. Proceed to Step 3.
- **If it exists and an update is authorized**: this is an update run. Read the existing PRD, then
  proceed to Step 3 with both the braindumps and the existing PRD in hand.
- **If it exists without authorization**: go to Step 7.

## Step 3: Check for completeness

Before writing or updating anything, confirm the raw brain dumps and completed review answers,
taken together, cover all four required dimensions. Each one needs meaningful, specific content
because a passing mention or "we'll figure that out later" doesn't count.

| # | Dimension | What to look for |
|---|-----------|-----------------|
| 1 | **Purpose & functionality** | What the app does, the problem it solves, its core value proposition |
| 2 | **Target audience** | Who uses it, what user types exist, the context they use it in |
| 3 | **Tech stack** | Languages, frameworks, databases, runtime, key third-party services |
| 4 | **Deployment** | How it will be hosted or run (Docker, cloud, single server, etc.) |

**If any dimension is missing or too thin**, stop here. Do not generate or update the PRD.
Instead, report clearly:

```
The brain dumps don't yet have enough information to write a complete PRD.

Here's what's missing:

- [Dimension name]: [Specific description of what's needed]

Go back and add more detail on these areas, then run this skill again.
```

## Step 4: Spawn a subagent to create or update the PRD

Pass the subagent the full raw brain dump and brain dump review content, the existing PRD (if
any), the [Product altitude](#product-altitude) section, the [Open question rules](#open-question-rules),
the [Writing guidelines](#writing-guidelines-include-in-every-subagent-prompt), the PRD structure
template, and these instructions.

### For a first-time creation:

> You are writing a Product Requirements Document for a software application. Your audience
> is a junior developer and a product manager who may not have prior context. Write in plain
> English. Write at product altitude: capabilities, rules, control, and outcomes, not
> implementation. Do not invent details that aren't in the brain dumps. Completed `*Answer*`
> sections in brain dump review files are user-provided source material. Review questions and
> `*Why this matters*` text provide context only; do not turn them into requirements unless a
> completed answer supports them. Ignore answers whose only nonblank content is `-TBD-`. Treat
> `-OUT-OF-SCOPE-` as an explicit exclusion and `-IMPLEMENTATION-` as a deferral to engineering,
> and never copy either marker. Describe the complete final state of the requested product or
> feature unless the user explicitly defined a narrower scope. Raise open questions only under the
> open question rules, formatted with the required `**ANSWER**` block. Use the PRD structure
> template.
>
> [full raw brain dump and brain dump review contents]
> [product altitude, open question rules, writing guidelines]
> [PRD structure template]

### For an update run:

Use these instructions only after confirming that an update is authorized.

> You have an existing PRD and a set of brain dump files. The PRD's Open Questions may contain
> user-provided answers, and new brain dumps or review answers may exist. Your job is to bring the
> PRD up to date.
>
> Completed `*Answer*` sections in brain dump review files are source material. Review questions
> and `*Why this matters*` text provide context only. Ignore answers whose only nonblank content is
> `-TBD-`. Treat `-OUT-OF-SCOPE-` as an explicit exclusion and `-IMPLEMENTATION-` as a deferral to
> engineering, and never copy either marker. Preserve the complete final-state requirements for the
> requested product or feature unless the user explicitly changed that scope.
>
> In the existing PRD, treat non-placeholder content under an Open Questions `**ANSWER**` label as
> a user-provided answer. An answer whose only nonblank content is `--TBD--` is still unresolved.
>
> For every answered open question:
>
> 1. Apply the decision to every part of the document it affects: features, rules, permission
>    tables, flows, technical constraints, key concepts, out of scope, assumptions, and
>    cross-references. Also apply its direct consequences. For example, an answer that limits
>    workspace deletion to a sole owner also changes any permission table that lets every owner
>    delete. Fix stale wording, such as text that still calls the decision undecided.
> 2. Remove the question from Open Questions. An `-OUT-OF-SCOPE-` answer moves the topic to Out of
>    scope; an `-IMPLEMENTATION-` answer moves the need to Deferred to implementation.
> 3. Renumber the remaining open questions and update every cross-reference to them.
>
> Identify what else has changed: new decisions, new constraints, corrected assumptions, new
> features, and things explicitly removed or deferred.
>
> Then decide on the update approach:
>
> **Patch (update specific sections)** when the changes are additive or clarifying. Most updates
> fall here.
>
> **Full rewrite** when the changes are fundamental: the core product concept shifted, the tech
> stack changed significantly, the target audience is now different, or major sections of the
> existing PRD are no longer accurate. A full rewrite uses the same structure but starts fresh
> from the current braindumps and answers.
>
> Whichever approach you take, the output is always a complete, self-contained REQUIREMENTS.md.
> Never produce a "diff" or a partial document. Always return the full PRD.
>
> At the top of the document, update the version number and add a one-line changelog entry
> noting what changed (e.g., "v1.2: Added publisher registration flow; resolved open question
> on scope ownership").
>
> [full raw brain dump and brain dump review contents]
> [existing PRD contents]
> [product altitude, open question rules, writing guidelines]
> [PRD structure template]

The subagent returns the complete PRD as a markdown string.

## Step 5: Verify, then save the PRD

Spawn a fresh verifier subagent that did not write the PRD. Pass it the returned PRD, the previous
PRD (for an update), the answered open questions folded into this update, the Product altitude
section, and the Open question rules. Instruct it to:

1. Check every answered question against the whole new PRD and find any text that contradicts
   the answer or its direct consequences, including tables, flows, key concepts, out of scope,
   assumptions, stale "not yet decided" wording, and cross-references to renumbered questions.
2. Check that no answered question remains in Open Questions.
3. Check every new open question against the Open question rules and remove any that fail.
4. Check the body for implementation detail that the source material did not explicitly mandate,
   and restate it at product altitude.
5. Correct every problem directly in the document and return the corrected, complete PRD with a
   short list of what it changed.

Create `docs/concepts/` if it doesn't exist. Write the verified PRD to
`docs/concepts/REQUIREMENTS.md`. Overwrite a previous version only for an authorized update run.
Never report a known inconsistency to the user as something for them to fix; fix it in this run.

Run the bundled inspector again with the same command used before Step 1:

- If it reports pending answers other than questions the user skipped twice earlier in this run,
  continue to Step 6 and leave those skipped questions out of the interview. Identify them by
  question text, because the update may have renumbered them.
- Otherwise, end with the **Done** ending.

## Step 6: Interview the open questions

Spawn a new dedicated interview subagent. Keep that same subagent for the entire interview. Pass
it the absolute project root, the absolute path to the bundled `scripts/inspect_requirements.mjs`,
the Product altitude section, the Open question rules, and these instructions:

> You are the PRD Interviewer. Work only with `docs/concepts/REQUIREMENTS.md` in the supplied
> project. Run the supplied inspector and use its `pending_answers` list as the interview queue.
>
> The orchestrator relays your messages to the user and sends their responses back to you. Begin
> immediately: say in one line how many questions are open, then ask the first one. Ask exactly
> one pending question at a time in document order. Never combine questions.
>
> **Ask at product altitude.** Before asking each question, apply the product altitude test.
> If the question asks for an implementation detail, say so in one line and recommend deferring it
> to implementation. If only part of it is implementation, ask only the product part. You may
> reword a question for the user, but never change the question text in the file.
>
> With every question, tell the user in one line that they may also reply:
> - **Implementation**: engineering decides. This records `-IMPLEMENTATION-`.
> - **Out of scope**: the topic is excluded. This records `-OUT-OF-SCOPE-`.
> - **Skip**: come back to this question once, after every other question.
> - **Stop**: end the interview now.
>
> **Record the answer.** After the orchestrator relays the user's answer, immediately edit the
> requirements file by replacing only that question's exact `--TBD--` placeholder. Record only what
> the user said. Lightly clean dictated text, but never add reasoning, justification, examples,
> numbers, or consequences the user did not state. Preserve valid Markdown indentation. Verify the
> direct edit before continuing.
>
> **Reconcile.** Treat reconciliation as a mandatory blocking gate after every direct answer
> other than `-IMPLEMENTATION-` or `-OUT-OF-SCOPE-`. Keep the user's complete response available
> as the only source for this pass. Rerun the inspector, then compare that response by meaning
> with every other item in the fresh `pending_answers` list, including questions before and after
> the one just answered. A shared topic or partial answer is not enough. Resolve another question
> only when the response materially and sufficiently supplies the decision that question requests
> without inference, invention, or missing information. For each additionally resolved question,
> write a concise, standalone answer derived only from the user's response. Immediately before
> editing, confirm that question still has the exact `--TBD--` placeholder. Replace only that
> placeholder; never overwrite a completed answer or change the question text. Leave partially
> answered or merely implied questions pending. Rerun the inspector and verify every edit. Briefly
> name any other questions resolved by the response. Do not return the next question until this
> gate succeeds.
>
> **Skips.** The first skip moves a question to the end of the queue. When only questions skipped
> once remain, ask each one more time, in the order skipped, and say in one line that this is the
> last time it will be asked in this run. A second skip leaves its `--TBD--` placeholder in place
> and removes it from the queue for the rest of this run.
>
> **Follow-up check.** When the queue is empty, read every answer recorded in this interview
> together with the PRD and sort what they imply into two groups:
> - **Consequences:** changes that follow directly from an answer, such as a table or section
>   that now disagrees with it, or a record that must survive a delete the answer allows. Do not
>   ask about these and do not edit the body for them. The next update applies them.
> - **New decisions:** product decisions the answers raise but do not settle. Keep only those
>   that pass the Open question rules. At most 3 new decisions per interview, and run this check
>   only once per interview.
>
> Append each new decision to Open Questions as the next numbered item, using the exact question
> format from the PRD template, then interview it like any other pending question.
>
> **Finish.** When no pending question remains except those skipped twice, return a report to the
> orchestrator (not for the user) with the number answered directly, the number resolved by
> reconciliation, the number added by the follow-up check, the list of consequences, and the text
> of every question skipped twice. If the user said Stop, return the same report plus the open
> count.
>
> If the user asks for clarification, answer it without changing the file, then repeat the same
> question.

Relay each interviewer message and user response between the same subagent and the user. Do not
answer on the user's behalf. Confirm that the subagent saves each direct answer, reconciles it
against every other pending question, and verifies all edits before the next question is shown.

When the interview finishes:

- If the user said Stop, end with the **Interview stopped** ending.
- Otherwise, rerun the inspector. If it reports at least one answered question not yet folded into
  the PRD, continue to Step 7, even when questions skipped twice remain open. Keep the
  interviewer's consequences list and the skipped question texts for the update.
- If nothing was answered, end with the **Interview stopped** ending.

## Step 7: Ask to proceed

Ask exactly:

> Should I proceed with updating the PRD now?

Precede it with at most one short sentence of context. Do not list the consequences, mismatches
between the body and the answers, or interview statistics; those belong to the update.

- If the user answers yes, the update is authorized. Continue at Step 1 as an update run, and pass
  the interviewer's consequences list (if any) to the PRD-writing subagent along with the update
  instructions. Questions still marked `--TBD--` stay in Open Questions with their placeholders,
  renumbered after the answered ones are removed.
- If the user answers no, stop without changing anything.

---

## Open question rules

An open question is a product decision that only the product owner can make. Raise one only when
every one of these is true:

- **Product altitude.** A different answer would change what a user can do, see, or control, or
  change acceptance criteria. Values, durations, field names, key formats, storage, schedules,
  algorithms, and record structures never qualify; record them as configurable values or under
  Deferred to implementation.
- **Grounded in the user's material.** It arises from a gap, ambiguity, or contradiction in the
  raw dumps, completed review answers, or recorded PRD answers. It must not arise only from detail
  the PRD itself added in an earlier version.
- **Novel.** No answered question, recorded marker, or existing open question already covers it,
  and no review answer marked it `-OUT-OF-SCOPE-` or `-IMPLEMENTATION-`.
- **Not a consequence.** If an existing answer already settles it, apply the answer instead of
  asking.
- **Material.** It changes scope, user-visible behavior, permissions, privacy, compliance, or an
  irreversible outcome.

Merge related questions into one decision instead of splitting them. Ask about the outcome, not
the mechanism: "What must the system administrator be able to find out from the audit log?" is
better than "Which event types and fields does the audit log store?"

Limits:

- A first-time creation adds at most 10 open questions.
- An update adds at most 5 new open questions.
- When more qualify, keep the ones with the greatest effect on scope and user-visible behavior.
  The rest can surface in a later update.

---

## PRD structure template

Pass this to the subagent as the document structure. The subagent fills in content from
the braindumps. It does not invent details.

```markdown
# Product Requirements: {Product Name}

**Version:** {N.M} Draft
**Date:** {YYYY-MM-DD}
**Status:** Draft
**Changelog:** {one-line summary of what changed in this version, or "Initial draft"}

---

## 1. Overview

### What this is
[2–3 sentence plain-English description. Write it so someone with no context understands
immediately what the product is and what problem it solves.]

### Why we're building it
[The business motivation. What opportunity or pain does this address?]

### What success looks like
[Concrete outcomes. What needs to work for this to be considered done?]

---

## 2. Who uses this

[For each user type: who they are, what they're trying to accomplish, how they interact
with the system. Plain language, not persona cards.]

---

## 3. Core features

[List all features needed for the complete final state of the requested product or feature. If the
user explicitly defined a narrower requirements scope, list all features needed for that scope.
Describe behavior, not implementation. For each:]

### {Feature name}
**What it does:** [One sentence]
**How it works:** [What the user does and what the product does in response]
**Rules and constraints:** [Business rules, permissions, and limits. Configurable values say who
can change them and use "default chosen during implementation" unless the user stated a value.]

---

## 4. Key user flows

[Walk through the most important journeys step by step.]

### {Flow name}
1. {Step}
2. {Step}
...

---

## 5. Technical constraints

### Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | | |
| Framework | | |
| Database | | |
| ORM | | |
| Auth | | |
| Payments | | |
| Hosting/Deployment | | |

[Fill in only what the user explicitly chose. Omit rows that were never mentioned.]

### Mandated constraints
[Explicit technical decisions from the braindumps. Note the source so developers know these are
intentional choices, not defaults.]

### Implementation notes from the product owner
[The user's own suggestions about how to build something, preserved faithfully and briefly.
Guidance for engineers, not requirements. Omit this subsection if there are none.]

### Key concepts
[The main things the product keeps track of and how they relate, in plain English, as a short
glossary. No fields, keys, tables, or record layouts.]

---

## 6. Out of scope

[Things explicitly deferred, dismissed, or flagged as "later". This section prevents scope
creep. Include topics represented by `-OUT-OF-SCOPE-` answers when useful, but never copy
the literal marker. Tell the developer what not to build.]

---

## 7. Open questions

[Product decisions that pass the open question rules. For each: name the decision that needs to
be made and why it matters to users or acceptance. Remove items as they get resolved in
subsequent braindumps or through a completed `**ANSWER**` block in the existing PRD.

Every numbered question must use this exact structure:

1. **{Question title}:** {Decision that needs to be made and why it matters.}

    **ANSWER**
    --TBD--

The blank line after `--TBD--` is required. Never omit the `**ANSWER**` label or the
`--TBD--` placeholder from an unresolved question. If there are no open questions, write
"None."]

---

## 8. Assumptions

[Decisions that appear settled in the braindumps, even if never stated as formal decisions.
Things the developer can proceed on without asking for confirmation.]

---

## 9. Deferred to implementation

[Needs whose details belong to engineering, one line each, such as "Length of the repository
cool-off period (configurable by the system administrator)." These are not questions and have
no `**ANSWER**` block. Include needs represented by `-IMPLEMENTATION-` answers, but never copy
the literal marker. Write "None." if empty.]
```

---

## Writing guidelines (include in every subagent prompt)

- **Be specific about behavior.** "Users can log in" is weak. "Users sign in with only their
  email address; they receive a one-time code by email and enter it to finish signing in" is
  useful. Be specific about what users can do and what the product guarantees, not about how it
  is built.
- **Stay at product altitude.** Apply the product altitude test to every sentence. Implementation
  detail belongs in Deferred to implementation, or in Implementation notes from the product owner
  when the user supplied it.
- **Stay grounded.** Every claim must be traceable to a raw brain dump, a completed review answer,
  or a recorded PRD answer. A gap that fails the open question rules is not a question; record it
  as a configurable value or under Deferred to implementation.
- **Do not build on your own elaborations.** Detail that an earlier version of the PRD added is
  not user material. Do not derive new requirements or questions from it.
- **Respect review boundaries.** Use review questions and rationales only to interpret completed
  answers. Never treat an unanswered prompt or `-TBD-` placeholder as a user decision.
- **Format every open question consistently.** Under every numbered question, add a blank line,
  then an indented `**ANSWER**` line, then an indented `--TBD--` line, followed by another blank
  line. Do not combine the answer label or placeholder with the question text.
- **Flag contradictions.** If source files say two conflicting things that matter at product
  altitude, raise an open question rather than silently picking one.
- **Product completeness.** Document the complete, fully working final state of the requested
  product or feature. Do not default to a proof, demonstration, MVP, initial release, or presumed
  delivery subset. Narrow the requirements only when the user explicitly defines a narrower scope.
- **Respect explicit markers.** An `-OUT-OF-SCOPE-` answer retires the associated topic, and an
  `-IMPLEMENTATION-` answer hands it to engineering. Never create an open question from either,
  and never copy the literal marker into the PRD.
- **Plain English.** If a technical term is used, briefly explain it. The audience may
  not know what "OAuth" or "Drizzle ORM" means.
- **On updates:** When a raw brain dump, completed review answer, or recorded PRD answer resolves
  an open question, move it out of Open Questions, apply it everywhere it matters, and note the
  resolution in the changelog.
