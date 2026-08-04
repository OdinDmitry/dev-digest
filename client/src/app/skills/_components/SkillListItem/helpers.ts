import type { IconName } from "@devdigest/ui";
import type { SkillSource } from "@devdigest/shared";

/** Icon paired with each source's label (`listItem.source.*`) in the rail row. */
export const SOURCE_ICON: Record<SkillSource, IconName> = {
  manual: "Edit",
  extracted: "Wrench",
  community: "Globe",
  imported_url: "Link",
};
