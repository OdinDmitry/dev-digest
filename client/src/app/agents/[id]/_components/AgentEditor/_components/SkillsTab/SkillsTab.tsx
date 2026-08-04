/* SkillsTab — attach skills to an agent and order them.

   The order IS the order of the `## Skills / rules` blocks in the assembled
   prompt, which is why the rows are draggable rather than alphabetical. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/agents";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { useDragList } from "../../../../../../../lib/drag-list";
import { skillTypeChip } from "../../../../../../../lib/skill-type";
import { filterRows, orderRows, toggleLink } from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const tSkills = useTranslations("skills");
  const { data: skills, isLoading: skillsLoading } = useSkills();
  const { data: links, isLoading: linksLoading } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();
  const [filter, setFilter] = React.useState("");

  const rows = React.useMemo(() => orderRows(skills ?? [], links ?? []), [skills, links]);
  const linkedIds = React.useMemo(
    () => rows.filter((r) => r.linked).map((r) => r.skill.id),
    [rows],
  );
  const visible = filterRows(rows, filter);

  const persist = (skillIds: string[]) => setSkills.mutate({ agentId: agent.id, skillIds });

  // Reordering from a filtered view would silently drop the linked skills the
  // filter is hiding, so dragging is disabled while a filter is active. Three
  // obvious lines beat splicing a visible subsequence back into the full list.
  const filtering = filter.trim() !== "";
  const drag = useDragList(linkedIds, persist);

  if (skillsLoading || linksLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={22} width={180} />
        <div style={{ height: 16 }} />
        <Skeleton height={140} />
      </div>
    );
  }

  const total = (skills ?? []).length;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          {t("skills.enabledCount", { linked: linkedIds.length, total })}
        </Badge>
        <div style={s.search}>
          <Icon.Search size={12} style={{ color: "var(--text-muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            aria-label={t("skills.filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>

      <p style={s.hint}>{filtering ? t("skills.dragDisabledHint") : t("skills.orderHint")}</p>

      {total === 0 ? (
        <p style={s.hint}>{t("skills.noSkills")}</p>
      ) : (
        <div style={s.list}>
          {visible.map(({ skill, linked }) => {
            const draggable = linked && !filtering;
            const rowProps = draggable ? drag.rowProps(skill.id) : {};
            return (
              <div
                key={skill.id}
                {...rowProps}
                onClick={() => persist(toggleLink(linkedIds, skill.id))}
                role="checkbox"
                aria-checked={linked}
                aria-label={skill.name}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    persist(toggleLink(linkedIds, skill.id));
                  }
                }}
                style={s.row(linked, drag.over === skill.id, drag.dragging === skill.id)}
              >
                <Icon.Menu size={14} style={s.grip(draggable)} />
                <span style={s.checkbox(linked)}>
                  {linked && <Icon.Check size={11} style={s.checkIcon} />}
                </span>
                <span className="mono" style={s.name}>
                  {skill.name}
                </span>
                {!skill.enabled && (
                  <span style={s.disabledNote}>{t("skills.skillDisabled")}</span>
                )}
                <span style={skillTypeChip(skill.type)}>{tSkills(`listItem.type.${skill.type}`)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
