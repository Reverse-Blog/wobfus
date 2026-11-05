import { big5Identifier } from './big5.ts';

export function encodeVmPayload(value: unknown, seed: number): string {
  const bytes: number[] = [];
  const scratch = new DataView(new ArrayBuffer(8));
  const writeLength = (length: number) => {
    scratch.setUint32(0, length, true);
    for (let index = 0; index < 4; index++) bytes.push(scratch.getUint8(index));
  };
  const write = (item: unknown): void => {
    if (item === null) bytes.push(0);
    else if (item === false) bytes.push(1);
    else if (item === true) bytes.push(2);
    else if (typeof item === 'number') {
      bytes.push(3);
      scratch.setFloat64(0, item, true);
      for (let index = 0; index < 8; index++) bytes.push(scratch.getUint8(index));
    } else if (typeof item === 'string') {
      bytes.push(4);
      writeLength(item.length);
      for (let index = 0; index < item.length; index++) {
        const code = item.charCodeAt(index);
        bytes.push(code & 255, code >>> 8);
      }
    } else if (Array.isArray(item)) {
      bytes.push(5);
      writeLength(item.length);
      for (const child of item) write(child);
    } else {
      throw new TypeError('Unsupported binary VM payload value.');
    }
  };
  write(value);
  let state = seed >>> 0;
  let encoded = '';
  for (const byte of bytes) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const cipher = byte ^ (state >>> 24);
    state = (state ^ cipher) >>> 0;
    encoded += big5Identifier(cipher >>> 4) + big5Identifier(cipher & 15);
  }
  return encoded;
}

// Keep this function self-contained: it is embedded in generated JavaScript.
export function decodeVmPayload(data: string, alphabet: string, seed: number): unknown {
  if (data.length % 4 !== 0) throw new Error('Invalid binary VM payload length.');
  const bytes = new Uint8Array(data.length / 4);
  let state = seed >>> 0;
  for (let index = 0; index < bytes.length; index++) {
    const high = alphabet.indexOf(data[index * 4]!);
    const low = alphabet.indexOf(data[index * 4 + 2]!);
    if (high < 0 || low < 0 || high % 2 !== 0 || low % 2 !== 0) {
      throw new Error('Invalid binary VM payload digit.');
    }
    if (
      data[index * 4 + 1] !== alphabet[high + 1] ||
      data[index * 4 + 3] !== alphabet[low + 1]
    ) throw new Error('Invalid binary VM payload separator.');
    const cipher = ((high / 2) << 4) | (low / 2);
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[index] = cipher ^ (state >>> 24);
    state = (state ^ cipher) >>> 0;
  }
  const view = new DataView(bytes.buffer);
  let position = 0;
  const requireBytes = (length: number) => {
    if (length > bytes.length - position) throw new Error('Truncated binary VM payload.');
  };
  const readLength = () => {
    requireBytes(4);
    const length = view.getUint32(position, true);
    position += 4;
    return length;
  };
  const read = (): unknown => {
    requireBytes(1);
    const tag = view.getUint8(position++);
    switch (tag) {
      case 0: return null;
      case 1: return false;
      case 2: return true;
      case 3: {
        requireBytes(8);
        const number = view.getFloat64(position, true);
        position += 8;
        return number;
      }
      case 4: {
        const length = readLength();
        requireBytes(length * 2);
        let value = '';
        for (let index = 0; index < length; index++) {
          value += String.fromCharCode(view.getUint16(position, true));
          position += 2;
        }
        return value;
      }
      case 5: {
        const length = readLength();
        requireBytes(length);
        const values: unknown[] = [];
        for (let index = 0; index < length; index++) values.push(read());
        return values;
      }
      default: throw new Error('Invalid binary VM payload tag.');
    }
  };
  const result = read();
  if (position !== bytes.length) throw new Error('Trailing binary VM payload data.');
  return result;
}
