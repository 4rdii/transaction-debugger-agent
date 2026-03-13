import { useState, useCallback } from "react";

interface AddressChipProps {
  address: string;
  label?: string;
  className?: string;
}

function truncAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function AddressChip({ address, label, className = "" }: AddressChipProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      // Fallback for Telegram WebApp
      const el = document.createElement("textarea");
      el.value = address;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [address]);

  const display = label || truncAddr(address);

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={address}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0098EA]/10 text-[#0098EA] text-[11px] font-mono hover:bg-[#0098EA]/20 active:bg-[#0098EA]/30 transition-colors cursor-pointer max-w-full ${className}`}
    >
      <span className="truncate">{copied ? "Copied!" : display}</span>
    </button>
  );
}
