/* ProjectContextView — /repos/:repoId/context (mockup 01). Browse every
   markdown document in the repo's synced working copy, grouped by folder,
   and preview one at a time. Attaching happens on the agent/skill Context
   tabs (ContextAttachPanel), not here — this page is read-only browse +
   preview (spec Non-goals: no create/edit/upload/delete). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Markdown, Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useActiveRepo, useRepoNotFound } from "@/lib/repo-context";
import { useContextDocument, useContextDocuments } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { SKELETON_ROWS } from "./constants";
import { fileName, filterDocuments, groupByFolder, relativeTime } from "./helpers";
import { s } from "./styles";

export function ProjectContextView() {
  const t = useTranslations("context");
  const { repoId, activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);
  const { data: listing, isLoading, isError, error, refetch } = useContextDocuments(repoId);

  const [filter, setFilter] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  const documents = listing?.documents ?? [];
  const filtered = filterDocuments(documents, filter);
  const groups = groupByFolder(filtered);

  // Derived, not stored: the displayed document is the explicit selection if
  // it's still visible under the current filter, else the first visible one.
  const displayedPath =
    selectedPath && filtered.some((d) => d.path === selectedPath)
      ? selectedPath
      : (filtered[0]?.path ?? null);
  const displayedDoc = documents.find((d) => d.path === displayedPath) ?? null;

  const { data: docText, isLoading: docLoading } = useContextDocument(repoId, displayedPath, {
    enabled: !!displayedPath,
  });

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: t("title") }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  const repoName = activeRepo?.full_name ?? repoId ?? "";
  const synced = listing?.synced ?? false;

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: t("title") }]}>
      <div style={s.layout}>
        <div style={s.rail}>
          <div style={s.railHeader}>
            <div style={s.railTitleRow}>
              <h1 style={s.h1}>{t("title")}</h1>
            </div>
            <div style={s.search}>
              <Icon.Search size={13} style={s.searchIcon} />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t("filterPlaceholder")}
                aria-label={t("filterPlaceholder")}
                style={s.searchInput}
              />
            </div>
          </div>

          <div style={s.railList}>
            {isLoading &&
              Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                <Skeleton key={i} height={28} />
              ))}

            {isError && (
              <ErrorState
                body={error instanceof ApiError ? error.message : t("loadError")}
                onRetry={() => refetch()}
              />
            )}

            {!isLoading && !isError && listing && !synced && (
              <div style={s.railEmpty}>{t("unavailable")}</div>
            )}

            {!isLoading && !isError && synced && documents.length === 0 && (
              <EmptyState icon="Folder" title={t("empty.title")} body={t("empty.body")} />
            )}

            {!isLoading &&
              !isError &&
              synced &&
              documents.length > 0 &&
              groups.length === 0 && <div style={s.railEmpty}>{t("noMatch")}</div>}

            {groups.map((group) => (
              <div key={group.folder || "__root__"} style={s.folderGroup}>
                <div style={s.folderHeading}>{group.folder || "/"}</div>
                {group.documents.map((doc) => (
                  <button
                    key={doc.path}
                    type="button"
                    onClick={() => setSelectedPath(doc.path)}
                    aria-label={t("previewAria", { name: doc.path })}
                    title={doc.path}
                    style={s.docRow(doc.path === displayedPath)}
                  >
                    <Icon.FileText size={13} style={s.docIcon} />
                    <span style={s.docName}>{fileName(doc.path)}</span>
                    <span style={s.docTokens}>{t("tokens", { count: doc.token_count })}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          {listing && synced && (
            <div style={s.railFooter}>
              <div>
                {t("footer", {
                  count: listing.document_count,
                  tokens: listing.total_tokens,
                  when: listing.last_synced_at ? relativeTime(listing.last_synced_at) : "—",
                })}
              </div>
              {listing.partial && <div>{t("notListed", { count: listing.not_listed })}</div>}
            </div>
          )}
        </div>

        <div style={s.detail}>
          {isLoading ? (
            <div style={s.loadingStack}>
              <Skeleton height={24} width={240} />
              <Skeleton height={200} />
            </div>
          ) : displayedDoc ? (
            <>
              <div style={s.detailHeader}>
                <span className="mono" style={s.detailFileName}>
                  {fileName(displayedDoc.path)}
                </span>
                <div style={s.modeToggle}>
                  <span style={s.modeActive}>{t("mode.preview")}</span>
                  <span style={s.modeDisabled} title={t("editDisabled")}>
                    {t("mode.edit")}
                  </span>
                </div>
                <span style={s.usedBy}>{t("usedByAgents", { count: displayedDoc.usage_count })}</span>
              </div>
              <div style={s.detailBody}>
                {docLoading ? <Skeleton height={200} /> : <Markdown>{docText?.text ?? ""}</Markdown>}
              </div>
            </>
          ) : (
            <div style={s.detailEmpty} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
