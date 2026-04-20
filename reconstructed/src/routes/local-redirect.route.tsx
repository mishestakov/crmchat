import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/local-redirect")({
  beforeLoad() {
    const searchParams = new URLSearchParams(window.location.search);
    const targetPrefix = searchParams.get("_target") ?? "http://localhost:3000";
    searchParams.delete("_target");

    const targetUrl =
      targetPrefix +
      window.location.pathname.replace("/local-redirect", "") +
      (searchParams.size > 0 ? `?${searchParams.toString()}` : "") +
      window.location.hash;

    console.info("Redirecting to local server", targetUrl);
    window.location.href = targetUrl;
  },
});
