import { useNavigate } from "react-router";
import { Sparkles, Shield, Zap, ArrowRight } from "lucide-react";
import { motion } from "motion/react";

export function OnboardingScreen() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#0F1117] flex flex-col items-center justify-center px-6 max-w-[400px] mx-auto">
      {/* Logo */}
      <motion.div
        className="mb-6 relative"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <div className="absolute inset-0 bg-[#0098EA]/15 blur-3xl rounded-full" />
        <Sparkles className="w-12 h-12 text-[#0098EA] relative z-10" />
      </motion.div>

      {/* Title */}
      <motion.h1
        className="text-[26px] font-semibold text-white mb-2 text-center"
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
      >
        Explorai
      </motion.h1>
      <motion.p
        className="text-[#8B8E96] text-[15px] text-center mb-10 max-w-[300px]"
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.25 }}
      >
        AI-powered blockchain transaction explorer
      </motion.p>

      {/* Features */}
      <motion.div
        className="w-full space-y-3 mb-10"
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.35 }}
      >
        <FeatureRow
          icon={<Sparkles className="w-4 h-4" />}
          text="Deep AI analysis of any transaction"
        />
        <FeatureRow
          icon={<Zap className="w-4 h-4" />}
          text="TON, Ethereum, Polygon, Arbitrum & more"
        />
        <FeatureRow
          icon={<Shield className="w-4 h-4" />}
          text="Real-time risk and security detection"
        />
      </motion.div>

      {/* CTA */}
      <motion.button
        onClick={() => navigate("/chat")}
        className="w-full h-12 bg-[#0098EA] text-white rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-[#0088D4] transition-colors"
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.45 }}
        whileTap={{ scale: 0.98 }}
      >
        Get Started
        <ArrowRight className="w-4 h-4" />
      </motion.button>
    </div>
  );
}

function FeatureRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-8 h-8 rounded-lg bg-[#0098EA]/10 flex items-center justify-center text-[#0098EA] flex-shrink-0">
        {icon}
      </div>
      <span className="text-[#c8cad0] text-[14px]">{text}</span>
    </div>
  );
}
