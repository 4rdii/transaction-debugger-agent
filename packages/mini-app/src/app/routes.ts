import { createBrowserRouter } from "react-router";
import { ChatScreen } from "./screens/ChatScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { RiskDetailScreen } from "./screens/RiskDetailScreen";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: ChatScreen,
  },
  {
    path: "/chat",
    Component: ChatScreen,
  },
  {
    path: "/history",
    Component: HistoryScreen,
  },
  {
    path: "/risk/:txHash",
    Component: RiskDetailScreen,
  },
]);
