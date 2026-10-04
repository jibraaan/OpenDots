import { Hono } from 'hono';
import { z } from 'zod';
import { connectionActionSchema } from '../shared/connection-types.js';
import type { WorkspaceStore } from './workspace.js';
import { connectionInput, type ConnectionService } from './connections.js';
export function connectionRoutes(
  workspace: WorkspaceStore,
  connections: ConnectionService,
  publicUrl?: string,
) {
  const app = new Hono();
  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof z.ZodError
            ? (error.issues[0]?.message ?? 'Invalid connection request.')
            : error.message,
      },
      400,
    ),
  );
  const requireDot = (id: string) => {
    if (!workspace.dot(id)) throw new Error('Dot not found.');
    return id;
  };
  const owned = (id: string) => {
    const connection = connections.store.get(id);
    if (!connection) throw new Error('Connection not found.');
    return connection;
  };
  app.get('/dots/:id/connections', (c) =>
    c.json(connections.store.list(requireDot(c.req.param('id')))),
  );
  app.post('/dots/:id/connections', async (c) =>
    c.json(
      await connections.add(
        requireDot(c.req.param('id')),
        connectionInput.parse(await c.req.json()),
      ),
      201,
    ),
  );
  app.post('/connections/:id/refresh', async (c) =>
    c.json(await connections.refresh(owned(c.req.param('id')).id)),
  );
  // The callback must return to the address the owner's browser is using.
  app.post('/connections/:id/sign-in', async (c) =>
    c.json(
      await connections.signIn(
        owned(c.req.param('id')).id,
        publicUrl ?? new URL(c.req.url).origin,
      ),
    ),
  );
  app.post('/connections/:id/sign-out', (c) =>
    c.json(connections.signOut(owned(c.req.param('id')).id)),
  );
  app.patch('/connections/:id/tools/:name', async (c) => {
    const patch = z
      .object({
        enabled: z.boolean().optional(),
        requiresApproval: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      connections.setTool(
        owned(c.req.param('id')).id,
        c.req.param('name'),
        patch,
      ),
    );
  });
  app.delete('/connections/:id', (c) => {
    connections.store.remove(owned(c.req.param('id')).id);
    return c.json({ ok: true });
  });
  app.get('/conversations/:id/connection-tools/:name', (c) => {
    const thread = workspace.requireThread(c.req.param('id'));
    const { connection, tool } = connections.resolve(
      thread.dotId,
      c.req.param('name'),
    );
    return c.json({
      connection: connection.name,
      title: tool.title,
      description: tool.description,
    });
  });
  app.get('/conversations/:id/connection-actions/:toolCallId', (c) => {
    const thread = workspace.requireThread(c.req.param('id'));
    return c.json(
      connections.store.action(thread.id, c.req.param('toolCallId')) ?? null,
    );
  });
  // The only path that runs an approval-gated tool: an owner request for a
  // tool this conversation's Dot currently has enabled.
  app.post('/conversations/:id/connection-actions', async (c) => {
    const body = connectionActionSchema
      .omit({ summary: true })
      .extend({ toolCallId: z.string().min(1).max(200) })
      .parse(await c.req.json());
    const thread = workspace.requireThread(c.req.param('id'));
    const exposed = connections.resolve(thread.dotId, body.tool);
    if (
      !connections.store.claimAction(
        thread.id,
        body.toolCallId,
        exposed.connection.id,
        exposed.tool.name,
      )
    ) {
      const previous = connections.store.action(thread.id, body.toolCallId);
      if (previous?.result) return c.json(previous.result);
      return c.json({ error: 'This action is already running.' }, 409);
    }
    // Not tied to the request: once approved, finish even if the tab closes.
    const result = await connections.call(exposed, body.arguments);
    connections.store.finishAction(thread.id, body.toolCallId, result);
    return c.json(result);
  });
  return app;
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title><style>body{font-family:-apple-system,system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;color:#242424;background:#fff}h1{font-size:20px}p{color:#6b6b6b;line-height:1.6}a{color:#242424}@media (prefers-color-scheme:dark){body{color:#eee;background:#1b1b1b}p{color:#a6a6a6}a{color:#eee}}</style></head><body><h1>${escape(title)}</h1><p>${escape(body)}</p><p><a href="/">Back to OpenDots</a></p></body></html>`;
// Where the service sends the owner's browser after sign-in. It sits outside
// /api because a redirect cannot carry the owner token; the single-use,
// expiring state ties it to a sign-in the owner started.
export function oauthCallbackRoute(connections: ConnectionService) {
  const app = new Hono();
  app.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const { code, state, error } = c.req.query();
    if (error || !code || !state)
      return c.html(
        page(
          'Sign-in was not completed',
          error === 'access_denied'
            ? 'Access was denied. You can try again from the Dot settings.'
            : 'The service did not return a sign-in code. Try again from the Dot settings.',
        ),
        400,
      );
    try {
      const connection = await connections.completeSignIn(state, code);
      return c.html(
        connection.error
          ? page(`Signed in to ${connection.name}`, connection.error)
          : page(
              `Signed in to ${connection.name}`,
              'You can close this tab and return to OpenDots. Your Dot can use its tools now.',
            ),
      );
    } catch (cause) {
      return c.html(
        page(
          'Sign-in failed',
          cause instanceof Error
            ? cause.message
            : 'Try again from the Dot settings.',
        ),
        400,
      );
    }
  });
  return app;
}
