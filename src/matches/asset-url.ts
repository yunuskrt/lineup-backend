// Never the bare key: a full URL or nothing
export function assetUrl(
  base: string | undefined,
  key: string | null,
): string | null {
  return base && key ? `${base}/${key}` : null;
}
