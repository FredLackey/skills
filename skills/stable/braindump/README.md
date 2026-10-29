# braindump

## What this skill does

`braindump` captures raw thoughts about an application and saves them as a timestamped markdown file. It preserves the user's thinking so later skills can turn it into requirements, schemas, mockups, and implementation plans.

Use this skill when a user says they want to brain dump, save thoughts, capture ideas, write down rough planning notes, or dictate early product thinking.

## How it is used

The user provides unstructured text. The skill lightly cleans obvious typos and paragraph breaks, but it does not summarize, restructure, rewrite, or remove content.

The goal is to preserve the user's original thinking, including contradictions and half-formed ideas.

## What it creates or edits

The skill creates a new markdown file in:

```text
docs/braindump/
```

The filename uses the current timestamp:

```text
YYYYMMDD-HHMMSS-dump.md
```

The file format is:

```text
Brain Dump (YYYYMMDD HHMMSS)

-----

{cleaned content}
```

## How to use it

1. Ask the agent to use `braindump`.
2. Provide the raw thoughts to capture.
3. The agent writes the timestamped dump file.
4. Use `braindump-review` or other downstream skills later to process the saved material.

## Important constraints

- Do not summarize the user's content.
- Do not add headings or structure that the user did not provide.
- Do not remove contradictory or unfinished thoughts.
- Only fix obvious typos, transcription glitches, and paragraph breaks.
