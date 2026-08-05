/* ConventionsView — /repos/:repoId/conventions. Scan the repo for candidate
   coding conventions, accept/reject each with real file:line evidence, then
   merge the accepted set into a Skill. Accept/Reject status IS the selection
   for "Create skill" — there is no separate multi-select UI. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../../../components/app-shell";
import { RepoNotFound } from "../../../../../../components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "../../../../../../lib/repo-context";
import {
  useConventions,
  useDeleteConvention,
  useExtractConventions,
  useUpdateConvention,
} from "../../../../../../lib/hooks/conventions";
import { ApiError } from "../../../../../../lib/api";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillFromConventionsModal } from "../CreateSkillFromConventionsModal";
import { latestScanAt, relativeTime } from "./helpers";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const { repoId, activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: conventions, isLoading, isError, error, refetch } = useConventions(repoId);
  const extract = useExtractConventions();
  const update = useUpdateConvention();
  const del = useDeleteConvention();
  const [creatingSkill, setCreatingSkill] = React.useState(false);
  const [lastExtractCount, setLastExtractCount] = React.useState<number | null>(null);

  const repoName = activeRepo?.full_name ?? repoId ?? t("page.repoFallback");
  const list = conventions ?? [];
  const acceptedIds = list.filter((c) => c.status === "accepted").map((c) => c.id);

  const scannedAt = latestScanAt(list);
  const subtitle =
    scannedAt == null
      ? t("page.subtitle")
      : lastExtractCount != null
        ? t("page.subtitleScanned", { count: lastExtractCount, when: relativeTime(scannedAt) })
        : t("page.subtitleCandidatesOnly", { count: list.length, when: relativeTime(scannedAt) });

  const runExtract = () => {
    if (!repoId) return;
    extract.mutate(repoId, {
      onSuccess: (result) => setLastExtractCount(result.scanned_files.length),
    });
  };

  const deselectAll = () => {
    if (!repoId) return;
    for (const c of list) {
      if (c.status === "accepted") {
        update.mutate({ id: c.id, repoId, patch: { status: "pending" } });
      }
    }
  };

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbConventions") }]}>
      {creatingSkill && repoId && (
        <CreateSkillFromConventionsModal
          repoId={repoId}
          repoName={repoName}
          conventionIds={acceptedIds}
          onClose={() => setCreatingSkill(false)}
        />
      )}

      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>
            {t("page.headingPrefix")}
            {repoName}
          </h1>
          <p style={s.pageSubtitle}>{isLoading ? t("page.subtitle") : subtitle}</p>
        </div>
        <div style={s.headerActions}>
          <Button
            icon="RefreshCw"
            onClick={runExtract}
            loading={extract.isPending}
            disabled={!repoId}
          >
            {extract.isPending ? t("page.scanning") : t("page.rescan")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div style={s.loadingStack}>
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </div>
      ) : isError ? (
        <div style={{ margin: "0 32px" }}>
          <ErrorState
            body={error instanceof ApiError ? error.message : t("page.loadError")}
            onRetry={() => refetch()}
          />
        </div>
      ) : list.length === 0 ? (
        <div style={{ margin: "0 32px" }}>
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={runExtract}
            ctaLoading={extract.isPending}
          />
        </div>
      ) : (
        <>
          <div style={s.toolbar}>
            <span style={s.acceptedCount}>
              {t("page.acceptedCount", { accepted: acceptedIds.length, total: list.length })}
            </span>
            <Button kind="ghost" size="sm" onClick={deselectAll} disabled={acceptedIds.length === 0}>
              {t("page.deselectAll")}
            </Button>
            <div style={s.spacer} />
            <Button
              kind="primary"
              icon="Sparkles"
              disabled={acceptedIds.length === 0}
              onClick={() => setCreatingSkill(true)}
            >
              {t("page.createSkill")}
            </Button>
          </div>

          <div style={s.list}>
            {list.map((c) => (
              <ConventionCard
                key={c.id}
                convention={c}
                repoFullName={activeRepo?.full_name}
                defaultBranch={activeRepo?.default_branch}
                pending={update.isPending}
                onStatusChange={(status) =>
                  repoId && update.mutate({ id: c.id, repoId, patch: { status } })
                }
                onDelete={() => repoId && del.mutate({ id: c.id, repoId })}
              />
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
