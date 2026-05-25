import { createRoot } from "react-dom/client";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import App from "./app/App.tsx";
import "./styles/index.css";

const MANIFEST_URL =
  import.meta.env.VITE_TONCONNECT_MANIFEST_URL ??
  "https://mini-app-iota-three.vercel.app/tonconnect-manifest.json";

createRoot(document.getElementById("root")!).render(
  <TonConnectUIProvider manifestUrl={MANIFEST_URL}>
    <App />
  </TonConnectUIProvider>
);
