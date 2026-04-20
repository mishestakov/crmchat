import { Navigate, createFileRoute } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";

import { Property } from "@repo/core/types";

import { MiniAppPage } from "@/components/mini-app-page";
import { PropertyForm } from "@/components/property-form";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useFormFeatures } from "@/hooks/useFormFeatures";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { useProperties } from "@/hooks/useProperties";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/properties/$objectType/$key/edit"
)({
  component: EditProperty,
});

function EditProperty() {
  useFormFeatures();
  const navigateBack = useNavigateBack();
  const { workspaceId, objectType, key } = Route.useParams();
  const [properties, updateProperties] = useProperties(objectType as any);
  const property = properties.find((p) => p.key === key);

  if (!property || property.readonly || property.internal) {
    return (
      <Navigate
        to="/w/$workspaceId/settings/properties/$objectType"
        params={{ workspaceId, objectType }}
        replace
      />
    );
  }

  const goBack = () => {
    navigateBack({
      fallback: {
        to: "/w/$workspaceId/settings/properties/$objectType",
        params: { workspaceId, objectType },
      },
    });
  };

  return (
    <MiniAppPage className="flex flex-col gap-5">
      <PropertyForm
        type={property.type}
        property={property}
        onSubmit={(updatedProperty) => {
          const index = properties.findIndex(
            (p) => p.key === updatedProperty.key
          );
          if (index === -1) {
            return;
          }
          const newProperties = properties.with(index, updatedProperty);
          updateProperties(newProperties);
          goBack();
        }}
      />

      <div className="text-center">
        <DeleteDialog
          property={property}
          onDelete={() => {
            const newProperties = properties.filter((p) => p.key !== key);
            updateProperties(newProperties);
            goBack();
          }}
        />
      </div>
    </MiniAppPage>
  );
}

function DeleteDialog({
  property,
  onDelete,
}: {
  property: Property;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant={"link"} className="text-destructive">
          {t("web.properties.edit.deleteButton")}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            {t("web.properties.edit.deleteConfirmTitle")}
          </DrawerTitle>
          <DrawerDescription>
            <p className="mt-2">
              <Trans
                t={t}
                i18nKey="web.properties.edit.deleteConfirmDescription"
                values={{ name: property.name }}
                components={{ 1: <strong /> }}
              />
            </p>
            <p className="text-destructive mt-2">
              <strong>{t("web.deleteWarning")}</strong>
            </p>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DestructiveButton
            onClick={() => {
              onDelete();
            }}
          >
            {t("web.properties.edit.deleteButton")}
          </DestructiveButton>
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">
              {t("web.cancel")}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
