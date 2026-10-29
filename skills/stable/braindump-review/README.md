# braindump-review

## What this skill does

`braindump-review` reads all brain dump files for a project, along with every prior review file and its answers, and produces between one and ten targeted questions or considerations. The goal is to expose gaps, assumptions, tensions, and areas that need another round of thinking, without repeating anything already asked, answered, or retired. It evaluates the requested product or feature as a complete, fully working final state unless the user explicitly defines a narrower scope.

Use this skill when a user asks to review brain dumps, identify what is missing, pressure-test notes, or suggest what to think about next.

## How it is used

Run this skill from a repository with brain dump files in:

```text
docs/braindump/
```

The skill reads raw brain dump files matching `YYYYMMDD-HHMMSS-dump.md` and every review file matching `*-dump-review.md` in chronological order, then builds a picture of the current thinking. It treats each prior review's answers as decisions: a completed answer is resolved, a `-TBD-` answer is an already-queued question, and an `-OUT-OF-SCOPE-` answer is a permanently retired topic. It asks a subagent to generate between one and ten high-value questions or considerations, comparing by meaning so nothing already asked, answered, or retired is repeated. Archived content under any `_archive` folder is ignored. If nothing new remains, the skill reports that and writes no file.

## What it creates or edits

The skill creates a review file alongside the brain dumps:

```text
docs/braindump/YYYYMMDD-HHMMSS-dump-review.md
```

Before writing, the skill runs a semantic duplicate check and an exact-review check against existing `*-dump-review.md` files. Answer sections are normalized during the exact comparison, so a review remains the same living document after the user fills in answers. The skill preserves those answers and reports the existing file instead of creating or overwriting it.

The output is also shown to the user. It uses this structure:

```text
Here are N questions and considerations based on your brain dumps and prior reviews:

1. ...

   *Why this matters*
   ...

   *Answer*
   -TBD-

---

2. ...
```

Each item has a dedicated rationale and answer area. Horizontal rules make the items easier to scan. Users can replace `-TBD-` with an answer as their thinking develops, or with the literal `-OUT-OF-SCOPE-` to retire a question so later reviews never raise it again.

## How to use it

1. Capture one or more dumps with `braindump`.
2. Ask the agent to use `braindump-review`.
3. Read the questions and considerations.
4. Replace `-TBD-` in the review file with answers as they develop, or with `-OUT-OF-SCOPE-` to retire a question. Use another `braindump` run for additional raw notes.
5. Re-run `braindump-review` anytime. It reads your prior answers and retired items and only surfaces genuinely new gaps.

## Important constraints

- This skill is not a summary generator.
- It produces between one and ten items, and never pads to reach a target count.
- It never repeats a topic already asked, answered, or marked `-OUT-OF-SCOPE-` in a prior review.
- Each item should invite elaboration rather than a yes/no answer.
- It does not assume the requested product or feature is only a proof, demonstration, MVP, or initial release.
- The output should help the user decide what to dump next.
