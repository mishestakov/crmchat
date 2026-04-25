import { Construction } from "lucide-react";

export function ComingSoon({
  phase,
  title,
  description,
}: {
  phase: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-md p-12 text-center">
      <Construction size={28} className="mx-auto mb-3 text-zinc-400" />
      <p className="mb-1 text-lg font-semibold">{title}</p>
      <p className="mb-3 text-xs uppercase tracking-wide text-zinc-500">
        Скоро · фаза {phase}
      </p>
      <p className="text-sm text-zinc-600">{description}</p>
      <p className="mt-4 text-xs text-zinc-400">
        Roadmap: <code>specs/agency-pivot.md</code>
      </p>
    </div>
  );
}
