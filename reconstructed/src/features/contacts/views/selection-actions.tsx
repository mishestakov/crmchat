import { AnimatePresence, m } from "motion/react";
import { useTranslation } from "react-i18next";

import { BulkEditDialog } from "../bulk-actions/bulk-edit/bulk-edit-dialog";
import { DeleteContactsDialog } from "../bulk-actions/delete-contacts-dialog";
import { MoveContactsDialog } from "../bulk-actions/move-contacts-dialog";
import { useViewContext } from "./view-context";
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "@/components/ui/button-group";
import { useCurrentWorkspace } from "@/lib/store";
import { cn } from "@/lib/utils";

export function SelectionActions({
  className,
  checkbox,
}: {
  className?: string;
  checkbox?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const {
    isSelectionMode,
    selectedContacts,
    setIsSelectionMode,
    setSelectedContacts,
  } = useViewContext();
  const LabelComponent = checkbox ? "label" : "div";
  return (
    <AnimatePresence>
      {isSelectionMode && (
        <m.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          transition={{ duration: 0.2, delay: 0.4 }}
          exit={{ opacity: 0, height: 0 }}
        >
          <div
            className={cn(
              "flex min-h-9 items-center gap-2 rounded-lg",
              className
            )}
          >
            <LabelComponent className="flex items-center gap-2">
              {checkbox}
              <span className="text-muted-foreground mr-2 hidden whitespace-nowrap text-sm sm:inline">
                {t("web.contacts.selected", { count: selectedContacts.size })}
              </span>
              <span className="text-muted-foreground mr-2 whitespace-nowrap text-sm sm:hidden">
                {t("web.contacts.selectedShort", {
                  count: selectedContacts.size,
                })}
              </span>
            </LabelComponent>
            <ButtonGroup>
              <BulkEditDialog
                workspaceId={workspaceId}
                contactIds={selectedContacts}
                onComplete={() => {
                  setSelectedContacts(new Set());
                  setIsSelectionMode(false);
                }}
                disabled={selectedContacts.size === 0}
              />
              <ButtonGroupSeparator />
              <MoveContactsDialog
                workspaceId={workspaceId}
                contactIds={selectedContacts}
                onComplete={() => {
                  setSelectedContacts(new Set());
                  setIsSelectionMode(false);
                }}
                disabled={selectedContacts.size === 0}
              />
              <ButtonGroupSeparator />
              <DeleteContactsDialog
                workspaceId={workspaceId}
                contactIds={selectedContacts}
                onComplete={() => {
                  setSelectedContacts(new Set());
                  setIsSelectionMode(false);
                }}
                disabled={selectedContacts.size === 0}
              />
            </ButtonGroup>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
