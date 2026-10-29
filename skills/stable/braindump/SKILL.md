---
name: braindump
description: Capture raw thoughts into a timestamped markdown file.
---

# Brain Dump Skill

## Purpose

This skill is the entry point for a development workflow. The user is thinking out loud, dictating
ideas, constraints, architecture hunches, user flows, or anything else about a new application they're
planning to build. Your job is to capture that thinking faithfully and save it to a file so that
other skills and future conversations can work from it.

The raw dump matters. It's the unfiltered version of the user's mental model at a specific moment
in time. Downstream skills will ask follow-up questions, extract requirements, build schemas, and
refine concepts based on what's in these files. So completeness and fidelity are more
important here than polish.

You are a scribe, not an editor.

## What you do

1. **Get the current timestamp** by running: `date '+%Y%m%d %H%M%S'`
   From that output, derive:
   - `YYYYMMDD`, for example `20260328`
   - `HHMMSS`, for example `143022`

2. **Determine the output folder**
   - If the user specified a folder path, use that.
   - Otherwise, default to `docs/braindump/` inside the current working directory (the monorepo root).
   - If the folder does not exist, create it.

3. **Construct the filename**: `{YYYYMMDD}-{HHMMSS}-dump.md`
   Example: `20260328-143022-dump.md`

4. **Clean the content.** Fix only:
   - Obvious typos and misspellings (correct the word, don't rephrase)
   - Run-together words or transcription glitches (e.g. "alsoI" → "also I")
   - Break text into paragraphs at natural topic or sentence-group boundaries

   Do NOT:
   - Summarize, condense, or shorten anything
   - Rewrite sentences for clarity or style
   - Add headings, bullets, or structure that wasn't in the original
   - Remove anything the user said, even if it seems redundant, contradictory, or half-formed

   Half-formed thoughts and contradictions are part of the record. Leave them in. Future skills
   will help the user work through them.

5. **Write the file** with this exact format:

```
Brain Dump ({YYYYMMDD} {HHMMSS})

-----

{cleaned content}
```

   Example header line: `Brain Dump (20260328 143022)`

   The dashes line is exactly five hyphens: `-----`

   One blank line between the header, the dashes, and the content.

6. **Confirm** by telling the user the full path of the file that was written.

## What the user gives you

The user may paste the text inline in the prompt, or they may say something like
"here's my brain dump:" followed by the content. Accept it however it arrives.
If no content is provided yet, ask: "What would you like to brain dump?"

## Tone

Keep your response short. Just confirm where the file was saved. No summaries, no reflections,
no commentary on the content.
