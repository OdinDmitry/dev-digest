/* Conventions page — /repos/:repoId/conventions. Thin route; all logic lives
   in the colocated ConventionsView (client/CLAUDE.md convention). */
import { ConventionsView } from "./_components/ConventionsView";

export default function ConventionsPage() {
  return <ConventionsView />;
}
