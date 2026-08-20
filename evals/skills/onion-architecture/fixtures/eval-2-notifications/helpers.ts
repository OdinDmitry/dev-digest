export function renderReviewCompleteEmail(reviewUrl: string): { subject: string; html: string } {
  return {
    subject: 'Your DevDigest review is ready',
    html: `<p>Your review is ready. <a href="${reviewUrl}">View it here</a>.</p>`,
  };
}
