# Community bots

Bots run in the developer's own process. Harbor never accepts or executes uploaded code. Human browser sessions and bot bearer credentials are separate: bots have a `BOT` sender identity, no usable password or human session, and cannot appear in friend searches or receive friend requests.

## Built-in Welcome bot

In community settings, open **Bots**, choose the Welcome bot, review the requested `SEND_MESSAGES` / `COMMANDS` grants, select only the intended channel (for example `#大厅`), and supply a welcome message. `{name}` is replaced with the new member's display name. The welcome hook runs only when an invite actually creates a new community membership. A transactional `(installation, member)` claim and stable message ID prevent duplicate greetings. Refreshing, reconnecting, or submitting an invite for an existing member never sends a welcome. Installing or reinstalling a bot does not backfill greetings for members who already belong to the community.

`/help` returns the current authorized command list privately. `/ticket` opens the private ticket form; no ticket subject, message or ticket activity is posted to a public channel.

## Run a custom bot locally

Use Node.js 22 or later. Create a normal developer account first. Run provisioning on the developer's own computer, not in the website frontend. Supply passwords interactively or through a secret manager; do not put them in shell history, Git or logs.

```bash
export HARBOR_URL=https://chat.example.com
export BOT_DEVELOPER_USERNAME=your_developer_username
read -s BOT_DEVELOPER_PASSWORD
export BOT_DEVELOPER_PASSWORD
export BOT_NAME='Ping helper'
export BOT_CREDENTIALS=/private/path/harbor-bot.json
node examples/custom-bot/provision.mjs
unset BOT_DEVELOPER_PASSWORD
```

The provisioner logs out its temporary human session and writes the bot credential once into a new file with mode `0600`. It prints only the Bot ID. It refuses to overwrite files. Keep the credential outside the website directory, backups served by the site, and the Git checkout.

Give the Bot ID to the community owner. In community settings install that ID, choose permitted channels, grant `SEND_MESSAGES` and `COMMANDS`, and configure command `ping`. Grant `READ_MESSAGES` separately only if the bot needs human message events. The example requires no message-reading permission to respond to `/ping`.

```bash
BOT_CREDENTIALS=/private/path/harbor-bot.json node examples/custom-bot/bot.mjs
```

Run `/ping` in the authorized channel. The independent process receives the command and posts `Pong` under its own BOT identity. `--once` exits after one command response, useful for a smoke test. Event delivery is at least once; the example reuses each event's ID as its message client ID, so replaying after a process restart cannot create a duplicate reply.

The polling API returns `{events,cursor}`. Pass `after=cursor` for subsequent pages. Only current installations and currently granted channels are returned; stale queued events are rechecked after scope changes. There is no ticket or private-message event API. Polling is limited to 120 requests/minute per bot and messages to 20/minute per installation. Bot messages never generate events for other bots, preventing feedback loops. Attachments are not exposed through the bot API.

## Rotate or revoke

- The developer rotates with the provisioner: set `BOT_ROTATE_ID` to the Bot ID, choose a new `BOT_CREDENTIALS` path, and run provisioning again. The old token stops authenticating immediately; replace the credential file in the independent process and restart it. The server stores only the token hash.
- A community owner can disable an installation, change channels/grants, or remove it. Every event poll and send rechecks authorization. Removal revokes that community immediately and removes only its installation/event records; historical BOT messages remain.
- Tokens never appear in catalog/installation JSON, frontend configuration, URLs or ordinary logs. Treat bearer credentials like passwords. Browser Origin and CSRF checks remain enabled for all human management requests; the example explicitly supplies the site's Origin for the bot API as well.

## Ticket privacy

Tickets reuse the authenticated Conversation, Message, attachment, reply, receipt and search pipeline, with a separate `TICKET` type. Only the current community owner, the member named on that ticket and its explicitly assigned eligible handler receive ConversationMember rows. Being a community administrator or installing a bot does not grant ticket access. Assignment is an explicit owner action; losing community membership or handler capability revokes access. Closed tickets remain readable to those parties but cannot receive messages/uploads/edits until reopened. Ownership transfer moves the owner party to the new owner, preserving the original ticket and history.

Ticket creation uses `(creatorId, clientId)` idempotency inside the community lock; repeated requests return the same conversation. Status/assignment changes are audited without storing ticket text in the audit record. Number, subject/member/assignee/status filters are restricted before pagination. The ticket title, body, files and unread counts are never emitted to a public community room.
