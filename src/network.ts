/**
 * 联网探测：决定走「多来源交叉」还是「本地 oracle + 独立重推导」。
 * 结果带 TTL 缓存，避免每条断言都探一次。
 */

export interface ProbeOptions {
  urls: readonly string[]
  timeoutMs: number
}

export interface NetState {
  online: boolean
  probedAt: number
  latencyMs: number
  via?: string
}

export class NetProbe {
  private cache: NetState | null = null
  private ttlMs: number

  constructor(private readonly opts: ProbeOptions, ttlMs = 30_000) {
    this.ttlMs = ttlMs
  }

  cached(): NetState | null {
    if (!this.cache) return null
    if (Date.now() - this.cache.probedAt > this.ttlMs) return null
    return this.cache
  }

  async state(): Promise<NetState> {
    const hit = this.cached()
    if (hit) return hit
    const started = Date.now()
    for (const url of this.opts.urls) {
      try {
        const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(this.opts.timeoutMs) })
        if (res.ok || res.status === 404) {
          this.cache = { online: true, probedAt: Date.now(), latencyMs: Date.now() - started, via: url }
          return this.cache
        }
      } catch { /* try next */ }
    }
    this.cache = { online: false, probedAt: Date.now(), latencyMs: Date.now() - started }
    return this.cache
  }

  invalidate(): void {
    this.cache = null
  }
}
