import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { debugRouter } from './routes/debug.route.js';
import { qaRouter } from './routes/qa.route.js';
import { rangoRouter } from './routes/rango.route.js';
import { errorHandler } from './middleware/error.middleware.js';
import { requireTelegramAuth, optionalTelegramAuth } from './middleware/telegram-auth.middleware.js';
import { getUsageStats } from './services/usage.service.js';

const app = express();

const corsEnv = process.env['CORS_ORIGIN'] ?? 'http://localhost:5173';
const corsOrigin = corsEnv === '*' ? true : corsEnv.split(',').map(s => s.trim());
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '5mb' }));

// Rate limiting — prevents runaway API costs from Tenderly/OpenRouter
const debugLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many debug requests. Please wait a minute.' },
});

const qaLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many QA requests. Please wait a minute.' },
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth check — mini-app calls this to verify Telegram auth
app.get('/api/auth/check', requireTelegramAuth, (req, res) => {
  res.json({ ok: true, user: req.telegramUser });
});

// Usage stats (protected — only accessible with valid Telegram auth)
app.get('/api/usage', requireTelegramAuth, (_req, res) => {
  res.json(getUsageStats());
});

// Routes — debug and QA require Telegram auth, rango uses optional
app.use('/api/debug', debugLimiter, requireTelegramAuth, debugRouter);
app.use('/api/qa', qaLimiter, requireTelegramAuth, qaRouter);
app.use('/api/rango', debugLimiter, optionalTelegramAuth, rangoRouter);

// Global error handler (must be last)
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[server] Explorai running on http://localhost:${config.port}`);
});
