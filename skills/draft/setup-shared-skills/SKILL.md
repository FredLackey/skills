---
name: setup-shared-skills
description: Install, add, update, or repair agent skills using one shared local source checkout and per-harness symlinks or supported direct paths. Use for ordinary requests such as "install this skill" or "make this skill available to my agents", even when shared installation is not mentioned. Default to shared installation across the selected local harnesses, preserve existing files, and follow the local Source workspace convention. Explicit requests for copies or native plugin installation take precedence.
---

# Setup Shared Skills

Make shared installation the default for local agent skills. Keep one maintained
copy of each repository; connect the selected harnesses to whole skill folders
inside it. Do not create a separate clone or copy for each harness by default.

If the user explicitly requests a copy or native plugin installation, use that
method and its relevant installer instead of the shared-connection steps below.
Preserve existing content and verify that requested installation. Do not also
register this installer in other locations unless that setup was requested.

## Scope And Automatic Discovery

- Apply this workflow to normal skill-install requests without requiring the
  user to name this skill or request symlinks.
- When setting up shared skills across a computer, discover the installed local
  harnesses and connect those with verified support. When installing an
  individual skill, use the user's stated harnesses or existing shared-install
  selection; if neither is known, target the current local harness. Ask only
  when the destination cannot be established. Do not install missing harnesses.
- In each selected harness, make **this installer skill** discoverable alongside
  the requested skills. Link its entire canonical folder using the same
  workflow. Reuse an existing correct registration; do not recursively install
  it again, install every sibling skill, or copy it out of a plugin cache.
- Keep this skill's automatic invocation enabled. Do not add explicit-only
  flags or disable model invocation. Metadata enables selection; it is not a
  hook that intercepts every request or overrides other instructions.
- Respect a user's explicit installation method, target scope, or revision.
  Native plugin installation may require the harness's own registry/cache;
  follow that mechanism rather than silently substituting a folder link.

## 1. Establish The Source

Read [the source workspace guidance](references/source-workspace.md) before
cloning or choosing a link target. It includes the needed conventions from
`setup-local-source-code`; installing skills does not require rerunning that
skill's identity interview or workstation setup.

1. Identify the requested repository, exact skill folder, and requested revision
   or release level. Reuse evidence from the request and local workspace. Do not
   assume every repository uses `skills/stable/` or promote a draft implicitly.
2. Inspect applicable workspace instructions, the configured source root, and
   existing clones. Use a durable primary clone at
   `<source-root>/repos/<owner>/<repository>` by default, with the configured
   source root or `~/Source` when none exists. Respect any documented host
   namespace. Avoid temporary task worktrees and harness cache directories as
   permanent installation sources.
3. Use the configured workspace helpers to acquire or refresh the repository.
   Preserve its identity routing, SSH transport, and signing configuration. Do
   not clone unrelated repositories or initialize an entire workspace just to
   install one skill. See the reference for an unconfigured computer.
4. Read the selected skill's `SKILL.md` and inspect its supporting files before
   enabling it. Resolve scripts, references, and assets within the complete
   skill directory. Check that its content belongs in the requested harness
   and that no credentials are needed merely to copy configuration paths.

## 2. Choose Each Harness Connection

Read [harness discovery and compatibility](references/harness-support.md) for
the selected products. Verify installed versions, actual configuration roots,
discovery scope, link support, and reload behavior using current official docs
or the installed loader. Treat the reference's dated information as a starting
point, not a permanent compatibility guarantee.

Prefer one directory symlink per skill. Use a supported direct skill path when
that is the harness's reliable shared-source mechanism. Link the whole folder,
not just `SKILL.md`, and never replace the harness's entire skills directory.
Check for duplicate names in other discovery locations or plugin installations.

Present a concise mapping of source folder → harness destination/resource and
the revision being installed. Continue with changes already authorized by the
install request. Ask for direction only for unresolved choices or a concrete
conflict whose replacement is not authorized.

## 3. Create Or Reuse Connections

For filesystem links, use the included Node.js 20+ helper with absolute paths
resolved for the current user. It defaults to a read-only preview:

```sh
node <this-skill>/scripts/link-skill.mjs --source <skill-folder> --destination <harness-skills-folder>/<skill-name>
node <this-skill>/scripts/link-skill.mjs --source <skill-folder> --destination <harness-skills-folder>/<skill-name> --apply
```

The helper resolves a source alias to its current real directory. If that alias
is later redirected, check and deliberately repair the registration; it does
not track future alias switches automatically.

An existing link to the same resolved folder is a successful no-op. A copied
directory, another target, a broken link, or a file is a conflict. The helper
never overwrites or removes one. Compare local modifications, preserve them,
and use an authorized migration with a recoverable backup before retrying.
Keep backups outside every harness discovery directory so they are not loaded
as duplicate skills. Do not use force-link commands or recursive deletion.

For direct-path configuration, edit only the selected agent's skill resource
entry, preserving unrelated settings. Follow the harness's path/URI syntax;
plain file context is not interchangeable with a discoverable skill resource.
Do not rewrite unrelated agents or change a default agent merely to claim
installation success.

If this installer is currently available only as an unpacked copy, locate its
source repository from reliable provenance or the user's supplied repository.
Establish its canonical Source checkout before registering it in other
harnesses. If provenance is unknown, ask for it while completing independent
requested-skill installations. Do not encode a particular maintainer's account
or machine as a default source.

## 4. Verify And Report

1. Run the helper with `--check` for every filesystem connection. It verifies
   the link resolves to the intended folder and that `SKILL.md` is readable.
2. Reload skills or start a new session as the harness requires. Use its skill
   list, selector, or equivalent to confirm the requested skills **and this
   installer** are discovered. Check that scripts and references remain
   reachable. A valid OS link alone does not prove harness discovery.
3. For this installer, verify the harness exposes its description for automatic
   selection. A fresh-session request such as “install this skill from this
   local repository” should choose the shared workflow without naming the
   installer; use a disposable destination if testing performs installation.
4. Report the shared clone, selected revision, connection paths, created/reused
   links, and per-harness verification. Distinguish `verified`, `configured but
   unverified`, and `blocked`; lack of authentication is not successful discovery.

## Updating And Removing

Update the shared primary clone once with the workspace's sync helper, then
recheck connections and reload the selected harnesses. Links do not fetch Git
updates. If the user pinned a revision, keep it pinned; do not sync it forward.
If a skill moves between release-level folders, resolve its new reviewed path
and repair affected registrations while preserving rollback information.

Author skill changes in task worktrees. Never edit the primary through an
installation link or run an updater there that modifies tracked source files.
Canonical documents bundled inside a skill still need their normal packaging
step; shared installation only removes the per-harness copies.

To uninstall, remove only the verified link or selected resource entry. Leave
the shared clone and other harness registrations intact. Remote machines,
containers, and cloud harnesses need their own reachable filesystem target;
a workstation symlink does not distribute files to them.
