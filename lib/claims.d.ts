import type { Check } from './verify.js';
import type { Finding } from './scanner.js';
export interface Claim {
    id: string;
    kind: string;
    text: string;
    checks: Check[];
    unmechanizable?: string;
}
export declare function splitCommand(cmd: string): string[] | null;
export declare function packageForVersionClaim(text: string): string | null;
export declare function extractClaims(findings: readonly Finding[], opts?: {
    executeAnswerCommands?: boolean;
    text?: string;
}): Claim[];
