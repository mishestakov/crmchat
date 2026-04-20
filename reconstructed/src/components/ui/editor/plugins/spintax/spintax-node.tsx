import {
  $create,
  $getState,
  $setState,
  ElementNode,
  LexicalNode,
  createState,
} from "lexical";

export { SPINTAX_REGEX, SPINTAX_EXACT_REGEX } from "@repo/message-formatter";

const colorIndexState = createState("colorIndex", {
  parse: (val) => (typeof val === "number" ? val : 0),
});

const SPINTAX_CLASS_NAMES = [
  ["bg-[rgba(139,92,246,0.15)]", "dark:bg-[rgba(139,92,246,0.3)]"], // violet
  ["bg-[rgba(16,185,129,0.15)]", "dark:bg-[rgba(16,185,129,0.3)]"], // emerald
  ["bg-[rgba(245,158,11,0.15)]", "dark:bg-[rgba(245,158,11,0.3)]"], // amber
  ["bg-[rgba(244,63,94,0.15)]", "dark:bg-[rgba(244,63,94,0.3)]"], // rose
  ["bg-[rgba(6,182,212,0.15)]", "dark:bg-[rgba(6,182,212,0.3)]"], // cyan
  ["bg-[rgba(217,70,239,0.15)]", "dark:bg-[rgba(217,70,239,0.3)]"], // fuchsia
];

export class SpintaxNode extends ElementNode {
  static override getType(): string {
    return "spintax";
  }

  override $config() {
    return this.config("spintax", {
      extends: ElementNode,
      stateConfigs: [{ flat: true, stateConfig: colorIndexState }],
    });
  }

  getColorIndex() {
    return $getState(this, colorIndexState);
  }

  setColorIndex(value: number): this {
    return $setState(this, colorIndexState, value);
  }

  override createDOM(): HTMLElement {
    const span = document.createElement("span");
    const colorIndex = this.getColorIndex();
    span.classList.add(
      ...SPINTAX_CLASS_NAMES[colorIndex % SPINTAX_CLASS_NAMES.length]!
    );
    span.style.borderRadius = "2px";
    return span;
  }

  override updateDOM(): boolean {
    return false;
  }

  override isInline(): boolean {
    return true;
  }

  override canBeEmpty(): boolean {
    return false;
  }
}

export function $createSpintaxNode(colorIndex: number): SpintaxNode {
  return $create(SpintaxNode).setColorIndex(colorIndex);
}

export function $isSpintaxNode(
  node: LexicalNode | null | undefined
): node is SpintaxNode {
  return node instanceof SpintaxNode;
}
