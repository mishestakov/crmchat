import { useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

// Единая стрелка «назад» для всех detail/edit страниц.
// Кладётся первым ребёнком в page-обёртке (вне max-w контейнера),
// тогда визуально стоит слева от центрированного контента — как в доноре.
export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.history.back()}
      aria-label="Назад"
      className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-200"
    >
      <ArrowLeft size={18} />
    </button>
  );
}
