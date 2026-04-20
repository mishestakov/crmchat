import {
  FileIcon,
  FileWarningIcon,
  LoaderCircleIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { isEqual } from "radashi";
import { PropsWithChildren, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "react-i18next";

import {
  OutreachDocumentMessageSchema,
  OutreachMessageContent,
} from "@repo/core/types";

import {
  EditComponent,
  MessageMetadata,
  PreviewComponent,
  useUploadMediaMutation,
} from "./common";
import { TelegramMessageEditor } from "@/components/ui/editor/telegram-message-editor";
import { Tip } from "@/components/ui/tooltip";

type Document = (OutreachMessageContent & {
  type: "document";
})["documents"][number];
type UploadingDocument = {
  file: File;
  state: "uploading" | "error";
  error?: string;
  progress?: number;
};

// eslint-disable-next-line react-refresh/only-export-components
function UploadDocuments({
  value,
  onChange,
}: {
  value?: Array<Document>;
  onChange?: (value: Array<Document>) => void;
}) {
  const uploadMutation = useUploadMediaMutation();
  const [documents, setDocuments] = useState<
    Array<Document | UploadingDocument>
  >(value ?? []);

  const dropzone = useDropzone({
    onDrop: async (acceptedFiles) => {
      const selectedDocuments = acceptedFiles.map(
        (file) =>
          ({
            file,
            state: "uploading",
          }) satisfies UploadingDocument
      );

      setDocuments((prev) => [...prev, ...selectedDocuments]);

      for (const document of selectedDocuments) {
        const replaceItem = (
          updateFn: (prev: UploadingDocument) => Document | UploadingDocument
        ) => {
          setDocuments((prevArray) => {
            const index = prevArray.findIndex(
              (m) => "file" in m && m.file === document.file
            );
            if (index === -1) return prevArray;
            const newFiles = [...prevArray];
            newFiles[index] = updateFn(prevArray[index] as UploadingDocument);
            return newFiles;
          });
        };

        if (document.file.size >= 1024 * 1024 * 512) {
          replaceItem((prev) => ({
            ...prev,
            state: "error",
            error: "File is too large. The maximum allowed size is 512MB.",
          }));
          continue;
        }

        uploadMutation
          .mutateAsync({
            file: document.file,
            onProgressUpdate: (progress) => {
              replaceItem((prev) => ({
                ...prev,
                state: "uploading",
                progress,
              }));
            },
          })
          .then((data) => {
            replaceItem(() => ({
              url: data.fileUrl,
              mimeType: document.file.type,
              fileName: document.file.name,
              fileSize: document.file.size,
            }));
          })
          .catch(() => {
            replaceItem((prev) => ({
              ...prev,
              state: "error",
            }));
          });
      }
    },
  });

  useEffect(() => {
    const filteredDocuments = documents.filter((d) => "url" in d);
    if (!isEqual(value, filteredDocuments)) {
      onChange?.(documents.filter((d) => "url" in d));
    }
  }, [value, documents, onChange]);

  return (
    <div className="flex flex-col gap-1">
      {documents.map((d, index) => (
        <DocumentPreview key={index} document={d}>
          <button
            type="button"
            className="text-card-foreground hover:bg-destructive hover:text-destructive-foreground absolute right-1 top-1 flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover/item:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              setDocuments((prev) => prev.filter((_, i) => i !== index));
            }}
          >
            <XIcon className="size-4" />
          </button>
        </DocumentPreview>
      ))}
      {(value ?? []).length < 10 && (
        <div
          {...dropzone.getRootProps()}
          className="border-input bg-card hover:bg-card/60 flex items-center gap-2 rounded-lg border p-3 transition-colors"
        >
          <input {...dropzone.getInputProps()} />
          <div className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-full">
            <PlusIcon className="text-muted-foreground size-5" />
          </div>
          <span className="text-sm font-medium">Upload file</span>
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
function DocumentPreview({
  document,
  children,
}: PropsWithChildren<{ document: Document | UploadingDocument }>) {
  return (
    <div className="group/item relative">
      {"url" in document ? (
        <div className="border-input bg-card hover:bg-card/60 flex items-center gap-2 rounded-lg border p-3 transition-colors">
          <div className="bg-primary flex size-10 shrink-0 items-center justify-center rounded-full">
            <FileIcon className="text-primary-foreground ml-0.5 size-5" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-sm font-medium">
              {document.fileName}
            </span>
            <span className="text-muted-foreground text-xs">
              {Math.round(document.fileSize / 1024 / 1024)} MB
            </span>
          </div>
        </div>
      ) : (
        <>
          {document.state === "error" ? (
            <Tip
              side="bottom"
              content={
                <p className="text-destructive">
                  {document.error ?? "Failed to upload"}
                </p>
              }
            >
              <div className="border-destructive bg-card hover:bg-card/60 flex min-w-0 items-center gap-2 rounded-lg border p-3 transition-colors">
                <div className="bg-destructive flex size-10 shrink-0 items-center justify-center rounded-full">
                  <FileWarningIcon className="text-destructive-foreground size-5" />
                </div>
                <span className="truncate text-sm font-medium">
                  {document.file.name}
                </span>
              </div>
            </Tip>
          ) : (
            <div className="border-input bg-card hover:bg-card/60 flex items-center gap-2 rounded-lg border p-3 transition-colors">
              <div className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-full">
                <LoaderCircleIcon className="text-accent-foreground size-5 animate-spin" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-sm font-medium">
                  {document.file.name}
                </span>
                {document.progress && (
                  <span className="text-muted-foreground text-xs">
                    {Math.round(document.progress * 100)}%
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {children}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
const Editor: EditComponent<"document"> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <UploadDocuments
        value={value.documents}
        onChange={(documents) => onChange({ ...value, documents })}
      />
      <TelegramMessageEditor
        className="min-h-[80px]"
        value={value.caption ?? ""}
        placeholder={t("web.outreach.sequences.addCaptionPlaceholder")}
        onChange={(text) => onChange({ ...value, caption: text })}
      />
    </div>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
const Preview: PreviewComponent<"document"> = ({ value }) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        {value.documents.map((d, index) => (
          <DocumentPreview key={index} document={d} />
        ))}
      </div>
      {value.caption?.trim() && (
        <TelegramMessageEditor editable={false} value={value.caption} />
      )}
    </div>
  );
};

export const DocumentMessageMetadata: MessageMetadata<"document"> = {
  type: "document",
  icon: FileIcon,
  label: (t) => t("web.outreach.sequences.messageType.document"),
  editorComponent: Editor,
  previewComponent: Preview,
  schema: OutreachDocumentMessageSchema,
};
