"use client";

import { useRef, useState } from "react";

type Source = { title: string; score: number };

type Usage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
  latency?: { user_visible_ttft_ms?: number; service_ttlt_ms?: number };
};

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  retrieval?: { latencyMs: number; computeUnits?: number };
  usage?: Usage;
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;

    const history: Message[] = [...messages, { role: "user", content: question }];
    setMessages(history);
    setInput("");
    setBusy(true);
    setStage("searching documentation");

    // The assistant message is built up in place as events arrive.
    const answer: Message = { role: "assistant", content: "" };
    const repaint = () => {
      setMessages([...history, { ...answer }]);
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    };
    repaint();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only role and content — the server has no use for our local metadata.
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`${response.status} ${await response.text()}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Newline-delimited JSON: a chunk can split a line in half, so keep
        // the trailing partial line in the buffer until its newline arrives.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);

          if (event.type === "sources") {
            answer.sources = event.sources;
            answer.retrieval = event.retrieval;
            setStage("reading sources");
          } else if (event.type === "delta") {
            answer.content += event.text;
            setStage(null);
          } else if (event.type === "done") {
            answer.usage = event.usage;
          } else if (event.type === "error") {
            answer.content += `\n\n[error] ${event.message}`;
          }
          repaint();
        }
      }
    } catch (error) {
      answer.content = `Request failed: ${error instanceof Error ? error.message : String(error)}`;
      repaint();
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col p-4">
      <header className="border-b border-black/10 pb-3 dark:border-white/15">
        <h1 className="text-lg font-semibold">ERP Support Copilot</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Grounded in Dynamics 365 Business Central documentation
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="text-sm text-black/50 dark:text-white/50">
            Try &ldquo;how do I reconcile a bank account?&rdquo; or &ldquo;what are dimension set
            entries?&rdquo;
          </p>
        )}

        {messages.map((message, index) =>
          message.role === "user" ? (
            <div
              key={index}
              className="ml-auto max-w-[80%] rounded-2xl bg-black/5 px-4 py-2 dark:bg-white/10"
            >
              {message.content}
            </div>
          ) : (
            <div key={index} className="max-w-[92%] space-y-2">
              {message.sources && message.sources.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {message.sources.map((source, sourceIndex) => (
                    <span
                      key={sourceIndex}
                      title={`relevance ${source.score}`}
                      className="rounded-full border border-black/10 px-2 py-0.5 text-xs text-black/60 dark:border-white/20 dark:text-white/60"
                    >
                      [{sourceIndex + 1}] {source.title.replace(/\.md$/, "")}
                    </span>
                  ))}
                </div>
              )}

              <div className="whitespace-pre-wrap">
                {message.content ||
                  (busy && index === messages.length - 1 && (
                    <span className="text-black/40 dark:text-white/40">
                      {stage ?? "thinking"}...
                    </span>
                  ))}
              </div>

              {message.usage && (
                <p className="font-mono text-[11px] text-black/40 dark:text-white/40">
                  {message.usage.promptTokens} in / {message.usage.completionTokens} out
                  {message.usage.reasoningTokens > 0 &&
                    ` (${message.usage.reasoningTokens} reasoning)`}
                  {message.retrieval && ` · search ${message.retrieval.latencyMs}ms`}
                  {message.retrieval?.computeUnits !== undefined &&
                    ` · ${message.retrieval.computeUnits} CU`}
                  {message.usage.latency?.user_visible_ttft_ms !== undefined &&
                    ` · first token ${message.usage.latency.user_visible_ttft_ms}ms`}
                </p>
              )}
            </div>
          ),
        )}
      </div>

      <form
        onSubmit={send}
        className="flex gap-2 border-t border-black/10 pt-3 dark:border-white/15"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about Business Central"
          className="flex-1 rounded-lg border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </main>
  );
}
