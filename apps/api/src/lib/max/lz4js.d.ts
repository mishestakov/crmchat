// lz4js не поставляет типы. Нужен только блочный декомпрессор.
declare module "lz4js" {
  export function decompressBlock(
    src: Uint8Array,
    dst: Uint8Array,
    srcIndex: number,
    srcLength: number,
    dstIndex: number,
  ): number;
  const lz4: { decompressBlock: typeof decompressBlock };
  export default lz4;
}
