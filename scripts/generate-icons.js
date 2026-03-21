#!/usr/bin/env node
// Generates multi-resolution build/icon.ico and build/icon.png from the Daylens SVG source.
// Usage: node scripts/generate-icons.js

const sharp  = require('sharp')
const path   = require('path')
const fs     = require('fs')
const os     = require('os')

const SVG_SRC  = path.join(__dirname, '..', '..', '..', 'daylens-icon-composer.icon', 'Assets', 'daylens.svg')
const BUILD    = path.join(__dirname, '..', 'build')

const ICO_SIZES = [256, 128, 64, 48, 32, 16]

async function run() {
  if (!fs.existsSync(SVG_SRC)) {
    console.error('SVG source not found:', SVG_SRC)
    process.exit(1)
  }

  if (!fs.existsSync(BUILD)) fs.mkdirSync(BUILD, { recursive: true })

  const svgBuf = fs.readFileSync(SVG_SRC)

  // Build 512×512 PNG for window icon / macOS dock
  await sharp(svgBuf)
    .resize(512, 512)
    .png()
    .toFile(path.join(BUILD, 'icon.png'))
  console.log('✓ build/icon.png (512×512)')

  // Write PNGs at each size to temp files, then use png-to-ico with file paths
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daylens-icons-'))
  const tmpFiles = []
  for (const size of ICO_SIZES) {
    const tmpPath = path.join(tmpDir, `icon-${size}.png`)
    await sharp(svgBuf).resize(size, size).png().toFile(tmpPath)
    tmpFiles.push(tmpPath)
    console.log(`✓ ${size}×${size}`)
  }

  // Use png-to-ico with file paths
  const pngToIco = require('png-to-ico')
  const toIco = pngToIco.default ?? pngToIco
  const icoBuffer = await toIco(tmpFiles)
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), icoBuffer)
  console.log('✓ build/icon.ico (multi-resolution:', ICO_SIZES.join(', '), 'px)')

  // Cleanup temp files
  for (const f of tmpFiles) fs.unlinkSync(f)
  fs.rmdirSync(tmpDir)
}

run().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
