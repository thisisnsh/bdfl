#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const width = 720;
const height = 360;
const palette = [[14, 15, 18], [250, 204, 21], [66, 186, 117], [230, 84, 94]];

function le16(value) { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value); return buffer; }
function le32(value) { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0); return buffer; }

function pixels() { return new Uint8Array(width * height); }
function rect(frame, x, y, w, h, color) {
  for (let row = Math.max(0, y); row < Math.min(height, y + h); row += 1) {
    frame.fill(color, row * width + Math.max(0, x), row * width + Math.min(width, x + w));
  }
}
function border(frame, x, y, w, h, color) {
  rect(frame, x, y, w, 2, color); rect(frame, x, y + h - 2, w, 2, color);
  rect(frame, x, y, 2, h, color); rect(frame, x + w - 2, y, 2, h, color);
}

function terminal(frame) {
  border(frame, 18, 18, width - 36, height - 36, 1);
  rect(frame, 36, 40, 14, 14, 1); rect(frame, 58, 40, 14, 14, 1); rect(frame, 80, 40, 14, 14, 1);
  rect(frame, 36, 72, 390, 6, 1);
}

function baseFrame(periods) {
  const frame = pixels(); terminal(frame);
  for (let dot = 0; dot < periods; dot += 1) rect(frame, 438 + dot * 12, 72, 6, 6, 1);
  return frame;
}

function makeFrames() {
  const sequence = [1, 2, 3, 4, 3, 2];
  return sequence.map((periods, index) => {
    const frame = baseFrame(periods);
    if (index === 0) {
      rect(frame, 36, 112, 240, 8, 1); rect(frame, 36, 136, 360, 6, 1);
    } else if (index === 1) {
      rect(frame, 36, 108, 150, 8, 1); rect(frame, 36, 138, 420, 8, 3); rect(frame, 36, 162, 350, 8, 2);
      rect(frame, 36, 186, 470, 8, 2); rect(frame, 36, 210, 310, 8, 3);
    } else if (index === 2) {
      for (let agent = 0; agent < 4; agent += 1) {
        border(frame, 36 + agent * 160, 118, 130, 120, 1);
        rect(frame, 50 + agent * 160, 140, 70, 7, 2); rect(frame, 50 + agent * 160, 164, 96, 6, 1);
      }
    } else if (index === 3) {
      border(frame, 90, 112, 540, 150, 1); rect(frame, 116, 138, 180, 8, 1);
      rect(frame, 116, 174, 420, 7, 3); rect(frame, 116, 206, 260, 7, 1);
    } else if (index === 4) {
      for (let row = 0; row < 4; row += 1) {
        rect(frame, 50, 112 + row * 38, 18, 18, row < 3 ? 2 : 1);
        rect(frame, 86, 116 + row * 38, 410 - row * 30, 8, 1);
      }
    } else {
      rect(frame, 36, 112, 540, 8, 2); rect(frame, 36, 146, 600, 8, 1);
      rect(frame, 36, 180, 300, 8, 2); rect(frame, 36, 214, 460, 8, 1);
    }
    rect(frame, 36, 310, 620, 5, 1);
    return frame;
  });
}

function lzw(frame) {
  const codes = [];
  for (const pixel of frame) codes.push(4, pixel);
  codes.push(5);
  const bytes = [];
  let current = 0;
  let bits = 0;
  for (const code of codes) {
    current |= code << bits;
    bits += 3;
    while (bits >= 8) { bytes.push(current & 255); current >>= 8; bits -= 8; }
  }
  if (bits) bytes.push(current & 255);
  const blocks = [Buffer.from([2])];
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const block = Buffer.from(bytes.slice(offset, offset + 255));
    blocks.push(Buffer.from([block.length]), block);
  }
  blocks.push(Buffer.from([0]));
  return Buffer.concat(blocks);
}

function gif(frames) {
  const chunks = [Buffer.from('GIF89a'), le16(width), le16(height), Buffer.from([0xf1, 0, 0])];
  chunks.push(Buffer.from(palette.flat()));
  chunks.push(Buffer.from([0x21, 0xff, 0x0b]), Buffer.from('NETSCAPE2.0'), Buffer.from([3, 1, 0, 0, 0]));
  for (const frame of frames) {
    chunks.push(Buffer.from([0x21, 0xf9, 4, 4]), le16(50), Buffer.from([0, 0]));
    chunks.push(Buffer.from([0x2c]), le16(0), le16(0), le16(width), le16(height), Buffer.from([0]));
    chunks.push(lzw(frame));
  }
  chunks.push(Buffer.from([0x3b]));
  return Buffer.concat(chunks);
}

const output = path.resolve(__dirname, '..', 'docs', 'assets', 'terminal-demo.gif');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, gif(makeFrames()));
console.log(`Generated ${path.relative(process.cwd(), output)}`);
