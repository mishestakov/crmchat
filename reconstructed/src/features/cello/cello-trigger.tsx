import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useTheme } from "@/hooks/useTheme";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function useCelloTrigger() {
  const [, updateState] = useState<any>();
  const forceUpdate = () => updateState({});

  const { resolvedTheme } = useTheme();
  const trpc = useTRPC();
  const { data: initOptions } = useQuery(
    trpc.cello.getInitOptions.queryOptions()
  );

  useEffect(() => {
    if (!initOptions?.token) return;

    if (!document.querySelector(`script[id="cello-script"]`)) {
      const el = document.createElement("script");
      el.id = "cello-script";
      el.src = initOptions.isSandbox
        ? "https://assets.sandbox.cello.so/app/latest/cello.js"
        : "https://assets.cello.so/app/latest/cello.js";
      el.type = "module";
      el.async = true;
      document.body.append(el);
    }

    if (!(window as any)._cello_initialized) {
      (window as any).cello = (window as any).cello || { cmd: [] };
      (window as any).cello.cmd.push(async (cello: any) => {
        try {
          await cello.boot({
            productId: initOptions.productId,
            token: initOptions.token,
            productUserDetails: {
              email: initOptions.email,
              firstName: initOptions.firstName,
            },
            themeMode: resolvedTheme,
            hideDefaultLauncher: true,
          });

          const campaignConfig = await (window as any).Cello?.(
            "getCampaignConfig"
          );
          (window as any)._cello_reward_cap = campaignConfig.rewardCap;
          forceUpdate();
        } catch (error) {
          console.warn("Failed to init cello", error);
        }
      });
      (window as any)._cello_initialized = true;
    }
  }, [initOptions, resolvedTheme]);

  return {
    celloClassName: cn(
      "cello-launcher relative",
      !(window as any)._cello_initialized && "hidden"
    ),
    rewardCap: (window as any)._cello_reward_cap,
  };
}
