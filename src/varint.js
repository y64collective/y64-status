function encodeVarInt(value) {
  const bytes = [];
  let remaining = value;

  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (remaining !== 0);

  return Buffer.from(bytes);
}

function decodeVarInt(buffer, offset) {
  let value = 0;
  let shift = 0;
  let position = offset;

  while (true) {
    if (position >= buffer.length) {
      return null;
    }

    const byte = buffer[position];
    value |= (byte & 0x7f) << shift;
    position++;

    if ((byte & 0x80) === 0) {
      break;
    }

    shift += 7;
    if (shift >= 32) {
      throw new Error('VarInt is too big');
    }
  }

  return { value, length: position - offset };
}

module.exports = { encodeVarInt, decodeVarInt };
