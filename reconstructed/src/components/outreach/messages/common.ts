import { useMutation } from "@tanstack/react-query";
import { TFunction } from "i18next";
import { ComponentType } from "react";
import * as z from "zod";

import type {
  OutreachMessageContent,
  OutreachMessageContentSchema,
  OutreachSequenceMessage,
} from "@repo/core/types";

import { useCurrentWorkspace } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";

export type OutreachMessageType = NonNullable<OutreachSequenceMessage["type"]>;

export type EditComponent<T extends OutreachMessageType> = React.ComponentType<{
  value: z.input<typeof OutreachMessageContentSchema> & { type: T };
  onChange: (
    value: z.input<typeof OutreachMessageContentSchema> & { type: T }
  ) => void;
}>;
export type PreviewComponent<T extends OutreachMessageType> =
  React.ComponentType<{
    value: OutreachMessageContent & { type: T };
  }>;

export type MessageMetadata<T extends OutreachMessageType> = {
  type: T;
  icon: ComponentType<{ className?: string }>;
  label: (t: TFunction) => React.ReactNode;
  editorComponent: EditComponent<T>;
  previewComponent: PreviewComponent<T>;
  schema: z.ZodType;
};

export function useUploadMediaMutation() {
  const trpc = useTRPC();
  const workspaceId = useCurrentWorkspace((w) => w.id);
  const signedUrlMutation = useMutation(
    trpc.outreach.generateUploadSignedUrl.mutationOptions()
  );
  const uploadMutation = useMutation({
    mutationFn: async ({
      file,
      onProgressUpdate,
    }: {
      file: File;
      onProgressUpdate: (progress: number) => void;
    }) => {
      const { signedUrl, fileUrl, headers } =
        await signedUrlMutation.mutateAsync({
          workspaceId,
          fileName: file.name,
          mimeType: file.type,
          type: "media",
          public: true,
        });

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", signedUrl, true);
        xhr.setRequestHeader("Content-Type", file.type);
        for (const [key, value] of Object.entries(headers ?? {})) {
          xhr.setRequestHeader(key, value);
        }
        const THROTTLE_MS = 500;
        let lastReportAt = 0;
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const progress = event.loaded / event.total;
            const now = Date.now();
            if (now - lastReportAt >= THROTTLE_MS || progress >= 1) {
              lastReportAt = now;
              onProgressUpdate(progress);
            }
          }
        });
        xhr.addEventListener("load", function () {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(
              new Error(
                `Upload failed with status ${xhr.status}: ${xhr.statusText}`
              )
            );
          }
        });
        xhr.addEventListener("error", function () {
          reject(new Error("Network error during upload"));
        });
        xhr.send(file);
      });

      return { fileUrl };
    },
  });
  return uploadMutation;
}
