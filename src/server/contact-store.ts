import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  Contact,
  ContactMessage,
  ContactStatus,
  Delivery,
} from '../shared/contact-types.js';
type ContactRow = Contact & { secret: string };
export class ContactStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY, name TEXT NOT NULL, peerName TEXT, peerUrl TEXT, secret TEXT NOT NULL, status TEXT NOT NULL, dotId TEXT NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS contact_messages(id TEXT PRIMARY KEY, contactId TEXT NOT NULL, direction TEXT NOT NULL, text TEXT NOT NULL, delivery TEXT, decision TEXT NOT NULL, reply TEXT, threadId TEXT, toolCallId TEXT, error TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS contact_messages_tool ON contact_messages(threadId, toolCallId) WHERE toolCallId IS NOT NULL;`);
  }
  private row(id: string) {
    return this.db.prepare('SELECT * FROM contacts WHERE id=?').get(id) as
      ContactRow | undefined;
  }
  // Pairing secrets never leave the server.
  private view({
    id,
    name,
    peerName,
    peerUrl,
    status,
    dotId,
    createdAt,
    updatedAt,
  }: ContactRow): Contact {
    return { id, name, peerName, peerUrl, status, dotId, createdAt, updatedAt };
  }
  list(): Contact[] {
    return (
      this.db
        .prepare('SELECT * FROM contacts ORDER BY createdAt DESC, rowid DESC')
        .all() as unknown as ContactRow[]
    ).map((row) => this.view(row));
  }
  get(id: string) {
    const row = this.row(id);
    return row && this.view(row);
  }
  secret(id: string) {
    return this.row(id)?.secret;
  }
  create(value: {
    id?: string;
    name: string;
    secret: string;
    status: ContactStatus;
    dotId: string;
    peerUrl?: string;
    peerName?: string;
  }): Contact {
    const now = Date.now();
    const id = value.id ?? randomUUID();
    this.db
      .prepare('INSERT INTO contacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        id,
        value.name,
        value.peerName ?? null,
        value.peerUrl ?? null,
        value.secret,
        value.status,
        value.dotId,
        now,
        now,
      );
    return this.get(id)!;
  }
  activate(id: string, peerUrl: string, peerName: string) {
    this.db
      .prepare(
        "UPDATE contacts SET status='active', peerUrl=?, peerName=?, updatedAt=? WHERE id=? AND status='invited'",
      )
      .run(peerUrl, peerName, Date.now(), id);
    return this.get(id)!;
  }
  setStatus(id: string, status: ContactStatus) {
    this.db
      .prepare('UPDATE contacts SET status=?, updatedAt=? WHERE id=?')
      .run(status, Date.now(), id);
    return this.get(id);
  }
  setDot(id: string, dotId: string) {
    this.db
      .prepare('UPDATE contacts SET dotId=?, updatedAt=? WHERE id=?')
      .run(dotId, Date.now(), id);
    return this.get(id);
  }
  messages(contactId?: string): ContactMessage[] {
    return this.db
      .prepare(
        `SELECT * FROM contact_messages ${contactId ? 'WHERE contactId=?' : ''} ORDER BY createdAt, rowid`,
      )
      .all(...(contactId ? [contactId] : [])) as unknown as ContactMessage[];
  }
  message(id: string) {
    return this.db
      .prepare('SELECT * FROM contact_messages WHERE id=?')
      .get(id) as ContactMessage | undefined;
  }
  byToolCall(threadId: string, toolCallId: string) {
    return this.db
      .prepare(
        'SELECT * FROM contact_messages WHERE threadId=? AND toolCallId=?',
      )
      .get(threadId, toolCallId) as ContactMessage | undefined;
  }
  addMessage(value: {
    id?: string;
    contactId: string;
    direction: 'out' | 'in';
    text: string;
    delivery: Delivery | null;
    threadId?: string;
    toolCallId?: string;
  }): ContactMessage | undefined {
    const now = Date.now();
    const id = value.id ?? randomUUID();
    // OR IGNORE: a repeated delivery or approval resolves to the first record.
    const inserted = this.db
      .prepare(
        "INSERT OR IGNORE INTO contact_messages VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL, ?, ?)",
      )
      .run(
        id,
        value.contactId,
        value.direction,
        value.text,
        value.delivery,
        value.threadId ?? null,
        value.toolCallId ?? null,
        now,
        now,
      ).changes;
    return inserted ? this.message(id) : undefined;
  }
  update(
    id: string,
    patch: Partial<
      Pick<ContactMessage, 'delivery' | 'decision' | 'reply' | 'error'>
    >,
  ) {
    const current = this.message(id);
    if (!current) throw new Error('Contact message not found.');
    const next = { ...current, ...patch };
    this.db
      .prepare(
        'UPDATE contact_messages SET delivery=?, decision=?, reply=?, error=?, updatedAt=? WHERE id=?',
      )
      .run(
        next.delivery,
        next.decision,
        next.reply,
        next.error,
        Math.max(Date.now(), current.updatedAt + 1),
        id,
      );
    return this.message(id)!;
  }
  pendingIncoming(contactId?: string) {
    return this.messages(contactId).filter(
      (message) => message.direction === 'in' && message.decision === 'pending',
    ).length;
  }
  undelivered() {
    return this.db
      .prepare(
        "SELECT * FROM contact_messages WHERE delivery IN ('queued','failed') ORDER BY createdAt",
      )
      .all() as unknown as ContactMessage[];
  }
}
