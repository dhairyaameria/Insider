/**
 * Meeting bot adapter — bot JOIN/LEAVE/CHAT only.
 *
 * Speaking is handled by the Pipecat sidecar (see ./pipecat.ts), not here.
 * raiseHand() is intentionally absent: Zoom/Meet/Teams expose no public API
 * for programmatic hand-raise. The bot signals intent via
 * sendChatMessage("✋ Insider has a relevant note — finishing this thought first").
 */

import {
  AppError,
  NotImplementedError,
  VENDOR_TIMEOUT_MS,
  logVendorError,
  toErrorMessage,
} from "@/lib/utils/errors";

export class BotError extends AppError {
  constructor(
    message: string,
    public readonly vendor: string,
    public readonly context: Record<string, unknown> = {},
  ) {
    super(message, "MEETING_BOT_ERROR", 502);
    this.name = "BotError";
  }
}

export interface MeetingBotAdapter {
  joinMeeting(
    meetingUrl: string,
    botName: string,
    webhookUrl: string,
  ): Promise<{ botId: string }>;
  leaveMeeting(botId: string): Promise<void>;
  sendChatMessage(botId: string, message: string): Promise<void>;
}

const MEETINGBAAS_BASE_URL = "https://api.meetingbaas.com";
const VENDOR = "meetingbaas";

export class MeetingBaaSAdapter implements MeetingBotAdapter {
  private readonly apiKey: string;

  constructor(apiKey = process.env.MEETINGBAAS_API_KEY) {
    if (!apiKey) {
      throw new BotError("MEETINGBAAS_API_KEY is not set", VENDOR);
    }
    this.apiKey = apiKey;
  }

  async joinMeeting(
    meetingUrl: string,
    botName: string,
    webhookUrl: string,
  ): Promise<{ botId: string }> {
    const data = await this.request<{ bot_id: string }>(
      "POST",
      "/bots",
      {
        meeting_url: meetingUrl,
        bot_name: botName,
        webhook_url: webhookUrl,
        speech_to_text: { provider: "Default" },
      },
      { meetingUrl },
    );

    if (!data?.bot_id) {
      throw new BotError("MeetingBaaS did not return a bot_id", VENDOR, {
        meetingUrl,
      });
    }
    return { botId: data.bot_id };
  }

  async leaveMeeting(botId: string): Promise<void> {
    await this.request("DELETE", `/bots/${botId}`, undefined, { botId });
  }

  async sendChatMessage(botId: string, message: string): Promise<void> {
    await this.request(
      "POST",
      `/bots/${botId}/actions`,
      { action: "send_message", message },
      { botId },
    );
  }

  /** Shared request wrapper: 10s timeout, typed errors, structured logging. */
  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    context: Record<string, unknown> = {},
  ): Promise<T | null> {
    try {
      const res = await fetch(`${MEETINGBAAS_BASE_URL}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-meeting-baas-api-key": this.apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(VENDOR_TIMEOUT_MS),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        throw new BotError(
          `MeetingBaaS ${method} ${path} failed with ${res.status}`,
          VENDOR,
          { ...context, status: res.status, body: errorBody.slice(0, 500) },
        );
      }

      const text = await res.text();
      return text ? (JSON.parse(text) as T) : null;
    } catch (error) {
      logVendorError(VENDOR, error, { method, path, ...context });
      if (error instanceof BotError) throw error;
      throw new BotError(
        `MeetingBaaS ${method} ${path} failed: ${toErrorMessage(error)}`,
        VENDOR,
        context,
      );
    }
  }
}

let adapter: MeetingBotAdapter | null = null;

/** Returns the meeting bot adapter selected by MEETING_BOT_PROVIDER. */
export function getMeetingBotAdapter(): MeetingBotAdapter {
  if (adapter) return adapter;

  const provider = process.env.MEETING_BOT_PROVIDER ?? "meetingbaas";
  switch (provider) {
    case "meetingbaas":
      adapter = new MeetingBaaSAdapter();
      return adapter;
    case "vexa":
      // v1.1+: self-hosted Vexa adapter.
      throw new NotImplementedError("Vexa meeting bot adapter");
    default:
      throw new BotError(
        `Unknown MEETING_BOT_PROVIDER: ${provider}`,
        provider,
      );
  }
}
