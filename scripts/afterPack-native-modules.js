const fs = require('node:fs')
const path = require('node:path')

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, results)
    } else if (entry.isFile() && entry.name === 'app.asar') {
      results.push(fullPath)
    }
  }
  return results
}

function requiredFilesFor(name) {
  if (name === 'better-sqlite3') {
    return [
      'package.json',
      path.join('lib', 'index.js'),
      path.join('lib', 'database.js'),
      path.join('build', 'Release', 'better_sqlite3.node'),
    ]
  }

  if (name === 'bindings') {
    return ['package.json', 'bindings.js']
  }

  if (name === 'file-uri-to-path') {
    return ['package.json', 'index.js']
  }

  if (name === '@paymoapp/active-window') {
    return [
      'package.json',
      path.join('dist', 'index.js'),
      path.join('build', 'Release', 'PaymoActiveWindow.node'),
    ]
  }

  if (name === 'keytar') {
    return [
      'package.json',
      path.join('lib', 'keytar.js'),
      path.join('build', 'Release', 'keytar.node'),
    ]
  }

  return ['package.json']
}

function isDependencyComplete(target, name) {
  return requiredFilesFor(name).every((entry) => fs.existsSync(path.join(target, entry)))
}

function copyDependency(projectDir, resourcesDir, name) {
  const source = path.join(projectDir, 'node_modules', ...name.split('/'))
  const target = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', ...name.split('/'))

  if (!fs.existsSync(source)) {
    throw new Error(`Cannot repair unpacked native dependency; missing source ${source}`)
  }

  if (isDependencyComplete(target, name)) {
    return
  }

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.cpSync(source, target, { recursive: true, force: true })
}

exports.default = async function afterPackNativeModules(context) {
  const asarPaths = walk(context.appOutDir)
  for (const asarPath of asarPaths) {
    const resourcesDir = path.dirname(asarPath)
    const unpackedBase = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules')

    // Only run repairs if electron-builder created an unpacked directory
    if (!fs.existsSync(unpackedBase)) continue

    // better-sqlite3 and its transitive deps (uses `bindings` package)
    copyDependency(context.packager.info.projectDir, resourcesDir, 'better-sqlite3')
    copyDependency(context.packager.info.projectDir, resourcesDir, 'bindings')
    copyDependency(context.packager.info.projectDir, resourcesDir, 'file-uri-to-path')

    // @paymoapp/active-window (tracking backend — app cannot launch without this)
    copyDependency(context.packager.info.projectDir, resourcesDir, '@paymoapp/active-window')

    // keytar (secure credential storage)
    copyDependency(context.packager.info.projectDir, resourcesDir, 'keytar')
  }
}
