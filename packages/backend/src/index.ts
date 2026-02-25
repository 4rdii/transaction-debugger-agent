import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { debugRouter } from './routes/debug.route.js';
import { qaRouter } from './routes/qa.route.js';
import { errorHandler } from './middleware/error.middleware.js';

const app = express();

const corsOrigin = process.env['CORS_ORIGIN'] ?? 'http://localhost:5173';
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin }));
app.use(express.json({ limit: '5mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/debug', debugRouter);
app.use('/api/qa', qaRouter);

// Global error handler (must be last)
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[server] AI Transaction Debugger running on http://localhost:${config.port}`);
});
