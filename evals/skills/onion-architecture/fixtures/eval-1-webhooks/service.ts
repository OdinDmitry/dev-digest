import { eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { NotFoundError } from '../../platform/errors.js';
import { WebhookRepository } from './repository.js';
import { verifySignature } from './helpers.js';
import { REVIEW_JOB_KIND } from '../reviews/constants.js';

export interface WebhookDelivery {
  deliveryId: string;
  eventType: string;
  signature: string;
  rawBody: string;
  payload: { repoFullName: string; pullNumber?: number };
}

export class WebhookService {
  private events: WebhookRepository;

  constructor(private container: Container) {
    this.events = new WebhookRepository(container.db);
  }

  async handleDelivery(delivery: WebhookDelivery): Promise<{ accepted: boolean }> {
    const secret = await this.container.secrets.get('GITHUB_WEBHOOK_SECRET');
    if (!secret || !verifySignature(delivery.rawBody, delivery.signature, secret)) {
      return { accepted: false };
    }

    const existing = await this.events.findByDeliveryId(delivery.deliveryId);
    if (existing) {
      return { accepted: true };
    }

    // Resolve the repo the delivery belongs to before recording the event.
    const [repo] = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, delivery.payload.repoFullName));
    if (!repo) {
      throw new NotFoundError(`Unknown repo ${delivery.payload.repoFullName}`);
    }

    await this.events.insertEvent({
      repoId: repo.id,
      deliveryId: delivery.deliveryId,
      eventType: delivery.eventType,
      payload: delivery.payload,
    });

    if (delivery.eventType === 'pull_request' && delivery.payload.pullNumber) {
      this.container.jobs.enqueue(REVIEW_JOB_KIND, {
        repoId: repo.id,
        pullNumber: delivery.payload.pullNumber,
      });
    }

    return { accepted: true };
  }
}
