# Agent Contacts

Agent Contacts let your Dots message the agents of people you trust, with each person running their own OpenDots. Two deployments talk through a narrow peer interface, and each owner stays in control of their side. This implements the first slice of the [Agent Contacts RFC](https://github.com/CopilotKit/OpenDots/issues/41).

## Setup

Both servers need `PUBLIC_URL`: the address the other server uses to reach this one, for example `https://dots.example.com`. Peer requests go to `PUBLIC_URL/peer/v1/*`. That path is served by the OpenDots API server, not the Vite dev server, so in development use the API port, such as `http://127.0.0.1:4310`. An externally reachable server also needs `OWNER_TOKEN`, as usual.

## Pairing

1. One owner opens **Contacts → Invite someone**, enters a name, chooses which Dot drafts replies to that person, and selects **Create invite code**.
2. They send the code over a channel they trust. A code works once and expires in 7 days.
3. The other owner pastes it into **Accept an invite**. Their server contacts yours, and both sides become active.

Pairing allows messages only. It grants no access to Spaces, pages, memories, computers or tools. Display names are what each owner typed, not verified identities.

## Sending

When a Dot wants to ask a contact something, it calls `ask_contact`. An approval card shows the recipient and the exact text. Nothing is sent until you select **Approve & send**, and the server sends only that approved text. The card then follows the request: sending, waiting for a reply, replied, declined or not delivered. When a reply arrives, **Continue with this reply** passes it to your Dot, marked as the other person's words, not instructions.

Contact tools appear only in the web app and only when you have an active contact. They are not available over Slack, iMessage or in scheduled runs.

## Receiving

Requests from contacts wait in **Contacts → Inbox**, and the sidebar shows how many. For each request you can:

- **Draft a reply** with that contact's Dot. The draft uses only your Dot's role instructions, your earlier exchange with this contact and any guidance you type. It has no tools, memories, other conversations or Learning.
- Edit the reply, then **Send reply**. Only the text in the box is sent.
- **Decline**.

A contact can have at most 20 unanswered requests waiting.

## Revoking

**Revoke** stops all further messages in both directions. Your server also tells the other server. If it cannot be reached, revocation still applies on your side. Messages already delivered stay with the other person.

## States

Delivery and the owner's decision are tracked separately.

- **Delivery:** `queued`, `delivered` or `failed`. Failed deliveries can be retried, and queued or failed ones are retried when the server starts.
- **Decision:** `pending`, `answered` or `declined`.

Re-submitting the same approval or delivery never sends a request twice.

## Peer protocol (v1)

Each request is a JSON `POST` with two headers: `X-OpenDots-Contact: <contact id>` and `Authorization: Bearer <pairing secret>`.

| Path                          | Body                                            |
| ----------------------------- | ----------------------------------------------- |
| `/peer/v1/pair`               | `{ url, name }`                                 |
| `/peer/v1/messages`           | `{ id, text }`                                  |
| `/peer/v1/messages/:id/reply` | `{ decision: "answered" \| "declined", text? }` |
| `/peer/v1/revoke`             | `{}`                                            |

Each pairing has its own secret, which never reaches the browser. Use HTTPS between servers so the secret and messages are encrypted in transit.
