import { visit } from "unist-util-visit";

const sizeRegex = /(\d+)x(\d+)$/;

export function remarkParseAltImageSize() {
  return (tree: any) => {
    visit(tree, "image", (node) => {
      const match = sizeRegex.exec(node.alt);
      if (match) {
        const width = match[1];
        const height = match[2];
        node.alt = node.alt.replace(sizeRegex, "").trim();
        node.data = node.data || {};
        node.data.hProperties = node.data.hProperties || {};
        node.data.hProperties.width = width;
        node.data.hProperties.height = height;
      }
    });
  };
}
