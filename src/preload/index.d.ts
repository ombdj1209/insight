import type { InsightApi } from './index'

declare global {
  interface Window {
    insight: InsightApi
  }
}
export {}
