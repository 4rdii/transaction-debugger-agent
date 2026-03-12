import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router";
import { Hexagon, ChevronDown, Send, History, Search, Cpu, Loader2 } from "lucide-react";
import { AnalysisResultCard } from "../components/AnalysisResultCard";
import { TONFeaturesPanel } from "../components/TONFeaturesPanel";
import { useApp } from "../store";
import { streamAnalysis, askQuestion, CHAIN_TO_NETWORK_ID } from "../api";
import type { Chain, AnalysisResult } from "../api";
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
  const [showChainDropdown, setShowChainDropdown] = useState(false);
  const [input, setInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      type: "agent",
      content: "Hey! I'm your TON Debug Agent. Paste a transaction hash or ask me anything about blockchain transactions.",
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const chains: Chain[] = ["TON", "ETH", "Polygon", "Arbitrum", "Base"];
  const selectedChain = state.selectedChain;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(scrollToBottom, [messages, scrollToBottom]);

  // Restore conversation from history entry
  useEffect(() => {
    const historyEntry = (location.state as { fromHistory?: HistoryEntry } | null)?.fromHistory;
    if (historyEntry?.result) {
      setMessages([
        {
          id: "welcome",
          type: "agent",
          content: "Hey! I'm your TON Debug Agent. Paste a transaction hash or ask me anything about blockchain transactions.",
        },
        {
          id: `hist-user-${historyEntry.txHash}`,
          type: "user",
          content: historyEntry.txHash,
        },
        {
          id: `hist-result-${historyEntry.txHash}`,
          type: "agent",
          content: "Here's what I found:",
          analysis: historyEntry.result,
        },
      ]);
      // Clear the navigation state so refreshing doesn't re-trigger
      window.history.replaceState({}, "");
    }
  }, [location.state]);

  // Detect if input looks like a transaction hash
  const isTxHash = (text: string): boolean => {
    const t = text.trim();
    // EVM: 0x + 64 hex chars
    if (/^0x[0-9a-fA-F]{64}$/.test(t)) return true;
    // TON: 64 hex chars or 44-char base64
    if (/^[0-9a-fA-F]{64}$/.test(t)) return true;
    if (/^[A-Za-z0-9+/=]{44}$/.test(t)) return true;
    // Solana: base58, 43-88 chars
    if (/^[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(t)) return true;
    return false;
  };

  const handleSend = () => {
    if (!input.trim() || isAnalyzing) return;
    const text = input.trim();

    // Add user message
    const userMsg: Message = { id: Date.now().toString(), type: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsAnalyzing(true);

    if (isTxHash(text)) {
      // ─── Transaction analysis flow ──────────────────────────────────────
      const txHash = text;
      const networkId = CHAIN_TO_NETWORK_ID[selectedChain];
      const statusId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        { id: statusId, type: "status", content: "Starting analysis..." },
      ]);

      const cancel = streamAnalysis(txHash, networkId, (event) => {
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
              content: "Here's what I found:",
              analysis: event.result,
            },
          ]);
          dispatch({ type: "SET_RESULT", result: event.result! });
          dispatch({
            type: "ADD_HISTORY",
            entry: {
              txHash,
              chain: selectedChain,
              status: event.result!.success ? "Success" : "Failed",
              timestamp: new Date().toISOString(),
              result: event.result!,
            },
          });
          setIsAnalyzing(false);
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
      // ─── Question / chat flow ───────────────────────────────────────────
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

  const handleQuickAction = (action: string) => {
    setInput(action);
  };

  return (
    <div className="h-screen bg-[#0F1117] flex flex-col">
      {/* Top Bar */}
      <div className="bg-[#1A1D27] border-b border-[#2A2D37] px-4 py-3 flex items-center justify-between flex-shrink-0 z-10">
        <div className="flex items-center gap-2">
          <Hexagon className="w-6 h-6 text-[#0098EA]" strokeWidth={1.5} />
          <span className="text-white font-semibold text-[15px]">TON Debug Agent</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Chain Selector */}
          <div className="relative">
            <button
              onClick={() => setShowChainDropdown(!showChainDropdown)}
              className="px-3 py-1.5 bg-[#0F1117] border border-[#2A2D37] rounded-full text-[13px] text-white flex items-center gap-1.5 hover:border-[#0098EA] transition-colors"
            >
              {selectedChain}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>

            {showChainDropdown && (
              <div className="absolute top-full right-0 mt-2 bg-[#1A1D27] border border-[#2A2D37] rounded-xl overflow-hidden min-w-[120px] shadow-xl">
                {chains.map((chain) => (
                  <button
                    key={chain}
                    onClick={() => {
                      dispatch({ type: "SET_CHAIN", chain });
                      setShowChainDropdown(false);
                    }}
                    className="w-full px-4 py-2.5 text-left text-[13px] text-white hover:bg-[#2A2D37] transition-colors"
                  >
                    {chain}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => navigate("/history")}
            className="w-8 h-8 flex items-center justify-center text-[#8B8E96] hover:text-white transition-colors"
          >
            <History className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 space-y-4">
        {messages.length === 1 && (
          <div className="space-y-3 mb-6">
            <QuickActionChip
              label="Debug Transaction"
              icon={<Search className="w-4 h-4" />}
              onClick={() => handleQuickAction("")}
            />
            <QuickActionChip
              label="Check Token Flows"
              icon={<Cpu className="w-4 h-4" />}
              onClick={() => handleQuickAction("")}
            />
            <QuickActionChip
              label="Risk Scan"
              icon={<Cpu className="w-4 h-4" />}
              onClick={() => handleQuickAction("")}
            />
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id}>
            {message.type === "status" && (
              <div className="flex gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-[#0098EA]/10 flex items-center justify-center flex-shrink-0">
                  <Loader2 className="w-4 h-4 text-[#0098EA] animate-spin" />
                </div>
                <div className="flex-1">
                  <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-xl rounded-tl-none px-4 py-3 text-[#8B8E96] text-[13px]">
                    {message.content}
                  </div>
                </div>
              </div>
            )}

            {message.type === "agent" && (
              <div className="flex gap-3 mb-4 max-w-[85%]">
                <div className="w-8 h-8 rounded-full bg-[#0098EA]/10 flex items-center justify-center flex-shrink-0">
                  <Hexagon className="w-4 h-4 text-[#0098EA]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-xl rounded-tl-none px-4 py-3 text-white text-[14px]">
                    {message.content}
                  </div>
                  {message.analysis && (
                    <div className="mt-3 space-y-3">
                      <AnalysisResultCard analysis={message.analysis} />
                      {message.analysis.networkId.startsWith("ton-") && (
                        <TONFeaturesPanel analysis={message.analysis} />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {message.type === "user" && (
              <div className="flex justify-end mb-4">
                <div className="bg-[#0098EA] rounded-xl rounded-tr-none px-4 py-3 text-white text-[14px] max-w-[80%] break-all font-mono">
                  {message.content}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <div className="bg-[#1A1D27] border-t border-[#2A2D37] px-4 py-3 flex-shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Paste tx hash or ask a question..."
            className="flex-1 bg-[#0F1117] border border-[#2A2D37] rounded-full px-4 py-2.5 text-white text-[14px] placeholder:text-[#8B8E96] focus:outline-none focus:border-[#0098EA] transition-colors font-mono"
            disabled={isAnalyzing}
          />
          <button
            onClick={handleSend}
            disabled={isAnalyzing || !input.trim()}
            className="w-10 h-10 bg-[#0098EA] rounded-full flex items-center justify-center text-white hover:bg-[#0088D4] transition-colors flex-shrink-0 disabled:opacity-50"
          >
            {isAnalyzing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickActionChip({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-[#1A1D27] border border-[#2A2D37] rounded-xl px-4 py-3 flex items-center gap-3 text-white text-[14px] hover:border-[#0098EA] transition-colors"
    >
      <div className="w-8 h-8 rounded-full bg-[#0098EA]/10 flex items-center justify-center text-[#0098EA]">
        {icon}
      </div>
      {label}
    </button>
  );
}
