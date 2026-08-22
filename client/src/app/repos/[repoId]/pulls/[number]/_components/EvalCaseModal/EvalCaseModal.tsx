/* EvalCaseModal — "turn into eval case" (SPEC-04). Single consumer:
   FindingsPanel, via the finding card's action row. Fetches the draft for one
   finding; shows the existing case instead of a form when one already exists
   (AC-10); otherwise states the expectation the server already derived from
   the finding's own decision (AC-40) — there is no control to change it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorState, FormField, Modal, Skeleton, TextInput } from "@devdigest/ui";
import { useCreateEvalCase, useEvalCaseDraft } from "../../../../../../../lib/hooks/eval";
import { ApiError } from "../../../../../../../lib/api";
import { lineRangeLabel } from "./helpers";
import { s } from "./styles";

export function EvalCaseModal({ findingId, onClose }: { findingId: string; onClose: () => void }) {
  const t = useTranslations("eval");
  const { data: draft, isLoading, isError, error } = useEvalCaseDraft(findingId);
  const create = useCreateEvalCase();

  const [name, setName] = React.useState("");

  // Seed the editable name from the draft, guarded by `touchedRef` so a
  // deliberate user edit is never clobbered. On reopen of the SAME finding
  // within the query's `gcTime`, TanStack Query serves the stale cached
  // draft synchronously on the first render (before the `staleTime: 0` +
  // `refetchOnMount: "always"` background refetch in `useEvalCaseDraft`
  // resolves) — depending on the actual seed values, not just `finding_id`,
  // means this effect fires again once the fresh decision arrives instead of
  // being stuck on the first open's value (client/insights.md, Open
  // Questions 2026-08-21). The expectation statement itself needs no such
  // guard: it is read straight off `draft.expectation_kind` on every render,
  // never mirrored into local state, so a decision that changed while the
  // modal was closed shows up the moment the fresh draft lands.
  const touchedRef = React.useRef(false);
  React.useEffect(() => {
    if (draft && !draft.existing_case && !touchedRef.current) {
      setName(draft.suggested_name);
    }
  }, [draft?.finding_id, draft?.expectation_kind, draft?.suggested_name, draft?.existing_case]);

  const editName = (next: string) => {
    touchedRef.current = true;
    setName(next);
  };

  const submit = () => {
    if (!draft) return;
    create.mutate(
      {
        agentId: draft.agent_id,
        body: { finding_id: findingId, name: name.trim() || draft.suggested_name },
      },
      { onSuccess: () => onClose() },
    );
  };

  const showForm = !!draft && !draft.existing_case;

  return (
    <Modal
      width={640}
      title={t("caseModal.title")}
      subtitle={draft ? t("caseModal.subtitle", { agent: draft.agent_name }) : undefined}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {showForm ? t("caseModal.cancel") : t("caseModal.close")}
          </Button>
          {showForm && (
            <Button
              kind="primary"
              icon="FlaskConical"
              disabled={!draft || create.isPending}
              onClick={submit}
            >
              {create.isPending ? t("caseModal.creating") : t("caseModal.confirm")}
            </Button>
          )}
        </div>
      }
    >
      <div style={s.body}>
        {isLoading && <Skeleton height={220} />}
        {isError && (
          <ErrorState body={error instanceof ApiError ? error.message : t("caseModal.loadError")} />
        )}

        {draft && draft.existing_case && (
          <div>
            <p style={s.hint}>{t("caseModal.existingNotice")}</p>
            <div style={s.fileLabel} className="mono">
              {draft.existing_case.file}:{lineRangeLabel(draft.existing_case)}
            </div>
            <div style={s.caseName}>{draft.existing_case.name}</div>
            <pre style={s.fragment}>{draft.existing_case.fragment}</pre>
            <div style={s.expectationList}>
              {draft.existing_case.expectations.map((e) => (
                <span key={e.id}>
                  {t(`caseModal.kind.${e.kind}`)} · {e.file}:{lineRangeLabel(e)}
                </span>
              ))}
            </div>
          </div>
        )}

        {showForm && draft && (
          <>
            <FormField label={t("caseModal.nameLabel")} required>
              <TextInput value={name} onChange={editName} placeholder={draft.suggested_name} />
            </FormField>

            <FormField label={t("caseModal.locationLabel")}>
              <div className="mono" style={s.fileLabel}>
                {draft.file}:{lineRangeLabel(draft)}
              </div>
            </FormField>

            <FormField label={t("caseModal.fragmentLabel")}>
              <pre style={s.fragment}>{draft.fragment}</pre>
            </FormField>

            <FormField label={t("caseModal.expectationLabel")}>
              <p style={s.hint}>
                {draft.expectation_kind ? t(`caseModal.kind.${draft.expectation_kind}`) : null}
              </p>
            </FormField>
          </>
        )}
      </div>
    </Modal>
  );
}
