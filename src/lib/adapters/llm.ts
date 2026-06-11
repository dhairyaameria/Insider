/**
 * LLM + embedding adapters.
 *
 * Claude (claude-sonnet-4-20250514) handles completions: summaries,
 * decisions, problem classification. OpenAI text-embedding-3-small
 * (1536-dim) handles embeddings only.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  AppError,
  VENDOR_TIMEOUT_MS,
  logVendorError,
  toErrorMessage,
} from "@/lib/utils/errors";

export const CLAUDE_MODEL = "claude-sonnet-4-20250514";
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export class LLMError extends AppError {
  constructor(
    message: string,
    public readonly vendor: string,
    public readonly context: Record<string, unknown> = {},
  ) {
    super(message, "LLM_ERROR", 502);
    this.name = "LLMError";
  }
}

export interface LLMAdapter {
  complete(
    systemPrompt: string,
    userMessage: string,
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<string>;
  embed(text: string): Promise<number[]>;
}

export interface EmbedAdapter {
  embed(text: string): Promise<number[]>;
}

export class OpenAIEmbedAdapter implements EmbedAdapter {
  private readonly client: OpenAI;

  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) {
      throw new LLMError("OPENAI_API_KEY is not set", "openai");
    }
    this.client = new OpenAI({
      apiKey,
      timeout: VENDOR_TIMEOUT_MS,
      maxRetries: 1,
    });
  }

  async embed(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text,
      });

      const embedding = response.data[0]?.embedding;
      if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new LLMError(
          `Expected a ${EMBEDDING_DIMENSIONS}-dim embedding, got ${embedding?.length ?? 0}`,
          "openai",
        );
      }
      return embedding;
    } catch (error) {
      logVendorError("openai", error, {
        model: EMBEDDING_MODEL,
        textLength: text.length,
      });
      if (error instanceof LLMError) throw error;
      throw new LLMError(
        `OpenAI embedding failed: ${toErrorMessage(error)}`,
        "openai",
      );
    }
  }
}

export class ClaudeAdapter implements LLMAdapter {
  private readonly client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) {
      throw new LLMError("ANTHROPIC_API_KEY is not set", "anthropic");
    }
    this.client = new Anthropic({
      apiKey,
      timeout: VENDOR_TIMEOUT_MS,
      maxRetries: 1,
    });
  }

  async complete(
    systemPrompt: string,
    userMessage: string,
    options: { maxTokens?: number; temperature?: number } = {},
  ): Promise<string> {
    try {
      const response = await this.client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0.2,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });

      return response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");
    } catch (error) {
      logVendorError("anthropic", error, { model: CLAUDE_MODEL });
      if (error instanceof LLMError) throw error;
      throw new LLMError(
        `Claude completion failed: ${toErrorMessage(error)}`,
        "anthropic",
      );
    }
  }

  /** Claude has no embeddings API — delegates to the embed adapter. */
  async embed(text: string): Promise<number[]> {
    return getEmbedAdapter().embed(text);
  }
}

let llmAdapter: LLMAdapter | null = null;
let embedAdapter: EmbedAdapter | null = null;

export function getLLMAdapter(): LLMAdapter {
  if (!llmAdapter) {
    llmAdapter = new ClaudeAdapter();
  }
  return llmAdapter;
}

export function getEmbedAdapter(): EmbedAdapter {
  if (!embedAdapter) {
    embedAdapter = new OpenAIEmbedAdapter();
  }
  return embedAdapter;
}
