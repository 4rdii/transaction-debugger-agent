import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useTonConnectUI, useTonAddress, useTonConnectModal } from "@tonconnect/ui-react";
import {
  Sparkles, CheckCircle, Loader2, ArrowLeft, Zap, Star, Wallet, RefreshCw,
} from "lucide-react";
import {
  getPaymentInfo,
  verifyTonConnect,
  createStarsInvoice,
  activateStars,
} from "../api";
import type { PaymentInfo } from "../api";
import { useApp } from "../store";

type Tab = "ton" | "stars";
type TonState = "idle" | "connecting" | "sending" | "verifying" | "error";

export function PaywallScreen() {
  const navigate = useNavigate();
  const { dispatch } = useApp();
  const [tab, setTab] = useState<Tab>("ton");
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);

  // TON Connect state
  const [tonConnectUI] = useTonConnectUI();
  const { open: openConnectModal } = useTonConnectModal();
  const userAddress = useTonAddress();
  const [tonState, setTonState] = useState<TonState>("idle");
  const [tonError, setTonError] = useState<string | null>(null);

  // Stars state
  const [starsLoading, setStarsLoading] = useState(false);
  const [starsError, setStarsError] = useState<string | null>(null);

  // Success
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    getPaymentInfo().then(setPaymentInfo);
  }, []);

  const handleSuccess = (status: Parameters<typeof dispatch>[0] extends { type: "SET_SUBSCRIPTION"; status: infer S } ? S : never) => {
    dispatch({ type: "SET_SUBSCRIPTION", status });
    setSuccess(true);
    setTimeout(() => navigate("/"), 2000);
  };

  // ─── TON Connect payment ──────────────────────────────────────────────────

  const handleTonPay = async () => {
    if (!paymentInfo) return;
    setTonError(null);

    if (!userAddress) {
      setTonState("connecting");
      openConnectModal();
      return;
    }

    setTonState("sending");
    try {
      const amountNano = String(Math.round(paymentInfo.amountTon * 1e9));
      // Encode memo as a TON cell text comment (prefixed with 0x00000000 op)
      const memoBytes = new TextEncoder().encode(paymentInfo.memo);
      const prefix = new Uint8Array(4); // 4-byte zero prefix = text comment op
      const payload = new Uint8Array(prefix.length + memoBytes.length);
      payload.set(prefix, 0);
      payload.set(memoBytes, 4);
      const payloadBase64 = btoa(String.fromCharCode(...payload));

      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{
          address: paymentInfo.walletAddress,
          amount: amountNano,
          payload: payloadBase64,
        }],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("cancel") || msg.includes("reject") || msg.includes("User")) {
        setTonState("idle");
      } else {
        setTonError(msg);
        setTonState("error");
      }
      return;
    }

    // Transaction sent — backend polls TonAPI
    setTonState("verifying");
    const result = await verifyTonConnect(userAddress);
    if (result.success && result.status) {
      handleSuccess(result.status);
    } else {
      setTonError(result.error ?? "Verification failed. Please try again.");
      setTonState("error");
    }
  };

  const tonButtonLabel = () => {
    if (!userAddress) return "Connect Wallet";
    switch (tonState) {
      case "connecting": return "Connecting…";
      case "sending": return "Confirm in wallet…";
      case "verifying": return "Verifying payment…";
      default: return `Pay ${paymentInfo?.amountTon ?? 3} TON`;
    }
  };

  const isTonBusy = tonState === "connecting" || tonState === "sending" || tonState === "verifying";

  // ─── Telegram Stars payment ───────────────────────────────────────────────

  const handleStarsPay = async () => {
    setStarsLoading(true);
    setStarsError(null);

    const invoice = await createStarsInvoice();
    if (!invoice) {
      setStarsError("Stars payments are not available right now.");
      setStarsLoading(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tg = (window as any).Telegram?.WebApp;
    if (!tg?.openInvoice) {
      setStarsError("Telegram Stars are only available inside the Telegram app.");
      setStarsLoading(false);
      return;
    }

    tg.openInvoice(invoice.invoiceUrl, async (status: string) => {
      setStarsLoading(false);
      if (status === "paid") {
        const result = await activateStars(invoice.payload);
        if (result.success && result.status) {
          handleSuccess(result.status);
        } else {
          setStarsError(result.error ?? "Activation failed after payment.");
        }
      } else if (status === "cancelled") {
        // user cancelled — do nothing
      } else {
        setStarsError(`Payment ${status}. Please try again.`);
      }
    });
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (success) {
    return (
      <div className="h-screen bg-[#0F1117] flex flex-col items-center justify-center px-6 gap-4">
        <CheckCircle className="w-16 h-16 text-green-400" />
        <h2 className="text-white text-xl font-semibold">You're on Pro!</h2>
        <p className="text-[#8B8E96] text-sm text-center">
          Unlimited analyses for 30 days. Redirecting…
        </p>
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
          <p className="text-[#8B8E96] text-sm">
            {paymentInfo
              ? `You've used your free analyses today.`
              : "Unlimited analyses · No daily limits"}
          </p>
          <div className="mt-3 inline-flex items-baseline gap-1">
            <span className="text-white text-3xl font-bold">$9</span>
            <span className="text-[#8B8E96] text-sm">/ month</span>
          </div>
          <p className="text-[#0098EA] text-sm mt-1">30 days · Unlimited analyses</p>
        </div>

        {/* Tabs */}
        <div className="flex bg-[#1A1D27] border border-[#2A2D37] rounded-xl p-1 mb-4">
          <button
            onClick={() => setTab("ton")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "ton"
                ? "bg-[#0098EA] text-white"
                : "text-[#8B8E96] hover:text-white"
            }`}
          >
            <Wallet className="w-4 h-4" />
            TON Connect
          </button>
          <button
            onClick={() => setTab("stars")}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === "stars"
                ? "bg-[#0098EA] text-white"
                : "text-[#8B8E96] hover:text-white"
            }`}
          >
            <Star className="w-4 h-4" />
            Telegram Stars
          </button>
        </div>

        {/* ── TON Connect tab ──────────────────────────────────────────────── */}
        {tab === "ton" && (
          <div className="space-y-3">
            {paymentInfo?.configured ? (
              <>
                <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-2xl p-4 space-y-2">
                  <p className="text-[#8B8E96] text-xs">
                    Connects to Tonkeeper, TON Space, or any TON wallet.
                    The transaction includes your unique memo automatically.
                  </p>
                  {userAddress && (
                    <div className="flex items-center gap-2 bg-[#0F1117] rounded-xl px-3 py-2">
                      <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                      <span className="text-[#8B8E96] text-xs font-mono truncate">
                        {userAddress.slice(0, 8)}…{userAddress.slice(-6)}
                      </span>
                      <button
                        onClick={() => tonConnectUI.disconnect()}
                        className="ml-auto text-[#555] hover:text-[#8B8E96] text-xs transition-colors"
                      >
                        Disconnect
                      </button>
                    </div>
                  )}
                </div>

                {tonError && (
                  <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                    <p className="text-red-400/90 text-xs flex-1">{tonError}</p>
                    <button onClick={() => { setTonError(null); setTonState("idle"); }}>
                      <RefreshCw className="w-3.5 h-3.5 text-red-400/60 mt-0.5" />
                    </button>
                  </div>
                )}

                <button
                  onClick={handleTonPay}
                  disabled={isTonBusy}
                  className="w-full bg-[#0098EA] hover:bg-[#0088D4] disabled:opacity-50 disabled:bg-[#2A2D37] text-white text-sm font-medium rounded-xl py-3.5 transition-all flex items-center justify-center gap-2"
                >
                  {isTonBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : userAddress ? (
                    <Wallet className="w-4 h-4" />
                  ) : null}
                  {tonButtonLabel()}
                </button>

                {tonState === "verifying" && (
                  <p className="text-[#8B8E96] text-xs text-center">
                    Waiting for on-chain confirmation… this takes ~15 seconds.
                  </p>
                )}
              </>
            ) : (
              <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-2xl p-6 text-center">
                <p className="text-[#8B8E96] text-sm">
                  TON payments are not configured yet. Please check back soon.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Telegram Stars tab ────────────────────────────────────────────── */}
        {tab === "stars" && (
          <div className="space-y-3">
            <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-2xl p-4 space-y-2">
              <p className="text-[#8B8E96] text-xs">
                Pay directly with your Telegram Stars balance. No wallet needed —
                works on any device.
              </p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[#8B8E96] text-sm">Price</span>
                <div className="flex items-center gap-1.5">
                  <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                  <span className="text-white font-semibold">
                    {paymentInfo?.starsPrice ?? 500} Stars
                  </span>
                </div>
              </div>
            </div>

            {starsError && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                <p className="text-red-400/90 text-xs flex-1">{starsError}</p>
                <button onClick={() => setStarsError(null)}>
                  <RefreshCw className="w-3.5 h-3.5 text-red-400/60 mt-0.5" />
                </button>
              </div>
            )}

            <button
              onClick={handleStarsPay}
              disabled={starsLoading}
              className="w-full bg-[#FFB800] hover:bg-[#FFA800] disabled:opacity-50 text-black text-sm font-semibold rounded-xl py-3.5 transition-all flex items-center justify-center gap-2"
            >
              {starsLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Star className="w-4 h-4 fill-black" />
              )}
              {starsLoading ? "Opening…" : "Pay with Telegram Stars"}
            </button>
          </div>
        )}

        <p className="text-[#555] text-xs text-center pt-4">
          {paymentInfo?.durationDays ?? 30} days · No auto-renewal
        </p>
      </div>
    </div>
  );
}
