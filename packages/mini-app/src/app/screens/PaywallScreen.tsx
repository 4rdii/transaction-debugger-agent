import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Sparkles, Copy, CheckCircle, Loader2, ArrowLeft, Zap } from "lucide-react";
import { getPaymentInfo, verifyPayment } from "../api";
import type { PaymentInfo } from "../api";
import { useApp } from "../store";

export function PaywallScreen() {
  const navigate = useNavigate();
  const { dispatch } = useApp();
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [txInput, setTxInput] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState<"address" | "memo" | null>(null);

  useEffect(() => {
    getPaymentInfo().then(setPaymentInfo);
  }, []);

  const copyToClipboard = async (text: string, field: "address" | "memo") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // fallback — select text
    }
  };

  const handleVerify = async () => {
    if (!txInput.trim() || verifying) return;
    setVerifying(true);
    setError(null);

    const result = await verifyPayment(txInput.trim());
    setVerifying(false);

    if (result.success && result.status) {
      setSuccess(true);
      dispatch({ type: "SET_SUBSCRIPTION", status: result.status });
      setTimeout(() => navigate("/"), 2000);
    } else {
      setError(result.error ?? "Verification failed. Please try again.");
    }
  };

  if (success) {
    return (
      <div className="h-screen bg-[#0F1117] flex flex-col items-center justify-center px-6 gap-4">
        <CheckCircle className="w-16 h-16 text-green-400" />
        <h2 className="text-white text-xl font-semibold">You're on Pro!</h2>
        <p className="text-[#8B8E96] text-sm text-center">Unlimited analyses for 30 days. Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#0F1117] flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => navigate("/")}
          className="w-8 h-8 flex items-center justify-center text-[#8B8E96] hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-[#0098EA]" />
          <span className="text-white font-medium text-[15px]">Explorai Pro</span>
        </div>
      </div>

      <div className="flex-1 px-4 pb-8 max-w-[520px] mx-auto w-full">
        {/* Hero */}
        <div className="text-center py-6">
          <div className="w-14 h-14 rounded-2xl bg-[#0098EA]/15 flex items-center justify-center mx-auto mb-4">
            <Zap className="w-7 h-7 text-[#0098EA]" />
          </div>
          <h1 className="text-white text-xl font-semibold mb-1">Upgrade to Pro</h1>
          <p className="text-[#8B8E96] text-sm">You've used all 5 free analyses today.</p>
          <div className="mt-3 inline-flex items-baseline gap-1">
            <span className="text-white text-3xl font-bold">$9</span>
            <span className="text-[#8B8E96] text-sm">/ month</span>
          </div>
          <p className="text-[#0098EA] text-sm mt-1">Paid in TON · Unlimited analyses</p>
        </div>

        {/* Steps */}
        {paymentInfo && paymentInfo.configured ? (
          <div className="space-y-3">
            {/* Step 1 */}
            <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-2xl p-4">
              <p className="text-[#8B8E96] text-xs font-medium uppercase tracking-wide mb-3">
                Step 1 — Copy your memo
              </p>
              <p className="text-[#8B8E96] text-xs mb-2">
                This links the payment to your account. Must be included exactly as shown.
              </p>
              <div className="flex items-center gap-2 bg-[#0F1117] rounded-xl px-3 py-2.5">
                <span className="text-[#0098EA] font-mono text-sm flex-1 select-all">
                  {paymentInfo.memo}
                </span>
                <button
                  onClick={() => copyToClipboard(paymentInfo.memo, "memo")}
                  className="text-[#8B8E96] hover:text-white transition-colors flex-shrink-0"
                >
                  {copied === "memo" ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-2xl p-4">
              <p className="text-[#8B8E96] text-xs font-medium uppercase tracking-wide mb-3">
                Step 2 — Send {paymentInfo.amountTon} TON
              </p>
              <p className="text-[#8B8E96] text-xs mb-2">
                Send exactly {paymentInfo.amountTon} TON to this address with the memo above as the comment.
              </p>
              <div className="flex items-center gap-2 bg-[#0F1117] rounded-xl px-3 py-2.5">
                <span className="text-white font-mono text-xs flex-1 break-all select-all">
                  {paymentInfo.walletAddress}
                </span>
                <button
                  onClick={() => copyToClipboard(paymentInfo.walletAddress, "address")}
                  className="text-[#8B8E96] hover:text-white transition-colors flex-shrink-0 ml-1"
                >
                  {copied === "address" ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Step 3 */}
            <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-2xl p-4">
              <p className="text-[#8B8E96] text-xs font-medium uppercase tracking-wide mb-3">
                Step 3 — Paste your transaction hash
              </p>
              <p className="text-[#8B8E96] text-xs mb-3">
                After sending, copy the transaction hash from your TON wallet and paste it here.
              </p>
              <div className={`bg-[#0F1117] border rounded-xl px-3 py-2.5 flex items-center gap-2 transition-colors ${error ? "border-red-500/60" : "border-[#2A2D37] focus-within:border-[#3A3D47]"}`}>
                <input
                  type="text"
                  value={txInput}
                  onChange={(e) => { setTxInput(e.target.value); setError(null); }}
                  placeholder="Paste TON tx hash..."
                  className="flex-1 bg-transparent text-white text-sm placeholder:text-[#555] focus:outline-none font-mono"
                  disabled={verifying}
                  onKeyDown={(e) => { if (e.key === "Enter") handleVerify(); }}
                />
              </div>
              {error && (
                <p className="text-red-400/80 text-xs mt-2">{error}</p>
              )}
              <button
                onClick={handleVerify}
                disabled={!txInput.trim() || verifying}
                className="w-full mt-3 bg-[#0098EA] hover:bg-[#0088D4] disabled:opacity-30 disabled:bg-[#2A2D37] text-white text-sm font-medium rounded-xl py-3 transition-all flex items-center justify-center gap-2"
              >
                {verifying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Activate Pro"
                )}
              </button>
            </div>

            <p className="text-[#555] text-xs text-center pt-1">
              Subscription is valid for {paymentInfo.durationDays} days · No auto-renewal
            </p>
          </div>
        ) : (
          <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-2xl p-6 text-center">
            <p className="text-[#8B8E96] text-sm">
              TON payments are not yet configured. Please check back soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
