// Подмножество TDLib `user` (td_api.tl:2175) — только те поля, что используются
// в проекте. Все поля required по TL, на nullable не рассчитываем; на пустые
// значения (deleted-юзер с first_name="" и т.п.) caller'ы принимают
// решение сами.
//
//   user id:int53 first_name:string last_name:string usernames:usernames
//        phone_number:string ... is_premium:Bool ... type:UserType ... = User;
//
// usernames (td_api.tl:2144):
//   usernames active_usernames:vector<string> disabled_usernames:vector<string>
//             editable_username:string collectible_usernames:vector<string>
//             = Usernames;
//
// userType (td_api.tl:713-735): Regular | Deleted | Bot {...} | Unknown.
export type TdUser = {
  id: number;
  first_name: string;
  last_name: string;
  phone_number: string;
  usernames: {
    active_usernames: string[];
    editable_username: string;
  };
  is_premium: boolean;
  type: {
    _: "userTypeRegular" | "userTypeDeleted" | "userTypeBot" | "userTypeUnknown";
  };
};

// Активный публичный username юзера. По TL `usernames` — обязательный объект,
// `active_usernames` всегда массив (может быть пустой), `editable_username`
// всегда строка (может быть пустой). `||` (не `??`) — пустая строка
// "no public username" мапится в null.
export function extractActiveUsername(user: TdUser): string | null {
  return (
    user.usernames.active_usernames[0] ||
    user.usernames.editable_username ||
    null
  );
}
