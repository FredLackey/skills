# Skill Repository Convention

This convention organizes repositories containing reusable, portable agent
skills. It separates repository documentation from skill packages and makes a
locally developed skill's readiness visible from its path.

## Repository Structure

```text
repo-root/
├── README.md
├── docs/
└── skills/
    ├── draft/
    │   └── README.md
    ├── canary/
    │   └── README.md
    ├── stable/
    │   └── README.md
    ├── imported/
    │   └── README.md
    └── legacy/
        └── README.md
```

The root `README.md` briefly explains the repository and links to its
documentation and skill-level indexes. The `docs/` directory contains only
repository-wide documentation and helpful information.

## Skill Levels

- `draft` contains skills still in development. They may be incomplete,
  unstable, or subject to significant change.
- `canary` contains skills ready for practical testing but not yet approved
  for production use.
- `stable` contains skills ready for dependable production use.
- `imported` contains skills obtained from external sources. Imported skills
  always remain classified by origin and do not participate in the local
  readiness lifecycle.
- `legacy` contains retired, superseded, or otherwise old skills retained for
  historical reference or limited continued use.

The usual lifecycle for a locally developed skill is:

```text
draft → canary → stable
```

Moving a locally developed skill between these three directories communicates
a change in its readiness. `legacy` is not a stage of that lifecycle — it is
an isolated, disconnected archive. A skill lands there two ways: it is
retired out of the active `draft`/`canary`/`stable` pipeline, or it is pulled
in from elsewhere (a forgotten skill recovered from an old location, another
repository, or a backup) without ever having gone through that pipeline here.
Either way, a `legacy` skill does not participate in promotion and is not
assumed to still work or be maintained.

## Level README Files

Every `skills/{level}` directory contains a `README.md`, even when it contains
no skills. The README concisely describes the level and catalogs every skill
currently stored there.

Do not use Markdown tables or single-line skill entries. Give each skill its
own subheading, followed by a useful explanation and explicit current state.

```markdown
# Canary Skills

## `release-notes`

Produces release notes from repository changes and organizes noteworthy
updates for the intended audience.

**Current state:** Ready for representative testing. Output quality and edge
cases are still being validated before promotion to stable.
```

Keep indexes synchronized whenever a skill is added, removed, renamed, or
moved between levels.

## Skill Package

Every skill lives at:

```text
skills/{level}/{skill-name}/
├── SKILL.md
├── references/            # Optional supporting information
├── scripts/               # Optional executable helpers
└── ...                    # Any other resources the skill needs
```

A skill must never sit directly under `skills/`; every skill belongs under
exactly one of `skills/draft`, `skills/canary`, `skills/stable`,
`skills/imported`, or `skills/legacy`. `skills/{level}/{skill-name}/` is
required, not optional — a skill directory found any other place, including
loose under `skills/` itself, is a structural violation to fix, not an
acceptable alternate location.

`SKILL.md` is required, with that exact capitalization. Use a descriptive,
kebab-case skill directory name, and keep exactly one skill in each directory.

`references/` contains skill-specific instructions, schemas, templates,
examples, or other information loaded as needed. `SKILL.md` must identify
required references and explain when to read them. Use paths relative to the
skill directory.

`scripts/` contains internal executable helpers. Scripts support the workflow
documented by `SKILL.md`; they do not replace those instructions.

These conventional directories are not exhaustive. A skill may contain any
additional files or subdirectories it needs, including evaluations, assets,
fixtures, or agent metadata. Preserve all of them when moving the skill.

## Self-Containment

Every skill must function independently of its source repository. Its skill
directory must contain everything it needs without relying on repository-level
documentation, sibling skills, or continued access to the source organization.

- Keep required supporting information within the skill directory.
- Use relative paths for internal links and file references.
- Do not make runtime behavior depend on the root `docs/` directory.
- Keep repository-wide information in `docs/`, but duplicate or adapt any
  operationally required material inside the relevant skill.

This convention defines package contents and portability. Installation,
discovery, activation, updating, and removal behavior are outside its scope.

## Script Portability

Helper scripts should normally be executable Node.js programs. Use a different
language or runtime only for a deliberate reason documented in `SKILL.md`.

Default Node.js scripts should:

- Use the `.mjs` extension and ES modules.
- Include a `#!/usr/bin/env node` shebang.
- Be marked executable in Git.
- Avoid platform-specific shell behavior and filesystem assumptions.
- Run on supported versions of Windows, macOS, Ubuntu, and Arch Linux.

## Repository Boundaries

A skills repository contains self-contained skills and repository-wide
documentation. Standalone applications and unrelated source projects belong
elsewhere.
