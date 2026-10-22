import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

export interface Workspace {
  root: string;
  /** Writes a file (creating folders) and returns its absolute path. */
  write(relativePath: string, content: string | Buffer): Promise<string>;
  cleanup(): Promise<void>;
}

export async function createWorkspace(prefix = 'mdreader-e2e-'): Promise<Workspace> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    root,
    async write(relativePath, content) {
      const target = path.join(root, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
      return target;
    },
    cleanup: () => removeWithRetries(root),
  };
}

/** Windows keeps files locked for a moment after a process exits. */
export function removeWithRetries(target: string): Promise<void> {
  return rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}

const CRC_TABLE = Array.from({ length: 256 }, (_unused, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A small, valid, solid-colour PNG so image loading can be verified by decoding it in the page. */
export function createPng(
  width = 8,
  height = 8,
  rgba: [number, number, number, number] = [200, 60, 60, 255],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA

  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width }, () => rgba).flat()),
  ]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
