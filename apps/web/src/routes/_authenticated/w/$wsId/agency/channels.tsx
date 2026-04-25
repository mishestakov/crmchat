import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "../../../../../components/coming-soon";

export const Route = createFileRoute("/_authenticated/w/$wsId/agency/channels")({
  component: () => (
    <ComingSoon
      phase="P2"
      title="Каналы"
      description="Реестр инвентаря: тематика/гео/прайс-лист/ER/охваты. Фильтры по бюджету и тематике для подбора в медиаплан проекта."
    />
  ),
});
