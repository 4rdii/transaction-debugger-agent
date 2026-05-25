import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireTelegramAuth } from '../middleware/telegram-auth.middleware.js';
import {
  getUsageStatus,
  getPaymentInfo,
  verifyTonPayment,
  verifyTonConnectPayment,
  createStarsInvoice,
  activateStarsPro,
} from '../services/subscription.service.js';

export const subscriptionRouter = Router();

/** GET /api/subscription/status */
subscriptionRouter.get('/status', requireTelegramAuth, (req: Request, res: Response) => {
  res.json(getUsageStatus(req.telegramUser!.id));
});

/** GET /api/subscription/payment-info */
subscriptionRouter.get('/payment-info', requireTelegramAuth, (req: Request, res: Response) => {
  res.json(getPaymentInfo(req.telegramUser!.id));
});

/**
 * POST /api/subscription/verify-payment
 * Body: { txHash: string }
 * Original manual-hash verification (fallback / power users).
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

/**
 * POST /api/subscription/verify-ton-connect
 * Body: { senderAddress: string }
 * Called after a TON Connect sendTransaction — polls TonAPI to confirm the TX.
 */
subscriptionRouter.post('/verify-ton-connect', requireTelegramAuth, async (req: Request, res: Response) => {
  const { senderAddress } = req.body as { senderAddress?: string };
  if (!senderAddress || typeof senderAddress !== 'string' || senderAddress.trim().length < 10) {
    res.status(400).json({ success: false, error: 'Missing or invalid senderAddress.' });
    return;
  }
  const userId = req.telegramUser!.id;
  const result = await verifyTonConnectPayment(senderAddress.trim(), userId);
  if (result.success) {
    res.json({ success: true, status: getUsageStatus(userId) });
  } else {
    res.status(400).json({ success: false, error: result.error });
  }
});

/**
 * POST /api/subscription/create-stars-invoice
 * Creates a Telegram Stars invoice link. Returns { invoiceUrl, payload }.
 */
subscriptionRouter.post('/create-stars-invoice', requireTelegramAuth, async (req: Request, res: Response) => {
  const userId = req.telegramUser!.id;
  const invoice = await createStarsInvoice(userId);
  if (!invoice) {
    res.status(503).json({ error: 'Stars payments are not configured.' });
    return;
  }
  res.json(invoice);
});

/**
 * POST /api/subscription/activate-stars
 * Body: { payload: string }
 * Called after Telegram WebApp.openInvoice reports 'paid'.
 */
subscriptionRouter.post('/activate-stars', requireTelegramAuth, (req: Request, res: Response) => {
  const { payload } = req.body as { payload?: string };
  if (!payload || typeof payload !== 'string') {
    res.status(400).json({ success: false, error: 'Missing payload.' });
    return;
  }
  const userId = req.telegramUser!.id;
  const result = activateStarsPro(userId, payload);
  if (result.success) {
    res.json({ success: true, status: getUsageStatus(userId) });
  } else {
    res.status(400).json({ success: false, error: result.error });
  }
});
