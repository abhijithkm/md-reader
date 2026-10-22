// Renders the SVG sources in build/ into the icon files electron-builder needs:
//   build/icon.png       512 px, used for the development window
//   build/icon.ico       application icon (16-256 px)
//   build/file-icon.ico  icon for .md and .markdown files (16-256 px)
//
// Run `npm run icons` after changing either SVG, and commit the result.

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const buildDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function renderPng(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

/** Packs PNG images into an .ico file (PNG-in-ICO, supported by Windows Vista and later). */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  images.forEach(({ size, data }, index) => {
    const entry = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, entry); // width (0 means 256)
    directory.writeUInt8(size >= 256 ? 0 : size, entry + 1); // height
    directory.writeUInt8(0, entry + 2); // palette size
    directory.writeUInt8(0, entry + 3); // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...images.map((image) => image.data)]);
}

const appIcon = await readFile(path.join(buildDir, 'icon.svg'), 'utf8');
const fileIcon = await readFile(path.join(buildDir, 'file-icon.svg'), 'utf8');
const icoFor = (svg) => encodeIco(ICO_SIZES.map((size) => ({ size, data: renderPng(svg, size) })));

await writeFile(path.join(buildDir, 'icon.png'), renderPng(appIcon, 512));
await writeFile(path.join(buildDir, 'icon.ico'), icoFor(appIcon));
await writeFile(path.join(buildDir, 'file-icon.ico'), icoFor(fileIcon));
console.log('Wrote build/icon.png, build/icon.ico and build/file-icon.ico');
