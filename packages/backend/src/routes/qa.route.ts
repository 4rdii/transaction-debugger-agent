import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { validate, QARequestSchema } from '../middleware/validate.middleware.js';
import { answerQuestion } from '../services/llm.service.js';
import { trackQuestion } from '../services/usage.service.js';
import type { AnalysisResult } from '@debugger/shared';

export const qaRouter = Router();

qaRouter.post(
  '/',
  validate(QARequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    const { question, context } = req.body as { question: string; context?: AnalysisResult | null };

    if (req.telegramUser) {
      trackQuestion(req.telegramUser.id, req.telegramUser.firstName, req.telegramUser.username);
    }

    try {
      const answer = await answerQuestion(context ?? null, question);
      res.json({ answer });
    } catch (err) {
      next(err);
    }
  }
);
