// Type definitions for our lightweight C parser

declare module 'c-parser-lite' {
    export interface CParseOptions {
        locations?: boolean;
    }

    export function parse(code: string, options?: CParseOptions): any;
}
