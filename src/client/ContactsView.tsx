import { useCallback, useEffect, useState } from 'react';
import { Copy, Inbox, Send, Sparkles, UserPlus, Users } from 'lucide-react';
import type { Contact, ContactMessage } from '../shared/contact-types';
import type { Dot } from '../shared/types';
import { api } from './api';
import { contactStatus } from './ContactRequestCard';
type State = {
  contacts: Contact[];
  messages: ContactMessage[];
  ready: boolean;
};
const describe = (error: unknown) =>
  error instanceof Error ? error.message : 'Request failed.';
function DotPicker({
  dots,
  value,
  onChange,
  id,
}: {
  dots: Dot[];
  value: string;
  onChange: (id: string) => void;
  id: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {dots.map((dot) => (
        <option key={dot.id} value={dot.id}>
          {dot.name}
        </option>
      ))}
    </select>
  );
}
function IncomingRequest({
  message,
  contact,
  onChange,
}: {
  message: ContactMessage;
  contact?: Contact;
  onChange: () => Promise<void>;
}) {
  const [guidance, setGuidance] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError('');
    try {
      await action();
      await onChange();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy('');
    }
  };
  const from = contact?.name ?? 'A contact';
  const pending = message.decision === 'pending';
  const active = contact?.status === 'active';
  return (
    <article className="contact-request">
      <header>
        <strong>{from}</strong>
        <span>
          {pending
            ? 'Needs your decision'
            : message.decision === 'declined'
              ? 'Declined'
              : message.delivery === 'failed'
                ? 'Reply not delivered'
                : 'Replied'}
        </span>
      </header>
      <p className="contact-exact">{message.text}</p>
      {pending && active && (
        <>
          <label className="field-label" htmlFor={`guidance-${message.id}`}>
            Guidance for your Dot’s draft (optional)
          </label>
          <input
            id={`guidance-${message.id}`}
            value={guidance}
            maxLength={2000}
            placeholder="e.g. Say yes, but only after 10am"
            onChange={(e) => setGuidance(e.target.value)}
          />
          <button
            type="button"
            className="contact-secondary"
            disabled={!!busy}
            onClick={() =>
              void run('draft', async () => {
                const draft = await api<{ text: string }>(
                  `/contact-messages/${message.id}/draft`,
                  'POST',
                  { guidance },
                );
                setReply(draft.text);
              })
            }
          >
            <Sparkles size={14} />
            {busy === 'draft' ? 'Drafting…' : 'Draft a reply'}
          </button>
          <label className="field-label" htmlFor={`reply-${message.id}`}>
            Your reply (sent exactly as written)
          </label>
          <textarea
            id={`reply-${message.id}`}
            rows={4}
            maxLength={4000}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="contact-actions">
            <button
              type="button"
              className="primary"
              disabled={!!busy || !reply.trim()}
              onClick={() =>
                void run('reply', () =>
                  api(`/contact-messages/${message.id}/reply`, 'POST', {
                    text: reply,
                  }),
                )
              }
            >
              <Send size={14} />
              {busy === 'reply' ? 'Sending…' : 'Send reply'}
            </button>
            <button
              type="button"
              className="contact-secondary"
              disabled={!!busy}
              onClick={() =>
                void run('decline', () =>
                  api(`/contact-messages/${message.id}/decline`, 'POST', {}),
                )
              }
            >
              Decline
            </button>
          </div>
        </>
      )}
      {message.reply && (
        <div className="connection-action-result">
          <strong>You replied</strong>
          <pre>{message.reply}</pre>
        </div>
      )}
      {message.delivery === 'failed' && (
        <button
          type="button"
          className="contact-secondary"
          disabled={!!busy}
          onClick={() =>
            void run('retry', () =>
              api(`/contact-messages/${message.id}/retry`, 'POST', {}),
            )
          }
        >
          Retry delivery
        </button>
      )}
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
export function ContactsView({ dots }: { dots: Dot[] }) {
  const [state, setState] = useState<State>();
  const [error, setError] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteDot, setInviteDot] = useState(dots[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [acceptCode, setAcceptCode] = useState('');
  const [acceptName, setAcceptName] = useState('');
  const [acceptDot, setAcceptDot] = useState(dots[0]?.id ?? '');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try {
      setState(await api<State>('/contacts'));
    } catch (cause) {
      setError(describe(cause));
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try {
      await action();
      await load();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy('');
    }
  };
  if (!state) return <p className="muted">Loading contacts…</p>;
  const contactById = new Map(state.contacts.map((item) => [item.id, item]));
  const incoming = state.messages
    .filter((message) => message.direction === 'in')
    .sort(
      (a, b) =>
        Number(b.decision === 'pending') - Number(a.decision === 'pending') ||
        b.createdAt - a.createdAt,
    );
  const outgoing = state.messages
    .filter((message) => message.direction === 'out')
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <div className="contacts-view">
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      {!state.ready && (
        <div className="config-note">
          <strong>Set PUBLIC_URL to pair</strong>
          <p>
            Agent Contacts connects two OpenDots servers directly. Set
            PUBLIC_URL to the address the other server can reach, then restart.
          </p>
        </div>
      )}
      <section className="contacts-section" aria-labelledby="inbox-heading">
        <h2 id="inbox-heading">
          <Inbox size={16} /> Inbox
        </h2>
        {!incoming.length && (
          <p className="muted">
            Requests from your contacts’ agents wait here for you.
          </p>
        )}
        {incoming.map((message) => (
          <IncomingRequest
            key={message.id}
            message={message}
            contact={contactById.get(message.contactId)}
            onChange={load}
          />
        ))}
      </section>
      <section className="contacts-section" aria-labelledby="contacts-heading">
        <h2 id="contacts-heading">
          <Users size={16} /> Contacts
        </h2>
        {!state.contacts.length && (
          <p className="muted">
            Pair with someone you trust to let your Dots message each other.
            Pairing allows messages only, never access to your Spaces or tools.
          </p>
        )}
        <ul className="contact-list">
          {state.contacts.map((contact) => (
            <li key={contact.id}>
              <span>
                <strong>{contact.name}</strong>
                <small>
                  {contact.status === 'invited'
                    ? 'Invite not accepted yet'
                    : contact.status === 'revoked'
                      ? 'Revoked'
                      : `${contact.peerName ?? 'Paired'} · ${new URL(contact.peerUrl!).host}`}
                </small>
              </span>
              {contact.status !== 'revoked' && (
                <>
                  <label className="sr-only" htmlFor={`dot-${contact.id}`}>
                    Dot that drafts replies to {contact.name}
                  </label>
                  <DotPicker
                    id={`dot-${contact.id}`}
                    dots={dots}
                    value={contact.dotId}
                    onChange={(dotId) =>
                      void run(contact.id, async () => {
                        await api(`/contacts/${contact.id}`, 'PATCH', {
                          dotId,
                        });
                      })
                    }
                  />
                  <button
                    type="button"
                    className="contact-secondary"
                    disabled={!!busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Revoke ${contact.name}? Neither side can send anything more. Messages already delivered stay with them.`,
                        )
                      )
                        void run(contact.id, async () => {
                          await api(
                            `/contacts/${contact.id}/revoke`,
                            'POST',
                            {},
                          );
                        });
                    }}
                  >
                    Revoke
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
      <div className="contacts-pair">
        <section className="contacts-section" aria-labelledby="invite-heading">
          <h2 id="invite-heading">
            <UserPlus size={16} /> Invite someone
          </h2>
          <label className="field-label" htmlFor="invite-name">
            Their name
          </label>
          <input
            id="invite-name"
            value={inviteName}
            maxLength={80}
            onChange={(e) => setInviteName(e.target.value)}
          />
          <label className="field-label" htmlFor="invite-dot">
            Your Dot that drafts replies to them
          </label>
          <DotPicker
            id="invite-dot"
            dots={dots}
            value={inviteDot}
            onChange={setInviteDot}
          />
          <button
            type="button"
            className="primary"
            disabled={!!busy || !state.ready || !inviteName.trim()}
            onClick={() =>
              void run('invite', async () => {
                const created = await api<{ code: string }>(
                  '/contacts/invites',
                  'POST',
                  { name: inviteName.trim(), dotId: inviteDot },
                );
                setCode(created.code);
                setCopied(false);
                setInviteName('');
              })
            }
          >
            {busy === 'invite' ? 'Creating…' : 'Create invite code'}
          </button>
          {code && (
            <div className="invite-code">
              <p className="muted">
                Send this code to them over a channel you trust. It works once
                and expires in 7 days.
              </p>
              <code>{code}</code>
              <button
                type="button"
                className="contact-secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(code)
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError('Copy failed; select the code instead.'),
                    )
                }
              >
                <Copy size={14} /> {copied ? 'Copied' : 'Copy code'}
              </button>
            </div>
          )}
        </section>
        <section className="contacts-section" aria-labelledby="accept-heading">
          <h2 id="accept-heading">
            <Users size={16} /> Accept an invite
          </h2>
          <label className="field-label" htmlFor="accept-code">
            Invite code
          </label>
          <textarea
            id="accept-code"
            rows={3}
            value={acceptCode}
            onChange={(e) => setAcceptCode(e.target.value)}
          />
          <label className="field-label" htmlFor="accept-name">
            Their name
          </label>
          <input
            id="accept-name"
            value={acceptName}
            maxLength={80}
            onChange={(e) => setAcceptName(e.target.value)}
          />
          <label className="field-label" htmlFor="accept-dot">
            Your Dot that drafts replies to them
          </label>
          <DotPicker
            id="accept-dot"
            dots={dots}
            value={acceptDot}
            onChange={setAcceptDot}
          />
          <button
            type="button"
            className="primary"
            disabled={
              !!busy || !state.ready || !acceptCode.trim() || !acceptName.trim()
            }
            onClick={() =>
              void run('accept', async () => {
                await api('/contacts/accept', 'POST', {
                  code: acceptCode.trim(),
                  name: acceptName.trim(),
                  dotId: acceptDot,
                });
                setAcceptCode('');
                setAcceptName('');
              })
            }
          >
            {busy === 'accept' ? 'Pairing…' : 'Accept invite'}
          </button>
        </section>
      </div>
      {outgoing.length > 0 && (
        <section className="contacts-section" aria-labelledby="sent-heading">
          <h2 id="sent-heading">
            <Send size={16} /> Sent by your Dots
          </h2>
          {outgoing.map((message) => (
            <article className="contact-request" key={message.id}>
              <header>
                <strong>
                  To {contactById.get(message.contactId)?.name ?? 'a contact'}
                </strong>
                <span>{contactStatus(message)}</span>
              </header>
              <p className="contact-exact">{message.text}</p>
              {message.reply && (
                <div className="connection-action-result">
                  <strong>Reply</strong>
                  <pre>{message.reply}</pre>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
