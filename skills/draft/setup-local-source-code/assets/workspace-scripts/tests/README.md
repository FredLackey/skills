# Workspace Script Tests

From an installed workspace, run the workspace-script regression checks with:

```sh
node --test scripts/tests/*.test.mjs
```

The tests never read or change the developer's settings. `helpers/test-config.mjs`
points `SOURCE_WORKSPACE_CONFIG` and `GIT_CONFIG_GLOBAL` at temporary files with
a generated configuration (personal, employer, and Forgejo accounts), and
`helpers/workspace-fixture.mjs` builds a throwaway workspace with workstation
signing installed. Tests use fake GitHub and Forgejo responses, fake network Git
operations, and isolated temporary repositories. They do not contact any host,
expose stored tokens, create real primary clones, push branches, or create PRs.

- `path-casing` covers legacy reuse, ambiguity, worktree ownership, exact
  ticket/branch case, canonical metadata, creation locking, additional-host
  namespaces, and SSH host aliases.
- `routing-signing` covers configuration validation, fail-closed routing,
  `wt-route.mjs`, workstation identity and signing (including worktree
  inheritance and local overrides), `wt-sync.mjs --strict`/`--verify-branch`,
  and alias acceptance in PR preflight.
- `forgejo` covers per-host routing, SSH port validation, and draft PR
  creation/reuse.
- `clone-mine`, `clone-all`, and `wt-pr-create` cover discovery, credential
  isolation, argument validation, and PR publishing.
