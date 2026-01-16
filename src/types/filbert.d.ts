declare module 'filbert' {
    export interface Options {
        version?: number;
        locations?: boolean;
        ranges?: boolean;
    }

    export function parse(input: string, options?: Options): any;

    export const pythonRuntime: {
        ops: {
            // Arithmetic
            add: (a: any, b: any) => any;
            subtract: (a: any, b: any) => any;
            multiply: (a: any, b: any) => any;
            divide: (a: any, b: any) => any;
            floorDivide: (a: any, b: any) => any;
            mod: (a: any, b: any) => any;
            pow: (a: any, b: any) => any;

            // Comparison
            eq: (a: any, b: any) => boolean;
            ne: (a: any, b: any) => boolean;
            lt: (a: any, b: any) => boolean;
            lte: (a: any, b: any) => boolean;
            gt: (a: any, b: any) => boolean;
            gte: (a: any, b: any) => boolean;

            // Logical & Membership
            in: (a: any, b: any) => boolean;
            notIn: (a: any, b: any) => boolean;
            is: (a: any, b: any) => boolean;
            isNot: (a: any, b: any) => boolean;
            and: (a: any, b: any) => any;
            or: (a: any, b: any) => any;
            not: (a: any) => boolean;

            // Unary
            usub: (a: any) => any;
            uadd: (a: any) => any;

            // Container
            subscriptIndex: (obj: any, key: any) => any;
            [key: string]: (a: any, b?: any) => any;
        };
        functions: {
            print: (...args: any[]) => void;
            range: (start: number, stop?: number, step?: number) => any; // Returns PythonList/Array
            len: (obj: any) => number;
            str: (obj: any) => string;
            int: (obj: any) => number;
            float: (obj: any) => number;
            bool: (obj: any) => boolean;
            list: (iterable?: any) => any[];
            dict: (iterable?: any) => any;
            set: (iterable?: any) => Set<any>;
            tuple: (iterable?: any) => any[];
            abs: (x: number) => number;
            min: (...args: any[]) => any;
            max: (...args: any[]) => any;
            sum: (iterable: any, start?: number) => number;
            type: (obj: any) => string;
            [key: string]: (...args: any[]) => any;
        };
        objects: {
            list: new (...args: any[]) => any;
            dict: new (...args: any[]) => any;
            [key: string]: any;
        };
    };
}
