import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { auth } from "@/lib/firebase";
import { NewWorkspaceForm } from "@/routes/_protected/w.$workspaceId/settings/workspace/new";

export function NewWorkspaceModal() {
  const { t } = useTranslation();
  return (
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="mx-3">
            {t("web.workspace.new.createFirstWorkspace")}
          </DialogTitle>
        </DialogHeader>
        <NewWorkspaceForm />

        {import.meta.env.DEV && (
          <Button
            variant="outline"
            onClick={() => {
              auth.signOut();
            }}
          >
            Sign out
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
