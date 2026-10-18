---
name: zulip-admin
description: Onboard human and agent accounts in Zulip and maintain their profiles, roles, and channel or group access using the Zulip CLI. Use for routine organization administration.
---

# Zulip Admin

Administer human teammates and automated participants with `@fredlackey/cli-zulip`. Use a regular Zulip administrator account through its API key; a native bot cannot perform bot lifecycle administration. Host maintenance, SMTP, and server upgrades are outside this skill.

## Start every session

Always check the current npm release and the installed executable before using Zulip:

```sh
npm view @fredlackey/cli-zulip@latest version engines --json
zulip --version
```

If missing or outdated, install/update with `npm install -g @fredlackey/cli-zulip@latest`, then verify `zulip --version` matches the registry release. Satisfy the reported Node.js requirement (0.0.2 requires Node.js 24.22+). If checking or updating fails, report the blocker; do not claim the CLI is current. Use `zulip <group> <command> --help` for current options. Commands return JSON by default.

Reuse the intended administrator profile, or obtain the site URL, account email, and API key from the user or their credential store. A regular user's API key is available in Zulip's personal settings. Import it without putting it in command arguments:

```sh
zulip profile create-profile --profile-name admin --site https://chat.example.com \
  --email admin@example.com --api-key-stdin < /secure/admin-key
zulip auth get-caller-identity --profile admin
zulip auth get-capabilities --profile admin
```

Replace example values with actual inputs. Check identity before changes and pass `--profile admin` explicitly. Profiles are local CLI identities, distinct from users' server-side profile fields. Default credentials live in owner-only files under `~/.config/cli-zulip`; this is not encrypted storage. Keep keys/passwords out of chat, repositories, and logs; use the user's credential store or a protected handoff when provisioning another machine.

## Onboard people and agents

First inspect `user list-users`, `channel list-channels`, and `group list-groups` with the administrator profile. Resolve existing accounts and intended channel/group IDs before creating anything. Use member access unless another role is requested.

For a human joining the team, an invitation lets them establish their own login:

```sh
zulip invite create-invite --profile admin --to teammate@example.com --role 400 --channel-id 12
```

This sends an invitation email; use it as part of the requested onboarding. After acceptance, look up the account and verify its access. For direct account creation, use `user create-user --user-email ... --full-name ... --password-stdin` with the administrator profile and a protected password input. Direct creation requires the separate server-granted `can_create_users` capability; administrator role alone is insufficient. If missing, report the required server grant rather than attempting self-elevation. An administrator cannot retrieve an arbitrary regular user's API key.

For an agent, prefer resumable onboarding. Save a secret-free manifest such as `worker.json`, replacing the example IDs with existing resources:

```json
{
  "version": 1,
  "name": "team-worker",
  "kind": "bot",
  "short_name": "team-worker",
  "full_name": "Team Worker",
  "profile": "team-worker",
  "role": "member",
  "channel_ids": [12],
  "group_ids": [34]
}
```

```sh
zulip entity onboard-entity --profile admin --manifest file://worker.json --dry-run
zulip entity onboard-entity --profile admin --manifest file://worker.json
zulip auth get-caller-identity --profile team-worker
```

This creates the bot, stores its own key and local profile, assigns access, and verifies identity. Resume interrupted onboarding with the same manifest. For an automated regular account, use `"kind": "user"` and `"email": "worker@example.com"` instead of `short_name`; this additionally requires `can_create_users`. Native bots support normal chat with humans and bots, but regular accounts are needed for presence and personal status. Bots need their own channel subscriptions and do not inherit their owner's private history access.

## Correct accounts and access

Use the discovered IDs; the following are examples, not a batch to execute:

```sh
zulip user update-user --profile admin --user-id 42 --full-name 'Team Member'
zulip user set-user-role --profile admin --user-id 42 --role member
zulip channel create-channel --profile admin --name team-chat --description 'Team discussion'
zulip channel subscribe-channel --profile admin --name team-chat --user-id 42
zulip group add-members --profile admin --id 34 --user-id 42
zulip user reactivate-user --profile admin --id 42
```

Use `user update-user --help` for email corrections and custom profile fields; privileged email changes need separate server permission. For accounts managed by an onboarding manifest, edit its display name (`full_name`), role, or memberships and run `entity reconcile-entity --manifest file://worker.json --profile admin`. Keep `name`, kind, email/short name, and destination profile unchanged. Inspect current state after a partial failure instead of creating a duplicate.

When requested, deactivate with `user deactivate-user --user-id 42 --dry-run --profile admin`, then apply without `--dry-run`. Review owned-bot dependencies before accepting any cascade. Verify the resulting account details, memberships, and active state; report any permission blocker or unfinished step.
