/* ExportWizard/constants.ts — module-scope constants for the wizard: the
   initial reducer state, the step labels (resolved against the `ci`
   namespace by the component), and the four target cards (only `gha` is
   live — plan Out of scope: "The three non-GitHub-Actions target cards ...
   render, they say they are not available, and they are not selectable"). */

import type { CiTarget } from "@devdigest/shared";
import type { WizardState } from "./reducer";

export const STEP_KEYS = ["target", "preview", "configure", "install"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export interface TargetCardDef {
  value: CiTarget;
  labelKey: string;
  descKey: string;
  available: boolean;
}

export const TARGET_CARDS: readonly TargetCardDef[] = [
  { value: "gha", labelKey: "exportWizard.targets.gha", descKey: "exportWizard.targets.ghaDesc", available: true },
  { value: "circle", labelKey: "exportWizard.targets.circle", descKey: "exportWizard.targets.circleDesc", available: false },
  { value: "jenkins", labelKey: "exportWizard.targets.jenkins", descKey: "exportWizard.targets.jenkinsDesc", available: false },
  { value: "cli", labelKey: "exportWizard.targets.cli", descKey: "exportWizard.targets.cliDesc", available: false },
];

export const INITIAL_WIZARD_STATE: WizardState = {
  step: 0,
  target: "gha",
  repoId: null,
  workflowEdit: null,
  triggers: ["opened", "synchronize"],
  postAs: "github_review",
  workflowError: null,
  installError: null,
  prUrl: null,
};
