import type { DoubtConfig } from './config.js';
export interface PreflightDecision {
    kind: 'allow' | 'ask' | 'deny' | 'cancel';
    reason?: string;
    displayReason?: {
        en: string;
        zh: string;
    };
}
export interface PreflightHost {
    approval: () => any;
}
export declare function createPreflightGuard(getConfig: () => DoubtConfig, host: PreflightHost): (exec: any, next: () => Promise<any>) => Promise<any>;
