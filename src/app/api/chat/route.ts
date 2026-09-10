import { AzureOpenAI } from "openai";
import { env } from "@/lib/env";
import { asContext, retrieveHybrid, type Passage } from "@/lib/retrieve";

// POST /api/chat
//
// Retrieves relevant documentation passages, asks the model to answer from
// them, and streams the reply.
//
// The response is newline-delimited JSON rather than plain text, because an
// answer is not only prose: the client also needs the sources it was based on
// and the token counts it cost. One event per line:
//
//   {"type":"sources","sources":[{title,score}],"retrieval":{...}}
//   {"type":"delta","text":"..."}                     (many)
//   {"type":"done","usage":{...}}
//
// Sources arrive first so the UI can show what it is reading before the answer
// starts, which makes the wait feel purposeful rather than slow.

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = `You are an assistant for Dynamics 365 Business Central support consultants.

Answer ONLY from the numbered sources provided. Cite the sources you use inline as [1], [2].
If the sources do not contain the answer, say so plainly and suggest what to search for instead —
a confident wrong answer about an ERP configuration costs someone a day of work.
Be concise and practical. Prefer steps over prose.`;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// Azure sends a server-side latency breakdown that the OpenAI SDK types don't
// know about. Only the fields the UI shows are typed; the rest of the object
// still arrives if it's ever wanted.
type LatencyCheckpoint = {
  user_visible_ttft_ms?: number;
  service_ttlt_ms?: number;
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

  const question = messages[messages.length - 1]?.content ?? "";

  // apiVersion is mandatory on Azure: the REST surface is versioned separately
  // from the SDK, so a new model can be unusable until this string moves.
  // Swap apiKey for azureADTokenProvider to go keyless.
  const client = new AzureOpenAI({
    endpoint: env.foundryEndpoint(),
    apiKey: env.foundryKey(),
    apiVersion: env.openAiApiVersion(),
  });

  const encoder = new TextEncoder();

  const send = (controller: ReadableStreamDefaultController, event: unknown) =>
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // --- retrieve ---------------------------------------------------
        const retrieval = await retrieveHybrid(question);

        send(controller, {
          type: "sources",
          sources: retrieval.passages.map((passage: Passage) => ({
            title: passage.title,
            score: Number(passage.score.toFixed(2)),
          })),
          retrieval: {
            latencyMs: retrieval.latencyMs,
            computeUnits: retrieval.computeUnits,
          },
        });

        // --- generate ---------------------------------------------------
        // Only the current question gets the retrieved context attached.
        // Earlier turns keep their original text, so the conversation stays
        // coherent without re-sending every passage from every turn.
        const history = messages.slice(0, -1);
        const grounded = `Sources:\n\n${asContext(retrieval.passages)}\n\n---\n\nQuestion: ${question}`;

        const completion = await client.chat.completions.create({
          // The DEPLOYMENT name, not the model name.
          model: env.chatDeployment(),
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...history,
            { role: "user", content: grounded },
          ],
          stream: true,
          // Without this, `usage` is null on streamed responses.
          stream_options: { include_usage: true },
          // Reasoning models reject the older `max_tokens`.
          max_completion_tokens: 800,
          // Hidden reasoning tokens are billed as output. "minimal" keeps a
          // documentation lookup cheap. `temperature` and `top_p` are
          // unsupported on this model and error if passed.
          reasoning_effort: "minimal",
        });

        let usage: Usage | undefined;

        for await (const chunk of completion) {
          // `choices` is empty on the prompt-filter prologue chunk and on the
          // final usage chunk, so index defensively.
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            send(controller, { type: "delta", text });
          }

          if (chunk.usage?.total_tokens) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
              reasoningTokens:
                chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0,
              cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
              latency: (chunk as unknown as { latency_checkpoint?: LatencyCheckpoint })
                .latency_checkpoint,
            };
          }
        }

        // Phase 4 persists this to Cosmos and turns it into cost per answer.
        send(controller, { type: "done", usage });
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[/api/chat]", error);
        send(controller, { type: "error", message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      // Defeats proxy buffering, which would hold the whole response and
      // defeat the point of streaming.
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
