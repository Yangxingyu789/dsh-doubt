export interface ToolTrace {
    id: string;
    name: string;
    args: Record<string, unknown>;
    callIndex: number;
    resultIndex: number;
    state: 'completed' | 'failed' | 'pending' | 'unknown';
    /** Actual tool output, not the author's description of it. */
    resultText: string;
    /** Characters dropped from resultText by the review budget; 0/undefined = whole. */
    truncated?: number;
    /** Original host turn and event time; historical observations are not fresh checks. */
    turn?: number;
    observedAt?: number;
}
export declare function toolTrace(events: readonly unknown[], turn?: number): ToolTrace[];
