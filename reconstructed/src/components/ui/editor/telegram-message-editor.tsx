import { AutoLinkNode, LinkNode } from "@lexical/link";
import { MarkNode } from "@lexical/mark";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CODE,
  LINK,
  QUOTE,
  TEXT_FORMAT_TRANSFORMERS,
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
import { QuoteNode } from "@lexical/rich-text";
import type { EditorState } from "lexical";
import { FocusEventHandler } from "react";

import { AutoLinkPlugin } from "./plugins/autolink";
import AvoidParagraphNodePlugin from "./plugins/avoid-paragraphs";
import { SpintaxNode } from "./plugins/spintax/spintax-node";
import SpintaxPlugin from "./plugins/spintax/spintax-plugin";
import { TextVariableNode } from "./plugins/text-variables/text-variable-node";
import TextVariablesSuggestionPlugin from "./plugins/text-variables/text-variables-plugin";
import { ToolbarPlugin } from "./plugins/toolbar";
import { cn } from "@/lib/utils";

// Catch any errors that occur during Lexical updates and log them
// or throw them as needed. If you don't throw them, Lexical will
// try to recover gracefully without losing user data.
function onError(error: Error) {
  console.error(error);
}

const TRANSFORMERS = [QUOTE, CODE, LINK, ...TEXT_FORMAT_TRANSFORMERS];

export function TelegramMessageEditor({
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
    namespace: "TelegramMessageEditor",
    onError,
    nodes: [
      MarkNode,
      QuoteNode,
      AutoLinkNode,
      LinkNode,
      TextVariableNode,
      SpintaxNode,
    ],
    editorState: () =>
      $convertFromMarkdownString(value ?? "", TRANSFORMERS, undefined, true),
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
                "prose dark:prose-invert first:prose-p:!mt-0 prose-p:!mt-5 w-full max-w-none text-sm",
                "border-input bg-card rounded-md border px-3 py-2",
                editable &&
                  "ring-offset-background focus-visible:ring-ring min-h-[120px] pb-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
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
            <ToolbarPlugin
              className="absolute bottom-1 left-1.5"
              hasVariables
            />
            <HistoryPlugin />
          </>
        )}
        <LinkPlugin />
        <AutoLinkPlugin />
        <AvoidParagraphNodePlugin />
        {autoFocus && <AutoFocusPlugin />}
        <SpintaxPlugin />
        <TextVariablesSuggestionPlugin />
      </div>
    </LexicalComposer>
  );
}

export function TelegramMessagePreview({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <TelegramMessageEditor
      editable={false}
      value={value}
      className={className}
    />
  );
}
