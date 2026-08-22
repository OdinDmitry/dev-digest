/* EvalCaseDialog — create/edit an eval case, or seed one from an accepted or
   dismissed finding (SPEC-03 T5/T6; docs/tasks/eval-pipeline.md §5.6). Owns
   its own draft state, its own validation message and (per the frozen
   contract) never reads the case list — the caller (EvalsTab / FindingCard)
   supplies `mode` and re-fetches the case list itself once `onSaved` fires.

   Polarity (T6): derived from the draft's own expectations
   (`polarityOf`, helpers.ts) — `must_find` for a positive case, or
   `must_not_flag` for one seeded/edited from a dismissed finding or an
   existing negative case. The "Expected output" editor shows the real,
   editable JSON for a positive case, but always PROJECTS `[]` for a
   negative one (AC-7): the real forbidden-zone expectations still exist in
   the draft and render read-only beside it (AC-10); on save, a negative
   case always sends `expectations: []` unchanged (AC-8) — the server keeps
   its stored forbidden zones for that exact shape
   (`server/src/modules/evals/helpers.ts` `resolveExpectations`).

   Repository is NOT shown (task §5.6 / design 06–07). `repo_id` on create
   is null for hand-made cases; from-finding derives it server-side (AC-46);
   edit preserves the existing association without exposing a control.

   Actual output + Run case (task §5.6): persisted `last_outcome`, or an
   ephemeral preview from `POST /eval-cases/:id/preview` (needs a saved
   case id — disabled until edit mode). */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Modal, FormField, TextInput, Textarea, Button } from "@devdigest/ui";
import type { EvalCase, EvalCaseInput, EvalExpectation, EvalPerTrace } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import {
  useCreateEvalCase,
  useCreateEvalCaseFromFinding,
  useUpdateEvalCase,
  useEvalCaseSeed,
  usePreviewEvalCase,
} from "@/lib/hooks";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { polarityOf, projectExpectedOutput, parseExpectations } from "./helpers";
import { formatActualOutput } from "./format-actual";
import { s } from "./styles";

export interface EvalCaseDialogProps {
  mode: "new" | "edit" | "from-finding";
  agentId: string;
  findingId?: string;
  caseRecord?: EvalCase;
  onClose: () => void;
  onSaved?: (c: EvalCase) => void;
}

