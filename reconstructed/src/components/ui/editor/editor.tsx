import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { MarkNode } from "@lexical/mark";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import {
  type InitialConfigType,
  LexicalComposer,
} from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import type { EditorState } from "lexical";
import { FocusEventHandler } from "react";

import { AutoLinkPlugin } from "./plugins/autolink";
import { ToolbarPlugin } from "./plugins/toolbar";
import { cn } from "@/lib/utils";

// Catch any errors that occur during Lexical updates and log them
// or throw them as needed. If you don't throw them, Lexical will
// try to recover gracefully without losing user data.
function onError(error: Error) {
  console.error(error);
}

export function Editor({
  editable = true,
  className,
  value,
  onChange,
  onFocus,
  autoFocus,
  placeholder,
}: {
  editable?: boolean;
  className?: string;
  value?: string;
  onFocus?: FocusEventHandler<HTMLDivElement>;
  onChange?: (value: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const initialConfig: InitialConfigType = {
    namespace: "MarkdownEditor",
    onError,
    nodes: [
      MarkNode,
      HeadingNode,
      QuoteNode,
      AutoLinkNode,
      LinkNode,
      ListNode,
      ListItemNode,
    ],
    editorState: () => $convertFromMarkdownString(value ?? "", TRANSFORMERS),
    editable,
  };

  function _onChange(state: EditorState) {
    state.read(() => {
      const markdown = $convertToMarkdownString(TRANSFORMERS);
      onChange?.(markdown);
    });
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              onFocus={onFocus}
              className={cn(
                "prose dark:prose-invert w-full max-w-none text-sm",
                editable &&
                  "border-input bg-card ring-offset-background focus-visible:ring-ring min-h-[120px] rounded-md border px-3 pb-12 pt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                className
              )}
            />
          }
          placeholder={
            <div className="prose dark:prose-invert text-muted-foreground pointer-events-none absolute left-3 top-2 inline-block max-w-none select-none overflow-hidden text-sm">
              {placeholder ?? ""}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        {editable && (
          <>
            {onChange && <OnChangePlugin onChange={_onChange} />}
            <ToolbarPlugin className="absolute bottom-1 left-1.5" />
            <HistoryPlugin />
          </>
        )}
        <LinkPlugin />
        <AutoLinkPlugin />
        {autoFocus && <AutoFocusPlugin />}
      </div>
    </LexicalComposer>
  );
}

export function MarkdownPreview({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return <Editor editable={false} value={value} className={className} />;
}
