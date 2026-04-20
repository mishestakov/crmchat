import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import { Bold, Braces, Italic } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Toggle } from "../../toggle";

const LowPriority = 1;

export function ToolbarPlugin({
  className,
  hasVariables,
}: {
  className?: string;
  hasVariables?: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isCode, setIsCode] = useState(false);

  const $updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      // Update text format
      setIsBold(selection.hasFormat("bold"));
      setIsItalic(selection.hasFormat("italic"));
      setIsCode(selection.hasFormat("code"));
    }
  }, []);

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          $updateToolbar();
        });
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        (_payload, _newEditor) => {
          $updateToolbar();
          return false;
        },
        LowPriority
      )
    );
  }, [editor, $updateToolbar]);

  return (
    <div className={className}>
      <Toggle
        aria-label="Format bold"
        pressed={isBold}
        onPressedChange={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold");
        }}
      >
        <Bold className="size-4" />
      </Toggle>
      <Toggle
        aria-label="Format italic"
        pressed={isItalic}
        onPressedChange={() => {
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic");
        }}
      >
        <Italic className="size-4" />
      </Toggle>
      {hasVariables && (
        <Toggle
          aria-label="Insert variable"
          pressed={isCode}
          onPressedChange={() => {
            editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, " {");
          }}
        >
          <Braces className="size-4" />
        </Toggle>
      )}
    </div>
  );
}
