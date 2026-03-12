import { useState } from "react";
import { ChevronDown, ChevronUp, GitBranch, MessageSquare, Coins } from "lucide-react";
import type { AnalysisResult, NormalizedCall } from "../api";

const NANOTON = 1_000_000_000;

function truncAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

interface MessageStep {
  step: number;
  type: string;
  from: string;
  to: string;
  status: string;
  value: string;
  opName?: string;
}

function extractMessageFlow(node: NormalizedCall, steps: MessageStep[] = [], depth = 0): MessageStep[] {
  if (depth > 0) {
    const value = BigInt(node.valueWei || "0");
    const valueStr = value > 0n ? `${(Number(value) / NANOTON).toFixed(4)} TON` : "";
    steps.push({
      step: steps.length + 1,
      type: node.callType === "BOUNCE" ? "Bounce" : depth === 1 ? "External" : "Internal",
      from: truncAddr(node.caller),
      to: node.contractName ?? truncAddr(node.callee),
      status: node.success ? "Success" : "Failed",
      value: valueStr,
      opName: node.functionName,
    });
  }
  for (const child of node.children) {
    extractMessageFlow(child, steps, depth + 1);
  }
  return steps;
}

export function TONFeaturesPanel({ analysis }: { analysis: AnalysisResult }) {
  const [expandedSections, setExpandedSections] = useState({
    messageFlow: false,
    jettonTransfers: false,
    stateDiff: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const messageFlow = extractMessageFlow(analysis.callTree);

  // Separate Jetton (non-native) transfers
  const jettonTransfers = analysis.tokenFlows.filter((f) => f.tokenSymbol !== "TON");
  const nativeFlows = analysis.tokenFlows.filter((f) => f.tokenSymbol === "TON");

  return (
    <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#2A2D37] bg-[#0098EA]/5">
        <h3 className="text-white font-medium text-[14px] flex items-center gap-2">
          <Coins className="w-4 h-4 text-[#0098EA]" />
          TON-Specific Analysis
        </h3>
      </div>

      {/* Message Flow */}
      {messageFlow.length > 0 && (
        <CollapsibleSection
          title="Multi-Message Flow"
          icon={<MessageSquare className="w-4 h-4" />}
          expanded={expandedSections.messageFlow}
          onToggle={() => toggleSection("messageFlow")}
        >
          <div className="relative">
            {messageFlow.map((msg, index) => (
              <div key={index} className="flex items-start gap-3 mb-4 last:mb-0">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-[#0098EA]/10 flex items-center justify-center text-[#0098EA] text-[12px] font-semibold flex-shrink-0">
                    {msg.step}
                  </div>
                  {index < messageFlow.length - 1 && (
                    <div className="w-0.5 h-8 bg-[#0098EA]/30 my-1" />
                  )}
                </div>

                <div className="flex-1 min-w-0 bg-[#0F1117] rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[11px] text-[#0098EA] font-medium break-words min-w-0">
                      {msg.type} Message{msg.opName ? ` (${msg.opName})` : ""}
                    </span>
                    <span
                      className={`text-[11px] flex-shrink-0 ${msg.status === "Success" ? "text-[#2ECC71]" : "text-[#E74C3C]"}`}
                    >
                      {msg.status}
                    </span>
                  </div>
                  <div className="text-[12px] text-white mb-1 truncate">{msg.from}</div>
                  <div className="text-[12px] text-[#8B8E96] truncate">
                    &rarr; {msg.to}
                    {msg.value && <span className="ml-2 text-[#0098EA]">({msg.value})</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Jetton Transfers */}
      {jettonTransfers.length > 0 && (
        <CollapsibleSection
          title="Jetton Transfers"
          icon={<Coins className="w-4 h-4" />}
          expanded={expandedSections.jettonTransfers}
          onToggle={() => toggleSection("jettonTransfers")}
        >
          <div className="space-y-2">
            {jettonTransfers.map((transfer, index) => {
              const isIn = transfer.to === analysis.callTree.callee;
              return (
                <div
                  key={index}
                  className="bg-[#0F1117] rounded-lg p-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#0098EA]/10 flex items-center justify-center text-[#0098EA] text-[11px] font-semibold">
                      {transfer.tokenSymbol.charAt(0)}
                    </div>
                    <div>
                      <div className="text-white text-[13px] font-medium">
                        {transfer.formattedAmount}
                      </div>
                      <div className="text-[#8B8E96] text-[11px]">{transfer.tokenSymbol}</div>
                    </div>
                  </div>
                  <div
                    className={`px-2 py-1 rounded-full text-[11px] ${
                      isIn
                        ? "bg-[#2ECC71]/10 text-[#2ECC71]"
                        : "bg-[#E74C3C]/10 text-[#E74C3C]"
                    }`}
                  >
                    {isIn ? "\u2193 In" : "\u2191 Out"}
                  </div>
                </div>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

      {/* Balance Changes (native TON flows as state diff) */}
      {nativeFlows.length > 0 && (
        <CollapsibleSection
          title="TON Balance Changes"
          icon={<GitBranch className="w-4 h-4" />}
          expanded={expandedSections.stateDiff}
          onToggle={() => toggleSection("stateDiff")}
        >
          <div className="space-y-2 text-[12px]">
            {nativeFlows.map((flow, index) => (
              <div key={index} className="bg-[#0F1117] rounded-lg p-3">
                <div className="text-[#8B8E96] mb-1">
                  {truncAddr(flow.from)} &rarr; {truncAddr(flow.to)}
                </div>
                <div className="text-white font-medium">{flow.formattedAmount} TON</div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-[#2A2D37] last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between text-white hover:bg-[#0F1117]/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="text-[#0098EA]">{icon}</div>
          <span className="text-[14px] font-medium">{title}</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-[#8B8E96]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#8B8E96]" />
        )}
      </button>
      {expanded && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
