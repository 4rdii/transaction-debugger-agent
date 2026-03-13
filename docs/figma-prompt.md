# TON Debug Agent — Figma Make Prompt

Design a modern, dark-themed Telegram Mini App UI for an **AI Transaction Debugger Agent on TON**. The app is called **"TON Debug Agent"** — an AI-powered blockchain transaction analyzer built for the TON ecosystem (with secondary support for EVM chains like Ethereum, Polygon, Arbitrum).

**Overall Style:** Dark mode (#0F1117 background), with TON brand blue (#0098EA) as the primary accent. Glassmorphism cards with subtle borders. Clean, minimal, mobile-first layout (390px width — Telegram Mini App viewport). Rounded corners (12-16px). Inter or SF Pro font. Subtle gradients on CTAs.

## Screens to design:

### 1. Home / Chat Screen (primary)
- Top bar: app logo (hexagon icon + "TON Debug Agent"), small chain selector pill (TON selected by default, dropdown for ETH/Polygon/Arbitrum/Base)
- Chat-style interface: AI agent conversation bubbles. The user pastes a transaction hash, the agent responds with structured analysis cards
- Bottom input bar: text field with placeholder "Paste tx hash or ask a question...", send button with TON blue accent
- Show a welcome state with 3 quick-action chips: "Debug Transaction", "Check Token Flows", "Risk Scan"

### 2. Analysis Result Card (inline in chat)
- Expandable card showing: Status badge (Success/Failed/Reverted), Network pill, Gas used
- **Call Trace** section: collapsible tree of internal calls with method names and addresses (truncated)
- **Token Flows** section: visual flow showing tokens in/out with amounts, token icons, and arrow connectors
- **Risk Flags** section: colored severity badges (Critical/High/Medium/Low) with short descriptions
- **AI Summary** section: 2-3 sentence plain-english explanation of what the transaction did

### 3. Risk Scan Detail Screen
- Expanded view of risk flags with full descriptions
- Donut/ring chart showing risk distribution by severity
- "Ask AI" button to drill deeper into a specific flag

### 4. TON-Specific Features Panel
- BOC (Bag of Cells) message trace viewer
- Multi-message transaction flow (TON's async model — show message chain as a horizontal timeline/graph)
- Jetton (TON token) transfer visualization
- Smart contract state diff (before/after)

### 5. History / Saved Screen
- List of previously analyzed transactions with chain icon, truncated hash, status badge, and timestamp
- Search/filter bar at top

### 6. Onboarding / Splash
- Centered logo animation placeholder, tagline: "Your AI agent for debugging TON transactions"
- "Connect via Telegram" button (TON Connect style)
- Three feature highlights with icons: "AI-Powered Analysis", "Multi-Chain Support", "Real-Time Risk Detection"

## Design tokens:
- Background: #0F1117
- Surface/Card: #1A1D27 with 1px border #2A2D37
- Primary accent: #0098EA (TON blue)
- Success: #2ECC71, Error: #E74C3C, Warning: #F39C12
- Text primary: #FFFFFF, Text secondary: #8B8E96
- Border radius: 12px cards, 20px buttons, 999px pills

Make it feel like a premium Telegram bot experience — conversational, fast, information-dense but not cluttered. Prioritize the mobile chat view as the hero screen.
