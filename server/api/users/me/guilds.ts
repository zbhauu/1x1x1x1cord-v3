import { Router } from 'express';

import dispatcher from '../../../helpers/dispatcher.ts';
import errors from '../../../helpers/errors.ts';
import globalUtils from '../../../helpers/globalutils.ts';
import { logText } from '../../../helpers/logger.ts';
import { guildMiddleware, rateLimitMiddleware } from '../../../helpers/middlewares.ts';
import type { Request, Response } from "express";
import { prisma } from '../../../prisma.ts';
import { cacheForMiddleware } from '../../../helpers/middlewares.ts';
import ctx from '../../../context.ts';
import lazyRequest from '../../../helpers/lazyRequest.ts';

const router = Router();

router.delete(
  '/:guildid',
  guildMiddleware,
  rateLimitMiddleware("leaveGuild"),
  async (req: Request, res: Response) => {
    try {
      try {
        const user = req.account;
        const guild = req.guild;

        if (guild.owner_id == user.id) {
          await dispatcher.dispatchEventInGuild(guild.id, 'GUILD_DELETE', {
            id: req.params.guildid,
          });

          await prisma.guild.delete({
            where: {
              id: guild.id
            }
          });

          return res.status(204).send();
        } else {
          await prisma.member.deleteMany({
            where: {
              user_id: user.id,
              guild_id: guild.id
            }
          }); //??

          await dispatcher.dispatchEventTo(user.id, 'GUILD_DELETE', {
            id: req.params.guildid,
          });

          await dispatcher.dispatchEventInGuild(guild.id, 'GUILD_MEMBER_REMOVE', {
            type: 'leave',
            user: globalUtils.miniUserObject(user),
            guild_id: String(req.params.guildid),
          });

          await lazyRequest.syncMemberList(req.guild.id, user.id);

          return res.status(204).send();
        }
      } catch (error) {
        logText(error, 'error');

        return res.status(500).json(errors.response_500.INTERNAL_SERVER_ERROR);
      }
    } catch (error) {
      logText(error, 'error');

      return res.status(500).json({
        code: 500,
        message: 'Internal Server Error',
      });
    }
  },
);

router.patch(
  '/:guildid/settings',
  guildMiddleware,
  rateLimitMiddleware(
    "updateUsersGuildSettings"
  ),
  async (req: Request, res: Response) => {
    try {
      const user = req.account;
      const guild = req.guild;

      const userData = await prisma.user.findUnique({
        where: { id: user.id },
        select: { guild_settings: true }
      });

      let allSettings = (userData?.guild_settings as any[]) || [];
      let guildSettings = allSettings.find((x: any) => x.guild_id === guild.id);

      if (!guildSettings) {
        guildSettings = {
          guild_id: guild.id,
          muted: false,
          message_notifications: 2,
          suppress_everyone: false,
          mobile_push: false,
          channel_overrides: [],
        };
        allSettings.push(guildSettings);
      }

      const fields = ['muted', 'suppress_everyone', 'message_notifications', 'mobile_push'];

      fields.forEach(field => {
        if (req.body[field] !== undefined) {
          guildSettings[field] = req.body[field];
        }
      });

      if (req.body.channel_overrides) {
        if (!Array.isArray(guildSettings.channel_overrides)) {
          guildSettings.channel_overrides = [];
        }

        for (const [id, override] of Object.entries(req.body.channel_overrides) as [string, any][]) {
          let channelObj = guildSettings.channel_overrides.find((x: any) => x.channel_id === id);

          if (!channelObj) {
            channelObj = { channel_id: id };
            guildSettings.channel_overrides.push(channelObj);
          }

          if (override.muted !== undefined) channelObj.muted = override.muted;
          if (override.message_notifications !== undefined)
            channelObj.message_notifications = override.message_notifications;
        }
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          guild_settings: allSettings
        }
      });

      await dispatcher.dispatchEventTo(user.id, 'USER_GUILD_SETTINGS_UPDATE', guildSettings);

      return res.status(204).send();
    } catch (error) {
      logText(error, 'error');

      return res.status(500).json(errors.response_500.INTERNAL_SERVER_ERROR);
    }
  },
);

router.get('/premium/subscriptions', cacheForMiddleware(60 * 5, "private", false), async (req: Request, res: Response) => {
  if (ctx.config!.instance.flags.includes("INFINITE_BOOSTS")) {
    return res.status(200).json([]);
  }

  const account = req.account;
  const subscriptions = await prisma.guildSubscription.findMany({
      where: { user_id: account.id },
      select: {
        guild_id: true,
        user_id: true,
        subscription_id: true,
        ended: true,
      }
  });

  return res.status(200).json(subscriptions.map(sub => ({
      guild_id: sub.guild_id,
      user_id: sub.user_id,
      id: sub.subscription_id,
      ended: sub.ended,
    })));
});

router.get('/premium/subscriptions/cooldown', async (_req: Request, res: Response) => {
  return res.status(200).json({
    ends_at: null,
  });
});

export default router;