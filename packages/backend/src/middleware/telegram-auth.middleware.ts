import { createHmac } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const BOT_TOKEN = process.env['BOT_TOKEN'] ?? '';

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  isPremium?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      telegramUser?: TelegramUser;
    }
  }
}

interface ParsedInitData {
  hash: string;
  user?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
  };
  auth_date: number;
  query_id?: string;
}

function parseInitData(raw: string): ParsedInitData | null {
  try {
    const params = new URLSearchParams(raw);
    const hash = params.get('hash');
    const authDate = params.get('auth_date');
    if (!hash || !authDate) return null;

    const userStr = params.get('user');
    const user = userStr ? JSON.parse(userStr) : undefined;

    return {
      hash,
      user,
      auth_date: parseInt(authDate, 10),
      query_id: params.get('query_id') ?? undefined,
    };
  } catch {
    return null;
  }
}

function validateInitData(raw: string, botToken: string, maxAgeSeconds = 86400): boolean {
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  if (!hash) return false;

  // Build data-check-string: sorted key=value pairs (excluding hash), joined by \n
  params.delete('hash');
  const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  // secret_key = HMAC-SHA256("WebAppData", bot_token)
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();

  // computed_hash = HMAC-SHA256(secret_key, data_check_string)
  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return false;

  // Check expiry
  const authDate = parseInt(params.get('auth_date') ?? '0', 10);
  if (Date.now() / 1000 - authDate > maxAgeSeconds) return false;

  return true;
}

function extractUser(raw: string): TelegramUser | undefined {
  const parsed = parseInitData(raw);
  if (!parsed?.user) return undefined;
  return {
    id: parsed.user.id,
    firstName: parsed.user.first_name,
    lastName: parsed.user.last_name,
    username: parsed.user.username,
    languageCode: parsed.user.language_code,
    isPremium: parsed.user.is_premium,
  };
}

/**
 * Middleware that validates Telegram Mini App initData.
 * Attaches `req.telegramUser` on success.
 * Returns 401 if initData is missing or invalid.
 */
export function requireTelegramAuth(req: Request, res: Response, next: NextFunction) {
  const initData = req.headers['x-telegram-init-data'] as string | undefined;

  if (!initData) {
    res.status(401).json({ error: 'Missing Telegram authentication' });
    return;
  }

  if (!BOT_TOKEN) {
    // Dev mode — skip HMAC validation, just parse user
    req.telegramUser = extractUser(initData);
    next();
    return;
  }

  if (!validateInitData(initData, BOT_TOKEN)) {
    res.status(401).json({ error: 'Invalid or expired Telegram authentication' });
    return;
  }

  req.telegramUser = extractUser(initData);
  next();
}

/**
 * Optional auth — attaches user if present but doesn't block requests.
 */
export function optionalTelegramAuth(req: Request, res: Response, next: NextFunction) {
  const initData = req.headers['x-telegram-init-data'] as string | undefined;
  if (!initData) {
    next();
    return;
  }

  if (BOT_TOKEN && !validateInitData(initData, BOT_TOKEN)) {
    next();
    return;
  }

  req.telegramUser = extractUser(initData);
  next();
}
