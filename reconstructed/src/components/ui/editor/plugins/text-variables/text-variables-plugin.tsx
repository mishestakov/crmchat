import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  MenuRenderFn,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createTextNode, TextNode } from "lexical";
import { Loader2, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  $createTextVariableNode,
  NotDefinedTooltip,
} from "./text-variable-node";
import { useTextVariablesContext } from "./text-variables-context";
import { cn } from "@/lib/utils";

export interface TextVariable {
  variable: string;
  label: string;
  icon?: React.JSX.Element;
  shouldValidate?: boolean;
  /** If true, insert as plain editable text instead of a styled node */
  plainText?: boolean;
}

export class TextVariableTypeaheadOption extends MenuOption {
  variable: string;
  label: string;
  override icon?: React.JSX.Element;
  shouldValidate?: boolean;
  plainText?: boolean;

  constructor(params: TextVariable) {
    super(params.variable);
    this.variable = params.variable;
    this.label = params.label;
    this.icon = params.icon;
    this.shouldValidate = params.shouldValidate;
    this.plainText = params.plainText;
  }
}

const createFilteredOptions = (
  options: TextVariable[],
  queryString: string | RegExp | null
) => {
  if (queryString === null) {
    return options;
  }

  const regex = new RegExp(queryString, "gi");
  return options.filter(
    (option) => regex.test(option.variable) || regex.test(option.label)
  );
};

export default function TextVariablesSuggestionPlugin() {
  const [editor] = useLexicalComposerContext();
  const [queryString, setQueryString] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const context = useTextVariablesContext();

  useEffect(() => {
    return editor.registerNodeTransform(TextNode, (node) => {
      const text = node.getTextContent();
      const matches = text.match(/{{([^}]+)}}/g);

      if (!matches) return;

      // Start from last match to preserve indices when splitting
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i]!;
        const matchIndex = text.lastIndexOf(match);
        const variableName = match.slice(2, -2);
        const textVariable = context.variables.find(
          (p) => p.variable === variableName
        );

        if (!textVariable || textVariable.plainText) {
          // Skip if variable not found, or if it's a plainText variable (like RANDOM)
          continue;
        }

        if (matchIndex === 0 && match.length === text.length) {
          // If the entire node is the placeholder
          const variableNode = $createTextVariableNode(
            textVariable.variable,
            textVariable.label
          );
          node.replace(variableNode);
        } else {
          // Split the text node and insert placeholder
          const textSize = node.getTextContent().length;
          let nodeToReplace: TextNode | undefined = node;
          if (matchIndex + match.length < textSize) {
            const res = node.splitText(matchIndex + match.length);
            nodeToReplace = res[0]!;
          }
          if (matchIndex > 0) {
            const res = node.splitText(matchIndex);
            nodeToReplace = res[1]!;
          }
          const variableNode = $createTextVariableNode(
            textVariable.variable,
            textVariable.label
          );

          // sometimes nodeToReplace is undefined, but it's not clear why
          nodeToReplace?.replace(variableNode);
        }
      }
    });
  }, [editor, context.variables]);

  const _checkForTriggerMatch = useBasicTypeaheadTriggerMatch("{", {
    minLength: 0,
  });

  const checkForTriggerMatch = useCallback(
    (text: string) => {
      const match = _checkForTriggerMatch(text, editor);
      if (match !== null) {
        setShowSuggestions(true);
      }
      return match;
    },
    [_checkForTriggerMatch, editor]
  );

  const onSelectOption = useCallback(
    (
      selectedOption: TextVariableTypeaheadOption,
      nodeToReplace: TextNode | null,
      closeMenu: () => void
    ) => {
      editor.update(() => {
        if (selectedOption.plainText) {
          // Insert as plain editable text (e.g., for RANDOM spintax)
          const textNode = $createTextNode(selectedOption.variable);
          if (nodeToReplace) {
            nodeToReplace.replace(textNode);
          }
        } else {
          const node = $createTextVariableNode(
            selectedOption.key,
            selectedOption.label
          );
          if (nodeToReplace) {
            nodeToReplace.replace(node);
          }
        }
        closeMenu();
      });
    },
    [editor]
  );

  const options: TextVariableTypeaheadOption[] = useMemo(
    () =>
      createFilteredOptions(context.variables, queryString).map(
        (option) => new TextVariableTypeaheadOption(option)
      ),
    [context.variables, queryString]
  );

  const renderSuggestionsMenu: MenuRenderFn<TextVariableTypeaheadOption> = (
    anchorElementRef,
    { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
  ) => {
    if (
      !showSuggestions ||
      anchorElementRef.current == null ||
      options.length === 0
    ) {
      return null;
    }
    return anchorElementRef.current && options.length > 0
      ? createPortal(
          <div className="bg-popover text-popover-foreground border-border max-h-[320px] w-[250px] min-w-[90px] gap-0.5 overflow-hidden overflow-y-auto rounded-lg border shadow-md">
            <ul>
              {options.map(
                (option: TextVariableTypeaheadOption, index: number) => (
                  <li
                    key={option.key}
                    tabIndex={-1}
                    className={cn(
                      "flex cursor-pointer items-center px-3 py-2 text-sm",
                      selectedIndex === index &&
                        "bg-accent text-accent-foreground",
                      selectedIndex === null &&
                        "hover:bg-accent hover:text-accent-foreground"
                    )}
                    ref={option.setRefElement}
                    role="option"
                    aria-selected={selectedIndex === index}
                    id={"typeahead-item-" + index}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => {
                      setHighlightedIndex(index);
                      selectOptionAndCleanUp(option);
                    }}
                  >
                    {option.icon && (
                      <span className="mr-2 shrink-0">{option.icon}</span>
                    )}
                    <span className="popper__reference">
                      {option.label ?? option.key}
                    </span>

                    {option.shouldValidate ? (
                      context.notDefinedVariablesPending ? (
                        <Loader2 className="text-muted-foreground ml-auto size-4 animate-spin" />
                      ) : context.notDefinedVariables?.has(option.variable) ? (
                        <NotDefinedTooltip
                          notDefined={
                            context.notDefinedVariables!.get(option.variable)!
                          }
                        >
                          <TriangleAlertIcon className="ml-auto size-4 text-orange-500" />
                        </NotDefinedTooltip>
                      ) : null
                    ) : null}
                  </li>
                )
              )}
            </ul>
          </div>,
          anchorElementRef.current
        )
      : null;
  };

  return (
    <LexicalTypeaheadMenuPlugin<TextVariableTypeaheadOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      anchorClassName="z-40"
      menuRenderFn={renderSuggestionsMenu}
    />
  );
}
