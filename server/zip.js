/**
 * Minimal, dependency-free ZIP (store + deflate) writer.
 * Produces a standard .zip archive readable by Windows Explorer, macOS,
 * 7-Zip, `unzip` and Roblox Studio's "Import from file" workflows.
 */
import zlib from 'node:zlib';

/* ------------------------------------------------------------------ *
 * CRC-32
 * ------------------------------------------------------------------ */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
const DOS_TIME = () => {
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xffff, date: date & 0xffff };
};

function toBuffer(content) {
  if (Buffer.isBuffer(content)) return content;
  if (typeof content === 'string') return Buffer.from(content, 'utf8');
  return Buffer.from(JSON.stringify(content, null, 2), 'utf8');
}

/**
 * Build a ZIP archive in memory.
 * @param {Array<{path: string, content: string|Buffer}>} files
 * @returns {Buffer}
 */
export function createZip(files) {
  const { time, date } = DOS_TIME();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(String(file.path).replace(/\\/g, '/').replace(/^\/+/, ''), 'utf8');
    const raw = toBuffer(file.content);
    const crc = crc32(raw);

    // Small files gain nothing from deflate; keep them stored for speed.
    let method = 8;
    let body = zlib.deflateRawSync(raw, { level: 9 });
    if (body.length >= raw.length) {
      method = 0;
      body = raw;
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    localParts.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(0x031e, 4); // version made by (unix, 3.0)
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: -rw-r--r--
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralBuf, end]);
}

/** Naive but sufficient ZIP reader for tests / round-tripping own archives. */
export function readZipEntries(buf) {
  const out = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const uncompSize = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extraLen;
    const body = buf.subarray(start, start + compSize);
    const content = method === 0 ? body : zlib.inflateRawSync(body);
    if (content.length !== uncompSize) throw new Error(`Corrupt entry ${name}`);
    out.push({ path: name, content });
    i = start + compSize;
  }
  return out;
}
