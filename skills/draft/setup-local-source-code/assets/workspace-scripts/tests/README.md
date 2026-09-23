# Workspace Script Tests

From an installed workspace, run the workspace-script regression checks with:

```sh
node --test scripts/tests/*.test.mjs
```

The tests use generated workspace identity configuration, temporary files,
fake GitHub responses, fake Git operations, and isolated temporary Git repositories. They do not contact GitHub,
expose stored tokens, create primary clones, push branches, or create PRs.

Path-casing tests cover legacy reuse, ambiguity, worktree ownership, exact ticket/branch case, canonical metadata, and creation locking.
