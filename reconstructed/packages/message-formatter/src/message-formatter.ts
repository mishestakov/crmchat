import remarkBreaks from "remark-breaks";
import remarkHtml from "remark-html";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { stripBom } from "@repo/core/utils";

import { processSpintax } from "./spintax.js";

export async function formatMessageAsHtml(
  markdownMessage: string,
  textVariables: Record<string, string>,
  seed: string
) {
  // Process spintax before markdown conversion
  const processedMessage = processSpintax(markdownMessage, seed);

  let htmlMessage = String(
    await unified()
      .use(remarkParse)
      .use(remarkBreaks)
      .use(remarkHtml)
      .use(function () {
        const data = this.data();
        data.micromarkExtensions ??= [];
        data.micromarkExtensions.push({
          disable: { null: ["list", "listItem"] },
        });
      })
      .process(processedMessage)
  )
    // There is a better way to do this, but it's not worth the effort
    .replaceAll("<p>", "")
    .replaceAll("</p>", "<br><br>")

    // for some reason mtcute html parser doesn't handle
    // spaces before closing tags and removes them
    .replaceAll(/(\s+)<\/([-a-z]+)>/gi, "</$2>$1");

  for (const [key, value] of Object.entries(textVariables)) {
    htmlMessage = htmlMessage.replaceAll(
      `{{${stripBom(key)}}}`,
      stripBom(value).replaceAll("\n", "<br>\n")
    );
  }

  // trim and remove trailing <br/>
  htmlMessage = htmlMessage.trim().replaceAll(/(<br\/?>)+$/gi, "");

  return htmlMessage;
}
