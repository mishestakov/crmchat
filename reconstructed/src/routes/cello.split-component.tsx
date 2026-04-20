import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { LoadingScreen } from "@/components/LoadingScreen";

export const Route = createFileRoute("/cello")({
  component: RouteComponent,
  scripts: () => [
    {
      src: "https://assets.cello.so/attribution/latest/cello-attribution.js",
      type: "module",
      async: true,
    },
  ],
});

function RouteComponent() {
  const navigate = Route.useNavigate();
  useEffect(() => {
    const interval = setInterval(async () => {
      const ucc = await (window as any).CelloAttribution("getUcc");
      if (ucc) {
        clearInterval(interval);
        navigate({
          href: `https://t.me/${import.meta.env.VITE_BOT_USERNAME}?start=ucc_${ucc}`,
        });
      }
    }, 500);
    return () => clearInterval(interval);
  }, [navigate]);

  return <LoadingScreen />;
}
