import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { debugRouter } from './routes/debug.route.js';
import { qaRouter } from './routes/qa.route.js';
import { rangoRouter } from './routes/rango.route.js';
import { errorHandler } from './middleware/error.middleware.js';

const app = express();

const corsOrigin = process.env['CORS_ORIGIN'] ?? 'http://localhost:5173';
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin }));
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

// Routes
app.use('/api/debug', debugLimiter, debugRouter);
app.use('/api/qa', qaLimiter, qaRouter);
app.use('/api/rango', debugLimiter, rangoRouter);

// Global error handler (must be last)
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[server] AI Transaction Debugger running on http://localhost:${config.port}`);
});
