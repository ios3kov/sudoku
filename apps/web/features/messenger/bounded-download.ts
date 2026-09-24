/** Consume an untrusted response without retaining bytes beyond the declared size. */
export async function readBoundedDownload(response: Response, size: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Attachment response body is unavailable");
  let complete = false;
  try {
    if (!Number.isSafeInteger(size) || size <= 16 || size > 25 * 1024 * 1024 + 16) {
      throw new Error("Invalid encrypted attachment size");
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > size - offset) throw new Error("Attachment exceeds declared size");
      bytes.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== size) throw new Error("Attachment is truncated");
    complete = true;
    return bytes;
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
