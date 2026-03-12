import { useNavigate } from "react-router";
import { Hexagon, Sparkles, Shield, Zap } from "lucide-react";
import { motion } from "motion/react";

export function OnboardingScreen() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#0F1117] flex flex-col items-center justify-center px-6 max-w-[390px] mx-auto">
      {/* Logo Animation Placeholder */}
      <motion.div
        className="mb-8 relative"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="absolute inset-0 bg-[#0098EA]/20 blur-3xl rounded-full" />
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        >
          <Hexagon className="w-20 h-20 text-[#0098EA] relative z-10" strokeWidth={1.5} />
        </motion.div>
      </motion.div>

      {/* Title and Tagline */}
      <motion.h1
        className="text-[28px] font-semibold text-white mb-3 text-center"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        TON Debug Agent
      </motion.h1>
      <motion.p
        className="text-[#8B8E96] text-center mb-12 max-w-[280px]"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
      >
        Your AI agent for debugging TON transactions
      </motion.p>

      {/* Feature Highlights */}
      <motion.div
        className="w-full space-y-4 mb-12"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <FeatureCard
          icon={<Sparkles className="w-5 h-5" />}
          title="AI-Powered Analysis"
          description="Deep insights into every transaction"
        />
        <FeatureCard
          icon={<Zap className="w-5 h-5" />}
          title="Multi-Chain Support"
          description="TON, Ethereum, Polygon, Arbitrum & more"
        />
        <FeatureCard
          icon={<Shield className="w-5 h-5" />}
          title="Real-Time Risk Detection"
          description="Instant security and compliance checks"
        />
      </motion.div>

      {/* CTA Button */}
      <motion.button
        onClick={() => navigate("/chat")}
        className="w-full h-12 bg-gradient-to-r from-[#0098EA] to-[#0088D4] text-white rounded-[20px] font-medium hover:opacity-90 transition-opacity"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        Connect via Telegram
      </motion.button>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-[#1A1D27] border border-[#2A2D37] rounded-xl p-4 flex gap-4">
      <div className="w-10 h-10 rounded-full bg-[#0098EA]/10 flex items-center justify-center text-[#0098EA] flex-shrink-0">
        {icon}
      </div>
      <div>
        <h3 className="text-white text-[15px] font-medium mb-1">{title}</h3>
        <p className="text-[#8B8E96] text-[13px]">{description}</p>
      </div>
    </div>
  );
}