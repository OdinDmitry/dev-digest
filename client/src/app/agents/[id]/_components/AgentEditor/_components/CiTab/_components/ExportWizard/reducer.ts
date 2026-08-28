/* ExportWizard/reducer.ts — the wizard's Frozen-surface state, at module
   scope (no React import) so it can outlive individual step components. The
   wizard component itself instantiates this via `useReducer`; nothing in
   here is a hook.

   Server state (generated files, expected secrets, workflow version) is
   never mirrored here — it is read straight from the preview query's cache.
   Only the user's own edit of the workflow (`workflowEdit`), the chosen
   options, and step/error bookkeeping live in this reducer
   (frontend-ui-architecture: "server state and client state are different
   things and must not be mixed"). Closing the wizard unmounts it, which
   discards this state with no extra code. */

import type { CiPostAs, CiTriggerEvent } from "@devdigest/shared";

export interface WizardState {
  step: 0 | 1 | 2 | 3; // target | preview | configure | install
  target: "gha"; // the only selectable member
  repoId: string | null; // AC-19: step 0 cannot be left while null
  workflowEdit: string | null; // null = "use the generated contents"
  triggers: CiTriggerEvent[]; // opens as ['opened','synchronize'] (edge case)
  postAs: CiPostAs; // opens as 'github_review'
  workflowError: string | null; // AC-3
  installError: string | null;
  prUrl: string | null; // AC-7
}

export type WizardAction =
  | { type: "SET_STEP"; step: WizardState["step"] }
  | { type: "SET_REPO"; repoId: string }
  | { type: "EDIT_WORKFLOW"; contents: string }
  | { type: "SET_WORKFLOW_ERROR"; error: string | null }
  | { type: "TOGGLE_TRIGGER"; trigger: CiTriggerEvent }
  | { type: "SET_POST_AS"; postAs: CiPostAs }
  | { type: "SET_INSTALL_ERROR"; error: string | null }
  | { type: "INSTALL_SUCCESS"; prUrl: string };

/** The single gate every step's Continue button checks. Step 0 requires a
 *  chosen repository (AC-19); step 1 requires a workflow that validated
 *  clean (AC-3); step 2 requires at least one trigger selected (edge case:
 *  "with none selected the configure step cannot be advanced and states
 *  that a trigger is required"). Step 3 has nothing left to gate. */
export function canLeaveStep(s: WizardState): boolean {
  switch (s.step) {
    case 0:
      return s.repoId !== null;
    case 1:
      return s.workflowError === null;
    case 2:
      return s.triggers.length > 0;
    default:
      return true;
  }
}

export function wizardReducer(s: WizardState, a: WizardAction): WizardState {
  switch (a.type) {
    case "SET_STEP":
      return { ...s, step: a.step };
    case "SET_REPO":
      return { ...s, repoId: a.repoId };
    case "EDIT_WORKFLOW":
      // A fresh edit invalidates whatever validation result was showing —
      // the user must re-validate (re-press Continue) before advancing again.
      return { ...s, workflowEdit: a.contents, workflowError: null };
    case "SET_WORKFLOW_ERROR":
      return { ...s, workflowError: a.error };
    case "TOGGLE_TRIGGER": {
      const has = s.triggers.includes(a.trigger);
      return {
        ...s,
        triggers: has ? s.triggers.filter((t) => t !== a.trigger) : [...s.triggers, a.trigger],
      };
    }
    case "SET_POST_AS":
      return { ...s, postAs: a.postAs };
    case "SET_INSTALL_ERROR":
      return { ...s, installError: a.error };
    case "INSTALL_SUCCESS":
      return { ...s, prUrl: a.prUrl, installError: null };
    default:
      return s;
  }
}
