# braindump-to-prd

## What this skill does

`braindump-to-prd` creates or updates a Product Requirements Document from brain dump files and completed answers in brain dump review files. It turns the user's planning decisions into a structured `REQUIREMENTS.md` that a junior developer or product manager can build from. It documents the requested product or feature as a complete, fully working final state unless the user explicitly defines a narrower scope.

The PRD is written from the product owner's point of view. It records what the product must let people do, the rules it enforces, and who controls what. It does not decide implementation details such as specific values, durations, field names, or storage. When a capability needs a value, the PRD says the value is configurable and who can change it, and leaves the default to engineering.

When open questions remain, the skill interviews the user one question at a time. Each question can be answered, marked as an implementation detail, marked out of scope, or skipped. A skipped question comes back once at the end of the interview; skipping it again leaves it open for a later run. The skill then asks one question: "Should I proceed with updating the PRD now?" The update folds in the answers and keeps any skipped questions open.

Use this skill when a user asks to create, update, refresh, write, or sync requirements from their brain dumps.

## How it is used

Run this skill from a repository that has raw brain dump files in:

```text
docs/braindump/
```

The skill reads raw `YYYYMMDD-HHMMSS-dump.md` files and `YYYYMMDD-HHMMSS-dump-review.md` files in chronological order. Completed `*Answer*` sections in review files count as source material. Review prompts, rationales, and unanswered `-TBD-` placeholders do not count as user decisions. Two answer markers have special meaning:

- `-OUT-OF-SCOPE-` excludes the topic. It is recorded under "Out of scope" when useful.
- `-IMPLEMENTATION-` hands the decision to engineering. The need is recorded under "Deferred to implementation" and never becomes an open question.

The skill then checks whether the combined source material covers purpose, audience, tech stack, and deployment before writing or updating requirements.

## What it creates or edits

The skill creates or overwrites:

```text
docs/concepts/REQUIREMENTS.md
```

The PRD includes:

- Product overview
- User types
- Core features
- Key user flows
- Technical constraints, the product owner's implementation notes, and key concepts
- Out-of-scope items
- Open questions (product decisions only)
- Assumptions
- Needs deferred to implementation

## How a run flows

A bundled inspector reads the PRD's `**ANSWER**` blocks and picks the route:

| Route | Meaning | What the skill does |
|---|---|---|
| `interview_pending_answers` | At least one `--TBD--` answer remains. | Interviews the user through every open question, then asks to proceed. |
| `ready_for_update` | Every open question is answered, but the answers are not yet folded into the PRD. | Asks "Should I proceed with updating the PRD now?" |
| `create_or_update_prd` | No PRD exists, or the PRD has no open questions. | Creates the PRD, or asks to proceed with an update. |

A "yes" to the proceed question authorizes the update. The update applies every answer, and its direct consequences, throughout the document. A fresh verifier then checks the result for contradictions, stale wording, broken cross-references, and implementation-level detail, and fixes them before the file is saved.

## How to use it

1. Capture raw planning notes with the brain dump skill.
2. Ask the agent to use `braindump-to-prd`.
3. If required information is missing, add another brain dump with the missing details.
4. Answer the interview questions. Reply **Implementation** for anything engineering should decide, **Out of scope** for anything excluded, or **Skip** to come back to it once at the end.
5. Answer "yes" when asked whether to proceed with updating the PRD.

## Important constraints

- The PRD must stay grounded in raw brain dumps, completed review answers, and recorded PRD answers.
- Open questions are product decisions only. Values, durations, field names, storage, and other implementation details never become questions.
- A first-time creation adds at most 10 open questions, and an update adds at most 5.
- New questions must come from the user's material, not from detail an earlier PRD version added.
- Interview answers record only what the user said, with no added reasoning.
- An existing PRD is updated only when the user explicitly asks or answers "yes" to the proceed question.
- Every run ends with one of a fixed set of endings. It never ends by asking the user to request a fix.
- The output is always a complete `REQUIREMENTS.md`, not a partial diff.
- The writing should be clear enough for a junior software engineer to build from.
