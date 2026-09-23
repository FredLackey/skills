# Workspace Script Tests

From an installed workspace, run the workspace-script regression checks with:

```sh
node --test scripts/tests/*.test.mjs
```

The tests use generated workspace identity configuration, temporary files,
fake GitHub responses, and fake Git operations. They do not contact GitHub,
expose stored tokens, create primary clones, push branches, or create PRs.
