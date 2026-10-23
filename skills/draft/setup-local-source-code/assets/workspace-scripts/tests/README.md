# Workspace script tests

Run `node --test scripts/tests/*.test.mjs assets/workspace-scripts/tests/*.test.mjs` from the skill directory,
or `node --test scripts/tests/*.test.mjs` after installation. Node 24+, Git 2.36+
and OpenSSH SSH-signing support are required.

The source-only setup/registration suite additionally lives in `scripts/tests/`.

Fixtures isolate HOME, global Git configuration, workspace configuration and API
credentials. They generate disposable SSH keys and create real signed commits/tags;
network/API responses are mocked. No real account, credential, checkout or push is used.

Coverage includes off-path and linked-worktree identity selection, multiple hosts,
ambiguous/remoteless repositories, explicit binding, exact exceptions, path collisions,
shared discovery/authorship filtering, pull-request dry-run and idempotency, registration
naming/date validation, effective SSH configuration, preserved historical trust and
transport endpoint selection. On case-insensitive filesystems, creating two physical
case variants is unavailable; occupied-path refusal is still exercised.
