/* ExportWizard — the four-step export-to-CI flow (target → preview →
   configure → install), opened from CiTab's add-to-CI control (AC-1). Step
   state, the user's own workflow edit and the chosen options live in one
   reducer at module scope (reducer.ts); the generated files, expected
   secrets and workflow version are read straight from the preview
   mutation's own returned data — never mirrored into the reducer
   (Placement decisions: "server state and client state are different
   things"). Closing the wizard unmounts it, discarding all of the above
   with no extra code. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Button, Icon, ExportWizardSteps } from "@devdigest/ui";
import type { Agent, CiTriggerEvent, CiPostAs, CiExportInputBody } from "@devdigest/shared";
import {
  useCiExportPreview,
  useValidateWorkflow,
  useInstallCi,
} from "@/lib/hooks";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { RepoChooser } from "./_components/RepoChooser";
import { wizardReducer, canLeaveStep, type WizardState } from "./reducer";
import { INITIAL_WIZARD_STATE, STEP_KEYS, TARGET_CARDS } from "./constants";
import { s } from "./styles";

const TRIGGER_OPTIONS: CiTriggerEvent[] = ["opened", "synchronize", "reopened"];
const POST_AS_OPTIONS: CiPostAs[] = ["github_review", "pr_comment", "none"];

function isHttpsUrl(url: string | null | undefined): url is string {
  return !!url && url.startsWith("https://");
}

function AlertRegion({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" style={s.alert}>
      {children}
    </div>
  );
}

export function ExportWizard({
  agent,
  initialStep = 0,
  onClose,
}: {
  agent: Agent;
  initialStep?: WizardState["step"];
  onClose: () => void;
}) {
  const t = useTranslations("ci");
  const c = useTranslations("common");

  const [state, dispatch] = React.useReducer(wizardReducer, {
    ...INITIAL_WIZARD_STATE,
    step: initialStep,
  });

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  useFocusTrap(wrapperRef, true, onClose);

  const stepRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    stepRef.current?.focus();
  }, [state.step]);

  const preview = useCiExportPreview();
  const validate = useValidateWorkflow();
  const install = useInstallCi();

  // AC-2/plan: the preview runs on ENTERING the preview step, not on open —
  // fire it once per transition into step 1 (a re-entry after picking a
  // different repository fires again since `repoId` is a dep here too).
  const prevStepRef = React.useRef<WizardState["step"]>(initialStep);
  React.useEffect(() => {
    const enteringPreview = state.step === 1 && prevStepRef.current !== 1;
    prevStepRef.current = state.step;
    if (enteringPreview && state.repoId) {
      preview.mutate({
        agentId: agent.id,
        input: {
          repo_id: state.repoId,
          target: state.target,
          triggers: state.triggers,
          post_as: state.postAs,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, state.repoId]);

  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!preview.data) return;
    const editableFile = preview.data.files.find((f) => f.editable);
    setSelectedPath(editableFile?.path ?? preview.data.files[0]?.path ?? null);
  }, [preview.data]);

  const selectedFile = preview.data?.files.find((f) => f.path === selectedPath) ?? null;
  const isEditableSelected = !!selectedFile?.editable;
  const displayedContents = isEditableSelected
    ? (state.workflowEdit ?? selectedFile?.contents ?? "")
    : (selectedFile?.contents ?? "");

  async function handleContinueFromPreview() {
    const workflowFile = preview.data?.files.find((f) => f.editable);
    const contents = state.workflowEdit ?? workflowFile?.contents ?? "";
    try {
      const result = await validate.mutateAsync(contents);
      if (result.valid) {
        dispatch({ type: "SET_WORKFLOW_ERROR", error: null });
        dispatch({ type: "SET_STEP", step: 2 });
      } else {
        dispatch({ type: "SET_WORKFLOW_ERROR", error: result.error ?? "" });
      }
    } catch (e) {
      dispatch({ type: "SET_WORKFLOW_ERROR", error: e instanceof Error ? e.message : String(e) });
    }
  }

  async function handleInstall() {
    if (!state.repoId) return;
    const input: CiExportInputBody = {
      repo_id: state.repoId,
      target: state.target,
      triggers: state.triggers,
      post_as: state.postAs,
      workflow_contents: state.workflowEdit,
    };
    try {
      const result = await install.mutateAsync({ agentId: agent.id, input });
      dispatch({ type: "INSTALL_SUCCESS", prUrl: result.pr_url });
    } catch (e) {
      dispatch({ type: "SET_INSTALL_ERROR", error: e instanceof Error ? e.message : String(e) });
    }
  }

  const canLeave = canLeaveStep(state);
  const stepLabels = STEP_KEYS.map((k) => t(`exportWizard.steps.${k}`));
  const total = STEP_KEYS.length;

  return (
    <div ref={wrapperRef}>
      <Modal
        width={880}
        title={t("exportWizard.title")}
        subtitle={t("exportWizard.subtitle", { agentName: agent.name })}
        onClose={onClose}
        footer={
          <div style={s.footer}>
            {state.step > 0 && !state.prUrl && (
              <Button kind="ghost" onClick={() => dispatch({ type: "SET_STEP", step: (state.step - 1) as WizardState["step"] })}>
                {t("exportWizard.back")}
              </Button>
            )}
            {state.step === 0 && (
              <Button kind="primary" disabled={!canLeave} onClick={() => dispatch({ type: "SET_STEP", step: 1 })}>
                {t("exportWizard.continue")}
              </Button>
            )}
            {state.step === 1 && (
              <Button
                kind="primary"
                disabled={!preview.data || !canLeave}
                loading={validate.isPending}
                onClick={() => void handleContinueFromPreview()}
              >
                {t("exportWizard.continue")}
              </Button>
            )}
            {state.step === 2 && (
              <Button kind="primary" disabled={!canLeave} onClick={() => dispatch({ type: "SET_STEP", step: 3 })}>
                {t("exportWizard.continue")}
              </Button>
            )}
            {state.step === 3 && !state.prUrl && (
              <Button kind="primary" loading={install.isPending} onClick={() => void handleInstall()}>
                {install.isPending ? t("exportWizard.installing") : t("exportWizard.install")}
              </Button>
            )}
            {state.prUrl && (
              <Button kind="primary" onClick={onClose}>
                {c("actions.close")}
              </Button>
            )}
          </div>
        }
      >
        <div style={s.body}>
          <div style={s.stepsRow}>
            <ExportWizardSteps step={state.step} labels={stepLabels} />
            <div style={s.stepOfLine}>
              {t("exportWizard.stepOf", { n: state.step + 1, total, label: stepLabels[state.step] })}
            </div>
          </div>

          <div ref={stepRef} tabIndex={-1} style={s.stepContainer}>
            {state.step === 0 && (
              <>
                <h3 style={s.h3}>{t("exportWizard.steps.target")}</h3>
                <div style={s.cardsGrid}>
                  {TARGET_CARDS.map((card) => {
                    const selected = card.available && state.target === card.value;
                    return (
                      <button
                        key={card.value}
                        type="button"
                        disabled={!card.available}
                        onClick={() => {
                          /* only 'gha' is selectable; it is already the
                             reducer's fixed target value. */
                        }}
                        style={s.card(selected, !card.available)}
                      >
                        <div style={s.cardTitle}>{t(card.labelKey)}</div>
                        <div style={s.cardDesc}>{t(card.descKey)}</div>
                        {card.available ? (
                          <span style={s.recommendedBadge}>{t("exportWizard.recommended")}</span>
                        ) : (
                          <span style={s.cardBadge}>{t("exportWizard.targetUnavailableBadge")}</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div style={{ marginTop: 16 }}>
                  <RepoChooser
                    value={state.repoId}
                    onChange={(repoId) => dispatch({ type: "SET_REPO", repoId })}
                    required
                  />
                  {state.repoId === null && <div style={s.reasonText}>{t("exportWizard.repoRequired")}</div>}
                </div>
              </>
            )}

            {state.step === 1 && (
              <>
                <h3 style={s.h3}>{t("exportWizard.filesToCreate")}</h3>
                {preview.isPending && <p style={s.hint}>{t("exportWizard.generating")}</p>}
                <AlertRegion>
                  {preview.isError
                    ? `${t("exportWizard.previewFailedLabel")} ${
                        preview.error instanceof Error ? preview.error.message : String(preview.error)
                      }`
                    : null}
                </AlertRegion>
                {preview.data && (
                  <>
                    {preview.data.skill_count === 0 && <p style={s.hint}>{t("exportWizard.noSkills")}</p>}
                    <div style={s.previewGrid}>
                      <div style={s.fileList}>
                        {preview.data.files.map((f) => (
                          <button
                            key={f.path}
                            type="button"
                            onClick={() => setSelectedPath(f.path)}
                            style={s.fileRow(f.path === selectedPath)}
                          >
                            <span style={s.fileRowPath} className="mono">
                              {f.path}
                            </span>
                            {f.editable && <span style={s.editableTag}>{t("exportWizard.editable")}</span>}
                          </button>
                        ))}
                      </div>
                      <div style={s.contentsPane}>
                        <div style={s.contentsHeader}>
                          <span className="mono">{selectedFile?.path}</span>
                          {isEditableSelected && <span style={s.editableTag}>{t("exportWizard.editable")}</span>}
                        </div>
                        {isEditableSelected ? (
                          <textarea
                            className="mono"
                            value={displayedContents}
                            onChange={(e) => dispatch({ type: "EDIT_WORKFLOW", contents: e.target.value })}
                            style={s.codeEditable}
                          />
                        ) : (
                          <textarea className="mono" readOnly value={displayedContents} style={s.codeReadOnly} />
                        )}
                        {state.workflowError !== null && (
                          <AlertRegion>
                            {t("exportWizard.workflowErrorLabel")} {state.workflowError}
                          </AlertRegion>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {state.step === 2 && (
              <>
                <h3 style={s.h3}>{t("exportWizard.triggerLabel")}</h3>
                <div style={s.triggerRow}>
                  {TRIGGER_OPTIONS.map((tr) => {
                    const checked = state.triggers.includes(tr);
                    return (
                      <label key={tr} style={s.triggerChip(checked)}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => dispatch({ type: "TOGGLE_TRIGGER", trigger: tr })}
                          style={{ margin: 0 }}
                        />
                        {t(`exportWizard.triggers.${tr}`)}
                      </label>
                    );
                  })}
                </div>
                {state.triggers.length === 0 && <div style={s.reasonText}>{t("exportWizard.triggerRequired")}</div>}

                <h3 style={{ ...s.h3, marginTop: 18 }}>{t("exportWizard.secrets.heading")}</h3>
                {preview.data && preview.data.expected_secrets.length > 0 && (
                  <table style={s.secretsTable}>
                    <tbody>
                      {preview.data.expected_secrets.map((secret) => (
                        <tr key={secret.key}>
                          <td style={s.secretsTd} className="mono">
                            {secret.key}
                          </td>
                          <td style={s.secretsTd}>
                            {secret.provided_by_platform ? (
                              <span>
                                <Icon.CheckCircle size={12} style={{ color: "var(--ok)", marginRight: 6 }} aria-hidden />
                                {t("exportWizard.secrets.providedByPlatform")}
                              </span>
                            ) : (
                              <span>
                                <Icon.AlertTriangle size={12} style={{ color: "var(--warn)", marginRight: 6 }} aria-hidden />
                                {t("exportWizard.secrets.mustAdd")}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <h3 style={{ ...s.h3, marginTop: 18 }}>{t("exportWizard.postResultsLabel")}</h3>
                <div style={s.radioRow}>
                  {POST_AS_OPTIONS.map((opt) => (
                    <label key={opt} style={s.radioLabel}>
                      <input
                        type="radio"
                        name="post-as"
                        checked={state.postAs === opt}
                        onChange={() => dispatch({ type: "SET_POST_AS", postAs: opt })}
                      />
                      {t(`exportWizard.postAs.${opt === "github_review" ? "githubReview" : opt === "pr_comment" ? "prComment" : "none"}`)}
                    </label>
                  ))}
                </div>

                <div style={s.note}>{t("exportWizard.branchProtectionNote")}</div>
              </>
            )}

            {state.step === 3 && (
              <>
                {state.prUrl ? (
                  <div style={s.successBox}>
                    <div style={s.successTitle}>{t("exportWizard.successTitle")}</div>
                    {isHttpsUrl(state.prUrl) ? (
                      <a href={state.prUrl} target="_blank" rel="noopener noreferrer" style={s.prLink}>
                        {t("exportWizard.prLinkLabel")}: {state.prUrl}
                      </a>
                    ) : (
                      <span style={s.prLink}>{state.prUrl}</span>
                    )}
                  </div>
                ) : (
                  <>
                    <h3 style={s.h3}>{t("exportWizard.steps.install")}</h3>
                    <div style={s.installCards}>
                      <div style={s.installCard(false)}>
                        <div style={s.installCardTitle}>{t("exportWizard.installCardTitle")}</div>
                        <div style={s.installCardBody}>
                          {t("exportWizard.installCardBody", {
                            repo: preview.data?.repo ?? "",
                            count: preview.data?.files.length ?? 0,
                          })}
                        </div>
                      </div>
                      <div style={s.installCard(true)} aria-disabled="true">
                        <div style={s.installCardTitle}>{t("exportWizard.zipCardTitle")}</div>
                        <div style={s.installCardBody}>{t("exportWizard.zipCardBody")}</div>
                      </div>
                    </div>
                    <AlertRegion>
                      {state.installError ? `${t("exportWizard.installFailedLabel")} ${state.installError}` : null}
                    </AlertRegion>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
