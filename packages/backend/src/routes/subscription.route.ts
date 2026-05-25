import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireTelegramAuth } from '../middleware/telegram-auth.middleware.js';
import {
  getUsageStatus,
  getPaymentInfo,
  verifyTonPayment,
} from '../services/subscription.service.js';

export const subscriptionRouter = Router();

/** GET /api/subscription/status — returns current plan and daily usage */
subscriptionRouter.get('/status', requireTelegramAuth, (req: Request, res: Response) => {
  const userId = req.telegramUser!.id;
  res.json(getUsageStatus(userId));
});

/** GET /api/subscription/payment-info — returns TON wallet + amount + memo for this user */
subscriptionRouter.get('/payment-info', requireTelegramAuth, (req: Request, res: Response) => {
  const userId = req.telegramUser!.id;
  res.json(getPaymentInfo(userId));
});

/**
 * POST /api/subscription/verify-payment
 * Body: { txHash: string }
 * Verifies a TON payment transaction and activates Pro if valid.
 */
subscriptionRouter.post('/verify-payment', requireTelegramAuth, async (req: Request, res: Response) => {
  const { txHash } = req.body as { txHash?: string };

  if (!txHash || typeof txHash !== 'string' || txHash.trim().length < 20) {
    res.status(400).json({ success: false, error: 'Missing or invalid txHash.' });
    return;
  }

  const userId = req.telegramUser!.id;
  const result = await verifyTonPayment(txHash.trim(), userId);

  if (result.success) {
    res.json({ success: true, status: getUsageStatus(userId) });
  } else {
    res.status(400).json({ success: false, error: result.error });
  }
});
