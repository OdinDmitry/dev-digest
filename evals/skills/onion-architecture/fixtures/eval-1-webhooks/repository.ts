import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type WebhookEventRow = typeof t.webhookEvents.$inferSelect;

export interface InsertWebhookEvent {
  repoId: string;
  deliveryId: string;
  eventType: string;
  payload: unknown;
}

export class WebhookRepository {
  constructor(private db: Db) {}

  async findByDeliveryId(deliveryId: string): Promise<WebhookEventRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.webhookEvents)
      .where(eq(t.webhookEvents.deliveryId, deliveryId));
    return row;
  }

  async insertEvent(event: InsertWebhookEvent): Promise<WebhookEventRow> {
    const [row] = await this.db.insert(t.webhookEvents).values(event).returning();
    return row;
  }

  async markProcessed(id: string): Promise<void> {
    await this.db.update(t.webhookEvents).set({ processedAt: new Date() }).where(eq(t.webhookEvents.id, id));
  }
}
