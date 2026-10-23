export type CheckKind = 'command' | 'fileExists' | 'fileMatch' | 'httpStatus' | 'expr' | 'textEquals' | 'commandAvailability' | 'packageVersion' | 'versionClaim' | 'symbolExists';
export interface Check {
    kind: CheckKind;
    claim?: string;
    argv?: string[];
    expectExit?: number;
    expectMatch?: string;
    expectRegex?: string;
    /** fileExists / fileMatch */
    path?: string;
    regex?: string;
    /** httpStatus */
    url?: string;
    expectStatus?: number;
    source?: string;
    signature?: string;
    /** textEquals */
    actual?: string;
    expected?: string;
    name?: string;
    cwd?: string;
    noRegistry?: boolean;
    timeoutMs?: number;
}
export interface CheckOutcome {
    ok: boolean;
    kind: string;
    claim?: string;
    detail: string;
}
export interface RunOptions {
    timeoutMs: number;
    denyBinaries: readonly string[];
    cwd?: string;
}
export declare function runCheck(check: Check, opts: RunOptions): Promise<CheckOutcome>;
export declare function runChecks(checks: readonly Check[], opts: RunOptions): Promise<CheckOutcome[]>;
