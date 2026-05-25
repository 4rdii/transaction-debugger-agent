import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router";
import { ArrowUp, History, Loader2, Sparkles, Zap } from "lucide-react";
import { AnalysisResultCard } from "../components/AnalysisResultCard";
import { TONFeaturesPanel } from "../components/TONFeaturesPanel";
import { useApp } from "../store";
import { streamAnalysis, askQuestion, getSubscriptionStatus } from "../api";
import type { AnalysisResult } from "../api";
import type { HistoryEntry } from "../store";

type Message = {
  id: string;
  type: "user" | "agent" | "status";
  content: string;
  analysis?: AnalysisResult;
};

export function ChatScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, dispatch } = useApp();
  const [input, setInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load subscription status on mount (for usage counter in header)
  useEffect(() => {
    getSubscriptionStatus().then((status) => {
      if (status) dispatch({ type: "SET_SUBSCRIPTION", status });
    });
  }, [dispatch]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(scrollToBottom, [messages, scrollToBottom]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "24px";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + "px";
    }
  }, [input]);

  // Restore conversation from history entry
  useEffect(() => {
    const historyEntry = (location.state as { fromHistory?: HistoryEntry } | null)?.fromHistory;
    if (historyEntry?.result) {
      setMessages([
        {
          id: `hist-user-${historyEntry.txHash}`,
          type: "user",
          content: historyEntry.txHash,
        },
        {
          id: `hist-result-${historyEntry.txHash}`,
          type: "agent",
          content: "",
          analysis: historyEntry.result,
        },
      ]);
      window.history.replaceState({}, "");
    }
  }, [location.state]);

  const isTxHash = (text: string): boolean => {
    const t = text.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(t)) return true;
    if (/^[0-9a-fA-F]{64}$/.test(t)) return true;
    if (/^[A-Za-z0-9+/=]{44}$/.test(t)) return true;
    if (/^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(t)) return true;
    return false;
  };

  const handleSend = () => {
    if (!input.trim() || isAnalyzing) return;
    const text = input.trim();

    // Before any analysis exists, only accept tx hashes
    if (!hasAnalysis && !isTxHash(text)) {
      setHashError(true);
      setTimeout(() => setHashError(false), 1500);
      return;
    }

    const userMsg: Message = { id: Date.now().toString(), type: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsAnalyzing(true);

    if (isTxHash(text)) {
      const txHash = text;
      const statusId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        { id: statusId, type: "status", content: "Detecting network & analyzing..." },
      ]);

      const cancel = streamAnalysis(txHash, (event) => {
        if (event.type === "step") {
          setMessages((prev) =>
            prev.map((m) => (m.id === statusId ? { ...m, content: event.message ?? "" } : m))
          );
        } else if (event.type === "tool_result") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === statusId
                ? { ...m, content: `${event.toolName}: ${event.summary?.slice(0, 80) ?? "done"}` }
                : m
            )
          );
        } else if (event.type === "complete" && event.result) {
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== statusId),
            {
              id: (Date.now() + 2).toString(),
              type: "agent",
              content: "",
              analysis: event.result,
            },
          ]);
          dispatch({ type: "SET_RESULT", result: event.result! });
          dispatch({
            type: "ADD_HISTORY",
            entry: {
              txHash,
              networkId: event.result!.networkId,
              status: event.result!.success ? "Success" : "Failed",
              timestamp: new Date().toISOString(),
              result: event.result!,
            },
          });
          // Refresh subscription usage counter after successful analysis
          getSubscriptionStatus().then((status) => {
            if (status) dispatch({ type: "SET_SUBSCRIPTION", status });
          });
          setIsAnalyzing(false);
        } else if (event.type === "paywall") {
          setMessages((prev) => prev.filter((m) => m.id !== statusId));
          setIsAnalyzing(false);
          navigate("/upgrade");
        } else if (event.type === "error") {
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== statusId),
            {
              id: (Date.now() + 2).toString(),
              type: "agent",
              content: `Analysis failed: ${event.message ?? "Unknown error"}`,
            },
          ]);
          setIsAnalyzing(false);
        }
      });
      cancelRef.current = cancel;
    } else {
      const statusId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        { id: statusId, type: "status", content: "Thinking..." },
      ]);

      askQuestion(text, state.currentResult ?? undefined)
        .then((answer) => {
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== statusId),
            { id: (Date.now() + 2).toString(), type: "agent", content: answer },
          ]);
        })
        .catch((err) => {
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== statusId),
            {
              id: (Date.now() + 2).toString(),
              type: "agent",
              content: `Sorry, I couldn't answer that: ${err instanceof Error ? err.message : String(err)}`,
            },
          ]);
        })
        .finally(() => setIsAnalyzing(false));
    }
  };

  const hasMessages = messages.length > 0;
  const hasAnalysis = messages.some((m) => m.type === "agent" && m.analysis);
  const [hashError, setHashError] = useState(false);

  const sub = state.subscription;
  const showUsage = sub && !sub.isPro;
  const usageLabel = showUsage
    ? `${sub.remaining ?? 0} / ${sub.limit ?? 5} free`
    : null;

  return (
    <div className="h-screen bg-[#0F1117] flex flex-col">
      {/* Top Bar — minimal */}
      <div className="px-4 py-3 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#0098EA]" />
          <span className="text-white font-medium text-[15px]">Explorai</span>
        </div>

        <div className="flex items-center gap-2">
          {usageLabel && (
            <button
              onClick={() => navigate("/upgrade")}
              className="flex items-center gap-1.5 bg-[#1A1D27] border border-[#2A2D37] rounded-lg px-2.5 py-1 hover:border-[#0098EA]/40 transition-colors"
            >
              <Zap className="w-3 h-3 text-[#0098EA]" />
              <span className="text-[#8B8E96] text-[12px]">{usageLabel}</span>
            </button>
          )}
          {sub?.isPro && (
            <span className="flex items-center gap-1 bg-[#0098EA]/10 border border-[#0098EA]/30 rounded-lg px-2.5 py-1">
              <Zap className="w-3 h-3 text-[#0098EA]" />
              <span className="text-[#0098EA] text-[12px] font-medium">Pro</span>
            </span>
          )}
          <button
            onClick={() => navigate("/history")}
            className="w-8 h-8 flex items-center justify-center text-[#8B8E96] hover:text-white transition-colors"
          >
            <History className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {!hasMessages ? (
          /* Empty State */
          <div className="h-full flex flex-col items-center justify-center px-6">
            <Sparkles className="w-10 h-10 text-[#0098EA]/60 mb-4" />
            <h2 className="text-white text-[18px] font-medium mb-2">Paste a transaction hash</h2>
            <p className="text-[#8B8E96] text-[14px] text-center max-w-[280px]">
              Supports TON, EVM (14 chains), and Solana. Network is auto-detected.
            </p>
          </div>
        ) : (
          /* Conversation */
          <div className="max-w-[600px] mx-auto px-4 py-4">
            {messages.map((message) => (
              <div key={message.id}>
                {message.type === "user" && (
                  <div className="mb-6">
                    <div className="bg-[#1A1D27] rounded-2xl px-4 py-3 text-white text-[14px] break-all font-mono inline-block max-w-full">
                      {message.content}
                    </div>
                  </div>
                )}

                {message.type === "status" && (
                  <div className="mb-6 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-[#0098EA] animate-spin flex-shrink-0" />
                    <span className="text-[#8B8E96] text-[13px]">{message.content}</span>
                  </div>
                )}

                {message.type === "agent" && (
                  <div className="mb-6">
                    {message.content && (
                      <div className="text-[#c8cad0] text-[14px] leading-relaxed whitespace-pre-wrap break-words">
                        {message.content}
                      </div>
                    )}
                    {message.analysis && (
                      <div className="mt-3 space-y-3">
                        <AnalysisResultCard analysis={message.analysis} />
                        {message.analysis.networkId.startsWith("ton-") && (
                          <TONFeaturesPanel analysis={message.analysis} />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Bar — ChatGPT style */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2">
        <div className="max-w-[600px] mx-auto relative">
          <div className={`bg-[#1A1D27] border rounded-2xl px-4 py-3 flex items-end gap-2 transition-colors ${hashError ? "border-red-500/60" : "border-[#2A2D37] focus-within:border-[#3A3D47]"}`}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); setHashError(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={hasAnalysis ? "Ask a follow-up question..." : "Paste a transaction hash..."}
              rows={1}
              className="flex-1 bg-transparent text-white text-[14px] placeholder:text-[#555] focus:outline-none resize-none leading-6 min-h-[24px] max-h-[120px]"
              disabled={isAnalyzing}
            />
            <button
              onClick={handleSend}
              disabled={isAnalyzing || !input.trim()}
              className="w-8 h-8 bg-[#0098EA] rounded-lg flex items-center justify-center text-white flex-shrink-0 disabled:opacity-30 disabled:bg-[#2A2D37] transition-all hover:bg-[#0088D4]"
            >
              {isAnalyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUp className="w-4 h-4" />
              )}
            </button>
          </div>
          {hashError ? (
            <p className="text-red-400/80 text-[11px] text-center mt-2">
              Please paste a valid transaction hash to start.
            </p>
          ) : (
            <p className="text-[#555] text-[11px] text-center mt-2">
              Explorai can make mistakes. Verify important information.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

