import { useMutation } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { m } from "motion/react";
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { OutreachListWithId } from "@repo/core/types";
import { parseCsv } from "@repo/csv-parse";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Combobox } from "@/components/ui/combobox";
import { FileSelector } from "@/components/ui/file-selector";
import { MainButton } from "@/components/ui/main-button";
import { Section, SectionHeader } from "@/components/ui/section";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TelegramLinkItem } from "@/features/outreach/sequences/telegram-link-item";
import { orpc } from "@/lib/orpc";
import { useCurrentWorkspace } from "@/lib/store";
import { cn } from "@/lib/utils";

interface Preview {
  header: string[];
  data: Record<string, string>[];
}

export function NewCsvList({
  onNewListCreated,
}: {
  onNewListCreated: (
    list: Omit<OutreachListWithId, "createdAt" | "updatedAt">
  ) => void;
}) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((w) => w.id);
  const [file, setFile] = useState<File | null>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [usernameColumn, setUsernameColumn] = useState<string | null>(null);
  const [phoneColumn, setPhoneColumn] = useState<string | null>(null);

  const [emptyHeaderColumnWarning, setEmptyHeaderColumnWarning] =
    useState(false);

  const { mutateAsync, isPending, isSuccess } = useMutation(
    orpc.outreach.lists.uploadCsvList.mutationOptions()
  );

  useEffect(() => {
    void import("jschardet");
  }, []);

  const handleFileChange = async (file: File | null) => {
    if (!file) {
      setFile(null);
      setPreview(null);
      setUsernameColumn(null);
      setPhoneColumn(null);
      return;
    }

    if (!file.name.endsWith(".csv")) {
      toast.error(t("web.outreach.list.csv.pleaseUploadCsv"));
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      const jschardet = await import("jschardet");
      const binaryString = Array.from(bytes, (b) =>
        String.fromCodePoint(b)
      ).join("");
      const detected = jschardet.detect(binaryString);
      const encoding = detected?.encoding || "utf8";

      let decoder: TextDecoder;
      try {
        decoder = new TextDecoder(encoding);
      } catch {
        decoder = new TextDecoder("utf8");
      }

      const csvString = decoder.decode(bytes);

      const rows: Record<string, string>[] = [];
      for await (const row of parseCsv(csvString, { maxRows: 10 })) {
        rows.push(row);
      }

      setFile(new File([csvString], file.name, { type: "text/csv" }));

      const rawColumns = rows.length > 0 ? Object.keys(rows[0]!) : [];
      const columns = rawColumns
        .map((h) => h.replace(/^__(.+)__$/, "_$1_"))
        .filter((h) => h.trim() !== "");
      setEmptyHeaderColumnWarning(columns.length !== rawColumns.length);

      setPreview({
        header: columns,
        data: rows,
      });
    } catch {
      toast.error(t("web.outreach.list.csv.pleaseUploadCsv"));
    }
  };

  return (
    <div className="mx-3 flex flex-col gap-4">
      <FileSelector
        className="mx-auto w-full max-w-md"
        file={file}
        onChange={handleFileChange}
        text={t("web.outreach.list.csv.uploadCsvLeads")}
      />
      {preview && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex flex-col gap-4"
        >
          <Section className="mx-auto w-full max-w-md">
            <div className="bg-card rounded-lg border p-3">
              <h2 className="mb-1 text-sm font-medium">
                {t("web.outreach.list.csv.selectColumns")}
              </h2>
              <span className="text-muted-foreground text-sm font-normal">
                {t("web.outreach.list.csv.selectColumnsDescription")}
              </span>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label
                    className="text-muted-foreground text-sm"
                    htmlFor="usernameColumn"
                  >
                    {t("web.outreach.list.csv.usernameColumn")}
                  </label>

                  <Combobox
                    id="usernameColumn"
                    value={usernameColumn}
                    onChange={(value) =>
                      setUsernameColumn(value === "none" ? null : value)
                    }
                    options={[
                      { label: t("web.outreach.list.csv.none"), value: "none" },
                      ...preview.header.map((column) => ({
                        label: column,
                        value: column,
                      })),
                    ]}
                    renderListItem={(option) => (
                      <span
                        className={cn(
                          option.value === "none" && "text-muted-foreground"
                        )}
                      >
                        {option.label}
                      </span>
                    )}
                    placeholder={t("web.outreach.list.csv.none")}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label
                    className="text-muted-foreground text-sm"
                    htmlFor="phoneColumn"
                  >
                    {t("web.outreach.list.csv.phoneColumn")}
                  </label>
                  <Combobox
                    id="phoneColumn"
                    value={phoneColumn}
                    onChange={(value) =>
                      setPhoneColumn(value === "none" ? null : value)
                    }
                    options={[
                      {
                        label: t("web.outreach.list.csv.none"),
                        value: "none",
                      },
                      ...preview.header.map((column) => ({
                        label: column,
                        value: column,
                      })),
                    ]}
                    renderListItem={(option) => (
                      <span
                        className={cn(
                          option.value === "none" && "text-muted-foreground"
                        )}
                      >
                        {option.label}
                      </span>
                    )}
                    placeholder={t("web.outreach.list.csv.none")}
                  />
                </div>
              </div>
            </div>
          </Section>
          {phoneColumn && (
            <Alert
              variant="warning"
              size="small"
              className="mx-auto w-full max-w-md"
            >
              <AlertTitle className="flex items-center gap-2 text-sm font-medium">
                <TriangleAlert className="size-4 shrink-0" />
                <span className="font-medium">
                  {t("web.outreach.list.csv.phoneLimitations.title")}
                </span>
              </AlertTitle>
              <AlertDescription className="flex flex-col gap-1">
                <div className="flex items-center gap-2"></div>
                <ul className="ml-10 list-outside list-disc">
                  <li>
                    {t(
                      "web.outreach.list.csv.phoneLimitations.noDuplicateDetection"
                    )}
                  </li>
                  <li>
                    {t(
                      "web.outreach.list.csv.phoneLimitations.privacySettings"
                    )}
                  </li>
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {emptyHeaderColumnWarning && (
            <Alert variant="warning" size="small">
              <AlertTitle className="sr-only">
                {t("web.outreach.list.csv.warning")}
              </AlertTitle>
              <AlertDescription className="flex items-center gap-2">
                <TriangleAlert className="size-4" />
                {t("web.outreach.list.csv.columnsWithoutHeader")}
              </AlertDescription>
            </Alert>
          )}
          <Section>
            <SectionHeader className="mx-auto w-full max-w-md px-3">
              {t("web.outreach.list.csv.preview")}
            </SectionHeader>
            <div className="hidden">
              {/* Preload TelegramLinkItem to avoid page flickering */}
              <Suspense>
                <TelegramLinkItem />
              </Suspense>
            </div>
            <Table containerClassName="bg-card border rounded-lg max-h-[300px] mx-auto max-w-fit">
              <TableHeader className="bg-accent sticky top-0">
                <TableRow>
                  {preview.header.map((column) => (
                    <TableHead key={column}>{column}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.data.map((row, i) => (
                  <TableRow key={i}>
                    {preview.header.map((column) => (
                      <TableCell
                        key={column}
                        className="whitespace-pre align-top"
                      >
                        {column === usernameColumn ? (
                          <TelegramLinkItem username={row[column] ?? ""} />
                        ) : column === phoneColumn ? (
                          <TelegramLinkItem phone={row[column] ?? ""} />
                        ) : (
                          row[column]
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        </m.div>
      )}
      {file && (
        <MainButton
          className="mx-auto w-full max-w-md"
          loading={isPending || isSuccess}
          onClick={async () => {
            if (!file || !preview || (!usernameColumn && !phoneColumn)) {
              toast.error(t("web.outreach.list.csv.pleaseSelectColumn"));
              return;
            }

            const { data: list } = await mutateAsync({
              params: { workspaceId },
              body: {
                file: file,
                ...(usernameColumn && { usernameColumn }),
                ...(phoneColumn && { phoneColumn }),
              },
            });

            onNewListCreated(list);
          }}
        >
          {t("web.outreach.list.csv.continue")}
        </MainButton>
      )}
    </div>
  );
}
