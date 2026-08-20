import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { WebhookDeliveryInput } from '@devdigest/shared';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { WebhookService } from './service.js';

/**
 * Webhooks module. Receives GitHub webhook deliveries, verifies the
 * signature, records the event, and enqueues a review job for opened PRs.
 */
export default async function webhooksRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new WebhookService(app.container);

  app.post('/webhooks/github', { schema: { body: WebhookDeliveryInput } }, async (req, reply) => {
    const signature = req.headers['x-hub-signature-256'] as string;
    const deliveryId = req.headers['x-github-delivery'] as string;
    const result = await service.handleDelivery({
      deliveryId,
      eventType: req.headers['x-github-event'] as string,
      signature,
      rawBody: JSON.stringify(req.body),
      payload: req.body,
    });

    if (result.accepted && req.body.pullNumber) {
      // Pull the PR title for the activity feed while we're here — cheap
      // enough to do inline instead of waiting for the job to run.
      const token = await app.container.secrets.get('GITHUB_TOKEN');
      const github = new OctokitGitHubClient(token ?? '');
      const pr = await github.getPullRequest(req.body.repoFullName, req.body.pullNumber);
      reply.status(202);
      return { accepted: true, prTitle: pr.title };
    }

    reply.status(202);
    return { accepted: result.accepted };
  });
}
