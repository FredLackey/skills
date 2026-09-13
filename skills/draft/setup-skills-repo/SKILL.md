---
name: setup-skills-repo
description: Create or reorganize a repository of portable agent skills using draft, canary, stable, imported, and legacy levels. Only invoke this skill when the user explicitly asks to set up, restructure, or audit a skills repository against this convention by name — never infer it automatically from ordinary skill authoring or editing. Do not use for installing skills into an agent environment.
---

# Setup Skills Repo

Only run this skill when the user directly and explicitly asks for it — by
name, or by unambiguously asking to initialize, restructure, or audit a
skills repository against this convention. Never invoke it automatically
because a request merely touches a `SKILL.md` file, adds a reference or
script to an existing skill, or otherwise edits skill content; those are
ordinary authoring tasks this skill does not own.

Create or align a skills repository with the packaged convention while
preserving each skill as a self-contained unit.

## Required Reference

Read [references/skill-repo-configuration.md](references/skill-repo-configuration.md)
before changing a target repository. It defines the directory structure,
level meanings, README format, portability boundary, and script conventions.

## Workflow

1. Identify the repository root and inspect its existing files, Git status,
   branches, and applicable repository instructions.
2. Determine whether the task is a new setup, a structural audit, or a
   migration of existing skills.
3. For a new or empty repository, create the directory structure defined by
   the reference and author the root and level README files for that repository.
   Treat the reference as guidance, not as a file to copy into the target.
   Do not overwrite existing documentation.
4. For an existing repository, inventory every skill and all files beneath its
   directory before moving anything. Preserve the entire skill directory when
   changing its level.
5. Assign levels from explicit user direction or reliable repository evidence.
   Do not guess when a classification would materially change how a skill is
   presented. Unclassified retired or historical skills may be placed in
   `legacy` when that intent is clear.
6. Update the root README and every affected level README. Each skill entry in
   a level README must use a subheading, a proper explanation, and a current
   state paragraph; never reduce the catalog to a table or single-line list.
7. Verify the final structure, relative references, skill self-containment,
   README coverage, and script portability. Run an available skill validator
   against each skill when practical.

## Safety

- Preserve unrelated repository content and existing user changes.
- Never edit a primary clone when the user's workspace requires worktrees.
- Use Git-aware moves for tracked files so history remains traceable.
- Do not delete ambiguous content merely because it is outside the convention;
  report it and obtain direction when deletion is not already authorized.
- Do not commit, push, change repository visibility, or otherwise mutate a
  remote unless the user explicitly requests that action.
- Treat installation and environment-specific skill discovery as outside this
  skill's scope.

## Completion

Report the resulting repository path, skills by level, validation performed,
remaining decisions or exceptions, and any Git or remote actions taken.
