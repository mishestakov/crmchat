import { OrganizationWithId } from "@repo/core/types";

export function getOrganizationName(
  organization: Pick<OrganizationWithId, "id" | "name" | "membersCount">
) {
  if (organization.name) {
    return organization.name;
  }

  return `Organization ${organization.id.slice(0, 5)}`;
}
