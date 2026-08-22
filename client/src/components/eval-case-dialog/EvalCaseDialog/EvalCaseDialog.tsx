/* EvalCaseDialog — create/edit an eval case, or seed one from an accepted or
   dismissed finding (SPEC-03 T5/T6). Owns its own draft state, its own
   validation message and (per the frozen contract) never reads the case
   list — the caller (EvalsTab / FindingCard) supplies `mode` and re-fetches
   the case list itself once `onSaved` fires.

   Polarity (T6): derived from the draft's own expectations
   (`polarityOf`, helpers.ts) — `must_find` for a positive case, or
   `must_not_flag` for one seeded/edited from a dismissed finding or an
   existing negative case. The "Expected output" editor shows the real,
   editable JSON for a positive case, but always PROJECTS `[]` for a
   negative one (AC-7): the real forbidden-zone expectations still exist in
   the draft and render read-only beside it (AC-10); on save, a negative
   case always sends `expectations: []` unchanged (AC-8) — the server keeps
   its stored forbidden zones for that exact shape
   (`server/src/modules/evals/helpers.ts` `resolveExpectations`). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, FormField, TextInput, SelectInput, Textarea, Button } from "@devdigest/ui";
import type { EvalCase, EvalCaseInput, EvalExpectation } from "@devdigest/shared";
import {
  useRepos,
  useCreateEvalCase,
  useCreateEvalCaseFromFinding,
  useUpdateEvalCase,
  useEvalCaseSeed,
} from "@/lib/hooks";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { polarityOf, projectExpectedOutput, parseExpectations } from "./helpers";
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

  const { data: repos } = useRepos();
  const seed = useEvalCaseSeed(mode === "from-finding" ? (findingId ?? null) : null);

  const [name, setName] = React.useState(caseRecord?.name ?? "");
  const [repoId, setRepoId] = React.useState(caseRecord?.repo_id ?? "");
  const [diff, setDiff] = React.useState(caseRecord?.input_diff ?? "");
  const [expectations, setExpectations] = React.useState<EvalExpectation[]>(
    caseRecord?.expectations ?? [],
  );
  const [editorText, setEditorText] = React.useState(
    projectExpectedOutput(caseRecord?.expectations ?? []),
  );
  const [error, setError] = React.useState<string | null>(null);

  // from-finding: prefill once the seed loads, and only once — a refetch
  // (e.g. from an unrelated cache invalidation) must not clobber the user's
  // own edits mid-draft.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (mode !== "from-finding" || seededRef.current || !seed.data) return;
    seededRef.current = true;
    setName(seed.data.name);
    setRepoId(seed.data.repo_id);
    setDiff(seed.data.input_diff);
    setExpectations(seed.data.expectations);
    setEditorText(projectExpectedOutput(seed.data.expectations));
  }, [mode, seed.data]);

  const createNew = useCreateEvalCase(agentId);
  const createFromFinding = useCreateEvalCaseFromFinding(findingId ?? "");
  const updateCase = useUpdateEvalCase();
  const saving = createNew.isPending || createFromFinding.isPending || updateCase.isPending;

  const polarity = polarityOf(expectations);
  const primary = expectations[0] ?? null;

  const repoOptions = React.useMemo(
    () => [
      { value: "", label: t("caseEditor.repoNone") },
      ...(repos ?? []).map((r) => ({ value: r.id, label: r.full_name })),
    ],
    [repos, t],
  );

  async function save() {
    // AC-8: a negative case always sends its expectations back unchanged —
    // the editor's own content is never the source of truth for it (AC-7).
    const toSend = polarity === "must_not_flag" ? [] : parseExpectations(editorText);
    if (toSend === null) {
      setError(t("caseEditor.expectedInvalid"));
      return;
    }
    setError(null);

    const payload: EvalCaseInput = {
      name: name.trim(),
      input_diff: diff,
      repo_id: repoId === "" ? null : repoId,
      expectations: toSend,
    };

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
  }

  const title =
    mode === "edit" && caseRecord
      ? t("caseEditor.caseTitle", { name: caseRecord.name })
      : t("caseEditor.newCase");

  return (
    <div ref={dialogRef}>
      <Modal
        width={860}
        title={title}
        onClose={onClose}
        footer={
          <div style={s.footer}>
            <Button kind="ghost" onClick={onClose} disabled={saving}>
              {c("actions.cancel")}
            </Button>
            <Button kind="primary" onClick={() => void save()} disabled={saving || name.trim() === ""}>
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
                  {t("caseEditor.positiveBanner", {
                    title: primary.title ?? primary.file,
                    file: primary.file,
                    line: primary.start_line,
                  })}
                </div>
              ) : (
                <div style={s.banner("negative")}>
                  {t("caseEditor.negativeBanner", { file: primary.file, line: primary.start_line })}
                </div>
              ))}

            <FormField label={t("caseEditor.nameLabel")} required>
              <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
            </FormField>

            <FormField label={t("caseEditor.repoLabel")}>
              <SelectInput value={repoId ?? ""} onChange={setRepoId} options={repoOptions} mono={false} />
            </FormField>

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
              <Textarea value={editorText} onChange={setEditorText} rows={13} mono />
            )}
            {error && <div style={s.errorText}>{error}</div>}

            {polarity === "must_not_flag" && expectations.length > 0 && (
              <>
                <div style={s.forbiddenLabel}>{t("caseEditor.forbiddenZones")}</div>
                {expectations.map((e, i) => (
                  <div key={i} className="mono" style={s.forbiddenRow}>
                    {e.file}:{e.start_line}-{e.end_line}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
