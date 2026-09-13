# Workspace Script Tests

Run the clone-discovery regression checks with:

```sh
node --test scripts/tests/clone-mine.test.mjs scripts/tests/clone-all.test.mjs
```

The tests use generated workspace identity configuration plus fake GitHub
responses and clone operations. They do not contact GitHub, expose stored
tokens, or create primary clones.
