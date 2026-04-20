import { AlignLeftIcon } from "lucide-react";

import { OutreachTextMessageSchema } from "@repo/core/types";

import { EditComponent, MessageMetadata, PreviewComponent } from "./common";
import { TelegramMessageEditor } from "@/components/ui/editor/telegram-message-editor";

// eslint-disable-next-line react-refresh/only-export-components
const TextMessageEditor: EditComponent<"text"> = ({ value, onChange }) => {
  return (
    <TelegramMessageEditor
      value={value.text ?? ""}
      onChange={(text) => onChange({ ...value, text })}
    />
  );
};

// eslint-disable-next-line react-refresh/only-export-components
const TextMessagePreview: PreviewComponent<"text"> = ({ value }) => {
  return <TelegramMessageEditor editable={false} value={value.text ?? ""} />;
};

export const TextMessageMetadata: MessageMetadata<"text"> = {
  type: "text",
  icon: AlignLeftIcon,
  label: (t) => t("web.outreach.sequences.messageType.text"),
  editorComponent: TextMessageEditor,
  previewComponent: TextMessagePreview,
  schema: OutreachTextMessageSchema,
};
