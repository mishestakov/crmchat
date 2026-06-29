import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Section,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
} from "../../../../../components/section";

// Главная страница настроек workspace'а — список разделов в донор-стиле:
// карточка с строками, в каждой иконка/title + chevron справа. Каждая
// ведёт на свою под-страницу.

export const Route = createFileRoute("/_authenticated/w/$wsId/settings/")({
  component: SettingsIndex,
});

function SettingsIndex() {
  const { wsId } = Route.useParams();
  return (
    <div className="mx-auto max-w-xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Настройки</h1>

      <Section header="Workspace">
        <SectionItem withChevron>
          <Link
            to="/w/$wsId/settings/workspace"
            params={{ wsId }}
            className="flex flex-1 items-center"
          >
            <SectionItemTitle>Команда и название</SectionItemTitle>
          </Link>
        </SectionItem>
      </Section>

      <Section header="Конфигурация">
        <SectionItem withChevron>
          <Link
            to="/w/$wsId/properties"
            params={{ wsId }}
            className="flex flex-1 items-center"
          >
            <SectionItemTitle>Кастомные поля</SectionItemTitle>
            <SectionItemValue>контакты</SectionItemValue>
          </Link>
        </SectionItem>
        <SectionItem withChevron>
          <Link
            to="/w/$wsId/stage-templates"
            params={{ wsId }}
            className="flex flex-1 items-center"
          >
            <SectionItemTitle>Шаблоны стадий</SectionItemTitle>
            <SectionItemValue>канбан проектов</SectionItemValue>
          </Link>
        </SectionItem>
      </Section>

      <Section header="Расширения">
        <SectionItem withChevron>
          <Link
            to="/w/$wsId/settings/integrations"
            params={{ wsId }}
            className="flex flex-1 items-center"
          >
            <SectionItemTitle>Интеграции</SectionItemTitle>
            <SectionItemValue>скоро</SectionItemValue>
          </Link>
        </SectionItem>
      </Section>
    </div>
  );
}
