declare module 'ssh2-sftp-client' {
  interface ConnectOptions {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
  }

  interface FileInfo {
    type: string;
    name: string;
    size: number;
    modifyTime: number;
    accessTime: number;
    rights: {
      user: string;
      group: string;
      other: string;
    };
    owner: number;
    group: number;
  }

  class SftpClient {
    connect(options: ConnectOptions): Promise<void>;
    end(): Promise<void>;
    list(path: string): Promise<FileInfo[]>;
    mkdir(path: string, recursive?: boolean): Promise<string>;
    put(src: Buffer | string, dst: string): Promise<string>;
    exists(path: string): Promise<boolean | string>;
    get(src: string, dst: string): Promise<string>;
    delete(path: string): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    stat(path: string): Promise<{
      mode: number;
      permissions: number;
      size: number;
      uid: number;
      gid: number;
      atime: number;
      mtime: number;
    }>;
  }

  export = SftpClient;
}