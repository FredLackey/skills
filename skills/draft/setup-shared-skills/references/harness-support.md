# Harness Discovery And Compatibility

Documentation checked September 26, 2026. Verify the actual installed version
and supported configuration roots before applying this guidance. An existing
configuration override takes precedence over a default path shown here.

| Harness | Default user skill location | Shared-source behavior |
| --- | --- | --- |
| Codex | `~/.agents/skills/<skill-name>/` | Officially supports symlinked skill folders. Repository scope uses `.agents/skills/`. |
| Claude Code | `~/.claude/skills/<skill-name>/` | Officially supports individual skill-folder symlinks at personal and project scope. Repository scope uses `.claude/skills/`. |
| Kiro | `~/.kiro/skills/<skill-name>/` | Shared skill directories exist, but symlink discovery must be verified for the installed version. Current custom agents can use direct `skill://` resources. |

## Codex

The [official skills documentation](https://learn.chatgpt.com/docs/build-skills)
documents symlink traversal and automatic discovery of changes. Restart Codex
if changes do not appear. Older installations may also use `.codex/skills`;
inspect the actual loader/configuration instead of registering the same skill
in every possible root. Same-name skills from multiple locations can both
appear, so avoid duplicate registration.

For this installer, keep `policy.allow_implicit_invocation` enabled in
`agents/openai.yaml`. Discovery must expose its install-oriented description;
do not require `$setup-shared-skills` for ordinary installation requests.

## Claude Code

The [official skill locations guide](https://code.claude.com/docs/en/skills#choose-where-skills-load)
supports individual symlinked skill folders and deduplicates links to the same
target. Link a whole skill folder, not the parent skills directory. Local
personal skills do not automatically become available in hosted/cloud sessions.

Claude Code supports automatic skill selection from the description. Do not
set `disable-model-invocation: true` for this installer. Use its documented
reload mechanism or a fresh session when an external target's edits do not
appear; do not assume file watchers refresh already-loaded conversation text.
See [editing skills during a session](https://code.claude.com/docs/en/skills#edit-a-skill-during-a-session).

## Kiro

Read the [skills guide](https://kiro.dev/docs/skills/) and the
[custom-agent configuration reference](https://kiro.dev/docs/custom-agents/configuration-reference/).
The current configuration reference targets IDE 1.0 / CLI 3.0; do not apply its
schema blindly to earlier versions. An [open IDE symlink report](https://github.com/kirodotdev/Kiro/issues/6401)
concerns an older version; it is evidence to verify compatibility, not proof
that every Kiro version rejects links.

A compatible custom agent can use a resource such as
`skill://~/Source/repos/example-org/agent-skills/skills/stable/code-review/SKILL.md`.
Resolve the user's actual home/source root and use that version's supported
URI syntax. The resource points to `SKILL.md`, not merely its parent directory.
Preserve other resources and agent settings. This registration applies to that
custom agent, not automatically to every agent or the default agent.

`file://` loads ordinary context and is not a substitute for automatic skill
discovery. An import action that copies files does not meet shared installation.
If discovery or automatic selection cannot be verified, report that limitation
and complete the supported harnesses. Do not silently copy the skill or upgrade
Kiro to make the result look complete.

## Other Harnesses And Platforms

Use the product's current official skill documentation or installed loader to
establish its discovery roots, symlink/direct-path behavior, and invocation
policy. A folder named `skills` is not sufficient evidence. Verify that the
installer is offered to the model for normal install requests, not only in a
manual command palette. Provider-specific metadata can coexist in `agents/`;
do not assume another product honors Codex's invocation settings.

On Linux and macOS, the helper creates a directory symlink. On Windows it can
create a directory symlink, or an explicit `--kind junction` when the harness
has been verified to follow directory junctions. Symlink privileges and
filesystem support differ by machine. Do not enable Developer Mode, elevate,
change security settings, or fall back to copies automatically after a failure.
Use an already-supported direct resource path or report the concrete blocker.
The helper's unit tests do not establish compatibility with every harness/OS.

For remote SSH sessions, containers, WSL, and cloud environments, determine
which filesystem the harness actually reads. A host absolute path is not
necessarily meaningful inside a container or WSL. Install against that
environment's accessible source checkout or supported mount and verify there.
