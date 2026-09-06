const net = require('net');
const dns = require('dns').promises;
const { encodeVarInt, decodeVarInt } = require('./varint');

const DEFAULT_TIMEOUT_MS = 5_000;
const HANDSHAKE_PROTOCOL_VERSION = -1;
const STATUS_NEXT_STATE = 1;
const STATUS_PACKET_ID = 0x00;

function encodeString(value) {
  const content = Buffer.from(value, 'utf8');
  return Buffer.concat([encodeVarInt(content.length), content]);
}

function buildPacket(packetId, payload) {
  const body = Buffer.concat([encodeVarInt(packetId), payload]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}

function buildHandshakePacket(host, port) {
  const payload = Buffer.concat([
    encodeVarInt(HANDSHAKE_PROTOCOL_VERSION),
    encodeString(host),
    Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    encodeVarInt(STATUS_NEXT_STATE),
  ]);
  return buildPacket(STATUS_PACKET_ID, payload);
}

function buildStatusRequestPacket() {
  return buildPacket(STATUS_PACKET_ID, Buffer.alloc(0));
}

function readStatusResponse(buffer) {
  const packetLength = decodeVarInt(buffer, 0);
  if (!packetLength) {
    return null;
  }

  const packetStart = packetLength.length;
  const packetEnd = packetStart + packetLength.value;
  if (buffer.length < packetEnd) {
    return null;
  }

  const packetId = decodeVarInt(buffer, packetStart);
  if (!packetId) {
    return null;
  }

  const jsonLength = decodeVarInt(buffer, packetStart + packetId.length);
  if (!jsonLength) {
    return null;
  }

  const jsonStart = packetStart + packetId.length + jsonLength.length;
  const jsonEnd = jsonStart + jsonLength.value;

  return JSON.parse(buffer.toString('utf8', jsonStart, jsonEnd));
}

async function resolveSrv(host) {
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    return records[0] ?? null;
  } catch {
    return null;
  }
}

async function pingServer(host, port, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const srv = await resolveSrv(host);
  const target = srv ? { host: srv.name, port: srv.port } : { host, port };

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = Buffer.alloc(0);
    let settled = false;

    const finish = (error, result) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish(new Error('Connection timed out')));
    socket.on('error', (error) => finish(error));

    socket.on('connect', () => {
      socket.write(buildHandshakePacket(host, port));
      socket.write(buildStatusRequestPacket());
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      try {
        const status = readStatusResponse(buffer);
        if (status) {
          finish(null, status);
        }
      } catch (error) {
        finish(new Error('Failed to parse status response'));
      }
    });

    socket.connect(target.port, target.host);
  });
}

module.exports = { pingServer };
