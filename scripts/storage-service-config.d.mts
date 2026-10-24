export function storageServiceConfig(input: {
  root: string;
  node: string;
  runtime: string;
  logs: string;
  envFile: string;
}): { logrotate: string; service(command: string): string };
