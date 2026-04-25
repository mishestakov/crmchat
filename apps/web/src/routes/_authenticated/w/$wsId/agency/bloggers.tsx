import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "../../../../../components/coming-soon";

export const Route = createFileRoute("/_authenticated/w/$wsId/agency/bloggers")({
  component: () => (
    <ComingSoon
      phase="P2"
      title="Блогеры"
      description="Общая база админов: TG-аккаунт, форма работы, реквизиты, исторические агрегаты по сотрудничеству. У одного блогера может быть N каналов."
    />
  ),
});
