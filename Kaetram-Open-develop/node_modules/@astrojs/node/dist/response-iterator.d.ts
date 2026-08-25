/**
 * Original sources:
 *  - https://github.com/kmalakoff/response-iterator/blob/master/src/index.ts
 *  - https://github.com/apollographql/apollo-client/blob/main/src/utilities/common/responseIterator.ts
 */
/// <reference types="node" resolution-mode="require"/>
export declare function responseIterator<T>(response: Response | Buffer): AsyncIterableIterator<T>;
