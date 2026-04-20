import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  TextNode,
} from "lexical";
import { useEffect } from "react";

import {
  $createSpintaxNode,
  $isSpintaxNode,
  SPINTAX_EXACT_REGEX,
  SPINTAX_REGEX,
  SpintaxNode,
} from "./spintax-node";

function $countSpintaxNodes(): number {
  let count = 0;
  const root = $getRoot();
  for (const child of root.getChildren()) {
    if ($isElementNode(child)) {
      for (const grandchild of child.getChildren()) {
        if ($isSpintaxNode(grandchild)) {
          count++;
        }
      }
    }
  }
  return count;
}

/**
 * Dissolve a SpintaxNode by moving its children out into the parent.
 * Unlike `parent.replace(textNode)`, this preserves the existing child
 * node instances so the cursor stays in place.
 */
function $unwrapSpintaxNode(spintaxNode: SpintaxNode): void {
  const children = spintaxNode.getChildren();
  for (const child of children) {
    spintaxNode.insertBefore(child);
  }
  spintaxNode.remove();
}

export default function SpintaxPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return mergeRegister(
      // Backspace at SpintaxNode boundary: redirect cursor inside
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        () => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed())
            return false;

          const { anchor } = selection;
          const anchorNode = anchor.getNode();

          // Cursor at offset 0 of a text node right after a SpintaxNode
          if ($isTextNode(anchorNode) && anchor.offset === 0) {
            const prev = anchorNode.getPreviousSibling();
            if ($isSpintaxNode(prev)) {
              const lastChild = prev.getLastChild();
              if ($isTextNode(lastChild)) {
                lastChild.select(
                  lastChild.getTextContentSize(),
                  lastChild.getTextContentSize()
                );
              }
              return true;
            }
          }

          // Cursor in the paragraph element pointing right after a SpintaxNode
          if ($isElementNode(anchorNode) && anchor.offset > 0) {
            const child = anchorNode.getChildAtIndex(anchor.offset - 1);
            if ($isSpintaxNode(child)) {
              const lastChild = child.getLastChild();
              if ($isTextNode(lastChild)) {
                lastChild.select(
                  lastChild.getTextContentSize(),
                  lastChild.getTextContentSize()
                );
              }
              return true;
            }
          }

          return false;
        },
        COMMAND_PRIORITY_HIGH
      ),

      // Delete at SpintaxNode boundary: redirect cursor inside
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        () => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed())
            return false;

          const { anchor } = selection;
          const anchorNode = anchor.getNode();

          if (
            $isTextNode(anchorNode) &&
            anchor.offset === anchorNode.getTextContentSize()
          ) {
            const next = anchorNode.getNextSibling();
            if ($isSpintaxNode(next)) {
              const firstChild = next.getFirstChild();
              if ($isTextNode(firstChild)) {
                firstChild.select(0, 0);
              }
              return true;
            }
          }

          if ($isElementNode(anchorNode)) {
            const child = anchorNode.getChildAtIndex(anchor.offset);
            if ($isSpintaxNode(child)) {
              const firstChild = child.getFirstChild();
              if ($isTextNode(firstChild)) {
                firstChild.select(0, 0);
              }
              return true;
            }
          }

          return false;
        },
        COMMAND_PRIORITY_HIGH
      ),

      // Forward transform: TextNode → SpintaxNode
      editor.registerNodeTransform(TextNode, (node) => {
        const parent = node.getParent();

        // If inside a SpintaxNode, handle overflow and pattern validation
        if ($isSpintaxNode(parent)) {
          const fullContent = parent.getTextContent();
          if (SPINTAX_EXACT_REGEX.test(fullContent)) return;

          const nodeText = node.getTextContent();

          // Overflow at end: user typed after closing }
          if (node === parent.getLastChild()) {
            const endBrace = nodeText.lastIndexOf("}");
            if (endBrace !== -1 && endBrace < nodeText.length - 1) {
              const parts = node.splitText(endBrace + 1);
              if (parts[1]) parent.insertAfter(parts[1]);
              return;
            }
          }

          // Overflow at start: user typed before opening {
          if (node === parent.getFirstChild()) {
            const startBrace = nodeText.indexOf("{");
            if (startBrace > 0) {
              const parts = node.splitText(startBrace);
              if (parts[0]) parent.insertBefore(parts[0]);
              return;
            }
          }

          // Pattern fully broken (e.g. pipe deleted): dissolve SpintaxNode
          // by moving children out, preserving cursor position
          if (!SPINTAX_REGEX.test(fullContent)) {
            $unwrapSpintaxNode(parent);
          }
          return;
        }

        const text = node.getTextContent();
        const match = SPINTAX_REGEX.exec(text);
        if (!match) return;

        const matchStart = match.index;
        const matchEnd = match.index + match[0].length;
        const matchedText = match[0];

        // Capture cursor position relative to match before any splits
        let cursorOffset = matchedText.length;
        const selection = $getSelection();
        if ($isRangeSelection(selection) && selection.isCollapsed()) {
          const { anchor } = selection;
          if (anchor.key === node.getKey()) {
            const rel = anchor.offset - matchStart;
            if (rel >= 0 && rel <= matchedText.length) {
              cursorOffset = rel;
            }
          }
        }

        const colorIndex = $countSpintaxNodes();
        const spintaxNode = $createSpintaxNode(colorIndex);
        const contentNode = $createTextNode(matchedText);

        if (matchStart === 0 && matchEnd === text.length) {
          node.replace(spintaxNode);
          spintaxNode.append(contentNode);
        } else {
          let nodeToReplace: TextNode | undefined = node;
          if (matchEnd < text.length) {
            const res = node.splitText(matchEnd);
            nodeToReplace = res[0];
          }
          if (nodeToReplace && matchStart > 0) {
            const res = nodeToReplace.splitText(matchStart);
            nodeToReplace = res[1];
          }
          if (nodeToReplace) {
            nodeToReplace.replace(spintaxNode);
            spintaxNode.append(contentNode);
          }
        }

        // Restore cursor to its original position within the match
        contentNode.select(cursorOffset, cursorOffset);
      }),

      // Reverse transform: dissolve SpintaxNode when pattern breaks
      editor.registerNodeTransform(SpintaxNode, (node) => {
        const textContent = node.getTextContent();
        if (!SPINTAX_EXACT_REGEX.test(textContent)) {
          $unwrapSpintaxNode(node);
        }
      })
    );
  }, [editor]);

  return null;
}
