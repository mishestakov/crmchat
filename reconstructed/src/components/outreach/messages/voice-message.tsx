import {
  FileWarningIcon,
  LoaderCircleIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { isEqual, tryit } from "radashi";
import { PropsWithChildren, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  OutreachMessageContent,
  OutreachVoiceMessageSchema,
} from "@repo/core/types";

import {
  EditComponent,
  MessageMetadata,
  PreviewComponent,
  useUploadMediaMutation,
} from "./common";
import { Slider } from "@/components/ui/slider";
import { Tip } from "@/components/ui/tooltip";
import { getAudioDuration } from "@/lib/media";

type Voice = (OutreachMessageContent & { type: "voice" })["voice"];
type UploadingVoice = {
  file: File;
  state: "uploading" | "error";
  error?: string;
  progress?: number;
} & Pick<Voice, "duration">;

const ALLOWED_MIME_TYPES = new Set([
  "audio/ogg",
  "application/ogg",
  "audio/mpeg",
  "audio/mp4",
]);

// eslint-disable-next-line react-refresh/only-export-components
function UploadVoice({
  value,
  onChange,
}: {
  value?: Voice;
  onChange?: (value: Voice | undefined) => void;
}) {
  const { t } = useTranslation();

  const uploadMutation = useUploadMediaMutation();
  const [voice, setVoice] = useState<Voice | UploadingVoice | undefined>(value);

  const dropzone = useDropzone({
    maxFiles: 1,
    accept: Object.fromEntries(
      [...ALLOWED_MIME_TYPES].map((mimeType) => [mimeType, []])
    ),
    onDrop: async (acceptedFiles, rejections) => {
      for (const rejection of rejections) {
        if (rejection.errors[0]) {
          toast.error(rejection.errors[0].message);
        }
      }

      const file = acceptedFiles[0];
      if (!file) {
        console.error("No file selected", acceptedFiles, rejections);
        return;
      }

      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        setVoice({
          file,
          duration: 0,
          state: "error",
          error: "Unsupported file type.",
        });
        return;
      }

      const [err, duration] = await tryit(getAudioDuration)(file);
      if (err) {
        setVoice({
          file,
          duration: 0,
          state: "error",
          error: "Failed to get audio duration.",
        });
        return;
      }

      if (file.size >= 1024 * 1024 * 10) {
        setVoice({
          file,
          duration,
          state: "error",
          error: "File is too large. The maximum allowed size is 10MB.",
        });
        return;
      }

      setVoice({
        file,
        state: "uploading",
        duration,
      });

      try {
        const data = await uploadMutation.mutateAsync({
          file,
          onProgressUpdate: (progress) => {
            setVoice({
              file,
              state: "uploading",
              duration,
              progress,
            });
          },
        });
        setVoice({
          url: data.fileUrl,
          mimeType: file.type,
          fileSize: file.size,
          duration,
        });
      } catch {
        setVoice({ file, duration, state: "error" });
      }
    },
  });

  useEffect(() => {
    if (voice && "state" in voice) return;
    const target = voice && "url" in voice ? voice : undefined;
    if (!isEqual(value, target)) {
      onChange?.(target);
    }
  }, [value, voice, onChange]);

  return (
    <div className="flex flex-col gap-1.5">
      {!voice || ("url" in voice && !voice.url) ? (
        <div
          {...dropzone.getRootProps()}
          className="border-input bg-card hover:bg-card/60 flex h-16 items-center gap-2 rounded-lg border px-3 py-1 transition-colors"
        >
          <input {...dropzone.getInputProps()} />
          <div className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-full">
            <PlusIcon className="text-muted-foreground size-5" />
          </div>
          <span className="text-sm font-medium">
            {t("web.outreach.sequences.index.uploadVoice")}
          </span>
        </div>
      ) : (
        <VoicePreview voice={voice}>
          <button
            type="button"
            className="text-card-foreground hover:bg-destructive hover:text-destructive-foreground absolute right-1 top-1 flex size-5 items-center justify-center rounded bg-transparent opacity-0 transition-opacity group-hover/item:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              setVoice(undefined);
            }}
          >
            <XIcon className="size-4" />
          </button>
        </VoicePreview>
      )}
    </div>
  );
}

