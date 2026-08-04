/* /skills — the reusable skills library. Grid of cards on the left, preview of
   the selected skill on the right, "Add" offering create-or-import.

   Selection lives in `?id=` so a skill is linkable and survives a reload. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills, useUpdateSkill } from "../../../../lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { SkillPreviewPane } from "../SkillPreviewPane";
import { CreateSkillModal } from "../CreateSkillModal";
import { ImportSkillDrawer } from "../ImportSkillDrawer";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const search = useSearchParams();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();

  const [query, setQuery] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const selectedId = search.get("id");
  const select = React.useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(search.toString());
      if (id) sp.set("id", id);
      else sp.delete("id");
      router.replace(sp.size > 0 ? `/skills?${sp.toString()}` : "/skills");
    },
    [router, search],
  );

  const list = filterSkills(skills ?? [], query);
  const selected = (skills ?? []).find((sk) => sk.id === selectedId);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      {creating && <CreateSkillModal onClose={() => setCreating(false)} onCreated={select} />}
      {importing && <ImportSkillDrawer onClose={() => setImporting(false)} onImported={select} />}

      <div style={s.layout}>
        <div style={s.main}>
          <div style={s.page}>
            <div style={s.header}>
              <div style={s.headerText}>
                <h1 style={s.h1}>{t("page.heading")}</h1>
                <p style={s.subtitle}>{t("page.subtitle")}</p>
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
              <Dropdown
                width={220}
                align="right"
                trigger={
                  <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                    {t("page.addSkill")}
                  </Button>
                }
                items={[
                  { label: t("page.menu.create"), icon: "Edit", onClick: () => setCreating(true) },
                  { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setImporting(true) },
                ]}
              />
            </div>

            {isLoading && (
              <div style={s.grid}>
                <Skeleton height={110} />
                <Skeleton height={110} />
                <Skeleton height={110} />
              </div>
            )}
            {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
            {!isLoading && !isError && list.length === 0 && (
              <EmptyState
                icon="Sparkles"
                title={query ? t("page.noMatchTitle") : t("page.empty.title")}
                body={query ? t("page.noMatchBody") : t("page.empty.body")}
                {...(query ? {} : { cta: t("page.empty.cta"), onCta: () => setImporting(true) })}
              />
            )}
            {list.length > 0 && (
              <div style={s.grid}>
                {list.map((sk) => (
                  <SkillCard
                    key={sk.id}
                    skill={sk}
                    active={sk.id === selectedId}
                    onClick={() => select(sk.id === selectedId ? null : sk.id)}
                    onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {selected && (
          <div style={s.preview}>
            <SkillPreviewPane skill={selected} />
          </div>
        )}
      </div>
    </AppShell>
  );
}
