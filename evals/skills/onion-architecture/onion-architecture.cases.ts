import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

// Content-only cases (skillTask) have no Read/Bash — the reviewed module has to be inlined into
// the prompt itself, standing in for what the skill would normally Read off disk. Each fixture
// below is real, plausible module code with 3 planted onion-architecture violations and NO
// comments admitting what's wrong (so the judge is scoring whether the skill's OWN rules caught
// them, not whether the model can read a hint). Framed as "review before I open the PR", the way
// a developer actually asks for this.

function reviewPrompt(intro: string, files: Array<{ path: string; fixture: string }>): string {
  const blocks = files
    .map(({ path, fixture }) => `--- ${path} ---\n\`\`\`ts\n${fx(fixture)}\`\`\``)
    .join("\n\n");
  return `${intro} The files are inlined below exactly as they'd be read off disk — treat them as already read, and review them directly (do not ask for file/tool access).\n\n${blocks}`;
}

export const cases: SkillCase[] = [
  {
    name: "flags service-locator deps, SQL-in-service, and adapter construction outside the composition root (webhooks module)",
    kind: "quality",
    prompt: reviewPrompt(
      "We're about to merge a new `webhooks` module at server/src/modules/webhooks/ that receives inbound GitHub webhook deliveries, verifies the signature, records the event, and enqueues a review job for opened PRs. Before I open the PR, review routes.ts, service.ts, repository.ts and helpers.ts for architecture/placement problems — I'd rather a teammate not have to catch it in review.",
      [
        { path: "server/src/modules/webhooks/routes.ts", fixture: "eval-1-webhooks/routes.ts" },
        { path: "server/src/modules/webhooks/service.ts", fixture: "eval-1-webhooks/service.ts" },
        { path: "server/src/modules/webhooks/repository.ts", fixture: "eval-1-webhooks/repository.ts" },
        { path: "server/src/modules/webhooks/helpers.ts", fixture: "eval-1-webhooks/helpers.ts" },
      ],
    ),
    practices: [
      "flags that WebhookService.handleDelivery in service.ts runs a Drizzle query directly against the repos table instead of adding a repository method",
      "flags that WebhookService's constructor takes the whole `container: Container` instead of an explicit dependency list, and notes this is not one of the grandfathered existing services that are allowed to do that",
      "flags that routes.ts constructs `new OctokitGitHubClient(...)` directly instead of using the GitHubClient already available via the container",
      "does not flag repository.ts as having a placement problem — its Drizzle usage is the module's correctly-placed ring-3 file",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "flags a vendor SDK and a leaked query builder in a notifications module",
    kind: "quality",
    prompt: reviewPrompt(
      "Added a `notifications` module at server/src/modules/notifications/ that emails a workspace when a review finishes. Can you check service.ts and repository.ts for architecture issues before I push?",
      [
        { path: "server/src/modules/notifications/service.ts", fixture: "eval-2-notifications/service.ts" },
        { path: "server/src/modules/notifications/repository.ts", fixture: "eval-2-notifications/repository.ts" },
        { path: "server/src/modules/notifications/helpers.ts", fixture: "eval-2-notifications/helpers.ts" },
        { path: "server/src/modules/notifications/constants.ts", fixture: "eval-2-notifications/constants.ts" },
      ],
    ),
    practices: [
      "flags that service.ts imports the `resend` SDK and constructs `new Resend(...)` directly instead of hiding it behind an adapter/port",
      "flags that service.ts reads `process.env.RESEND_API_KEY` directly instead of using SecretsProvider",
      "flags that NotificationRepository.pendingForWorkspace returns an un-awaited Drizzle query builder rather than resolved data, and that service.ts chains `.limit()` onto it",
      "does not flag helpers.ts as having a placement problem — renderReviewCompleteEmail is a pure, correctly-placed helper",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "flags a routes-only module skipping the service/repository rings (annotations module)",
    kind: "quality",
    prompt: reviewPrompt(
      "I added an annotations feature so reviewers can leave a note on a finding — POST and GET on /repos/:id/annotations. Here's the module. Can you review it for architecture placement issues before I open the PR?",
      [{ path: "server/src/modules/annotations/routes.ts", fixture: "eval-3-annotations/routes.ts" }],
    ),
    practices: [
      "flags that the module has no service.ts or repository.ts and that routes.ts runs Drizzle queries directly, skipping the application-service and repository rings",
      "flags the inline membership/role permission check in the POST handler as a business rule that belongs in a service, not a route handler",
      "flags that the response returns the raw database row directly instead of a mapped contract/DTO",
      "does not merely say the module looks fine — it explicitly raises the missing service/repository layers",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
