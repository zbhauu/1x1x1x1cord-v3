import type { Request, Response } from 'express';
import { Router } from 'express';

import { getRegions } from '../helpers/globalutils.js';
import { cacheForMiddleware } from '../helpers/middlewares.ts';
const router = Router({ mergeParams: true });

router.get(
  '/regions',
  cacheForMiddleware(60 * 60 * 5, 'private', false),
  (_req: Request, res: Response) => {
    return res.status(200).json(getRegions());
  },
);

router.get('/ice', (_req: Request, res: Response) => {
  return res.status(200).json({
    servers: [
      {
        url: 'stun:stun.l.google.com:19302',
        username: '',
        credential: '',
      },
    ],
  });
});

export default router;
