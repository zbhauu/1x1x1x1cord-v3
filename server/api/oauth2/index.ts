import { Router } from 'express';
import type { Request, Response } from "express";
import errors from '../../helpers/errors.js';
import { logText } from '../../helpers/logger.ts';
import applications from './applications.js';
import tokens from './tokens.ts';
import { OAuthService } from '../services/oauthService.ts';

const router = Router({ mergeParams: true });

router.use('/applications', applications);
router.use('/tokens', tokens);
router.get('/authorize', async (req: Request, res: Response) => {
  try {
    const { client_id, scope } = req.query;
    const account = req.account;

    if (account.bot) {
      return res.status(403).json(errors.response_403.BOTS_CANNOT_USE_THIS_ENDPOINT);
    }

    if (!client_id) {
      return res.status(400).json({ code: 400, client_id: 'Required' });
    }

    if (!scope) {
      return res.status(400).json({ code: 400, scope: 'Required' });
    }

    const oauthDetails = await OAuthService.getOAuthDetails(
      client_id as string,
      scope as string,
      account.id,
      req.is_staff,
      req.staff_details?.privilege || 0
    );

    return res.status(200).json(oauthDetails);
  } catch (err: any) {
    if (err.status) {
      return res.status(err.status).json({ code: err.status, message: err.error });
    }
    
    logText(err, 'error');
    return res.status(500).json(errors.response_500.INTERNAL_SERVER_ERROR);
  }
});

router.post('/authorize', async (req: Request, res: Response) => {
  try {
    const { client_id } = req.query;
    const { guild_id, bot_guild_id } = req.body;
    const targetGuildId = bot_guild_id || guild_id;
    const account = req.account;

    let result = await OAuthService.authorizeBotToGuild(client_id as string, targetGuildId, account.id);

    if (result.status !== 200) {
      return res.status(result.status).json(result);
    }
    
    return res.json({ 
      location: `${req.protocol}://${req.get('host')}/oauth2/authorized` 
    });
  } catch (err: any) {
    if (err.status) {
      return res.status(err.status).json({ error: err.error });
    }
    
    logText(err, 'error');
    return res.status(500).json(errors.response_500.INTERNAL_SERVER_ERROR);
  }
});

export default router;