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