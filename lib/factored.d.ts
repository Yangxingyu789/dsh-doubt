export interface FactoredHost {
    /** ctx.subagents */
    subagents: any;
    parent: any;
}
export interface FactoredVote {
    raw: string;
    normalized: string;
}
export interface FactoredOutcome {
    available: boolean;
    majority: string | null;
    agree: number;
    total: number;
    votes: FactoredVote[];
    reason?: string;
}
export declare function normalizeAnswer(text: string): string;
export declare function factoredCheck(question: string, opts: {
    provider: string;
    votes: number;
    timeoutMs: number;
}, host: FactoredHost | null): Promise<FactoredOutcome>;
