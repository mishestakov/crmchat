import { Property, WorkspaceObjectType } from "../types";

export function enrichCustomProperties(
  objectType: WorkspaceObjectType,
  properties: Property[],
  t: (key: string) => string
): Property[] {
  return properties.map((property) => {
    return enrichProperty(objectType, property, t);
  });
}

function enrichProperty(
  objectType: WorkspaceObjectType,
  property: Property,
  t: (key: string) => string
) {
  if (objectType === "contacts" && property.key === "ownerId") {
    return {
      ...property,
      name: t("text.properties.owner"),
    };
  }

  return property;
}
