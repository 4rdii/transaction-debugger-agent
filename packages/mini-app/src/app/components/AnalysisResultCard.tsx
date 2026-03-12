import { useState } from "react";
import { useNavigate } from "react-router";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  ArrowRight,
  MessageSquare,
} from "lucide-react";
import type { AnalysisResult, NormalizedCall } from "../api";

function truncAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

function formatGas(result: AnalysisResult): string {
  if (result.networkId.startsWith("ton-")) {
    return `${(result.gasUsed / 1_000_000_000).toFixed(6)} TON`;
  }
  if (result.networkId.startsWith("solana-")) {
    return `${result.gasUsed.toLocaleString()} CU`;
  }
  return `${result.gasUsed.toLocaleString()} gas`;
}

function networkLabel(networkId: string): string {
  const map: Record<string, string> = {
    "1": "Ethereum",
    "137": "Polygon",
    "42161": "Arbitrum",
    "10": "Optimism",
    "8453": "Base",
    "56": "BSC",
    "ton-mainnet": "TON",
    "ton-testnet": "TON Testnet",
    "solana-mainnet": "Solana",
    "solana-devnet": "Solana Devnet",
  };
  return map[networkId] ?? networkId;
}

/** Render markdown-ish LLM text into styled React elements */
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      elements.push(<div key={key++} className="h-2" />);
      continue;
    }

    // Section headers like **Summary**: or **Step-by-step**:
    const sectionMatch = trimmed.match(/^\*\*([^*]+)\*\*\s*:?\s*(.*)$/);
    if (sectionMatch && !trimmed.startsWith('-') && !trimmed.match(/^\d+\./)) {
      const rest = sectionMatch[2];
      elements.push(
        <div key={key++} className="mt-3 first:mt-0">
          <span className="text-white font-semibold text-[13px]">{sectionMatch[1]}</span>
          {rest && <span className="text-[#c8cad0] text-[13px]"> {renderInline(rest)}</span>}
        </div>
      );
      continue;
    }

    // Numbered list items: 1. **Bold part**: rest
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      elements.push(
        <div key={key++} className="flex gap-2 ml-1 mt-1.5">
          <span className="text-[#0098EA] text-[12px] font-medium w-4 flex-shrink-0">{numMatch[1]}.</span>
          <span className="text-[#c8cad0] text-[13px] leading-relaxed">{renderInline(numMatch[2])}</span>
        </div>
      );
      continue;
    }

    // Bullet items: - text
    const bulletMatch = trimmed.match(/^[-•]\s+(.*)$/);
    if (bulletMatch) {
      elements.push(
        <div key={key++} className="flex gap-2 ml-1 mt-1.5">
          <span className="text-[#0098EA] text-[12px] mt-1">•</span>
          <span className="text-[#c8cad0] text-[13px] leading-relaxed">{renderInline(bulletMatch[1])}</span>
        </div>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={key++} className="text-[#c8cad0] text-[13px] leading-relaxed mt-1">
        {renderInline(trimmed)}
      </p>
    );
  }

  return elements;
}

/** Render inline markdown: **bold** */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldIdx = remaining.indexOf('**');
    if (boldIdx === -1) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
    if (boldIdx > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, boldIdx)}</span>);
    }
    const endIdx = remaining.indexOf('**', boldIdx + 2);
    if (endIdx === -1) {
      parts.push(<span key={key++}>{remaining.slice(boldIdx)}</span>);
      break;
    }
    parts.push(
      <span key={key++} className="text-white font-medium">{remaining.slice(boldIdx + 2, endIdx)}</span>
    );
    remaining = remaining.slice(endIdx + 2);
  }

  return parts;
}

