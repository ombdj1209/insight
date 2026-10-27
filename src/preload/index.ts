import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MainEvents, SegmentPayload } from '../shared/types'

const api = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args),
  sendSegment: (p: SegmentPayload): void => ipcRenderer.send('segment', p),
  /** fire-and-forget pointer messages from the pet and visitor windows (only pet:* channels and visitor:shape) */
  petSend: (channel: 'pet:shape' | 'pet:grab' | 'pet:moveTo' | 'pet:throw' | 'pet:walk' | 'visitor:shape', ...args: unknown[]): void => {
    if (channel.startsWith('pet:') || channel === 'visitor:shape') ipcRenderer.send(channel, ...args)
  },
  /** absolute path of a dropped file (File.path was removed in Electron 32) */
  pathForFile: (f: File): string => webUtils.getPathForFile(f),
  on: <K extends keyof MainEvents>(channel: K, cb: (payload: MainEvents[K]) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: MainEvents[K]): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('insight', api)
export type InsightApi = typeof api