export function EvalCaseDialog({
  mode,
  agentId,
  findingId,
  caseRecord,
  onClose,
  onSaved,
}: EvalCaseDialogProps) {
  const t = useTranslations("eval");
  const c = useTranslations("common");

  const dialogRef = React.useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true, onClose);

  const seed = useEvalCaseSeed(mode === "from-finding" ? (findingId ?? null) : null);

  const [name, setName] = React.useState(caseRecord?.name ?? "");
  const [diff, setDiff] = React.useState(caseRecord?.input_diff ?? "");
  const [expectations, setExpectations] = React.useState<EvalExpectation[]>(
    caseRecord?.expectations ?? [],
  );
  const [editorText, setEditorText] = React.useState(
    projectExpectedOutput(caseRecord?.expectations ?? []),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  // Session-local preview — wins over persisted last_outcome until close.
  const [previewOutcome, setPreviewOutcome] = React.useState<EvalPerTrace | null>(null);

  // from-finding: prefill once the seed loads, and only once — a refetch
  // (e.g. from an unrelated cache invalidation) must not clobber the user's
  // own edits mid-draft.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (mode !== "from-finding" || seededRef.current || !seed.data) return;
    seededRef.current = true;
    setName(seed.data.name);
    setDiff(seed.data.input_diff);
    setExpectations(seed.data.expectations);
    setEditorText(projectExpectedOutput(seed.data.expectations));
  }, [mode, seed.data]);

  const createNew = useCreateEvalCase(agentId);
  const createFromFinding = useCreateEvalCaseFromFinding(findingId ?? "");
  const updateCase = useUpdateEvalCase();
  const preview = usePreviewEvalCase();
  const saving = createNew.isPending || createFromFinding.isPending || updateCase.isPending;
  const running = preview.isPending;

  const polarity = polarityOf(expectations);
  const primary = expectations[0] ?? null;
  const canRun = mode === "edit" && !!caseRecord?.id;
  const alreadyExists = mode === "from-finding" && !!seed.data?.existing_case_id;
  const displayedOutcome = previewOutcome ?? caseRecord?.last_outcome ?? null;
  const actualText = displayedOutcome
    ? formatActualOutput(displayedOutcome)
    : t("caseEditor.neverRunYet");

  async function save() {
    // Negative cases: the editor shows `[]` (AC-7 / task §4.3) while the
    // real forbidden zones live in `expectations`. On EDIT, send `[]` so
    // the server keeps the stored zones (AC-8). On CREATE (from-finding /
    // new), send the canonical must_not_flag list — there is nothing stored
    // yet, and `resolveExpectations(null, [])` rejects as a must-find case.
    const toSend =
      polarity === "must_not_flag"
        ? mode === "edit"
          ? []
          : expectations
        : parseExpectations(editorText);
    if (toSend === null) {
      setError(t("caseEditor.expectedInvalid"));
      return;
    }
    if (alreadyExists) {
      setSaveError(t("caseEditor.alreadyExists"));
      return;
    }
    setError(null);
    setSaveError(null);

    // No repo UI (task §5.6). Hand-made → null; edit keeps whatever was
    // stored; from-finding ignores body.repo_id server-side (AC-46).
    const payload: EvalCaseInput = {
      name: name.trim(),
      input_diff: diff,
      repo_id: mode === "edit" ? (caseRecord?.repo_id ?? null) : null,
      expectations: toSend,
    };

    try {
      let saved: EvalCase;
      if (mode === "edit" && caseRecord) {
        saved = await updateCase.mutateAsync({ id: caseRecord.id, patch: payload });
      } else if (mode === "from-finding") {
        saved = await createFromFinding.mutateAsync(payload);
      } else {
        saved = await createNew.mutateAsync(payload);
      }
      onSaved?.(saved);
      onClose();
    } catch (e) {
      // Form errors stay inline (client/lib/providers toast taxonomy) — do not
      // rethrow or Next's dev overlay treats the rejection as unhandled.
      if (e instanceof ApiError && (e.status === 409 || e.code === "eval_case_exists")) {
        setSaveError(t("caseEditor.alreadyExists"));
      } else {
        setSaveError(e instanceof Error ? e.message : t("caseEditor.saveFailed"));
      }
    }
  }

  async function runCase() {
    if (!caseRecord?.id) return;
    setSaveError(null);
    try {
      const result = await preview.mutateAsync({ id: caseRecord.id });
      setPreviewOutcome(result.result);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : t("caseEditor.runFailed"));
    }
  }

  const title =
    mode === "edit" && caseRecord
      ? t("caseEditor.caseTitle", { name: caseRecord.name })
      : t("caseEditor.newCase");

  // Portal to <body>: FindingCard applies opacity:0.6 on accepted/dismissed
  // findings (the only states that can open this dialog), and opacity < 1
  // creates a stacking context that both multiplies every descendant's alpha
  // AND traps position:fixed. Without the portal the dialog paints at 60%
  // opacity under later sibling cards. Same escape hatch as SeverityCounts.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div ref={dialogRef}>
      <Modal
        width={860}
        title={title}
        onClose={onClose}
        footer={
          <div style={s.footer}>
            <Button kind="ghost" onClick={onClose} disabled={saving || running}>
              {c("actions.cancel")}
            </Button>
            <Button
              kind="secondary"
              icon="Play"
              onClick={() => void runCase()}
              disabled={!canRun || saving || running}
              loading={running}
            >
              {running ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
            <Button
              kind="primary"
              onClick={() => void save()}
              disabled={saving || running || alreadyExists || name.trim() === ""}
            >
              {saving ? t("caseEditor.saving") : t("caseEditor.save")}
            </Button>
          </div>
        }
      >
        <div style={s.body}>
          <div style={s.col}>
            {primary &&
              (polarity === "must_find" ? (
                <div style={s.banner("positive")}>
                  <div style={s.bannerLabel("positive")}>{t("caseEditor.positiveBannerLabel")}</div>
                  <div style={s.bannerBody}>
                    {t("caseEditor.positiveBannerBody", {
                      title: primary.title ?? primary.file,
                      file: primary.file,
                      line: primary.start_line,
                    })}
                  </div>
                </div>
              ) : (
                <div style={s.banner("negative")}>
                  <div style={s.bannerLabel("negative")}>{t("caseEditor.negativeBannerLabel")}</div>
                  <div style={s.bannerBody}>
                    {t("caseEditor.negativeBannerBody", {
                      file: primary.file,
                      line: primary.start_line,
                    })}
                  </div>
                </div>
              ))}

            <FormField label={t("caseEditor.nameLabel")} required>
              <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
            </FormField>

            {alreadyExists && <div style={s.errorText}>{t("caseEditor.alreadyExists")}</div>}
            {saveError && !alreadyExists && <div style={s.errorText}>{saveError}</div>}

            <FormField label={t("caseEditor.inputLabel")}>
              <textarea
                className="mono"
                value={diff}
                onChange={(e) => setDiff(e.target.value)}
                placeholder={t("caseEditor.diffPlaceholder")}
                style={s.diffTextarea}
              />
            </FormField>
          </div>

          <div style={s.col}>
            <div style={s.jsonEditorHeader}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                {t("caseEditor.expectedOutput")}
              </label>
            </div>
            {polarity === "must_not_flag" ? (
              <textarea className="mono" readOnly value="[]" style={s.jsonReadOnly} />
            ) : (
              <Textarea value={editorText} onChange={setEditorText} rows={10} mono />
            )}
            {error && <div style={s.errorText}>{error}</div>}

            {polarity === "must_not_flag" && expectations.length > 0 && (
              <>
                <div style={s.forbiddenLabel}>{t("caseEditor.forbiddenZones")}</div>
                <div style={s.forbiddenHint}>{t("caseEditor.forbiddenZonesHint")}</div>
                {expectations.map((e, i) => (
                  <div key={i} className="mono" style={s.forbiddenRow}>
                    {e.file}:{e.start_line}-{e.end_line}
                  </div>
                ))}
              </>
            )}

            <div style={{ ...s.jsonEditorHeader, marginTop: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                {t("caseEditor.actualOutput")}
              </label>
              {previewOutcome && (
                <span style={s.previewNote}>{t("evalsTab.previewNotStored")}</span>
              )}
            </div>
            <textarea
              className="mono"
              readOnly
              value={actualText}
              style={displayedOutcome ? s.actualOutput : s.actualPlaceholder}
            />
          </div>
        </div>
      </Modal>
    </div>,
    document.body,
  );
}
