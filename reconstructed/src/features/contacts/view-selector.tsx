import {
  ChevronDownIcon,
  EllipsisIcon,
  PencilIcon,
  TrashIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { View } from "@repo/core/types";

import { DeleteViewDialog } from "./delete-view-dialog";
import { RenameViewDialog } from "./rename-view-dialog";
import { ViewIcon } from "./view-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useView, useViews } from "@/hooks/useViews";
import { cn } from "@/lib/utils";

export function ViewSelector({
  className,
  value,
  onSelect,
}: {
  className?: string;
  value: string;
  onSelect: (id: string) => void;
}) {
  const { views } = useViews("contacts");
  const view = useView("contacts", value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="card"
          className={cn("group flex items-center px-3", className)}
        >
          <ViewIcon view={view} className="text-muted-foreground size-4" />

          {view.name}
          <ChevronDownIcon className="text-muted-foreground ml-1 size-4 transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={view.id}
          onValueChange={(value) => onSelect(value)}
        >
          {views.map((v) => (
            <ViewSelectorItem key={v.id} view={v} />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ViewSelectorItem({ view }: { view: View }) {
  const { t } = useTranslation();
  const [subMenuOpen, setSubMenuOpen] = useState(false);
  const canDelete = view.id !== "list" && view.id !== "pipeline";

  return (
    <div className="relative">
      <DropdownMenuRadioItem
        key={view.id}
        value={view.id}
        className="group pr-20"
        indicatorClassName="right-9"
        onSelect={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const direction = e.key === "ArrowDown" ? 1 : -1;
            const currentItem = e.currentTarget;
            const parentContainer = currentItem.closest('[role="menu"]');
            if (parentContainer) {
              const items = [
                ...parentContainer.querySelectorAll('[role="menuitemradio"]'),
              ];
              const currentIndex = items.indexOf(currentItem);
              const nextItem = items[currentIndex + direction] as HTMLElement;
              if (nextItem) {
                nextItem.focus();
              }
            }
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            const nextItem = e.currentTarget?.nextElementSibling as HTMLElement;
            if (nextItem) {
              nextItem.focus();
              const evt = new KeyboardEvent("keydown", {
                key: "ArrowRight",
                bubbles: true,
              });
              nextItem.dispatchEvent(evt);
            }
          }
        }}
      >
        <ViewIcon view={view} className="text-muted-foreground mr-2 size-4" />
        {view.name}
      </DropdownMenuRadioItem>
      <DropdownMenuSub open={subMenuOpen} onOpenChange={setSubMenuOpen}>
        <DropdownMenuSubTrigger
          chevron={false}
          className="absolute bottom-0 right-0 top-0"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              e.stopPropagation();
              const nextItem = e.currentTarget
                ?.previousElementSibling as HTMLElement;
              if (nextItem) {
                nextItem.focus();
              }
            }
          }}
        >
          <EllipsisIcon className="text-muted-foreground size-4" />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <RenameViewDialog
            view={view}
            onAfterSave={() => setSubMenuOpen(false)}
          >
            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
              <PencilIcon className="text-muted-foreground size-4" />
              <span>{t("web.contacts.view.selector.rename")}</span>
            </DropdownMenuItem>
          </RenameViewDialog>
          {canDelete && (
            <DeleteViewDialog
              view={view}
              onAfterSave={() => setSubMenuOpen(false)}
            >
              <DropdownMenuItem
                className="text-destructive focus:text-destructive focus:bg-destructive/10"
                onSelect={(e) => e.preventDefault()}
              >
                <TrashIcon className="text-destructive/70 size-4" />
                <span>{t("web.contacts.view.selector.delete")}</span>
              </DropdownMenuItem>
            </DeleteViewDialog>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </div>
  );
}
