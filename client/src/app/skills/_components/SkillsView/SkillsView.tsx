/* /skills — the reusable skills library. A fixed rail lists skills; the right
   pane shows the selected one across Config/Preview/Versions tabs, mirroring
   `client/src/app/agents/[id]/page.tsx`.

   `?id=` holds the selection, `?tab=` the active detail tab — one `navigate`
   helper owns both, so switching skill preserves the tab (as the agent editor
   preserves it when switching agent). Filtering never clears the selection,
   and nothing auto-selects the first skill on load. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills, useSkillStats, useUpdateSkill } from "../../../../lib/hooks/skills";
import { SkillListItem } from "../SkillListItem";
import { SkillDetail } from "../SkillDetail";
import { CreateSkillModal } from "../CreateSkillModal";
import { ImportSkillDrawer } from "../ImportSkillDrawer";
import { VALID_TABS, type DetailTabKey } from "./constants";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const { data: stats } = useSkillStats();
  const update = useUpdateSkill();

  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const selectedId = search.get("id");
  const tabParam = search.get("tab");
  const tab: DetailTabKey = (VALID_TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as DetailTabKey)
    : "config";

  const navigate = React.useCallback(
    (next: { id?: string | null; tab?: string }) => {
      const sp = new URLSearchParams(search.toString());
      if (next.id !== undefined) {
        if (next.id) sp.set("id", next.id);
        else sp.delete("id");
      }
      if (next.tab !== undefined) sp.set("tab", next.tab);
      router.replace(sp.size > 0 ? `/skills?${sp.toString()}` : "/skills");
    },
    [router, search],
  );
  const select = React.useCallback((id: string | null) => navigate({ id }), [navigate]);

  const statsById = React.useMemo(
    () => new Map((stats ?? []).map((st) => [st.skill_id, st.agent_count])),
    [stats],
  );

  const list = filterSkills(skills ?? [], query);
  const selected = (skills ?? []).find((sk) => sk.id === selectedId);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {creating && <CreateSkillModal onClose={() => setCreating(false)} onCreated={select} />}
      {importing && <ImportSkillDrawer onClose={() => setImporting(false)} onImported={select} />}

      <div style={s.layout}>
        <div style={s.rail}>
          <div style={s.railHeader}>
            <div style={s.railTitleRow}>
              <h1 style={s.h1}>{t("page.heading")}</h1>
              <Dropdown
                width={210}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus">
                    {t("page.addSkill")}
                  </Button>
                }
                items={[
                  { label: t("page.menu.create"), icon: "Edit", onClick: () => setCreating(true) },
                  { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setImporting(true) },
                ]}
              />
            </div>
            <div style={s.search}>
              <Icon.Search size={13} style={s.searchIcon} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("page.searchPlaceholder")}
                aria-label={t("page.searchPlaceholder")}
                style={s.searchInput}
              />
            </div>
          </div>

          <div style={s.railList}>
            {isLoading && (
              <>
                <Skeleton height={64} />
                <Skeleton height={64} />
                <Skeleton height={64} />
              </>
            )}
            {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
            {/* A wholly-empty library is covered by the detail pane's full
                EmptyState (with the import CTA) — showing the same message
                here too would just duplicate it. A filter that matches
                nothing DOES need its own line, since the detail pane keeps
                showing whatever was already selected. */}
            {!isLoading && !isError && list.length === 0 && query && (
              <div style={s.railEmpty}>{t("page.noMatchTitle")}</div>
            )}
            {list.map((sk) => (
              <SkillListItem
                key={sk.id}
                skill={sk}
                active={sk.id === selectedId}
                agentCount={statsById.get(sk.id) ?? null}
                onClick={() => select(sk.id)}
                onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
              />
            ))}
          </div>
        </div>

        <div style={s.detail}>
          {isLoading ? (
            <div style={s.detailLoading}>
              <Skeleton height={24} width={240} />
              <Skeleton height={200} />
            </div>
          ) : (
            <SkillDetail
              skill={selected}
              tab={tab}
              onTab={(nextTab) => navigate({ tab: nextTab })}
              librarySize={(skills ?? []).length}
              onImport={() => setImporting(true)}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