export function AnalysisResultCard({ analysis }: { analysis: AnalysisResult }) {
  const navigate = useNavigate();
  const [expandedSections, setExpandedSections] = useState({
    callTrace: false,
    tokenFlows: false,
    riskFlags: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Flatten call tree for display (up to 20 items)
  const flatCalls: { call: NormalizedCall; level: number }[] = [];
  function flatten(node: NormalizedCall, level: number) {
    if (flatCalls.length >= 20) return;
    flatCalls.push({ call: node, level });
    for (const child of node.children) flatten(child, level + 1);
  }
  flatten(analysis.callTree, 0);

  return (
    <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[#2A2D37]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {analysis.success ? (
              <CheckCircle2 className="w-5 h-5 text-[#2ECC71]" />
            ) : (
              <XCircle className="w-5 h-5 text-[#E74C3C]" />
            )}
            <span className={`text-[13px] font-medium ${analysis.success ? "text-[#2ECC71]" : "text-[#E74C3C]"}`}>
              {analysis.success ? "Success" : "Failed"}
            </span>
          </div>
          <div className="px-2.5 py-1 bg-[#0098EA]/10 rounded-full text-[12px] text-[#0098EA]">
            {networkLabel(analysis.networkId)}
          </div>
        </div>
        <div className="text-[#8B8E96] text-[12px]">
          Gas Used: <span className="text-white">{formatGas(analysis)}</span>
        </div>
      </div>

      {/* AI Summary — always visible at top, formatted */}
      {analysis.llmExplanation && (
        <div className="p-4 border-b border-[#2A2D37]">
          <div className="flex gap-3">
            <MessageSquare className="w-5 h-5 text-[#0098EA] flex-shrink-0 mt-1" />
            <div className="flex-1 min-w-0 break-words overflow-hidden">
              {renderMarkdown(analysis.llmExplanation)}
            </div>
          </div>
        </div>
      )}

      {/* Call Trace Section */}
      <CollapsibleSection
        title="Call Trace"
        expanded={expandedSections.callTrace}
        onToggle={() => toggleSection("callTrace")}
      >
        <div className="space-y-2">
          {flatCalls.map(({ call, level }) => (
            <div
              key={call.id}
              className="flex items-start gap-2"
              style={{ paddingLeft: `${level * 12}px` }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-[#0098EA] mt-1.5 flex-shrink-0" />
              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="flex items-center gap-1">
                  <span className="text-white text-[12px] font-mono truncate">
                    {call.functionName ?? call.callType}
                  </span>
                  {call.success ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#2ECC71] flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-[#E74C3C] flex-shrink-0" />
                  )}
                </div>
                <span className="text-[#8B8E96] text-[11px] font-mono truncate block">
                  {call.contractName ?? truncAddr(call.callee)}
                </span>
              </div>
            </div>
          ))}
          {flatCalls.length >= 20 && (
            <div className="text-[#8B8E96] text-[12px] pl-4">...and more</div>
          )}
        </div>
      </CollapsibleSection>

      {/* Token Flows Section */}
      {analysis.tokenFlows.length > 0 && (
        <CollapsibleSection
          title="Token Flows"
          expanded={expandedSections.tokenFlows}
          onToggle={() => toggleSection("tokenFlows")}
        >
          <div className="space-y-3">
            {analysis.tokenFlows.map((flow, index) => (
              <div key={index} className="bg-[#0F1117] rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-2 min-w-0">
                  <span className="text-[11px] text-[#8B8E96] font-mono truncate flex-shrink min-w-0">{truncAddr(flow.from)}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#0098EA] flex-shrink-0" />
                  <span className="text-[11px] text-[#8B8E96] font-mono truncate flex-shrink min-w-0">{truncAddr(flow.to)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full bg-[#0098EA]/10 flex items-center justify-center text-[10px] text-[#0098EA] flex-shrink-0">
                    {flow.tokenSymbol[0]}
                  </div>
                  <span className="text-white text-[13px] font-medium truncate">
                    {flow.formattedAmount} {flow.tokenSymbol}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Risk Flags Section */}
      {analysis.riskFlags.length > 0 && (
        <CollapsibleSection
          title="Risk Flags"
          expanded={expandedSections.riskFlags}
          onToggle={() => toggleSection("riskFlags")}
        >
          <div className="space-y-2">
            {analysis.riskFlags.map((flag, index) => (
              <div key={index} className="bg-[#0F1117] rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <RiskBadge severity={flag.level} />
                  <span className="text-white text-[12px] font-medium truncate">{flag.type}</span>
                </div>
                <div className="text-[#8B8E96] text-[12px] break-words">{flag.description}</div>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate(`/risk/${encodeURIComponent(analysis.txHash)}`)}
            className="w-full mt-3 px-4 py-2 bg-[#0098EA]/10 text-[#0098EA] rounded-lg text-[13px] font-medium hover:bg-[#0098EA]/20 transition-colors"
          >
            View Full Risk Report
          </button>
        </CollapsibleSection>
      )}

      {/* AI Summary moved to top — non-collapsible */}
    </div>
  );
}

function CollapsibleSection({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
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
        <span className="text-[14px] font-medium">{title}</span>
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

function RiskBadge({ severity }: { severity: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    high: { bg: "bg-[#E74C3C]/10", text: "text-[#E74C3C]" },
    medium: { bg: "bg-[#F39C12]/10", text: "text-[#F39C12]" },
    low: { bg: "bg-[#2ECC71]/10", text: "text-[#2ECC71]" },
  };

  const color = colors[severity] ?? colors.low;

  return (
    <div
      className={`px-2.5 py-1 ${color!.bg} ${color!.text} rounded-full text-[11px] font-medium flex-shrink-0 capitalize`}
    >
      {severity}
    </div>
  );
}
