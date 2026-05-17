declare module 'ssh2' {
  import { Socket, Readable, Writable } from 'stream';

  export class Client {
    connect(config: ConnectConfig): void;
    on(event: 'ready', callback: () => void): this;
    on(event: 'error', callback: (err: Error) => void): this;
    on(event: 'close', callback: () => void): this;
    exec(command: string, callback: (err: Error | null, stream: ClientChannel) => void): void;
    end(): void;
    destroy(): void;
  }

  export interface ConnectConfig {
    host: string;
    port?: number;
    username?: string;
    password?: string;
    privateKey?: string | Buffer;
    passphrase?: string;
    readyTimeout?: number;
    keepaliveInterval?: number;
    keepaliveCountMax?: number;
  }

  export interface ClientChannel extends Socket {
    stdin: Writable;
    stdout: Readable;
    stderr: Readable;
    on(event: 'data', callback: (data: Buffer) => void): this;
    on(event: 'close', callback: (code: number, signal?: string) => void): this;
    on(event: 'exit', callback: (code: number, signal?: string, doCoreDump?: boolean, description?: string) => void): this;
  }
}

declare module 'ssh2-sftp-client' {
  import { Client } from 'ssh2';

  interface SftpClientOptions {
    host: string;
    port?: number;
    username?: string;
    password?: string;
    privateKey?: string | Buffer;
    passphrase?: string;
    readyTimeout?: number;
    retries?: number;
    retry_factor?: number;
    retry_minTimeout?: number;
  }

  class SftpClient {
    constructor(clientName?: string);
    connect(config: SftpClientOptions): Promise<string>;
    end(): Promise<string>;
    put(input: string | Buffer | NodeJS.ReadableStream, toPath: string, options?: any): Promise<string>;
    get(path: string, dst?: string | WritableStream, options?: any): Promise<string | Buffer>;
    list(remotePath: string, filter?: (item: any) => boolean): Promise<any[]>;
    stat(remotePath: string): Promise<any>;
    mkdir(remotePath: string, recursive?: boolean): Promise<string>;
    rmdir(remotePath: string, recursive?: boolean): Promise<string>;
    delete(remotePath: string): Promise<string>;
    rename(fromPath: string, toPath: string): Promise<string>;
    exists(remotePath: string): Promise<string | boolean>;
    chmod(remotePath: string, mode: string | number): Promise<string>;
    fastGet(remotePath: string, localPath: string, options?: any): Promise<string>;
    fastPut(localPath: string, remotePath: string, options?: any): Promise<string>;
    createReadStream(remotePath: string, options?: any): NodeJS.ReadableStream;
    createWriteStream(remotePath: string, options?: any): NodeJS.WritableStream;
    append(input: string | Buffer | NodeJS.ReadableStream, remotePath: string, options?: any): Promise<string>;
    cwd(): Promise<string>;
  }

  export default SftpClient;
}

declare module 'minio' {
  export class Client {
    constructor(options: ClientOptions);
    bucketExists(bucketName: string): Promise<boolean>;
    makeBucket(bucketName: string, region?: string): Promise<void>;
    removeBucket(bucketName: string): Promise<void>;
    putObject(bucketName: string, objectName: string, stream: NodeJS.ReadableStream | Buffer | string, size?: number, metaData?: any): Promise<any>;
    getObject(bucketName: string, objectName: string): Promise<NodeJS.ReadableStream>;
    fGetObject(bucketName: string, objectName: string, filePath: string): Promise<void>;
    fPutObject(bucketName: string, objectName: string, filePath: string, metaData?: any): Promise<any>;
    removeObject(bucketName: string, objectName: string): Promise<void>;
    removeObjects(bucketName: string, objectsList: string[]): Promise<void>;
    listObjects(bucketName: string, prefix?: string, recursive?: boolean): any;
    listObjectsV2(bucketName: string, prefix?: string, recursive?: boolean): any;
    presignedGetObject(bucketName: string, objectName: string, expires?: number, respHeaders?: any): Promise<string>;
    presignedPutObject(bucketName: string, objectName: string, expires?: number): Promise<string>;
    statObject(bucketName: string, objectName: string): Promise<any>;
    copyObject(targetBucketName: string, targetObjectName: string, sourceBucketAndObject: string, conditions?: any): Promise<any>;
    removeIncompleteUpload(bucketName: string, objectName: string): Promise<void>;
    setBucketPolicy(bucketName: string, policy: string): Promise<void>;
    getBucketPolicy(bucketName: string): Promise<string>;
  }

  export interface ClientOptions {
    endPoint: string;
    port?: number;
    useSSL?: boolean;
    accessKey: string;
    secretKey: string;
    region?: string;
    transport?: any;
    sessionToken?: string;
    pathStyle?: boolean;
  }
}
