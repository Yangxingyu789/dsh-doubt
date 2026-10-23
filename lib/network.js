export class NetProbe {
    opts;
    cache = null;
    ttlMs;
    constructor(opts, ttlMs = 30_000) {
        this.opts = opts;
        this.ttlMs = ttlMs;
    }
    cached() {
        if (!this.cache)
            return null;
        if (Date.now() - this.cache.probedAt > this.ttlMs)
            return null;
        return this.cache;
    }
    async state() {
        const hit = this.cached();
        if (hit)
            return hit;
        const started = Date.now();
        for (const url of this.opts.urls) {
            try {
                const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(this.opts.timeoutMs) });
                if (res.ok || res.status === 404) {
                    this.cache = { online: true, probedAt: Date.now(), latencyMs: Date.now() - started, via: url };
                    return this.cache;
                }
            }
            catch { /* try next */ }
        }
        this.cache = { online: false, probedAt: Date.now(), latencyMs: Date.now() - started };
        return this.cache;
    }
    invalidate() {
        this.cache = null;
    }
}
//# sourceMappingURL=network.js.map