import type { DoubtConfig } from './config.js';
export interface PlainToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: {
        schema: Record<string, unknown>;
        render: (args: any, value: any) => Array<{
            type: 'text';
            text: string;
        }>;
    };
    execute: (args: any, exec: {
        signal?: AbortSignal;
    }) => Promise<unknown>;
}
export declare function buildVerifyTool(getConfig: () => DoubtConfig): PlainToolDefinition;
