"use client";

import React from "react";
import { SectionLabel, Skeleton, Button } from "@devdigest/ui";
import { usePrIntent, useComputeIntent, useRecomputeIntent } from "../../../../../../../lib/hooks/intent";
import { ApiError } from "../../../../../../../lib/api";
import { s } from "./styles";

interface IntentCardProps {
  prId: string | null;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

/**
 * Derived PR intent/scope (L03), shown above Description on the Overview tab
 * so the user can verify the system understood the task before reading
 * findings. Lazy: mounts → reads the persisted row (no LLM); if none exists,
 * fires ONE auto-compute per PR per mount (ref-guarded — a refetch/re-render
 * can never fan out into repeated model calls). A "Recompute" button is the
 * manual "the PR changed" escape hatch.
 */
export function IntentCard({ prId }: IntentCardProps) {
  const { data, isLoading, error } = usePrIntent(prId);
  const computeMutation = useComputeIntent();
  const recomputeMutation = useRecomputeIntent();

  // Once-per-PR-per-mount guard, keyed on prId so navigating to a different
  // PR resets it — a refetch/re-render of this component must never trigger
  // a second model call for the SAME PR.
  const firedForRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!prId || isLoading || data !== null || firedForRef.current === prId) return;
    firedForRef.current = prId;
    computeMutation.mutate(prId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prId, data, isLoading]);

  if (!prId) return null;

  if (isLoading) {
    return (
      <section>
        <SectionLabel icon="Target">Intent</SectionLabel>
        <Skeleton height={64} />
      </section>
    );
  }

  // Error UX: no toast, no full-screen error — a PR page must stay usable
  // with no LLM key configured. A quiet inline empty state with a retry.
  if (error || computeMutation.isError) {
    const message = error
      ? errorMessage(error, "Could not load intent for this PR.")
      : errorMessage(computeMutation.error, "Could not derive intent for this PR.");
    return (
      <section>
        <SectionLabel icon="Target">Intent</SectionLabel>
        <div style={s.emptyState}>
          <span style={s.emptyMessage}>{message}</span>
          <Button
            kind="secondary"
            size="sm"
            loading={computeMutation.isPending}
            onClick={() => computeMutation.mutate(prId)}
          >
            Derive intent
          </Button>
        </div>
      </section>
    );
  }

  if (data == null) {
    return (
      <section>
        <SectionLabel icon="Target">Intent</SectionLabel>
        <div style={s.derivingState}>Deriving intent…</div>
      </section>
    );
  }

  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          <Button
            kind="ghost"
            size="sm"
            icon="RefreshCw"
            loading={recomputeMutation.isPending}
            onClick={() => recomputeMutation.mutate(prId)}
          >
            {recomputeMutation.isPending ? "Deriving…" : "Recompute"}
          </Button>
        }
      >
        Intent
      </SectionLabel>
      <div style={s.box}>
        <p style={s.quote}>{data.intent}</p>
        {data.in_scope.length > 0 && (
          <>
            <hr style={s.divider} />
            <div style={s.scopeBlock}>
              <div style={s.scopeLabel}>In scope</div>
              <ul style={s.scopeList}>
                {data.in_scope.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </>
        )}
        {data.out_of_scope.length > 0 && (
          <>
            <hr style={s.divider} />
            <div style={s.scopeBlock}>
              <div style={s.scopeLabel}>Out of scope</div>
              <ul style={s.scopeList}>
                {data.out_of_scope.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
