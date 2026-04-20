import { FileWarningIcon, ImageIcon, ImagePlusIcon, XIcon } from "lucide-react";
import { isEqual } from "radashi";
import { PropsWithChildren, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "react-i18next";

import {
  OutreachMediaMessageSchema,
  OutreachMessageContent,
} from "@repo/core/types";

import {
  EditComponent,
  MessageMetadata,
  PreviewComponent,
  useUploadMediaMutation,
} from "./common";
import { TelegramMessageEditor } from "@/components/ui/editor/telegram-message-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { getImageDimensions, getVideoDimensions } from "@/lib/media";

type Media = (OutreachMessageContent & { type: "media" })["media"][number];
type UploadingMedia = {
  file: File;
  state: "uploading" | "error";
  error?: string;
  progress?: number;
} & Pick<Media, "width" | "height" | "duration">;

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "video/mp4"]);

// eslint-disable-next-line react-refresh/only-export-components
function UploadMedia({
  value,
  onChange,
}: {
  value?: Array<Media>;
  onChange?: (value: Array<Media>) => void;
}) {
  const uploadMutation = useUploadMediaMutation();
  const [media, setMedia] = useState<Array<Media | UploadingMedia>>(
    value ?? []
  );

  const dropzone = useDropzone({
    accept: Object.fromEntries(
      [...ALLOWED_MIME_TYPES].map((mimeType) => [mimeType, []])
    ),
    onDrop: async (acceptedFiles) => {
      const selectedMedia = await Promise.all(
        acceptedFiles.map(async (file) => {
          const dimensions: Pick<Media, "width" | "height" | "duration"> =
            file.type.startsWith("image/")
              ? await getImageDimensions(file)
              : await getVideoDimensions(file);
          return {
            file,
            state: "uploading",
            ...dimensions,
          } satisfies UploadingMedia;
        })
      );
      setMedia((prev) => [...prev, ...selectedMedia]);

      for (const media of selectedMedia) {
        const replaceItem = (
          updateFn: (prev: UploadingMedia) => Media | UploadingMedia
        ) => {
          setMedia((prevArray) => {
            const index = prevArray.findIndex(
              (m) => "file" in m && m.file === media.file
            );
            if (index === -1) return prevArray;
            const newFiles = [...prevArray];
            newFiles[index] = updateFn(prevArray[index] as UploadingMedia);
            return newFiles;
          });
        };

        if (!ALLOWED_MIME_TYPES.has(media.file.type)) {
          replaceItem((prev) => ({
            ...prev,
            state: "error",
            error: "Unsupported file type.",
          }));
          continue;
        }

        if (
          media.file.type.startsWith("image/") &&
          media.file.size >= 1024 * 1024 * 10
        ) {
          replaceItem((prev) => ({
            ...prev,
            state: "error",
            error: "Image is too large. The maximum allowed size is 10MB.",
          }));
          continue;
        }

        if (
          media.file.type.startsWith("video/") &&
          media.file.size >= 1024 * 1024 * 512
        ) {
          replaceItem((prev) => ({
            ...prev,
            state: "error",
            error: "Video is too large. The maximum allowed size is 512MB.",
          }));
          continue;
        }

        if (media.width + media.height >= 10_000) {
          replaceItem((prev) => ({
            ...prev,
            state: "error",
            error:
              "Dimensions are too large. The total width and height must be less than 10,000 pixels.",
          }));
          continue;
        }

        if (
          media.width / media.height >= 20 ||
          media.height / media.width >= 20
        ) {
          replaceItem((prev) => ({
            ...prev,
            state: "error",
            error: "Aspect ratio is too large. Maximum allowed is 20:1.",
          }));
          continue;
        }

        uploadMutation
          .mutateAsync({
            file: media.file,
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
              mimeType: media.file.type,
              fileSize: media.file.size,
              width: media.width,
              height: media.height,
              duration: media.duration,
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
    const filteredMedia = media.filter((m) => "url" in m);
    if (!isEqual(value, filteredMedia)) {
      onChange?.(filteredMedia);
    }
  }, [value, media, onChange]);

  return (
    <div className="flex flex-wrap gap-1.5">
      {media.map((m, index) => (
        <MediaPreview key={index} media={m}>
          <button
            type="button"
            className="bg-card text-card-foreground hover:bg-destructive hover:text-destructive-foreground absolute right-1 top-1 flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover/item:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              setMedia((prev) => prev.filter((_, i) => i !== index));
            }}
          >
            <XIcon className="size-4" />
          </button>
        </MediaPreview>
      ))}
      {(value ?? []).length < 10 && (
        <div
          {...dropzone.getRootProps()}
          className="border-input bg-card hover:bg-card/60 flex size-20 items-center justify-center rounded-lg border transition-colors"
        >
          <input {...dropzone.getInputProps()} />
          <ImagePlusIcon className="text-muted-foreground size-6" />
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
function MediaPreview({
  media,
  children,
}: PropsWithChildren<{ media: Media | UploadingMedia }>) {
  const aspectRatio =
    media.width && media.height
      ? `${media.width} / ${media.height}`
      : undefined;
  return (
    <div className="group/item relative">
      {"url" in media ? (
        <>
          {media.mimeType.startsWith("image/") ? (
            <img
              src={media.url}
              alt=""
              className="bg-card h-20 max-w-40 rounded-lg object-contain"
              style={{ aspectRatio }}
            />
          ) : (
            <video
              className="bg-card h-20 max-w-40 rounded-lg"
              style={{ aspectRatio }}
              controls
            >
              <source src={media.url} type={media.mimeType} />
            </video>
          )}
        </>
      ) : (
        <>
          {media.state === "error" ? (
            <Tip
              side="bottom"
              content={
                <p className="text-destructive">
                  {media.error ?? "Failed to upload"}
                </p>
              }
            >
              <div
                className="bg-card border-destructive flex h-20 max-w-40 items-center justify-center rounded-lg border"
                style={{ aspectRatio }}
              >
                <FileWarningIcon className="text-destructive size-4" />
              </div>
            </Tip>
          ) : (
            <>
              <Skeleton
                className="h-20 max-w-40 rounded-lg border"
                style={{ aspectRatio }}
              />
              {media.progress && (
                <div className="absolute inset-0 flex items-center justify-center text-xs">
                  {Math.round(media.progress * 100)}%
                </div>
              )}
            </>
          )}
        </>
      )}
      {children}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
const Editor: EditComponent<"media"> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <UploadMedia
        value={value.media}
        onChange={(media) => onChange({ type: "media", media })}
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
const Preview: PreviewComponent<"media"> = ({ value }) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {value.media.map((m, index) => (
          <MediaPreview key={index} media={m} />
        ))}
      </div>
      {value.caption?.trim() && (
        <TelegramMessageEditor editable={false} value={value.caption} />
      )}
    </div>
  );
};

export const MediaMessageMetadata: MessageMetadata<"media"> = {
  type: "media",
  icon: ImageIcon,
  label: (t) => t("web.outreach.sequences.messageType.media"),
  editorComponent: Editor,
  previewComponent: Preview,
  schema: OutreachMediaMessageSchema,
};
