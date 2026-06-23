declare module 'archiver' {
  import { Archiver } from 'archiver';
  function archiver(format: string, options?: Record<string, unknown>): Archiver;
  export default archiver;
}
