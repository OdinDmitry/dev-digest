import { Resend } from 'resend';
import type { GitHubClient } from '@devdigest/shared';
import { NotificationRepository } from './repository.js';
import { renderReviewCompleteEmail } from './helpers.js';
import { NOTIFICATION_KIND_REVIEW_COMPLETE } from './constants.js';

export interface NotificationServiceDeps {
  repo: NotificationRepository;
  github: GitHubClient;
}

export class NotificationService {
  private resend: Resend;

  constructor(private deps: NotificationServiceDeps) {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  async notifyReviewComplete(workspaceId: string, userId: string, reviewUrl: string, toEmail: string): Promise<void> {
    const notification = await this.deps.repo.insert({
      workspaceId,
      userId,
      kind: NOTIFICATION_KIND_REVIEW_COMPLETE,
      payload: { reviewUrl },
    });

    const { subject, html } = renderReviewCompleteEmail(reviewUrl);
    await this.resend.emails.send({
      from: 'DevDigest <notify@devdigest.dev>',
      to: toEmail,
      subject,
      html,
    });

    await this.deps.repo.markSent(notification.id);
  }

  async listPendingDigest(workspaceId: string, limit: number) {
    return this.deps.repo.pendingForWorkspace(workspaceId).limit(limit);
  }
}
