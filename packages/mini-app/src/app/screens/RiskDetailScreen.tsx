import { useNavigate, useParams } from "react-router";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { useApp } from "../store";

export function RiskDetailScreen() {
  const navigate = useNavigate();
  const { txHash } = useParams();
  const { state } = useApp();

  // Find the result from store or history
  const result =
    state.currentResult?.txHash === txHash
      ? state.currentResult
      : state.history.find((h) => h.txHash === txHash)?.result;

  const riskFlags = result?.riskFlags ?? [];

  const riskCounts = {
    high: riskFlags.filter((f) => f.level === "high").length,
    medium: riskFlags.filter((f) => f.level === "medium").length,
    low: riskFlags.filter((f) => f.level === "low").length,
  };

  const riskData = [
    { name: "High", value: riskCounts.high, color: "#E74C3C" },
    { name: "Medium", value: riskCounts.medium, color: "#F39C12" },
    { name: "Low", value: riskCounts.low, color: "#2ECC71" },
  ];

  const totalFlags = riskFlags.length;
  const maxScore = 100;
  const penalty = riskCounts.high * 25 + riskCounts.medium * 10 + riskCounts.low * 3;
  const riskScore = Math.max(0, maxScore - penalty);
  const scoreColor = riskScore >= 70 ? "#2ECC71" : riskScore >= 40 ? "#F39C12" : "#E74C3C";

  return (
    <div className="min-h-screen bg-[#0F1117] max-w-[390px] mx-auto">
      {/* Header */}
      <div className="bg-[#1A1D27] border-b border-[#2A2D37] px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate("/chat")} className="text-white hover:text-[#0098EA]">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-white font-semibold text-[15px]">Risk Analysis</h2>
          <p className="text-[#8B8E96] text-[12px] font-mono">
            {txHash?.slice(0, 10)}...{txHash?.slice(-8)}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Risk Distribution Chart */}
        <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-xl p-4">
          <h3 className="text-white font-medium mb-4 text-[14px]">Risk Distribution</h3>

          <div className="relative h-48 mb-4">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={riskData.filter((d) => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {riskData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-[24px] font-semibold text-white">{totalFlags}</div>
                <div className="text-[12px] text-[#8B8E96]">Total Flags</div>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="grid grid-cols-3 gap-2">
            {riskData.map((item) => (
              <div key={item.name} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-[13px] text-[#8B8E96]">
                  {item.name}: {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Overall Score */}
        <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-medium text-[14px]">Overall Risk Score</span>
            <span className="text-[20px] font-semibold" style={{ color: scoreColor }}>
              {riskScore}/100
            </span>
          </div>
          <div className="w-full h-2 bg-[#0F1117] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${riskScore}%`, backgroundColor: scoreColor }}
            />
          </div>
          <p className="text-[#8B8E96] text-[12px] mt-2">
            {riskScore >= 70
              ? "This transaction appears safe with only minor concerns detected."
              : riskScore >= 40
              ? "This transaction has some risk factors that warrant attention."
              : "This transaction has significant risk factors. Exercise caution."}
          </p>
        </div>

        {/* Detailed Flags */}
        {riskFlags.length === 0 ? (
          <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-xl p-8 text-center">
            <p className="text-[#8B8E96] text-[14px]">No risk flags detected</p>
          </div>
        ) : (
          <div className="space-y-3">
            {riskFlags.map((flag, index) => (
              <div key={index} className="bg-[#1A1D27] border border-[#2A2D37] rounded-xl p-4">
                <div className="flex items-start gap-3 mb-3">
                  <RiskBadge severity={flag.level} />
                  <h4 className="text-white font-medium text-[14px] flex-1">{flag.type}</h4>
                </div>

                <div className="space-y-3 text-[13px]">
                  <div>
                    <div className="text-[#8B8E96] text-[11px] uppercase font-medium mb-1">
                      Description
                    </div>
                    <p className="text-white leading-relaxed">{flag.description}</p>
                  </div>
                </div>

                <button className="w-full mt-3 px-4 py-2 bg-[#0098EA]/10 text-[#0098EA] rounded-lg text-[13px] font-medium hover:bg-[#0098EA]/20 transition-colors flex items-center justify-center gap-2">
                  <MessageCircle className="w-4 h-4" />
                  Ask AI for Details
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
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
