import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { WorkspaceStore } from '../src/server/workspace.js';
import { ContactService, type DraftInput } from '../src/server/contacts.js';
import { contactRoutes, peerRoutes } from '../src/server/contact-routes.js';
import type { Contact, ContactMessage } from '../src/shared/contact-types.js';
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((done) => done());
  vi.useRealTimers();
});
type Server = ReturnType<typeof server>;
// Two independent OpenDots servers whose peer traffic goes through each
// other's real HTTP routes.
function server(url: string, owner: string, network: Map<string, Hono>) {
  const workspace = new WorkspaceStore(':memory:', 'owner');
  cleanup.push(() => workspace.close());
  const dot = workspace.dots()[0];
  workspace.bindThread('thread', dot.id, 'Plans');
  const drafts: DraftInput[] = [];
  let online = true;
  const contacts = new ContactService(workspace.contacts, {
    publicUrl: url,
    ownerName: () => owner,
    dot: (id) => workspace.dot(id),
    draft: async (input) => {
      drafts.push(input);
      return `Draft for: ${input.request}`;
    },
    fetch: (async (input: string, init?: RequestInit) => {
      const target = [...network].find(([base]) => input.startsWith(base));
      if (!target) throw new TypeError('fetch failed');
      const [base, app] = target;
      const peer = servers.get(base)!;
      if (!peer.isOnline()) throw new TypeError('fetch failed');
      return app.request(input.slice(base.length), init);
    }) as typeof fetch,
  });
  const app = new Hono();
  app.route('/api', contactRoutes(workspace, contacts, url));
  app.route('/peer/v1', peerRoutes(contacts));
  network.set(url, app);
  const api = async <T>(path: string, method = 'GET', body?: unknown) => {
    const response = await app.request(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error);
    return data;
  };
  const value = {
    url,
    workspace,
    dot,
    contacts,
    drafts,
    app,
    api,
    isOnline: () => online,
    setOnline: (next: boolean) => {
      online = next;
    },
  };
  servers.set(url, value);
  return value;
}
const servers = new Map<string, Server>();
async function paired() {
  servers.clear();
  const network = new Map<string, Hono>();
  const alex = server('https://alex.example', 'Alex', network);
  const sam = server('https://sam.example', 'Sam', network);
  const { code, contact } = await alex.api<{ code: string; contact: Contact }>(
    '/contacts/invites',
    'POST',
    { name: 'Sam', dotId: alex.dot.id },
  );
  expect(contact.status).toBe('invited');
  const accepted = await sam.api<Contact>('/contacts/accept', 'POST', {
    code,
    name: 'Alex',
    dotId: sam.dot.id,
  });
  return { alex, sam, code, id: accepted.id };
}
const ask = (from: Server, id: string, message: string, toolCallId = 'tc1') =>
  from.api<ContactMessage>('/conversations/thread/contact-requests', 'POST', {
    contactId: id,
    message,
    toolCallId,
  });
const state = (at: Server) =>
  at.api<{ contacts: Contact[]; messages: ContactMessage[] }>('/contacts');
