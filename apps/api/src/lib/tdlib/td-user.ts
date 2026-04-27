// Минимальный shape TDLib `user` для полей, которые мы реально используем.
// Полная схема — в tdlib-types, но цеплять её ради 4 опциональных полей
// избыточно.
export type TdUser = {
  id?: number | string;
  type?: { _?: string };
  usernames?: { active_usernames?: string[]; editable_username?: string };
  username?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  is_premium?: boolean;
};

// TG-юзеры существуют в двух режимах: legacy одиночный `username` и новый
// массив `usernames[]` с флагами active/editable. У юзеров с multi-username
// legacy-поле пустует → берём первый active из массива как fallback.
export function extractActiveUsername(user: TdUser): string | null {
  return (
    user.usernames?.active_usernames?.[0] ??
    user.usernames?.editable_username ??
    user.username ??
    null
  );
}
