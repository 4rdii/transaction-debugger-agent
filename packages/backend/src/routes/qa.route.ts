import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { validate, QARequestSchema } from '../middleware/validate.middleware.js';
import { answerQuestion } from '../services/llm.service.js';
import type { AnalysisResult } from '@debugger/shared';

export const qaRouter = Router();

qaRouter.post(
  '/',
  validate(QARequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    const { question, context } = req.body as { question: string; context: AnalysisResult };

    try {
      const answer = await answerQuestion(context, question);
      res.json({ answer });
    } catch (err) {
      next(err);
    }
  }
);
