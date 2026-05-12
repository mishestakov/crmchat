type Props = {
  shown: number;
  // Если бэк отдаёт total — показываем «X из Y». Иначе сухое «первые X».
  total?: number;
  // Существительное в род.п. мн.ч.: «каналов», «лидов», «контактов».
  entity: string;
  // Хинт «Уточните поиск...» имеет смысл только когда у страницы есть search/фильтр.
  // На канбане его нет, поэтому отключаемо.
  hint?: string;
};

export function TruncationBanner({
  shown,
  total,
  entity,
  hint = "Уточните поиск, чтобы увидеть остальные.",
}: Props) {
  const shownFmt = shown.toLocaleString("ru-RU");
  const totalFmt = total?.toLocaleString("ru-RU");
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      {total !== undefined
        ? `Показаны первые ${shownFmt} из ${totalFmt} ${entity}.`
        : `Показаны первые ${shownFmt} ${entity}.`}
      {hint && ` ${hint}`}
    </div>
  );
}
