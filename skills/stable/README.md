# Stable Skills

Skills in this channel are ready for dependable, production use.

## `braindump`

Captures raw spoken, pasted, or stream-of-consciousness product thoughts into a
timestamped `docs/braindump/*-dump.md` file. Preserves the user's original
voice and only fixes obvious typos and paragraph breaks.

**Current state:** In regular use as the first step of the braindump workflow.
See [the skill](braindump/SKILL.md).

## `braindump-review`

Reads the raw brain dumps and earlier reviews, then writes a timestamped
`*-dump-review.md` with targeted product-level questions and a `-TBD-` answer
for each. Never re-asks a topic already answered or marked `-OUT-OF-SCOPE-` or
`-IMPLEMENTATION-`.

**Current state:** In regular use. Supports the `-IMPLEMENTATION-` marker for
needs whose details belong to engineering. See [the skill](braindump-review/SKILL.md).

## `braindump-answer`

Walks the user through unanswered review questions one at a time, saves each
typed or dictated answer, and fills in any other question the same answer fully
settles. A skipped question comes back once at the end of the session.

**Current state:** In regular use. See [the skill](braindump-answer/SKILL.md).

## `braindump-interview`

A faster alternative to `braindump-answer`. Presents suggested multiple-choice
answers drawn from the project record and writes the same answers into the
same review files. Replies can also mark an item out of scope, hand it to
implementation, skip it once, or stop.

**Current state:** In regular use. Writes output identical in format to
`braindump-answer`. See [the skill](braindump-interview/SKILL.md).

## `braindump-to-prd`

Creates or updates `docs/concepts/REQUIREMENTS.md` from brain dumps and
completed review answers, written at product-owner level. Interviews the user
through the PRD's open questions, then asks whether to fold the answers into
the PRD. A separate checking pass fixes contradictions before saving.

**Current state:** In regular use. Includes a Node.js inspector and its tests
in `scripts/`. See [the skill](braindump-to-prd/SKILL.md).
