import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $createLineBreakNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  INSERT_PARAGRAPH_COMMAND,
  ParagraphNode,
} from "lexical";
import { useEffect } from "react";

function $normalizeParagraphs() {
  let firstParagraph: ParagraphNode | null = null;
  for (const child of $getRoot().getChildren()) {
    if ($isParagraphNode(child)) {
      // eslint-disable-next-line unicorn/no-negated-condition
      if (!firstParagraph) {
        firstParagraph = child;
      } else {
        child.remove();
        firstParagraph.append($createLineBreakNode(), ...child.getChildren());
      }
    }
  }
}

export default function AvoidParagraphNodePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        INSERT_PARAGRAPH_COMMAND,
        () => {
          editor.update(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              selection.insertLineBreak();
            }
          });
          return true;
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerNodeTransform(ParagraphNode, () => {
        $normalizeParagraphs();
      })
    );
  }, [editor]);

  return null;
}
