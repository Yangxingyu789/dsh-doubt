export interface SourceHit {
    label: string;
    value: string;
    ok: boolean;
    weak?: boolean;
}
export interface OracleResult {
    kind: string;
    claim: string;
    ok: boolean;
    noEvidence: boolean;
    sources: SourceHit[];
    detail: string;
}
export declare function which(bin: string): string | null;
export declare function commandAvailability(claim: string, argv: readonly string[]): OracleResult;
export declare function packageVersion(claim: string, name: string, cwd: string): OracleResult;
export declare function rangeSatisfied(range: string, version: string): boolean | undefined;
export declare function versionClaim(claim: string, cwd: string, name?: string): OracleResult;
export declare function symbolExists(claim: string, cwd: string): OracleResult;
