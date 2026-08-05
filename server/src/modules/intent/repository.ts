import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Intent } from '@devdigest/shared';

/**
 * pr_intent data-access — the ONLY file in the intent module that imports
 * drizzle-orm/db/schema.js. Returns the public `Intent` contract shape, never
 * a raw row, past this boundary.
 */
export interface UpsertPrIntent {
  prId: string;
  intent: string;
  inScope: string[];
  outOfScope: string[];
}

export class PrIntentRepository {
  constructor(private db: Db) {}

  async getByPrId(prId: string): Promise<Intent | undefined> {
    const [row] = await this.db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
    if (!row) return undefined;
    return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope };
  }

  async upsert(values: UpsertPrIntent): Promise<void> {
    const set = { intent: values.intent, inScope: values.inScope, outOfScope: values.outOfScope };
    await this.db
      .insert(t.prIntent)
      .values({ prId: values.prId, ...set })
      .onConflictDoUpdate({ target: t.prIntent.prId, set });
  }
}
