---
name: zulip-user
description: Communicate in Zulip as a human or agent using the Zulip CLI. Use to read or search messages, send DMs and channel messages, reply, share attachments, and add emoji reactions.
---

# Zulip User

Use `@fredlackey/cli-zulip` for ordinary conversation with humans and other agents. Each participant uses its own account, API key, and named profile.

## Start every session

Always check the current npm release and the installed executable before using Zulip:

```sh
npm view @fredlackey/cli-zulip@latest version engines --json
zulip --version
```

If missing or outdated, install/update with `npm install -g @fredlackey/cli-zulip@latest`, then verify `zulip --version` matches the registry release. Satisfy the reported Node.js requirement (0.0.2 requires Node.js 24.22+). If checking or updating fails, report the blocker; do not claim the CLI is current. Use `zulip <group> <command> --help` for current options. Commands return JSON by default.

Reuse the intended profile. If absent, obtain the site URL, account email, and API key from the user or their credential store. Humans can obtain their key in Zulip's personal settings; agents can use their administrator-provisioned credentials. API-key configuration is the CLI's login:

```sh
zulip profile create-profile --profile-name worker --site https://chat.example.com \
  --email worker-bot@example.com --api-key-stdin < /secure/worker-key
zulip auth get-caller-identity --profile worker
```

Replace example values with actual inputs. Confirm identity and pass `--profile worker` on each operation; do not borrow the administrator's profile to chat. Default credentials live in owner-only files under `~/.config/cli-zulip`, not encrypted storage. Keep keys out of chat, command arguments, repositories, and logs.

## Find and read messages

Discover recipients and channels with `user list-users` and `channel list-channels`, using the selected profile. Use returned IDs rather than guessing. These examples use illustrative IDs:

```sh
zulip message get-inbox --profile worker --scope direct --include-raw
zulip message get-inbox --profile worker --scope mentions
zulip message get-inbox --profile worker --scope unread
zulip message get-inbox --profile worker --scope sent
zulip message get-inbox --profile worker --channel-id 12 --topic 'Planning'
zulip message list-messages --profile worker --search 'release date' --max-items 100
```

Continue paginated results using `--starting-token` with the returned `next_token` and unchanged filters. Reading does not mark messages read; use `message mark-read --id 123 --profile worker` when appropriate. A bot needs its own subscriptions; private channels and old history remain subject to server permissions. Request missing access from the administrator instead of switching identities.

When requested and permitted, join a known channel with `channel subscribe-channel --name team-chat --profile worker`, or create one with `channel create-channel --name team-chat --profile worker`. Check existence first: subscribing to a nonexistent name may create it.

## Send, reply, and react

```sh
zulip message send-message --profile worker --user-id 42 --content 'Hello'
zulip message send-message --profile worker --channel-id 12 --topic 'Planning' --content-file update.md
zulip message reply-message --profile worker --message-id 123 --content 'Received :thumbs_up:'
zulip message update-message --profile worker --id 124 --content-file correction.md
zulip reaction add-reaction --profile worker --id 123 --emoji thumbs_up
zulip reaction remove-reaction --profile worker --id 123 --emoji thumbs_up
```

A channel conversation is a topic: send its first message to start one. `reply-message` preserves the original DM participants or the message's current channel/topic. Use `--content-file` or `--content-stdin` for longer text; choose exactly one content source. Reactions use emoji names without colons; message text can contain `:emoji_name:`. Edit only the intended message within your permissions.

## Attachments

```sh
zulip file share-file --profile worker --path report.pdf --channel-id 12 --topic 'Planning' --caption 'Report'
zulip file download-file --profile worker --upload /user_uploads/1/path/report.pdf --destination report.pdf
```

For a DM attachment, replace channel/topic options with `--user-id 42`. To attach a file to a reply, run `file upload-file --path report.pdf --profile worker`, take the returned upload URI, and include `[Report](UPLOAD_URI)` in `message reply-message` content. Uploading alone does not send a message.

## Ongoing agent conversations

For recurring work, keep a stable consumer name and process deliveries before acknowledging them:

```sh
zulip event watch-events --profile worker --consumer team-chat --once
zulip event ack-event --profile worker --consumer team-chat --event-id EVENT_UID --delivery-id DELIVERY_UID
```

Use the actual IDs from each delivery. Keep the same consumer and filters on restart. Unacknowledged work can be redelivered; deduplicate effects by event ID. Read/unread flags are separate from completion. Respond when the task calls for it, not to every event or reaction; avoid agent reply loops. Native bots can converse with each other and humans, but cannot set human-only presence or personal status.

If a send times out, check whether it arrived before sending again. For retryable automation, use `outbox send-message --help` and a stable `--request-id` for the same intended message. A partial file-share failure may already have uploaded the file; reuse its returned path after checking the send outcome.
