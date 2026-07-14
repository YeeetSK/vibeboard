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

module.exports = {
  appId: 'com.yeeetsk.vibeboard',
  productName: 'VibeBoard',
  directories: {
    output: 'release'
  },
  files: ['out/**/*', 'build/icon.png', 'package.json'],
  asarUnpack: ['node_modules/better-sqlite3/**/*'],
  mac: {
    icon: 'build/icon.icns',
    identity: hasMacSigningIdentity ? undefined : '-',
    hardenedRuntime: hasMacSigningIdentity,
    gatekeeperAssess: false,
    notarize: hasMacSigningIdentity,
    target: [
      {
        target: 'dmg',
        arch: ['universal']
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
