export const requiredChecks: readonly string[];
export function sha256(data: string | Uint8Array): string;
export function sourceFiles(root: string, untracked?: boolean): string[];
export function sourceFingerprint(root: string): Promise<string>;
export function validateQualification(
  value: unknown,
  sourceHash: string,
  nodeVersion: string,
): void;
export function treeFingerprint(
  root: string,
  runtimeLinks?: Readonly<Record<string, string>>,
): Promise<Record<string, { sha256: string; link?: string }>>;
export function verifyRelease(directory: string): Promise<unknown>;

export function copyReleaseTree(
  source: string,
  destination: string,
): Promise<void>;
