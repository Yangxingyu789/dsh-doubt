export interface ProbeOptions {
    urls: readonly string[];
    timeoutMs: number;
}
export interface NetState {
    online: boolean;
    probedAt: number;
    latencyMs: number;
    via?: string;
}
export declare class NetProbe {
    private readonly opts;
    private cache;
    private ttlMs;
    constructor(opts: ProbeOptions, ttlMs?: number);
    cached(): NetState | null;
    state(): Promise<NetState>;
    invalidate(): void;
}
