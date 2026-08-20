import { eq, desc } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export type NotificationRow = typeof t.notifications.$inferSelect;

export interface InsertNotification {
  workspaceId: string;
  userId: string;
  kind: string;
  payload: unknown;
}

export class NotificationRepository {
  constructor(private db: Db) {}

  async insert(notification: InsertNotification): Promise<NotificationRow> {
    const [row] = await this.db.insert(t.notifications).values(notification).returning();
    return row;
  }

  async markSent(id: string): Promise<void> {
    await this.db.update(t.notifications).set({ sentAt: new Date() }).where(eq(t.notifications.id, id));
  }

  /** Pending notifications for a workspace, most recent first — caller narrows further. */
  pendingForWorkspace(workspaceId: string) {
    return this.db
      .select()
      .from(t.notifications)
      .where(eq(t.notifications.workspaceId, workspaceId))
      .orderBy(desc(t.notifications.createdAt));
  }
}
