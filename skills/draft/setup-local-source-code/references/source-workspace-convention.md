# Local Source Workspace Convention

This convention gives developers one predictable place for primary GitHub
clones, task worktrees, local-only projects, reusable tooling, and durable
research.

## Layout

```text
~/Source/
├── repos/      # Primary clones organized as repos/{org}/{repo}
├── trees/      # Task worktrees grouped by client/project and ticket/slug
├── local/      # Local-only projects that are not intended for GitHub
├── scripts/    # Executable Node.js workspace helpers
└── research/   # Durable, dated research findings
```

Primary clones are plumbing. Never perform repository work directly in
`repos/{org}/{repo}`. Work happens in:

```text
trees/{client-or-project}/{ticket-id-or-slug}/{repo}
```

The ticket directory is a plain grouping folder. Every repository worktree in
the same ticket directory uses the ticket ID or slug as its branch name.

Local-only projects live directly under `local/{kebab-case-slug}` without Git
initialization, commits, or publication unless their intent later changes.

The workspace's concise operating guidance lives in `CLAUDE.md`. `AGENTS.md`
points to the same content with a relative file symlink where the platform
allows one, and otherwise uses an identical compatibility copy.

## Workspace Tools

The setup installs dependency-free executable Node.js tools:

- `wt-create.mjs {org}/{repo} {client} {ticket}` creates or reuses a task
  worktree and clones/configures its primary repository when needed.
- `wt-enforce-signing.mjs` audits every primary clone and repairs routed author
  identity and SSH commit/tag-signing configuration.
- `wt-sync.mjs {org}/{repo}` fetches and fast-forwards a clean primary clone's
  default branch.
- `wt-list.mjs` lists task folders and their repository worktrees.
- `wt-status.mjs` reports clean/dirty and ahead/behind state.
- `wt-remove.mjs` safely removes a clean worktree and can optionally delete its
  merged local branch.
- `wt-prune.mjs` reports stale worktree directories and removes them only with
  its explicit force option.
- `wt-open.mjs {client} {ticket}` opens the entire ticket folder in VS Code.
- `clone-mine.mjs` discovers repositories with commits authored by configured
  GitHub profiles and clones them using the correct routed identity.

Scripts use `.mjs`, ES modules, a Node shebang, no npm dependencies, and avoid
shell interpretation of user-provided path segments.

## GitHub CLI and SSH Prerequisites

GitHub CLI is mandatory. The skill installs it when absent using WinGet on
Windows, Homebrew on macOS, GitHub's signed official apt repository on
Ubuntu/Debian, or the Arch `github-cli` package on Arch Linux. Installation is
previewed first because it changes system software.

Each GitHub account is authenticated in `gh` through the browser flow with the
Git protocol set to SSH. Automatic key upload during login is disabled so the
skill can deterministically register and verify the interviewed key afterward.
The login must have permission to administer authentication and SSH signing
keys. Existing logins are refreshed when those permissions are absent.

Git 2.34 or newer is required for SSH signature support. The setup stops rather
than claiming local enforcement when the installed Git version is too old.

## GitHub Identity Isolation

Each client or work context has its own identity record:

- Client/context display name.
- A safe identifier, suggested from the display name and confirmed by the
  user rather than typed in directly.
- Git author proper name and email.
- SSH host alias and private-key path, suggested from the safe identifier
  (bare `github.com` for the default identity, otherwise
  `github.com-{identifier}`) and confirmed by the user.
- GitHub username and the exact organization names routed to it — both
  discovered by logging into GitHub CLI as that identity and reading back
  the authenticated login and its organization memberships, never asked for
  directly.

One identity is the default for organizations without a discovered route. An
organization must resolve to exactly one identity — discovery must never
return the same organization for two identities. Routing is exact-match
only: an organization created later for an existing client is picked up by
re-running discovery, not by a prefix rule guessed in advance. Repository
cloning, GitHub API access, commit authorship, and SSH signing all use that
routed identity.

Every primary clone is configured locally with the routed name, email, SSH
signing key, `gpg.format=ssh`, `commit.gpgsign=true`, and `tag.gpgsign=true`.
Cloning uses SSH, not HTTPS. GitHub CLI uses SSH as its Git protocol, and the
same public key is registered and verified on the routed GitHub account as
both an authentication key and an SSH signing key.

## Research

```text
research/
├── TOPICS.md
└── {YYYY}/{MM}/{DD}/{topic-slug}/
    ├── README.md
    ├── findings-{subtopic}.md
    └── SUMMARY.md
```

`TOPICS.md` indexes every research topic. The topic README captures the full
question, separate findings files prevent parallel researchers from
overwriting one another, and the summary synthesizes the completed findings.

## Setup Configuration Schema

The setup script accepts this structure as Base64URL-encoded JSON. Values shown
below are placeholders, not defaults. `githubUser` and `orgs` are filled in
from GitHub CLI login and organization discovery, not typed in during the
interview:

```json
{
  "sourceRoot": "~/Source",
  "defaultIdentity": "personal",
  "identities": [
    {
      "id": "personal",
      "clientName": "Personal",
      "gitName": "Developer Name",
      "gitEmail": "developer@example.com",
      "githubUser": "github-user",
      "sshHost": "github.com-personal",
      "sshKeyPath": "~/.ssh/github-personal",
      "orgs": ["personal-org"]
    }
  ]
}
```

Identity IDs, client identifiers, organizations, and path segments use
lowercase letters, digits, and hyphens. Organization matching is
case-insensitive and exact only; an unmatched organization uses the default
identity.
