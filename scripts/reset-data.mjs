import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const appName = 'vibeboard'
const dataDir =
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', appName)
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), appName)
      : path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), appName)

fs.rmSync(dataDir, { recursive: true, force: true })
console.log(`Removed ${dataDir}`)
