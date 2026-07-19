import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUp,
  Download,
  FileText,
  Loader2,
  MessageSquarePlus,
  Quote,
  Sparkles,
} from "lucide-react";
import {
  createConversation,
  exportConversationUrl,
  listMessages,
  streamChat,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const SUGGESTIONS = [
  "Summarise the key findings.",
  "List all defined terms with definitions.",
  "What are the main risks or caveats?",
  "Extract every table with its title.",
];

export default function ChatPanel({
  conversationId,
  onConversationCreated,
  onCitationClick,
  selectedPdfIds,
  pdfs,
}) {
  const qc = useQueryClient();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [liveCitations, setLiveCitations] = useState([]);
  const scrollRef = useRef(null);

  const messagesQ = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => (conversationId ? listMessages(conversationId) : []),
    enabled: !!conversationId,
  });

  const messages = messagesQ.data || [];

  const ensureConversation = async () => {
    if (conversationId) return conversationId;
    const c = await createConversation({ pdf_ids: selectedPdfIds });
    onConversationCreated(c.id);
    qc.invalidateQueries({ queryKey: ["conversations"] });
    return c.id;
  };

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || streaming) return;
    setInput("");
    setLiveText("");
    setLiveCitations([]);
    setStreaming(true);
    const convId = await ensureConversation();

    // optimistic append
    qc.setQueryData(["messages", convId], (prev = []) => [
      ...prev,
      {
        id: `tmp-${Date.now()}`,
        conversation_id: convId,
        role: "user",
        content: msg,
        citations: [],
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      let acc = "";
      let cites = [];
      for await (const ev of streamChat({
        conversation_id: convId,
        message: msg,
        pdf_ids: selectedPdfIds.length ? selectedPdfIds : null,
      })) {
        if (ev.event === "citations") {
          cites = ev.data || [];
          setLiveCitations(cites);
        } else if (ev.event === "token") {
          acc += ev.data;
          setLiveText(acc);
        } else if (ev.event === "done") {
          break;
        } else if (ev.event === "error") {
          toast.error(ev.data?.error || "Chat error");
          break;
        }
      }
      // refresh messages from server (canonical state)
      qc.invalidateQueries({ queryKey: ["messages", convId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      toast.error("Streaming failed");
    } finally {
      setStreaming(false);
      setLiveText("");
      setLiveCitations([]);
    }
  };

  // autoscroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, liveText]);

  const scopeLabel = useMemo(() => {
    if (!pdfs.length) return "No PDFs uploaded";
    if (!selectedPdfIds.length) return `All documents (${pdfs.length})`;
    if (selectedPdfIds.length === 1) {
      return pdfs.find((p) => p.id === selectedPdfIds[0])?.name || "1 document";
    }
    return `${selectedPdfIds.length} documents`;
  }, [selectedPdfIds, pdfs]);

  return (
    <div className="h-full flex flex-col bg-background" data-testid="chat-panel">
      {/* Header */}
      <div className="h-14 border-b border-border bg-surface flex items-center justify-between px-4 flex-shrink-0">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            DocuMind Chat
          </div>
          <div
            className="text-sm font-medium truncate"
            data-testid="chat-scope-label"
          >
            {scopeLabel}
          </div>
        </div>
        {conversationId && messages.length > 0 && (
          <a
            href={exportConversationUrl(conversationId)}
            target="_blank"
            rel="noreferrer"
            data-testid="export-chat-btn"
            className="h-8 px-3 border border-border rounded-[4px] flex items-center gap-1.5 text-xs hover:bg-secondary transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </a>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto scroll-thin px-6 py-8"
        data-testid="messages-scroll"
      >
        {messages.length === 0 && !streaming ? (
          <EmptyChat pdfs={pdfs} onPick={(s) => send(s)} />
        ) : (
          <div className="space-y-6 max-w-2xl mx-auto">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                m={m}
                onCitationClick={onCitationClick}
              />
            ))}
            {streaming && (
              <MessageBubble
                m={{
                  role: "assistant",
                  content: liveText || "",
                  citations: liveCitations,
                }}
                streaming
                onCitationClick={onCitationClick}
              />
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-4 bg-surface flex-shrink-0">
        <div className="max-w-2xl mx-auto">
          <div className="relative border border-border rounded-[6px] focus-within:border-accent bg-background transition-colors">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                pdfs.length
                  ? "Ask anything about your documents…"
                  : "Upload a PDF to start chatting"
              }
              disabled={streaming || pdfs.length === 0}
              rows={2}
              data-testid="chat-input"
              className="resize-none border-0 shadow-none focus-visible:ring-0 bg-transparent pr-12 min-h-[64px]"
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || streaming || pdfs.length === 0}
              data-testid="chat-send-btn"
              className="absolute bottom-2 right-2 h-8 w-8 rounded-[4px] bg-accent text-accent-foreground disabled:bg-muted disabled:text-muted-foreground flex items-center justify-center hover:opacity-90 transition-opacity"
            >
              {streaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              )}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Press Enter to send, Shift+Enter for newline</span>
            <span className="mono">grounded · cited</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyChat({ pdfs, onPick }) {
  return (
    <div
      className="h-full flex flex-col items-center justify-center max-w-lg mx-auto text-center"
      data-testid="chat-empty-state"
    >
      <div className="h-12 w-12 mb-6 border border-border rounded-[4px] flex items-center justify-center bg-surface">
        <Sparkles className="h-5 w-5 text-accent" />
      </div>
      <h2 className="font-display text-3xl font-black tracking-tight mb-3">
        Ask, and receive receipts.
      </h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-8">
        Every answer is grounded in your library with clickable page-level
        citations. No hallucinations, no vibes.
      </p>
      <div className="w-full grid grid-cols-1 gap-2">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            data-testid={`suggestion-${i}`}
            disabled={pdfs.length === 0}
            onClick={() => onPick(s)}
            className="text-left px-3 py-2 border border-border rounded-[4px] text-xs hover:border-accent hover:bg-accent/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ m, streaming = false, onCitationClick }) {
  const isUser = m.role === "user";
  const cites = m.citations || [];
  const rendered = useMemo(
    () => renderContentWithCitations(m.content || "", cites, onCitationClick),
    [m.content, cites, onCitationClick]
  );

  return (
    <div className={`reveal ${isUser ? "" : ""}`} data-testid={`msg-${m.role}`}>
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`h-5 w-5 rounded-[3px] border border-border flex items-center justify-center text-[10px] font-bold ${
            isUser ? "bg-secondary" : "bg-accent text-accent-foreground border-accent"
          }`}
        >
          {isUser ? "U" : "D"}
        </div>
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
          {isUser ? "You" : "DocuMind"}
        </div>
      </div>
      <div className={`md-body text-sm ${isUser ? "text-foreground" : "text-foreground"}`}>
        {rendered}
        {streaming && !m.content && (
          <span className="text-muted-foreground text-xs">Thinking…</span>
        )}
        {streaming && <span className="stream-caret" />}
      </div>
      {!isUser && cites.length > 0 && (
        <div className="mt-4 border-l-2 border-accent/50 pl-4 space-y-2" data-testid="citations-block">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <Quote className="h-3 w-3" /> Sources ({cites.length})
          </div>
          <ul className="space-y-1.5">
            {cites.slice(0, 5).map((c, idx) => (
              <li key={idx}>
                <button
                  data-testid={`citation-${idx}`}
                  onClick={() => onCitationClick && onCitationClick(c)}
                  className="text-left w-full text-xs px-2 py-1.5 border border-border rounded-[4px] hover:border-accent hover:bg-accent/5 transition-colors group"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <FileText className="h-3 w-3 text-muted-foreground group-hover:text-accent" />
                    <span className="font-medium truncate">{c.pdf_name}</span>
                    <span className="mono text-[10px] text-muted-foreground ml-auto">
                      p.{c.page}
                    </span>
                  </div>
                  <div className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">
                    {c.snippet}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Renders assistant text: converts `[filename:page]` inline references into
// clickable citation chips (linked back to the citations list). Falls back to
// a lightweight markdown renderer for headings, lists, tables, code, bold.
function renderContentWithCitations(text, citations, onClick) {
  if (!text) return null;

  const chipRegex = /\[([^\]:]+):(\d+)\]/g;
  const nodes = [];
  let key = 0;

  const emitInline = (str) => {
    const parts = [];
    let last = 0;
    let m;
    while ((m = chipRegex.exec(str))) {
      if (m.index > last) parts.push(str.slice(last, m.index));
      const name = m[1];
      const page = parseInt(m[2], 10);
      const citation =
        citations.find(
          (c) => c.pdf_name === name || c.pdf_name?.startsWith(name)
        ) || { pdf_name: name, page, pdf_id: null, snippet: "" };
      parts.push(
        <button
          key={`c-${key++}`}
          className="citation-chip"
          data-testid={`inline-cite-${page}`}
          onClick={() => onClick && onClick({ ...citation, page })}
        >
          {name}·p{page}
        </button>
      );
      last = m.index + m[0].length;
    }
    if (last < str.length) parts.push(str.slice(last));
    return parts.map((p, i) =>
      typeof p === "string" ? (
        <span key={`t-${key++}`} dangerouslySetInnerHTML={inlineFormat(p)} />
      ) : (
        p
      )
    );
  };

  const lines = text.split("\n");
  let listBuf = null;
  const flushList = () => {
    if (listBuf) {
      nodes.push(
        <ul key={`u-${key++}`}>
          {listBuf.map((item, i) => (
            <li key={i}>{emitInline(item)}</li>
          ))}
        </ul>
      );
      listBuf = null;
    }
  };

  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^-\s+/.test(l) || /^\*\s+/.test(l)) {
      const item = l.replace(/^[-*]\s+/, "");
      if (!listBuf) listBuf = [];
      listBuf.push(item);
      continue;
    }
    flushList();
    if (/^###\s+/.test(l)) {
      nodes.push(<h3 key={`h-${key++}`}>{emitInline(l.replace(/^###\s+/, ""))}</h3>);
    } else if (/^##\s+/.test(l)) {
      nodes.push(<h2 key={`h-${key++}`}>{emitInline(l.replace(/^##\s+/, ""))}</h2>);
    } else if (/^#\s+/.test(l)) {
      nodes.push(<h1 key={`h-${key++}`}>{emitInline(l.replace(/^#\s+/, ""))}</h1>);
    } else if (l === "") {
      // paragraph break — do nothing
    } else {
      nodes.push(<p key={`p-${key++}`}>{emitInline(l)}</p>);
    }
  }
  flushList();
  return nodes;
}

// Very small inline formatter for **bold** and `code`. Text is already React-safe.
function inlineFormat(str) {
  const escaped = str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
  return { __html: escaped };
}
