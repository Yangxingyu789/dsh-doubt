export interface Finding {
    kind: string;
    weight: number;
    snippet: string;
    hint: string;
}
export interface ScanResult {
    score: number;
    findings: Finding[];
    chars: number;
}
export interface ScanOptions {
    detectors?: Record<string, boolean>;
    capPerKind?: number;
}
export declare const DETECTOR_KINDS: readonly string[];
export declare function scanAnswer(text: string, options?: ScanOptions): ScanResult;
export declare function turnHadVerification(toolNames: Iterable<string>, allowed: readonly string[]): boolean;
export declare function writtenDeliverables(events: readonly unknown[], turn: number): string[];
export declare function agentWorkspace(agent: unknown): string | null;
export declare function sessionCwd(events: readonly unknown[]): string | null;
export interface TurnExtract {
    turn: number;
    text: string;
    finalText: string;
    toolNames: string[];
}
export declare function extractTurn(events: readonly unknown[], turn: number): TurnExtract;
export declare function collectText(message: unknown): string;
export declare function lastTurn(events: readonly unknown[]): number;
