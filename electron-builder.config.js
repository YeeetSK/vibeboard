const signingEnvKeys = [
  'CSC_LINK',
  'CSC_NAME',
  'CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER'
]

for (const key of signingEnvKeys) {
  if (!process.env[key]?.trim()) {
    delete process.env[key]
  }
}

const hasMacSigningIdentity = Boolean(process.env.CSC_LINK || process.env.CSC_NAME)
const fs = require('node:fs')
const path = require('node:path')

const keptLocales = new Set(['Base.lproj', 'en.lproj', 'en_GB.lproj', 'sk.lproj'])
const keptLocalePaks = new Set(['en-US.pak', 'en-GB.pak', 'sk.pak'])

function removeIfExists(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true, recursive: true })
  }
}

function trimLprojFolders(rootPath) {
  if (!fs.existsSync(rootPath)) return

  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.endsWith('.lproj') && !keptLocales.has(entry.name)) {
      removeIfExists(path.join(rootPath, entry.name))
    }
  }
}

function trimElectronLocales(appOutDir) {
  const macResources = path.join(appOutDir, 'VibeBoard.app', 'Contents', 'Resources')
  const frameworkResources = path.join(
    appOutDir,
    'VibeBoard.app',
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Resources'
  )
  trimLprojFolders(macResources)
  trimLprojFolders(frameworkResources)

  const winLocales = path.join(appOutDir, 'locales')
  if (fs.existsSync(winLocales)) {
    for (const entry of fs.readdirSync(winLocales, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.pak') && !keptLocalePaks.has(entry.name)) {
        removeIfExists(path.join(winLocales, entry.name))
      }
    }
  }
}

function trimSqliteBuildFiles(appOutDir) {
  const resourcesRoot =
    process.platform === 'darwin'
      ? path.join(appOutDir, 'VibeBoard.app', 'Contents', 'Resources')
      : path.join(appOutDir, 'resources')
  const sqliteRoot = path.join(resourcesRoot, 'app.asar.unpacked', 'node_modules', 'better-sqlite3')
  removeIfExists(path.join(sqliteRoot, 'deps'))
  removeIfExists(path.join(sqliteRoot, 'src'))
  removeIfExists(path.join(sqliteRoot, 'build', 'deps'))
  removeIfExists(path.join(sqliteRoot, 'build', 'Release', 'test_extension.node'))
}

module.exports = {
  appId: 'com.yeeetsk.vibeboard',
  productName: 'VibeBoard',
  compression: 'maximum',
  artifactName: '${productName}-${version}-${arch}.${ext}',
  directories: {
    output: 'release'
  },
  files: [
    'out/**/*',
    'build/icon.png',
    'package.json',
    '!node_modules/better-sqlite3/deps/**/*',
    '!node_modules/better-sqlite3/src/**/*',
    '!node_modules/better-sqlite3/build/deps/**/*',
    '!node_modules/better-sqlite3/build/Release/test_extension.node'
  ],
  asarUnpack: ['node_modules/better-sqlite3/build/Release/better_sqlite3.node'],
  afterPack: async (context) => {
    trimElectronLocales(context.appOutDir)
    trimSqliteBuildFiles(context.appOutDir)
  },
  mac: {
    icon: 'build/icon.icns',
    identity: hasMacSigningIdentity ? undefined : '-',
    hardenedRuntime: hasMacSigningIdentity,
    gatekeeperAssess: false,
    notarize: hasMacSigningIdentity,
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64']
      }
    ],
    category: 'public.app-category.developer-tools'
  },
  win: {
    icon: 'build/icon.ico',
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ]
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true
  }
}
