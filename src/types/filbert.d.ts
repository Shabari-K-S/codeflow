declare module 'filbert' {
    export interface Options {
        version?: number;
    }

    export function parse(input: string, options?: Options): any;

    export const pythonRuntime: {
        ops: {
            [key: string]: (a: any, b: any) => any;
        };
        functions: {
            print: (...args: any[]) => void;
            range: (start: number, stop?: number, step?: number) => number[];
        }
    };
}
