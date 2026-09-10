import { foundryClient } from "@/lib/foundry";
import { env } from "@/lib/env";

// POST /api/chat
//
// Takes { messages: [{role, content}] } and streams the assistant's reply back
// as plain text chunks.
//
// Phase 2 scope: no retrieval yet, just prove the Foundry round-trip and
// streaming work. Phase 3 inserts a retrieval step before the model call.

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are an assistant for Dynamics 365 Business Central support consultants.
Answer concisely and practically. If you are unsure, say so rather than guessing —
a confident wrong answer about an ERP configuration costs someone a day.`;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// Azure-specific server-side latency breakdown, not present in the OpenAI SDK
// types. ttft = time to first token, ttlt = time to last token, tbt = time
// between tokens. "engine" excludes queueing, "service" includes it — the gap
// between them is how loaded the deployment is.
type LatencyCheckpoint = {
  engine_ttft_ms?: number;
  engine_ttlt_ms?: number;
  engine_tbt_ms?: number;
  service_ttft_ms?: number;
  service_ttlt_ms?: number;
  service_tbt_ms?: number;
  pre_inference_ms?: number;
  user_visible_ttft_ms?: number;
};

type Usage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  latency?: LatencyCheckpoint;
};

export async function POST(request: Request) {
  const { messages } = (await request.json()) as { messages: ChatMessage[] };

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("messages array is required", { status: 400 });
  }

  const client = foundryClient();
  const encoder = new TextEncoder();

  // Captured from the final chunk. Phase 4 persists this to Cosmos and turns
  // it into cost per answer.
  let usage: Usage | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // `model` is the DEPLOYMENT name ("chat"), not the model name.
        // Azure resolves which model that deployment points at, which is why
        // swapping gpt-5.4-mini for something else is a portal change and this
        // line never moves.
        const completion = await client.chat.completions.create({
          model: env.chatDeployment(),
          // The model is stateless: the whole conversation is resent every
          // time, with our instructions prepended.
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
          stream: true,
          // Makes the final chunk carry token counts. Without this, `usage` is
          // null on streamed responses and Phase 4 has nothing to report.
          stream_options: { include_usage: true },
          // Reasoning models reject the older `max_tokens` outright.
          max_completion_tokens: 800,
          // This model reasons before answering, and those hidden tokens are
          // billed. "minimal" keeps documentation lookups cheap and fast.
          // Note: `temperature` and `top_p` are unsupported here — passing them
          // errors rather than being ignored.
          reasoning_effort: "minimal",
        });

        // `completion` is a sequence that arrives over time, not a value.
        for await (const chunk of completion) {
          // `choices` is empty on the usage-only final chunk and on
          // content-filter chunks, so index defensively — skipping the `?.`
          // here is the most common crash in Azure OpenAI streaming code.
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            controller.enqueue(encoder.encode(text));
          }

          // The last chunk carries the token counts. Logged for now; Phase 4
          // persists this to Cosmos and turns it into cost per answer.
          // Azure emits two chunks with an empty `choices` array: a prologue
          // carrying prompt_filter_results (content-safety verdicts on the
          // prompt), and the real usage chunk at the end. Only the latter has a
          // `usage` field, so guarding on a field rather than the object costs
          // nothing and survives the prologue gaining one later.
          if (chunk.usage?.total_tokens) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
              // Hidden thinking tokens, billed as output. Should be 0 at
              // reasoning_effort "minimal" — worth asserting, because a silent
              // change here would quietly inflate cost per answer.
              reasoningTokens:
                chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0,
              // Prompt tokens served from Azure's cache, billed at a discount.
              cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
              // Azure-only extension, absent from the SDK types: a server-side
              // latency breakdown. Far better than measuring round-trip time in
              // the browser, and it feeds the insights page directly.
              latency: (chunk as unknown as { latency_checkpoint?: LatencyCheckpoint })
                .latency_checkpoint,
            };
            // JSON.stringify, not the object: Next's dev logger writes any
            // object to the log file as "{}".
            console.log("[/api/chat] usage", JSON.stringify(usage));
          }
        }

        controller.close();
      } catch (error) {
        // Surface the real error in the stream during development. A silent
        // failure here looks like the model "returning nothing", which is
        // miserable to debug.
        const message = error instanceof Error ? error.message : String(error);
        console.error("[/api/chat]", error);
        controller.enqueue(encoder.encode(`\n\n[error] ${message}`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      // Defeats proxy buffering, which otherwise holds the whole response and
      // destroys the point of streaming.
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

// Protocol note for later: plain text is enough while the response is only
// prose. Phase 3 adds citations and Phase 4 adds token counts and cost, which
// are metadata rather than text. At that point switch to newline-delimited JSON
// or Server-Sent Events so structured data can travel alongside the tokens.