const formatTime = (time: number) => {
  if (Number.isNaN(time)) return "0:00";
  const m = Math.floor(time / 60);
  const s = Math.floor(time % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
};

// eslint-disable-next-line react-refresh/only-export-components
function VoicePreview({
  voice,
  children,
}: PropsWithChildren<{ voice: Voice | UploadingVoice }>) {
  return (
    <div className="group/item relative">
      {"url" in voice ? (
        <AudioPlayer url={voice.url} mimeType={voice.mimeType} />
      ) : (
        <>
          {voice.state === "error" ? (
            <Tip
              side="bottom"
              content={
                <p className="text-destructive">
                  {voice.error ?? "Failed to upload"}
                </p>
              }
            >
              <div className="bg-card border-destructive flex h-20 max-w-40 items-center justify-center rounded-lg border">
                <FileWarningIcon className="text-destructive size-4" />
              </div>
            </Tip>
          ) : (
            <div className="border-input bg-card hover:bg-card/60 flex items-center gap-2 rounded-lg border p-3 transition-colors">
              <div className="bg-accent flex size-10 shrink-0 items-center justify-center rounded-full">
                <LoaderCircleIcon className="text-accent-foreground size-5 animate-spin" />
              </div>
              {voice.progress && (
                <span className="text-muted-foreground text-xs">
                  {Math.round(voice.progress * 100)}%
                </span>
              )}
            </div>
          )}
        </>
      )}
      {children}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
function AudioPlayer({
  url,
  mimeType,
}: {
  url: string | undefined;
  mimeType: string;
}) {
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audioEl = new Audio(url);
    setAudio(audioEl);

    const handleLoadedMetadata = () => {
      setDuration(audioEl.duration);
    };

    const handleTimeUpdate = () => {
      setProgress(audioEl.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setProgress(audioEl.duration);
    };

    audioEl.addEventListener("loadedmetadata", handleLoadedMetadata);
    audioEl.addEventListener("timeupdate", handleTimeUpdate);
    audioEl.addEventListener("ended", handleEnded);

    return () => {
      audioEl.pause();
      audioEl.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audioEl.removeEventListener("timeupdate", handleTimeUpdate);
      audioEl.removeEventListener("ended", handleEnded);
    };
  }, [url]);

  useEffect(() => {
    if (!audio) return;
    if (isPlaying) {
      audio.play();
    } else {
      audio.pause();
    }
  }, [isPlaying, audio]);

  return (
    <div className="border-input bg-card hover:bg-card/60 relative flex h-16 items-center gap-2 rounded-lg border px-3 py-1 transition-colors">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (audio?.canPlayType(mimeType)) {
            setIsPlaying((p) => !p);
          } else {
            toast.error("Your browser does not support this audio format.");
          }
        }}
        className="bg-primary flex size-10 shrink-0 items-center justify-center rounded-full"
      >
        {isPlaying ? (
          <PauseIcon className="text-primary-foreground size-5" />
        ) : (
          <PlayIcon className="text-primary-foreground size-5" />
        )}
      </button>
      <Slider
        min={0}
        max={duration || undefined}
        step={0.01}
        value={[progress]}
        onClick={(e) => {
          e.stopPropagation();
        }}
        onValueChange={([newTime]) => {
          if (!audio) return;
          audio.currentTime = newTime!;
          setProgress(newTime!);
        }}
      />
      <div className="text-muted-foreground absolute bottom-3 right-3 h-3 text-right text-xs">
        {formatTime(progress)} / {formatTime(duration)}
      </div>
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
const Editor: EditComponent<"voice"> = ({ value, onChange }) => {
  return (
    <UploadVoice
      value={value.voice}
      onChange={(voice) => onChange({ type: "voice", voice })}
    />
  );
};

// eslint-disable-next-line react-refresh/only-export-components
const Preview: PreviewComponent<"voice"> = ({ value }) => {
  return <AudioPlayer url={value.voice.url} mimeType={value.voice.mimeType} />;
};

export const VoiceMessageMetadata: MessageMetadata<"voice"> = {
  type: "voice",
  icon: MicIcon,
  label: (t) => t("web.outreach.sequences.messageType.voice"),
  editorComponent: Editor,
  previewComponent: Preview,
  schema: OutreachVoiceMessageSchema,
};
