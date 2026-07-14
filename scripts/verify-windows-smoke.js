#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { verifyRuntimeCapture } = require('./verify-runtime-capture')

function usage() {
  console.error('Usage: node scripts/verify-windows-smoke.js --report <path> --window-state <path>')
  process.exit(1)
}

function readArg(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  return process.argv[index + 1] ?? null
}

function fail(message) {
  console.error(`Smoke verification failed: ${message}`)
  process.exit(1)
}

const reportPathArg = readArg('--report')
const windowStatePath = readArg('--window-state')
if (!reportPathArg || !windowStatePath) usage()

const reportPath = path.resolve(reportPathArg)
if (!fs.existsSync(reportPath)) {
  fail(`Report file does not exist: ${reportPath}`)
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))

if (report.ok !== true) {
  fail(`App reported failure at stage "${report.stage ?? 'unknown'}": ${report.error ?? 'unknown error'}`)
}

if (report.platform !== 'win32') {
  fail(`Expected win32 platform, got: ${report.platform}`)
}

if (report.isPackaged !== true) {
  fail('Expected a packaged app runtime.')
}

if (!report.trackingStatus || typeof report.trackingStatus !== 'object') {
  fail('Tracking status was missing from the smoke report.')
}

if (!report.browserStatus || typeof report.browserStatus !== 'object') {
  fail('Browser diagnostics were missing from the smoke report.')
}

if (!Array.isArray(report.browserStatus.discoveredBrowsers)) {
  fail('Browser discovery diagnostics were malformed.')
}

if (!report.updater || typeof report.updater !== 'object') {
  fail('Updater diagnostics were missing from the smoke report.')
}

const capture = verifyRuntimeCapture(report, windowStatePath, fail)

console.log('Windows smoke verification passed:')
console.log(JSON.stringify(capture, null, 2))
process.exit(0)
