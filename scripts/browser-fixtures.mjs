import { deflateSync } from "node:zlib";
export function createTestPng() {
  const chunk = (name, data) => {
    const type = Buffer.from(name),
      content = Buffer.concat([type, data]);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    const length = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, content, sum]);
  };
  const w = 480,
    h = 200,
    header = Buffer.alloc(13);
  header.writeUInt32BE(w);
  header.writeUInt32BE(h, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      const sky = y < 110,
        boat = y > 105 && y < 133 && x > 170 + (y - 105) && x < 310 - (y - 105);
      pixels[i] = boat ? 219 : sky ? 154 : 56;
      pixels[i + 1] = boat ? 176 : sky ? 185 : 101;
      pixels[i + 2] = boat ? 116 : sky ? 200 : 131;
    }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
