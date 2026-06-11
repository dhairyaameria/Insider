export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotImplementedError extends AppError {
  constructor(feature: string) {
    super(`${feature} is not implemented yet`, "NOT_IMPLEMENTED", 501);
    this.name = "NotImplementedError";
  }
}

export class VendorTimeoutError extends AppError {
  constructor(vendor: string, timeoutMs: number) {
    super(`${vendor} did not respond within ${timeoutMs}ms`, "VENDOR_TIMEOUT", 504);
    this.name = "VendorTimeoutError";
  }
}

/** Guardrail: all vendor calls on the TypeScript side time out at 10s max. */
export const VENDOR_TIMEOUT_MS = 10_000;

/**
 * Wraps a vendor call with a hard timeout. On timeout the caller must fail
 * gracefully — the meeting continues, the bot stays silent for that turn.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  vendor: string,
  timeoutMs: number = VENDOR_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new VendorTimeoutError(vendor, timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Structured vendor-error logging: vendor, timestamp, and call context. */
export function logVendorError(
  vendor: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  console.error(
    JSON.stringify({
      level: "error",
      vendor,
      message: toErrorMessage(error),
      timestamp: new Date().toISOString(),
      ...context,
    }),
  );
}
