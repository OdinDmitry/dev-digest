/* Project Context page — /repos/:repoId/context. Thin route; all logic lives
   in the colocated ProjectContextView (client/CLAUDE.md convention). */
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ContextPage() {
  return <ProjectContextView />;
}
