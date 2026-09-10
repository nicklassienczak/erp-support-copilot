"use client";

import { useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;

    const history: Message[] = [...messages, { role: "user", content: question }];
    setMessages(history);
    setInput("");
    setBusy(true);

    // Placeholder the streamed tokens append into.
    setMessages([...history, { role: "assistant", content: "" }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`${response.status} ${await response.text()}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";

      // Read chunks as they arrive and repaint. This is the whole client side
      // of streaming — no library required.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: answer }]);
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMessages([...history, { role: "assistant", content: `Request failed: ${message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col p-4">
      <header className="border-b border-black/10 pb-3 dark:border-white/15">
        <h1 className="text-lg font-semibold">ERP Support Copilot</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Dynamics 365 Business Central knowledge base
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 && (
          <p className="text-sm text-black/50 dark:text-white/50">
            Ask something like &ldquo;how do I set up posting groups in Business Central?&rdquo;
          </p>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "ml-auto max-w-[80%] rounded-2xl bg-black/5 px-4 py-2 dark:bg-white/10"
                : "max-w-[90%] whitespace-pre-wrap"
            }
          >
            {message.content ||
              (busy && index === messages.length - 1 ? (
                <span className="text-black/40 dark:text-white/40">thinking…</span>
              ) : null)}
          </div>
        ))}
      </div>

      <form onSubmit={send} className="flex gap-2 border-t border-black/10 pt-3 dark:border-white/15">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask a question"
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