it('pairs only after both owners confirm, without exposing the secret', async () => {
  const { alex, sam, code, id } = await paired();
  const alexView = await state(alex);
  const samView = await state(sam);
  expect(alexView.contacts[0]).toMatchObject({
    id,
    status: 'active',
    peerName: 'Sam',
    peerUrl: 'https://sam.example',
  });
  expect(samView.contacts[0]).toMatchObject({
    id,
    status: 'active',
    peerName: 'Alex',
    peerUrl: 'https://alex.example',
  });
  const secret = JSON.parse(Buffer.from(code, 'base64url').toString()).secret;
  expect(JSON.stringify([alexView, samView])).not.toContain(secret);
  await expect(
    sam.api('/contacts/accept', 'POST', {
      code,
      name: 'Again',
      dotId: sam.dot.id,
    }),
  ).rejects.toThrow('already used');
  await expect(
    sam.api('/contacts/accept', 'POST', {
      code: 'not-a-code',
      name: 'X',
      dotId: sam.dot.id,
    }),
  ).rejects.toThrow('not valid');
});
it('rejects expired invites', async () => {
  servers.clear();
  const network = new Map<string, Hono>();
  const alex = server('https://alex.example', 'Alex', network);
  const sam = server('https://sam.example', 'Sam', network);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.UTC(2026, 9, 1));
  const { code } = await alex.api<{ code: string }>(
    '/contacts/invites',
    'POST',
    { name: 'Sam', dotId: alex.dot.id },
  );
  vi.setSystemTime(Date.UTC(2026, 9, 9));
  await expect(
    sam.api('/contacts/accept', 'POST', {
      code,
      name: 'Alex',
      dotId: sam.dot.id,
    }),
  ).rejects.toThrow('refused');
  expect((await state(sam)).contacts).toEqual([]);
});
it('delivers the approved text once and returns the other owner’s reply', async () => {
  const { alex, sam, id } = await paired();
  const sent = await ask(alex, id, 'Is Saturday still on?');
  expect(sent).toMatchObject({
    direction: 'out',
    delivery: 'delivered',
    decision: 'pending',
  });
  // A retried approval resolves to the same message and is not re-sent.
  expect((await ask(alex, id, 'Is Saturday still on?')).id).toBe(sent.id);
  await expect(ask(alex, id, 'Something else')).rejects.toThrow('already used');
  const inbox = (await state(sam)).messages;
  expect(inbox).toHaveLength(1);
  expect(inbox[0]).toMatchObject({
    id: sent.id,
    direction: 'in',
    text: 'Is Saturday still on?',
    decision: 'pending',
    delivery: null,
  });
  expect(
    (
      await sam.api<{ text: string }>(
        `/contact-messages/${sent.id}/draft`,
        'POST',
        { guidance: 'Yes, 10am' },
      )
    ).text,
  ).toBe('Draft for: Is Saturday still on?');
  expect(sam.drafts[0]).toEqual({
    dotName: 'Dot',
    instructions: sam.dot.instructions,
    contactName: 'Alex',
    exchange: [],
    request: 'Is Saturday still on?',
    guidance: 'Yes, 10am',
  });
  const answered = await sam.api<ContactMessage>(
    `/contact-messages/${sent.id}/reply`,
    'POST',
    { text: 'Yes, 10am at the park.' },
  );
  expect(answered).toMatchObject({
    decision: 'answered',
    delivery: 'delivered',
  });
  await expect(
    sam.api(`/contact-messages/${sent.id}/decline`, 'POST', {}),
  ).rejects.toThrow('already answered');
  expect(
    await alex.api<ContactMessage>(
      '/conversations/thread/contact-requests/tc1',
    ),
  ).toMatchObject({ decision: 'answered', reply: 'Yes, 10am at the park.' });
  const second = await ask(alex, id, 'Can you bring snacks?', 'tc2');
  await sam.api(`/contact-messages/${second.id}/decline`, 'POST', {});
  expect(
    await alex.api<ContactMessage>(
      '/conversations/thread/contact-requests/tc2',
    ),
  ).toMatchObject({ decision: 'declined', reply: null });
  const third = await ask(alex, id, 'And Sunday?', 'tc3');
  await sam.api(`/contact-messages/${third.id}/draft`, 'POST', {});
  // The drafter sees only this exchange, labeled from its owner's side.
  expect(sam.drafts.at(-1)!.exchange).toEqual([
    { from: 'them', text: 'Is Saturday still on?' },
    { from: 'you', text: 'Yes, 10am at the park.' },
    { from: 'them', text: 'Can you bring snacks?' },
  ]);
});
it('authenticates every peer request and bounds unanswered requests', async () => {
  const { alex, sam, id } = await paired();
  const post = (path: string, headers: Record<string, string>, body: unknown) =>
    sam.app.request(`/peer/v1${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const message = { id: crypto.randomUUID(), text: 'Hi' };
  expect(
    (await post('/messages', { 'X-OpenDots-Contact': id }, message)).status,
  ).toBe(401);
  expect(
    (
      await post(
        '/messages',
        { 'X-OpenDots-Contact': id, Authorization: 'Bearer wrong' },
        message,
      )
    ).status,
  ).toBe(401);
  for (let n = 0; n < 20; n++)
    await ask(alex, id, `Request ${n}`, `flood-${n}`);
  const blocked = await ask(alex, id, 'One too many', 'flood-20');
  expect(blocked).toMatchObject({
    delivery: 'failed',
    error: 'The other owner has too many unanswered requests.',
  });
  // Peers cannot answer requests they never received.
  const own = await ask(alex, id, 'x', 'own');
  const samSecret = sam.workspace.contacts.secret(id)!;
  const forged = await alex.app.request(
    `/peer/v1/messages/${crypto.randomUUID()}/reply`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${samSecret}`,
        'X-OpenDots-Contact': id,
      },
      body: JSON.stringify({ decision: 'answered', text: 'forged' }),
    },
  );
  expect(forged.status).toBe(404);
  expect(alex.workspace.contacts.message(own.id)?.decision).toBe('pending');
});
it('retries failed deliveries and stops everything after revocation', async () => {
  const { alex, sam, id } = await paired();
  sam.setOnline(false);
  const failed = await ask(alex, id, 'Are you there?');
  expect(failed).toMatchObject({
    delivery: 'failed',
    error: 'The other OpenDots server could not be reached.',
  });
  sam.setOnline(true);
  await alex.contacts.retryUndelivered();
  expect(alex.workspace.contacts.message(failed.id)?.delivery).toBe(
    'delivered',
  );
  await sam.api(`/contacts/${id}/revoke`, 'POST', {});
  expect((await state(alex)).contacts[0].status).toBe('revoked');
  await expect(ask(alex, id, 'Still there?', 'tc2')).rejects.toThrow('revoked');
  await expect(
    sam.api(`/contact-messages/${failed.id}/reply`, 'POST', { text: 'Late' }),
  ).rejects.toThrow('revoked');
  const late = await sam.app.request('/peer/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${alex.workspace.contacts.secret(id)}`,
      'X-OpenDots-Contact': id,
    },
    body: JSON.stringify({ id: crypto.randomUUID(), text: 'Late' }),
  });
  expect(late.status).toBe(403);
});
it('requires PUBLIC_URL before inviting or accepting', async () => {
  const workspace = new WorkspaceStore(':memory:', 'owner');
  cleanup.push(() => workspace.close());
  const contacts = new ContactService(workspace.contacts, {
    ownerName: () => 'Alex',
    dot: (id) => workspace.dot(id),
  });
  expect(() => contacts.createInvite('Sam', workspace.dots()[0].id)).toThrow(
    'PUBLIC_URL',
  );
});
