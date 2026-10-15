import { execFile } from 'child_process'
import { cpus, totalmem } from 'os'
import type { GpuInfo, HardwareInfo, PresetId } from '../shared/types'

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, out) => resolve(err ? '' : String(out))))

const vendorOf = (name: string): GpuInfo['vendor'] =>
  /nvidia|geforce|rtx|quadro/i.test(name) ? 'nvidia' : /amd|radeon/i.test(name) ? 'amd' : /intel|arc|iris|uhd/i.test(name) ? 'intel' : 'other'

export async function detectHardware(): Promise<HardwareInfo> {
  const gpus: GpuInfo[] = []
  const smi = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'])
  for (const line of smi.split(/\r?\n/).filter(Boolean)) {
    const [name, mem] = line.split(',').map((s) => s.trim())
    gpus.push({ name, vendor: 'nvidia', vramMB: Number(mem) || 0 })
  }
  if (process.platform === 'win32') {
    // Registry holds the true 64-bit VRAM size; Win32_VideoController.AdapterRAM caps at 4 GB.
    const ps = await run('powershell.exe', [
      '-NoProfile',
      '-Command',
      "Get-ItemProperty 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*' -ErrorAction SilentlyContinue | Where-Object { $_.DriverDesc } | ForEach-Object { '{0}|{1}' -f $_.DriverDesc, $_.'HardwareInformation.qwMemorySize' }"
    ])
    for (const line of ps.split(/\r?\n/).filter(Boolean)) {
      const [name, bytes] = line.split('|')
      if (!name || gpus.some((g) => g.name === name.trim())) continue
      const vendor = vendorOf(name)
      if (vendor === 'nvidia' && gpus.some((g) => g.vendor === 'nvidia')) continue
      gpus.push({ name: name.trim(), vendor, vramMB: Math.round((Number(bytes) || 0) / 1048576) })
    }
  }
  const ramGB = Math.round(totalmem() / 1073741824)
  const best = [...gpus].sort((a, b) => b.vramMB - a.vramMB)[0]
  let recommended: PresetId = 'light'
  let reason = 'No GPU with enough memory was found, so speech recognition runs on the CPU and notes use the Gemini API.'
  if (best?.vendor === 'nvidia' && best.vramMB >= 11000) {
    recommended = 'full'
    reason = `${best.name} (${Math.round(best.vramMB / 1024)} GB) can run Gemma 4 E4B Q8 locally.`
  } else if (best && best.vramMB >= 6000 && best.vendor !== 'other') {
    recommended = 'balanced'
    reason = `${best.name} (${Math.round(best.vramMB / 1024)} GB) fits Gemma 4 E4B at 4-bit.`
  }
  return { gpus, ramGB, cores: cpus().length, recommended, reason }
}

export const defaultBackend = (h: HardwareInfo): 'cuda' | 'vulkan' | 'cpu' => {
  const best = [...h.gpus].sort((a, b) => b.vramMB - a.vramMB)[0]
  if (!best || best.vramMB < 4000) return 'cpu'
  return best.vendor === 'nvidia' ? 'cuda' : 'vulkan'
}
