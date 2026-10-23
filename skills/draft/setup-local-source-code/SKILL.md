---
name: setup-local-source-code
description: Set up, update, or reconfigure a portable source-code workspace and native repository-selected Git/SSH identities. Invoke only when explicitly requested by name or when the user unambiguously requests this workspace setup; ordinary cloning and repository work do not invoke it.
---

# Setup Local Source Code

Read [the convention](references/source-workspace-convention.md) before configuring a workstation. Read [the rationale](references/workspace-rationale.md) when explaining the design. Use Node.js 24+, Git 2.36+, and OpenSSH with SSH signing support. Preserve existing user work.

## Required outcomes

- Ordinary Git commands work independently of checkout location. Repository remote host/owner selects author name, email and SSH signing key; exact-repository exceptions override owner routes.
- Enable SSH commit and tag signing globally. Unknown or conflicting identities stop signing. Never fix a key problem by disabling signing or selecting the first key in an agent.
- Each persona/company uses `id_{persona-or-company}`, with matching `.pub`, for example `id_fredlackey`, `id_ccsi`, or `id_cisa`. Different identities use different keys; the same persona can reuse a key across hosts.
- Registration titles are exactly `{Proper Machine Name} ({YYYYMMDD})`, using the actual local registration date. Reject names such as `macos`, `darwin`, `macos.local`, and equivalent generic values. Establish the proper machine name explicitly; never fall back to an OS identifier or hostname. Existing registrations retain their dates on reruns.
- Treat all configured Git hosts equally: one workflow, command surface, naming/signing policy and `repos/{owner}/{repo}` convention. No provider-specific areas, headings or explanatory comments. API differences remain internal capabilities of the same tooling.
- Personal and machine-specific configuration belongs outside the workspace at `$SOURCE_WORKSPACE_CONFIG`, default `~/.config/source-workspace/config.json`. Portable assets contain no personal values or secrets.

## Establish configuration

For new setup or reconfiguration, collect only missing values: the proper machine name; persona/company labels, author names and emails; key basenames; each host's endpoint and account login; approved owner routes and repository exceptions; workspace root; commit-and-push preference; and optional passphrase caching/keychain preference. Inventory existing key filenames and effective Git/SSH configuration before proposing new keys. Reuse approved existing keys where possible.

Confirm each identity and its routes. Do not infer an identity from an operating system, folder location, active API login, or key order. For repositories with remotes belonging to different identities, and repositories without remotes, establish an explicit repository identity. Credentials are account-scoped, including when multiple accounts use one host.

Use the scripts to configure the machine; do not hand-author generated files. Do not run setup automatically during ordinary development. Explicit user authorization in the current session takes precedence over repeated confirmation steps.

1. Prepare the setup object from the [configuration schema](references/source-workspace-convention.md#configuration). Require an explicit host on every account; there is no implicit host or personal signing identity.
2. Run `scripts/configure-ssh-identities.mjs --config-base64 <base64url-json> --dry-run`. Review conflicts. If a new key is required, use `--generate-missing-keys`; passphrases are entered interactively, never in arguments. After authorization, apply; `--replace` only replaces the reviewed managed fragment. Effective SSH resolution and matching key pairs are checked. Backups go to quarantine before replacements.
3. Run `scripts/setup-local-source-code.mjs --config-base64 <value> --dry-run`. Present replacements and path collisions before applying. Apply the reviewed plan, using `--replace` only for authorized replacements. This installs the external configuration and portable workspace helpers/guide.
4. For each account, have the user store its credential in the external `tokenFile` with mode `0600`. Never read or print that file yourself. Run `scripts/host-accounts.mjs validate --account <id>` and `owners --account <id>`; confirm discovered owners before adding routes. Account validation is part of every API operation; no service CLI is a universal prerequisite.
5. Obtain authorization for registration, then run `host-accounts.mjs ensure-keys --account <id>`. It validates filenames, pair correspondence and machine naming, derives registration-day titles internally, registers supported key types, and verifies results. `verify-keys` is read-only. Host capabilities do not weaken mandatory local SSH signing or imply a verification badge. Unsupported registration metadata is reported through this same workflow.
6. Run installed `scripts/wt-enforce-signing.mjs --dry-run`. Review the native Git policy, identity includes, historical/current trust entries, transport/signing guards, and repository drift. After authorization, apply. Remove direct repository overrides only when specifically authorized; retain approved explicit identity bindings.
7. Use `scripts/wt-identity.mjs bind <account>` inside a remote-less or mixed-account repository. This records a local identity include and binding; it preserves the previous configuration. It must not be replaced with a global personal fallback.

## Updates and migration

For compatible configuration, run setup with `--update --dry-run`, review the diff, then apply the authorized update. Update deploys helpers and guidance; it does not apply Git/SSH configuration or change routes. Never edit installed helpers directly.

Schema version 2 requires the proper machine name, explicit host definitions, account-scoped credentials, and compliant key filenames. Do not deploy new helpers over an incompatible configuration. Prepare a full setup object from existing values, review before/after effective behavior, and preserve existing state in quarantine before replacement. Reuse approved keys; do not delete or re-register them to fix labels. Renaming existing keys, moving old host-separated checkouts into the common layout, or removing obsolete entry points requires a concrete migration plan. Detect owner/repository path collisions and preserve both repositories; never guess which host owns a path.

After migrating configuration and installing helpers, separately apply reviewed SSH configuration and the signing policy. Keep old trusted signing keys so historical commits remain verifiable. Retired helper files are reported as unmanaged; preserve and remove them only as part of the reviewed migration. Do not silently repair an existing remote registration title by deleting its key.

## Verification

- Run `--help` for every setup/account/workspace command and `node --test scripts/tests/*.test.mjs assets/workspace-scripts/tests/*.test.mjs` from the skill directory. Tests use isolated homes, credentials, temporary keys and mocked API responses.
- Confirm `ssh -G` resolves each alias to its intended endpoint, user, port and key; test actual authentication and read-only repository access for each approved account. Report account authentication separately from repository authorization.
- Verify actual SSH-signed commits and tags for multiple identities in disposable repositories outside the workspace and in linked worktrees. Check identity, signature type, intended signer and local verification separately.
- Check canonical SSH, explicit-port SSH, approved HTTPS and alias URLs, mixed casing, exact repository exceptions, unknown owners, missing keys, mixed remotes, and remote-less initial commits. Verify explicit binding restores the intended behavior.
- Confirm registration titles, proper machine names, registration dates, idempotency and both supported registration types. Never claim a remote supports an operation it does not expose.
- Run the enforcer again and resolve remaining drift. Exercise `wt-pr-create.mjs --dry-run` without credentials, pushes or API calls. Preserve the authored-commit filter in `clone-mine`; use `clone-all` only when explicitly asked to include repositories never contributed to.

Git settings can be explicitly overridden. Unbypassable acceptance of SSH-only signatures and approved signers requires repository-side validation; generic signed-commit rules alone do not establish those properties. Do not change hosting rules without authorization.
