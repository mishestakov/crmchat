// Бинарный фрейминг протокола MAX: 10-байт заголовок + MessagePack-payload,
// опционально LZ4-сжатый. Порт из `~/MAX/src/transport/codec.ts` с зашитой
// робастностью — ни один битый/непонятный пакет не должен ронять сокет
// (важно для долгоживущих воркер-сессий). См. project_max_integration в памяти.
import { Encoder, Decoder } from "@msgpack/msgpack";
import lz4 from "lz4js";
import { opcodeName } from "./opcodes.ts";

const HEADER_LENGTH = 10;
const PROTOCOL_VERSION = 10;

const encoder = new Encoder({ useBigInt64: true });

// Свежий Decoder на каждый разбор: @msgpack/msgpack Decoder хранит внутреннее
// состояние, и шаренный инстанс после неудачного decode портит разбор
// следующих пакетов ("Expected number at N" на ответах MSG_SEND).
function makeDecoder(): Decoder {
  return new Decoder({
    useBigInt64: true,
    mapKeyConverter: (key: unknown): string | number => {
      if (typeof key === "bigint") return key.toString();
      if (typeof key === "string" || typeof key === "number") return key;
      return String(key);
    },
  });
}

export interface PacketHeader {
  version: number;
  cmd: number;
  seq: number;
  opcode: number;
  opcodeName: string;
  compressionFactor: number;
  payloadLength: number;
  inflatedLength: number;
}

export interface ParsedPacket {
  packet: PacketHeader;
  payloadBuffer: Buffer;
  decoded: unknown;
  consumed: number;
}

function normalizeDecoded(value: unknown): unknown {
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([k, v]) => [String(k), normalizeDecoded(v)]),
    );
  }
  if (Array.isArray(value)) return value.map(normalizeDecoded);
  if (value instanceof Uint8Array) return value;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalizeDecoded(v)]),
    );
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function encodePayload(payload: unknown): Buffer {
  if (payload == null) return Buffer.alloc(0);
  return Buffer.from(encoder.encode(payload));
}

// Никогда не бросает: на нераспознанном payload отдаёт { _decodeError, _rawBase64 }
// чтобы вызывающий мог залогировать сырые байты (нужно для реверса ответов).
function decodePayload(buffer: Buffer): unknown {
  if (!buffer || buffer.length === 0) return null;
  try {
    return normalizeDecoded(makeDecoder().decode(buffer));
  } catch (err) {
    try {
      const values: unknown[] = [];
      for (const item of makeDecoder().decodeMulti(buffer)) {
        values.push(normalizeDecoded(item));
      }
      if (values.length === 1) return values[0];
      return { _multi: values };
    } catch {
      return {
        _decodeError: (err as Error).message,
        _rawBase64: buffer.toString("base64"),
      };
    }
  }
}

export function buildPacket(opts: {
  cmd: number;
  seq: number;
  opcode: number;
  payload: unknown;
}): Buffer {
  const payloadBuffer = Buffer.isBuffer(opts.payload)
    ? opts.payload
    : encodePayload(opts.payload);

  const packet = Buffer.alloc(HEADER_LENGTH + payloadBuffer.length);
  packet.writeUInt8(PROTOCOL_VERSION, 0);
  packet.writeUInt8(opts.cmd, 1);
  packet.writeUInt16BE(opts.seq & 0xffff, 2);
  packet.writeUInt16BE(opts.opcode & 0xffff, 4);
  packet.writeUInt32BE(payloadBuffer.length & 0x00ffffff, 6);
  if (payloadBuffer.length > 0) payloadBuffer.copy(packet, HEADER_LENGTH);
  return packet;
}


export function tryParsePacket(buffer: Buffer): ParsedPacket | null {
  if (buffer.length < HEADER_LENGTH) return null;

  const version = buffer.readUInt8(0);
  const cmd = buffer.readUInt8(1);
  const seq = buffer.readUInt16BE(2);
  const opcode = buffer.readUInt16BE(4);
  const cofAndLength = buffer.readUInt32BE(6);
  const compressionFactor = (cofAndLength >>> 24) & 0xff;
  const payloadLength = cofAndLength & 0x00ffffff;
  const totalLength = HEADER_LENGTH + payloadLength;

  if (buffer.length < totalLength) return null;

  let payloadBuffer = buffer.subarray(HEADER_LENGTH, totalLength);
  let inflatedLength = payloadBuffer.length;

  if (compressionFactor !== 0 && payloadBuffer.length > 0) {
    try {
      // cof (1 байт) — оценка коэффициента инфляции; может недооценивать
      // (floor-округление отправителя, или сжатие >255×). Аллоцируем щедро —
      // decompressBlock возвращает реальную длину, перерасход безвреден, а
      // недобор молча обрезал бы пейлоад.
      const target = Buffer.alloc(
        Math.max(payloadBuffer.length * compressionFactor, payloadBuffer.length * 16, 1 << 16),
      );
      const written = lz4.decompressBlock(
        new Uint8Array(payloadBuffer.buffer, payloadBuffer.byteOffset, payloadBuffer.byteLength),
        new Uint8Array(target.buffer, target.byteOffset, target.byteLength),
        0,
        payloadBuffer.length,
        0,
      );
      inflatedLength = written;
      payloadBuffer = target.subarray(0, written);
    } catch {
      // Битый инфлейт не валит сокет — decodePayload вернёт _decodeError.
    }
  }

  return {
    packet: {
      version,
      cmd,
      seq,
      opcode,
      opcodeName: opcodeName(opcode),
      compressionFactor,
      payloadLength,
      inflatedLength,
    },
    payloadBuffer,
    decoded: decodePayload(payloadBuffer),
    consumed: totalLength,
  };
}
