import { PostHogProvider } from "posthog-js/react";
import { get, set } from "radashi";
import { type PropsWithChildren } from "react";

function sanitizeProperties(properties: Record<string, any>) {
  const urlProperties = [
    "$current_url",
    "$set.$current_url",
    "$initial_current_url",
    "$set_once.$initial_current_url",
  ];

  for (const urlProperty of urlProperties) {
    const value = get(properties, urlProperty);
    if (value && typeof value === "string") {
      // remove telegram sensitive data from url
      properties = set(
        properties,
        urlProperty,
        value.split("#tgWebAppData=")[0]
      );
    }
  }

  return properties;
}

export function AnalyticsProvider({ children }: PropsWithChildren) {
  return (
    <PostHogProvider
      apiKey={import.meta.env.VITE_POSTHOG_KEY}
      options={{
        api_host: import.meta.env.VITE_POSTHOG_HOST,
        capture_pageview: false,
        capture_pageleave: false,
        sanitize_properties: sanitizeProperties,
      }}
    >
      {children}
    </PostHogProvider>
  );
}
