/**
 * Pipecat sidecar adapter — how Next.js tells the Python audio pipeline
 * what to do.
 *
 * Guardrail: TTS is Pipecat's job, not Next.js's. Agents compose response
 * text and call triggerSpeak(); they never call ElevenLabs/Google TTS
 * directly. The sidecar owns all audio synthesis and injection.
 */

import {
  AppError,
  VENDOR_TIMEOUT_MS,
  logVendorError,
  toErrorMessage,
} from "@/lib/utils/errors";

export class PipecatError extends AppError {
  constructor(
    message: string,
    public readonly context: Record<string, unknown> = {},
  ) {
    super(message, "PIPECAT_ERROR", 502);
    this.name = "PipecatError";
  }
}

export interface PipecatAdapter {
  /** Tells Pipecat to join a meeting and start the audio pipeline. */
  spawnBot(params: {
    meetingUrl: string;
    botName: string;
    meetingId: string;
  }): Promise<{ pipecatBotId: string }>;
  /**
   * Tells Pipecat to synthesise `text` via ElevenLabs and inject the audio
   * into the meeting at the next VAD pause.
   */
  triggerSpeak(pipecatBotId: string, text: string): Promise<void>;
  /** Tells Pipecat to leave the meeting and clean up. */
  terminateBot(pipecatBotId: string): Promise<void>;
}

const VENDOR = "pipecat";

export class HttpPipecatAdapter implements PipecatAdapter {
  private readonly baseUrl: string;
  private readonly secret: string;

  constructor(
    baseUrl = process.env.PIPECAT_SERVICE_URL,
    secret = process.env.PIPECAT_SERVICE_SECRET,
  ) {
    if (!baseUrl) throw new PipecatError("PIPECAT_SERVICE_URL is not set");
    if (!secret) throw new PipecatError("PIPECAT_SERVICE_SECRET is not set");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.secret = secret;
  }

  async spawnBot(params: {
    meetingUrl: string;
    botName: string;
    meetingId: string;
  }): Promise<{ pipecatBotId: string }> {
    const data = await this.request<{ pipecat_bot_id: string }>(
      "POST",
      "/bots",
      {
        meeting_url: params.meetingUrl,
        bot_name: params.botName,
        meeting_id: params.meetingId,
      },
      { meetingId: params.meetingId },
    );

    if (!data?.pipecat_bot_id) {
      throw new PipecatError("Pipecat did not return a pipecat_bot_id", {
        meetingId: params.meetingId,
      });
    }
    return { pipecatBotId: data.pipecat_bot_id };
  }

  async triggerSpeak(pipecatBotId: string, text: string): Promise<void> {
    await this.request(
      "POST",
      `/bots/${pipecatBotId}/speak`,
      { text },
      { pipecatBotId },
    );
  }

  async terminateBot(pipecatBotId: string): Promise<void> {
    await this.request("DELETE", `/bots/${pipecatBotId}`, undefined, {
      pipecatBotId,
    });
  }

  /** Shared request wrapper: 10s timeout, typed errors, structured logging. */
  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    context: Record<string, unknown> = {},
  ): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.secret}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(VENDOR_TIMEOUT_MS),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        throw new PipecatError(
          `Pipecat ${method} ${path} failed with ${res.status}`,
          { ...context, status: res.status, body: errorBody.slice(0, 500) },
        );
      }

      const text = await res.text();
      return text ? (JSON.parse(text) as T) : null;
    } catch (error) {
      logVendorError(VENDOR, error, { method, path, ...context });
      if (error instanceof PipecatError) throw error;
      throw new PipecatError(
        `Pipecat ${method} ${path} failed: ${toErrorMessage(error)}`,
        context,
      );
    }
  }
}

let adapter: PipecatAdapter | null = null;

export function getPipecatAdapter(): PipecatAdapter {
  if (!adapter) {
    adapter = new HttpPipecatAdapter();
  }
  return adapter;
}
