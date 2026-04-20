import { EyeIcon, FileIcon } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";

import { remarkParseAltImageSize } from "./image.plugin";

export default function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkBreaks, remarkParseAltImageSize]}
      components={{
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        a: ({ node, children, href, ...props }) => {
          if (children?.toString().startsWith("[File:")) {
            return (
              <a
                {...props}
                href={href}
                target="_blank"
                className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-3 py-3 no-underline transition-colors hover:bg-gray-100/80 dark:bg-gray-800 dark:hover:bg-gray-800/70"
              >
                <FileIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
                <div className="sensitive text-sm font-medium text-gray-700 dark:text-gray-300">
                  {children.toString().replace(/\[File:\s*(.*)\]/, "$1")}
                </div>
              </a>
            );
          }

          return (
            <a {...props} href={href} target="_blank">
              {children}
            </a>
          );
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        img: ({ node, src, ...props }) => (
          <a
            href={src}
            target="_blank"
            className="bg-accent group relative inline-block h-auto max-h-[350px] w-auto max-w-[250px] overflow-hidden rounded-lg border"
          >
            <img {...props} src={src} className="m-0" />
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800/40 opacity-0 transition-opacity group-hover:opacity-100">
              <EyeIcon className="h-6 w-6 text-white" />
            </div>
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
