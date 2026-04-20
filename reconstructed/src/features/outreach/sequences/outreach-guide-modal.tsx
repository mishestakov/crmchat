import { PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function OutreachGuideModal({ children }: PropsWithChildren) {
  const { t } = useTranslation();

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader className="space-y-2">
          <DialogTitle>{t("web.outreach.guide.title")}</DialogTitle>
          <DialogDescription>
            {t("web.outreach.guide.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <GuideItem
            number={1}
            text={t("web.outreach.guide.steps.premium.text")}
            linkUrl={t("web.outreach.guide.steps.premium.linkUrl")}
            linkText={t("web.outreach.guide.steps.premium.linkText")}
          />
          <GuideItem
            number={2}
            text={t("web.outreach.guide.steps.warmup.text")}
            linkUrl={t("web.outreach.guide.steps.warmup.linkUrl")}
            linkText={t("web.outreach.guide.steps.warmup.linkText")}
          />
          <GuideItem number={3} text={t("web.outreach.guide.steps.limits")} />
          <GuideItem
            number={4}
            text={t("web.outreach.guide.steps.spintax.text")}
            linkUrl={t("web.outreach.guide.steps.spintax.linkUrl")}
            linkText={t("web.outreach.guide.steps.spintax.linkText")}
          />
          <GuideItem
            number={5}
            text={t("web.outreach.guide.steps.optout.text")}
            linkUrl={t("web.outreach.guide.steps.optout.linkUrl")}
            linkText={t("web.outreach.guide.steps.optout.linkText")}
          />
          <GuideItem
            number={6}
            text={t("web.outreach.guide.steps.bestPractices.text")}
            linkUrl={t("web.outreach.guide.steps.bestPractices.linkUrl")}
            linkText={t("web.outreach.guide.steps.bestPractices.linkText")}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">{t("web.outreach.guide.gotIt")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GuideItem({
  number,
  text,
  linkUrl,
  linkText,
}: {
  number: number;
  text: string;
  linkUrl?: string;
  linkText?: string;
}) {
  return (
    <div className="flex gap-3 text-sm">
      <div className="bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium">
        {number}
      </div>
      <div>
        {text}{" "}
        {linkUrl && linkText && (
          <a
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {linkText}
          </a>
        )}
      </div>
    </div>
  );
}
