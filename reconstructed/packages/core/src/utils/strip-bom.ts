export function stripBom(str: string) {
  return str.replace(/^\uFEFF/, "");
}
