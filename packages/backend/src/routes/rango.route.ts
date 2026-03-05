import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware.js';
import { resolveRangoSwap } from '../services/rango.service.js';

export const rangoRouter = Router();

const RangoResolveSchema = z.object({
  swapId: z.string().uuid(),
});

rangoRouter.post(
  '/resolve',
  validate(RangoResolveSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    const { swapId } = req.body as { swapId: string };

    try {
      const overview = await resolveRangoSwap(swapId);
      res.json({ overview });
    } catch (err) {
      next(err);
    }
  },
);
