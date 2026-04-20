import { FileUp, X } from "lucide-react";
import { m } from "motion/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, buttonVariants } from "./button";
import { SectionHeader } from "./section";
import csvIcon from "@/assets/csv-icon.svg";
import { cn } from "@/lib/utils";

export function FileSelector({
  accept,
  text,
  file,
  onChange,
  className,
}: {
  accept?: string;
  text?: string;
  file: File | null;
  onChange: (file: File | null) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [isOver, setIsOver] = useState(false);

  const handleFileSelect = (file: File | null) => {
    onChange(file);
    setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOver(true);
  };

  const handleDragLeave = () => {
    setIsOver(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  return (
    <div className={className}>
      {file && (
        <SectionHeader>{t("web.fileSelector.selectedFile")}</SectionHeader>
      )}
      <m.div
        layoutId="file-selector"
        className={cn(
          "bg-card group rounded-lg text-center transition-colors",
          file && "border",
          !file && "cursor-pointer border-2 border-dashed",
          !file && isOver && "border-primary"
        )}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {file ? (
          <m.div
            layoutId="file-selector-file"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex items-center justify-start gap-4 px-4 py-2 font-medium"
          >
            <img src={csvIcon} alt="CSV icon" className="size-6" />
            <p className="truncate">{file.name}</p>

            <Button
              variant="ghost"
              size="icon"
              className="-mr-2 ml-auto"
              onClick={() => handleFileSelect(null)}
            >
              <X className="size-4" />
              <span className="sr-only">
                {t("web.fileSelector.selectAnotherFile")}
              </span>
            </Button>
          </m.div>
        ) : (
          <label
            htmlFor="file-upload"
            className="flex min-h-32 flex-col items-center justify-center gap-4 p-6"
          >
            <input
              type="file"
              accept={accept}
              onChange={handleChange}
              className="hidden"
              id="file-upload"
            />
            <FileUp className="text-muted-foreground size-8" />
            <div className="text-sm">
              {isOver ? (
                <p>{t("web.fileSelector.dropFileHere")}</p>
              ) : (
                <p>{text ?? t("web.fileSelector.dragAndDropFile")}</p>
              )}
            </div>
            <div
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className:
                  "bg-card group-hover:bg-accent group-hover:text-accent-foreground",
              })}
            >
              <p>{t("web.fileSelector.selectFile")}</p>
            </div>
          </label>
        )}
      </m.div>
    </div>
  );
}
