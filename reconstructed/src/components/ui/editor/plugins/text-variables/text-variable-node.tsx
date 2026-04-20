import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import {
  $create,
  $getState,
  $setState,
  DecoratorNode,
  LexicalNode,
  NodeKey,
  StateConfigValue,
  StateValueOrUpdater,
  createState,
} from "lexical";
import { TriangleAlertIcon } from "lucide-react";
import { ComponentProps, JSX } from "react";
import { useTranslation } from "react-i18next";

import { useTextVariablesContext } from "./text-variables-context";
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ContactCell } from "@/features/outreach/sequences/contact-cell";
import { cn } from "@/lib/utils";

const variableState = createState<string, string>("variable", {
  parse: (val) => (typeof val === "string" ? val : ""),
});
const labelState = createState<string, string>("label", {
  parse: (val) => (typeof val === "string" ? val : ""),
});

const CONTACTS_TO_SHOW = 5;

export function NotDefinedTooltip({
  notDefined,
  side,
  children,
}: {
  notDefined: { contacts: string[] };
  side?: ComponentProps<typeof TooltipContent>["side"];
  children: React.ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent side={side} className="max-w-[300px]">
          {t("web.textVariables.notDefinedTooltip")}
          <div className="ml-2 mt-2 flex flex-col gap-1">
            {notDefined.contacts.slice(0, CONTACTS_TO_SHOW).map((contactId) => (
              <div key={contactId}>
                <ContactCell contactId={contactId} />
              </div>
            ))}
            {notDefined.contacts.length > CONTACTS_TO_SHOW && (
              <div>{t("web.textVariables.andMore")}</div>
            )}
          </div>
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

function TextVariableComponent({
  variable,
  label,
  nodeKey,
}: {
  variable: string;
  label: string;
  nodeKey: NodeKey;
}) {
  const [isNodeSelected] = useLexicalNodeSelection(nodeKey);
  const context = useTextVariablesContext();
  const notDefined = context.notDefinedVariables?.get(variable);

  const badge = (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm border px-0.5",
        "bg-badge-blue text-badge-blue-foreground border-badge-blue-foreground/30",
        isNodeSelected && "border-badge-blue-foreground"
      )}
    >
      &#8203;
      {context.notDefinedVariables?.has(variable) && (
        <TriangleAlertIcon className="block size-3 text-orange-500" />
      )}
      {label}
      &#8203;
    </span>
  );

  if (notDefined) {
    return (
      <NotDefinedTooltip notDefined={notDefined}>{badge}</NotDefinedTooltip>
    );
  }
  return badge;
}

export class TextVariableNode extends DecoratorNode<JSX.Element> {
  static override getType(): string {
    return "text-variable-node";
  }

  override $config() {
    return this.config("text-variable-node", {
      extends: DecoratorNode,
      stateConfigs: [
        { flat: true, stateConfig: variableState },
        { flat: true, stateConfig: labelState },
      ],
    });
  }

  getVariable(): StateConfigValue<typeof variableState> {
    return $getState(this, variableState);
  }

  setVariable(value: StateValueOrUpdater<typeof variableState>): this {
    return $setState(this, variableState, value);
  }

  getLabel(): StateConfigValue<typeof labelState> {
    return $getState(this, labelState);
  }

  setLabel(value: StateValueOrUpdater<typeof labelState>): this {
    return $setState(this, labelState, value);
  }

  override getTextContent(): string {
    return `{{${this.getVariable()}}}`;
  }

  override createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.style.display = "inline-block";
    return element;
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): JSX.Element {
    return (
      <TextVariableComponent
        variable={this.getVariable()}
        label={this.getLabel()}
        nodeKey={this.__key}
      />
    );
  }

  override isInline(): boolean {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return false;
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function $createTextVariableNode(
  variable: string,
  label: string
): TextVariableNode {
  const node = $create(TextVariableNode).setVariable(variable).setLabel(label);

  return node;
}

// eslint-disable-next-line react-refresh/only-export-components
export function $isTextVariableNode(
  node: LexicalNode | null | undefined
): node is TextVariableNode {
  return node instanceof TextVariableNode;
}
