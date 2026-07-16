const { spawn } = require('node:child_process')

const command = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
const child = spawn(command, ['dev'], {
  env: {
    ...process.env,
    VIBEBOARD_UPDATE_MOCK: '1'
  },
  shell: process.platform === 'win32',
  stdio: 'inherit'
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
