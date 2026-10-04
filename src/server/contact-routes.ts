import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  MAX_ATTACHMENT_CHARS,
  MAX_ATTACHMENTS,
  contactRequestSchema,
  type Attachment,
  type PagePreview,
} from '../shared/contact-types.js';
import type { WorkspaceStore } from './workspace.js';
import {
  PeerError,
  peerMessageBody,
  peerPairBody,
  peerReplyBody,
  type ContactService,
} from './contacts.js';
// The narrow interface other OpenDots servers use. Mounted outside /api:
// peers authenticate with a per-contact secret, never the owner token.
export function peerRoutes(contacts: ContactService) {
  const app = new Hono<{ Variables: { contactId: string } }>();
  app.use(
    '*',
    bodyLimit({
      // Text plus up to three 20k-character page snapshots.
      maxSize: 256_000,
      onError: (c) => c.json({ error: 'Request is too large.' }, 413),
    }),
  );
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.method !== 'POST')
      return c.json({ error: 'Method not allowed.' }, 405);
    if (!c.req.header('content-type')?.includes('application/json'))
      return c.json({ error: 'Use application/json.' }, 415);
    const contact = contacts.authenticate(
      c.req.header('x-opendots-contact'),
      c.req.header('authorization')?.replace(/^Bearer /, ''),
    );
    c.set('contactId', contact.id);
    await next();
  });
  const contact = (id: string) => contacts.store.get(id)!;
  app.post('/pair', async (c) => {
    contacts.peerPair(
      contact(c.get('contactId')),
      peerPairBody.parse(await c.req.json()),
    );
    return c.json({ ok: true });
  });
  app.post('/messages', async (c) => {
    contacts.peerMessage(
      contact(c.get('contactId')),
      peerMessageBody.parse(await c.req.json()),
    );
    return c.json({ ok: true }, 202);
  });
  app.post('/messages/:id/reply', async (c) => {
    contacts.peerReply(
      contact(c.get('contactId')),
      c.req.param('id'),
      peerReplyBody.parse(await c.req.json()),
    );
    return c.json({ ok: true });
  });
  app.post('/revoke', (c) => {
    contacts.peerRevoke(contact(c.get('contactId')));
    return c.json({ ok: true });
  });
  app.onError((error, c) =>
    error instanceof PeerError
      ? c.json({ error: error.message }, error.status)
      : error instanceof z.ZodError || error instanceof SyntaxError
        ? c.json({ error: 'Invalid request.' }, 400)
        : c.json({ error: 'The request failed.' }, 500),
  );
  return app;
}
export function contactRoutes(
  workspace: WorkspaceStore,
  contacts: ContactService,
  publicUrl?: string,
) {
  const app = new Hono();
  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof z.ZodError
            ? (error.issues[0]?.message ?? 'Invalid contact request.')
            : error.message,
      },
      400,
    ),
  );
  const name = z.string().trim().min(1).max(80);
  const dotId = z.string().min(1).max(64);
  app.get('/contacts', (c) =>
    c.json({
      contacts: contacts.store.list(),
      messages: contacts.store.messages(),
      ready: !!publicUrl,
    }),
  );
  app.post('/contacts/invites', async (c) => {
    const body = z
      .object({ name, dotId })
      .strict()
      .parse(await c.req.json());
    return c.json(contacts.createInvite(body.name, body.dotId), 201);
  });
  app.post('/contacts/accept', async (c) => {
    const body = z
      .object({ code: z.string().min(1).max(4000), name, dotId })
      .strict()
      .parse(await c.req.json());
    return c.json(await contacts.accept(body.code, body.name, body.dotId), 201);
  });
  app.patch('/contacts/:id', async (c) => {
    const body = z
      .object({ dotId })
      .strict()
      .parse(await c.req.json());
    if (!workspace.dot(body.dotId)) throw new Error('Dot not found.');
    const contact = contacts.store.setDot(c.req.param('id'), body.dotId);
    if (!contact) throw new Error('Contact not found.');
    return c.json(contact);
  });
  app.post('/contacts/:id/revoke', async (c) =>
    c.json(await contacts.revoke(c.req.param('id'))),
  );
  app.post('/contact-messages/:id/draft', async (c) => {
    const body = z
      .object({ guidance: z.string().max(2000).optional() })
      .strict()
      .parse(await c.req.json());
    return c.json({
      text: await contacts.draft(c.req.param('id'), body.guidance),
    });
  });
  app.post('/contact-messages/:id/reply', async (c) => {
    const body = z
      .object({ text: z.string() })
      .strict()
      .parse(await c.req.json());
    return c.json(await contacts.reply(c.req.param('id'), body.text));
  });
  app.post('/contact-messages/:id/decline', async (c) =>
    c.json(await contacts.decline(c.req.param('id'))),
  );
  app.post('/contact-messages/:id/retry', async (c) => {
    const message = contacts.store.message(c.req.param('id'));
    if (message?.delivery !== 'failed')
      throw new Error('Only failed deliveries can be retried.');
    return c.json(await contacts.deliver(message.id));
  });
  // Pages are shared only from Spaces this conversation's Dot can access.
  const page = (dotId: string, spaceId: string, pageId: string) => {
    if (!workspace.canAccessSpace(dotId, spaceId))
      throw new Error('This Dot cannot access that page’s Space.');
    return workspace.pages.get(spaceId, pageId);
  };
  app.get('/conversations/:id/contact-pages', (c) => {
    const thread = workspace.requireThread(c.req.param('id'));
    const refs = z
      .array(z.string().regex(/^[^/]{1,64}\/[^/]{1,64}$/))
      .max(MAX_ATTACHMENTS)
      .parse(c.req.queries('page') ?? []);
    return c.json(
      refs.map((ref): PagePreview => {
        const [spaceId, pageId] = ref.split('/');
        const found = page(thread.dotId, spaceId, pageId);
        return {
          spaceId,
          pageId,
          title: found.title,
          revision: found.revision,
          content: found.content,
          length: found.content.length,
        };
      }),
    );
  });
  app.get('/conversations/:id/contact-requests/:toolCallId', (c) => {
    const thread = workspace.requireThread(c.req.param('id'));
    return c.json(
      contacts.store.byToolCall(thread.id, c.req.param('toolCallId')) ?? null,
    );
  });
  // The only way a Dot's request leaves this server: the owner approved
  // this exact recipient and text in the conversation's review card.
  app.post('/conversations/:id/contact-requests', async (c) => {
    const body = contactRequestSchema
      .omit({ pages: true })
      .extend({
        toolCallId: z.string().min(1).max(200),
        pages: z
          .array(
            z
              .object({
                spaceId: z.string().min(1).max(64),
                pageId: z.string().min(1).max(64),
                revision: z.number().int().min(0),
              })
              .strict(),
          )
          .max(MAX_ATTACHMENTS)
          .optional(),
      })
      .parse(await c.req.json());
    const thread = workspace.requireThread(c.req.param('id'));
    // Snapshot exactly the versions the owner reviewed, or refuse.
    const attachments = (body.pages ?? []).map((ref): Attachment => {
      const found = page(thread.dotId, ref.spaceId, ref.pageId);
      if (found.revision !== ref.revision)
        throw new Error(
          `“${found.title}” changed after you reviewed it. Review it again.`,
        );
      if (found.content.length > MAX_ATTACHMENT_CHARS)
        throw new Error(
          `“${found.title}” is too long to share (20,000 characters at most).`,
        );
      return {
        title: found.title,
        content: found.content,
        revision: found.revision,
      };
    });
    return c.json(
      await contacts.send(
        body.contactId,
        body.message,
        thread.id,
        body.toolCallId,
        attachments,
      ),
    );
  });
  return app;
}
