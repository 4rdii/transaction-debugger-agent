import type { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

export const DebugRequestSchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid transaction hash (must be 0x + 64 hex chars)'),
  networkId: z.string().regex(/^\d+$/, 'networkId must be a numeric string'),
});

export const QARequestSchema = z.object({
  question: z.string().min(3).max(500),
  context: z.object({}).passthrough(), // full AnalysisResult, validated loosely
});
