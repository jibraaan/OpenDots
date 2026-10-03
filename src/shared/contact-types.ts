import { z } from 'zod';
// invited: our invite is waiting for the other owner; active: paired;
// revoked: either side ended it, and nothing more is sent or accepted.
export type ContactStatus = 'invited' | 'active' | 'revoked';
export interface Contact {
  id: string;
  name: string;
  peerName: string | null;
  peerUrl: string | null;
  status: ContactStatus;
  dotId: string;
  createdAt: number;
  updatedAt: number;
}
// Delivery and the owner's decision are separate states. For an outgoing
// request, delivery is the request's; for an incoming one, it is our reply's.
export type Delivery = 'queued' | 'delivered' | 'failed';
export type Decision = 'pending' | 'answered' | 'declined';
export interface ContactMessage {
  id: string;
  contactId: string;
  direction: 'out' | 'in';
  text: string;
  delivery: Delivery | null;
  decision: Decision;
  reply: string | null;
  threadId: string | null;
  toolCallId: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}
export const contactText = z.string().trim().min(1).max(4000);
export const contactRequestSchema = z
  .object({
    contactId: z.string().min(1).max(64),
    message: contactText,
  })
  .strict();
export const contactRequestTool = {
  name: 'ask_contact',
  description:
    "Send a message to another person's agent through Agent Contacts. The owner reviews the exact text before anything is sent, and the other owner decides how to reply. Use list_contacts for contact IDs. Include only what the owner wants to share. Call once, then wait. The result says whether it was sent; replies arrive later.",
  parameters: z.toJSONSchema(contactRequestSchema),
};
