#!/usr/bin/env node
// Rasterise SVG diagrams to PNG for embedding in .docx.
//
// Usage:  node render.js <in.svg> <out.png> [targetWidthPx]
//
// Uses sharp (librsvg). Note: librsvg does NOT render <foreignObject>, so D2
// sources must avoid |md| markdown blocks — use plain quoted labels instead.

const sharp = require('sharp');
const fs = require('fs');

const [, , input, output, widthArg] = process.argv;
if (!input || !output) {
  console.error('usage: node render.js <in.svg> <out.png> [targetWidthPx]');
  process.exit(1);
}

const targetWidth = parseInt(widthArg || '2400', 10);

const svg = fs.readFileSync(input);
const m = svg.toString().match(/width="(\d+(?:\.\d+)?)"\s+height="(\d+(?:\.\d+)?)"/);
if (!m) {
  console.error(`could not read intrinsic dimensions from ${input}`);
  process.exit(1);
}
const [w, h] = [parseFloat(m[1]), parseFloat(m[2])];

// Scale via density so text stays vector-crisp rather than being upscaled.
const density = Math.max(72, Math.min(2400, Math.round((targetWidth / w) * 72)));

sharp(svg, { density })
  .resize({ width: targetWidth, withoutEnlargement: false })
  .png({ compressionLevel: 9 })
  .toFile(output)
  .then((info) => {
    const ratio = (w / h).toFixed(2);
    console.log(
      `${input} → ${output}  source ${w}x${h} (${ratio}:1)  out ${info.width}x${info.height}  ${(fs.statSync(output).size / 1024).toFixed(0)}KB`
    );
  })
  .catch((err) => {
    console.error(`FAILED ${input}: ${err.message}`);
    process.exit(1);
  });
