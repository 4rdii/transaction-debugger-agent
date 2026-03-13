import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, Search, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useApp } from "../store";
import { networkLabel } from "../api";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncHash(hash: string): string {
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

export function HistoryScreen() {
  const navigate = useNavigate();
  const { state, dispatch } = useApp();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTransactions = state.history.filter((tx) =>
    tx.txHash.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelect = (entry: typeof state.history[0]) => {
    if (entry.result) {
      dispatch({ type: "SET_RESULT", result: entry.result });
    }
    navigate("/chat", { state: { fromHistory: entry } });
  };

  return (
    <div className="h-screen bg-[#0F1117] flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="bg-[#1A1D27] border-b border-[#2A2D37] px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate("/chat")} className="text-white hover:text-[#0098EA]">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-white font-semibold text-[15px]">Transaction History</h2>
      </div>

      {/* Search Bar */}
      <div className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B8E96]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by transaction hash..."
            className="w-full bg-[#1A1D27] border border-[#2A2D37] rounded-xl pl-10 pr-4 py-3 text-white text-[14px] placeholder:text-[#8B8E96] focus:outline-none focus:border-[#0098EA] transition-colors"
          />
        </div>
      </div>

      {/* Transactions List */}
      <div className="px-4 pb-4 space-y-3">
        {filteredTransactions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#8B8E96] text-[14px]">
              {state.history.length === 0 ? "No transactions analyzed yet" : "No transactions found"}
            </p>
          </div>
        ) : (
          filteredTransactions.map((tx, index) => (
            <button
              key={index}
              onClick={() => handleSelect(tx)}
              className="w-full bg-[#1A1D27] border border-[#2A2D37] rounded-xl p-4 hover:border-[#0098EA] transition-colors text-left"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusIcon status={tx.status} />
                    <span
                      className={`text-[13px] font-medium ${
                        tx.status === "Success"
                          ? "text-[#2ECC71]"
                          : tx.status === "Failed"
                          ? "text-[#E74C3C]"
                          : "text-[#F39C12]"
                      }`}
                    >
                      {tx.status}
                    </span>
                  </div>
                  <div className="text-white font-mono text-[13px] mb-1">{truncHash(tx.txHash)}</div>
                  <div className="text-[#8B8E96] text-[12px]">{timeAgo(tx.timestamp)}</div>
                </div>

                <div className="px-2.5 py-1 bg-[#0098EA]/10 rounded-full text-[12px] text-[#0098EA] ml-2 flex-shrink-0">
                  {networkLabel(tx.networkId)}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "Success") {
    return <CheckCircle2 className="w-4 h-4 text-[#2ECC71]" />;
  }
  if (status === "Failed") {
    return <XCircle className="w-4 h-4 text-[#E74C3C]" />;
  }
  return <Clock className="w-4 h-4 text-[#F39C12]" />;
}
