import { ReactNode } from "react";

function convertUrlsToLinks(text: string): ReactNode[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return parts.map((part, i) => {
    if (urlRegex.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

export function WithClickableLinks({ children }: { children: string }) {
  return <>{convertUrlsToLinks(children)}</>;
}
