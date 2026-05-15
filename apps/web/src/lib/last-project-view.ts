// Per-project preference: куда landить'ся при клике на проект из
// tree-explorer'а (не для draft — там всегда настройки). Пишется при
// клике на таб «Канбан» / «Список», читается в route.tsx.
//
// Дефолт = leads. В первые дни проекта менеджер смотрит рассылку
// (pending → sent, ошибки). Когда лиды начинают отвечать — переключается
// на канбан, и preference этого проекта запоминается — дальше landing в
// канбан. Каждый проект свой ключ: в одном можно работать в канбане, в
// другом одновременно в списке.

export type ProjectView = "kanban" | "leads";

const key = (projectId: string) => `crmchat:lastProjectView:${projectId}`;

export function rememberLastProjectView(
  projectId: string,
  view: ProjectView,
): void {
  try {
    localStorage.setItem(key(projectId), view);
  } catch {
    // приватный режим / quota — молча игнорируем
  }
}

export function getLastProjectView(projectId: string): ProjectView {
  try {
    const v = localStorage.getItem(key(projectId));
    return v === "kanban" ? "kanban" : "leads";
  } catch {
    return "leads";
  }
}
