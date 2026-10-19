export const PROTOCOL_VERSION = 1;

// HC 8: N and N-1 only, and no version below 1
export function isSupportedProtocol(
  version: unknown,
  current = PROTOCOL_VERSION,
): version is number {
  return (
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version >= Math.max(1, current - 1) &&
    version <= current
  );
}
