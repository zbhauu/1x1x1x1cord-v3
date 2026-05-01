import { Router } from 'express';
import type { WebSocket } from "ws";
import dispatcher from '../helpers/dispatcher.ts';
import errors from '../helpers/errors.ts';
import globalUtils from '../helpers/globalutils.ts';
import { logText } from '../helpers/logger.ts';
import { cacheForMiddleware, instanceMiddleware, rateLimitMiddleware, inviteMiddleware } from '../helpers/middlewares.ts';
import type { Request, Response } from "express";
import { prisma } from '../prisma.ts';
import { MessageService } from './services/messageService.ts';
import permissions from '../helpers/permissions.ts';
import ctx from '../context.ts';
import { GuildService } from './services/guildService.ts';
import { AuditLogService } from './services/auditLogService.ts';
import { AuditLogActionType } from '../types/auditlog.ts';

const router = Router({ mergeParams: true });

//We wont cache stuff like this for everyone because if theyre banned we want the invite to be invalid only for them.
router.get('/:code', inviteMiddleware, cacheForMiddleware(60 * 30, "private", false), async (req: Request, res: Response) => {
  try {
    const invite = req.invite;

    if (!invite) {
      return res.status(404).json(errors.response_404.UNKNOWN_INVITE);
    }

    return res.status(200).json(invite);
  } catch (error) {
    logText(error, 'error');

    return res.status(500).json(errors.response_500.INTERNAL_SERVER_ERROR);
  }
});

router.delete(
  '/:code',
  inviteMiddleware,
  rateLimitMiddleware(
   "deleteInvite"
  ),
  async (req: Request, res: Response) => {
    try {
      const sender = req.account;
      const invite = req.invite;
      const guild = req.guild;
      const channel = guild.channels?.find((x) => x.id === invite.channel?.id);

      if (channel == null) {
        return res.status(404).json(errors.response_404.UNKNOWN_CHANNEL);
      }

      const hasPermission = await permissions.hasChannelPermissionTo(
        channel.id,
        guild.id,
        sender.id,
        'MANAGE_CHANNELS',
      );

      if (!hasPermission) {
        return res.status(403).json(errors.response_403.MISSING_PERMISSIONS);
      }

      const auditChanges = [
        { key: 'code', old_value: invite.code },
        { key: 'channel_id', old_value: invite.channel.id },
        { key: 'inviter_id', old_value: invite.inviter.id },
        { key: 'max_uses', old_value: invite.max_uses },
        { key: 'uses', old_value: invite.uses }
      ];

      await AuditLogService.insertEntry(
        invite.guild.id,
        req.account.id,
        invite.code, 
        AuditLogActionType.INVITE_DELETE,
        req.headers['x-audit-log-reason'] as string || null,
        auditChanges,
        {}
      );

      await prisma.invite.delete({
        where: {
          code: req.params.code as string
        }
      });

      return res.status(204).send();
    } catch (error) {
      logText(error, 'error');

      return res.status(500).json(errors.response_500.INTERNAL_SERVER_ERROR);
    }
  },
);

router.post(
  '/:code',
  instanceMiddleware('NO_INVITE_USE'),
  inviteMiddleware,
  rateLimitMiddleware(
    "useInvite"
  ),
  async (req: Request, res: Response) => {
    try {
      const sender = req.account;

      if (sender.bot) {
        return res.status(403).json(errors.response_403.BOTS_CANNOT_USE_THIS_ENDPOINT);
      }

      const invite = req.invite;

      const usersGuild = await prisma.guild.count({
        where: {
          members: {
            some: {
              user_id: sender.id
            }
          }
        }
      });

      const limits = ctx.config?.limits;

      if (!limits || !limits['guilds_per_account']) {
        throw 'Failed to get configured limits for useInvite route';
      }

      const guildsPerAccountLimit = limits['guilds_per_account'];
      
      if (usersGuild >= guildsPerAccountLimit.max) {
        return res.status(404).json({
          code: 404,
          message: `Maximum number of guilds exceeded for this instance (${guildsPerAccountLimit.max})`,
        });
      }

      let joinAttempt = true;

      if (invite.max_uses && invite.max_uses != 0 && invite.uses!! >= invite.max_uses) {
        await prisma.invite.delete({
          where: {
            code: invite.code
          }
        })

        joinAttempt = false;
      }

      const banCount = await prisma.ban.count({
        where: {
          user_id: sender.id,
          guild_id: invite.guild.id
        }
      })

      if (banCount > 0) {
        joinAttempt = false;
      }

      await prisma.member.create({
        data: {
          user_id: sender.id,
          guild_id: invite.guild.id,
          joined_at: new Date().toISOString(),
          roles: [],
          nick: null,
          deaf: false,
          mute: false
        }
      });

      invite.uses!!++;

      await prisma.invite.update({
        where: {
          code: invite.code
        },
        data: {
          uses: invite.uses
        }
      });

      if (!joinAttempt) {
        return res.status(404).json(errors.response_404.UNKNOWN_INVITE);
      }

      let guild = await GuildService.getById(invite.guild.id);

      if (!guild) {
          return res.status(500).json(errors.response_500.INTERNAL_SERVER_ERROR);
      }

      await dispatcher.dispatchEventTo(sender.id, 'GUILD_CREATE', guild);

      await dispatcher.dispatchEventInGuild(invite.guild.id, 'GUILD_MEMBER_ADD', {
        roles: [],
        user: globalUtils.miniUserObject(sender),
        guild_id: invite.guild.id,
        joined_at: new Date().toISOString(),
        deaf: false,
        mute: false,
        nick: null,
      });

      await dispatcher.dispatchEventInGuild(invite.guild.id, 'PRESENCE_UPDATE', {
        ...globalUtils.getUserPresence({
          user: globalUtils.miniUserObject(sender),
        }),
        roles: [],
        guild_id: invite.guild.id,
      });

      if (guild.system_channel_id != null) {
        const join_msg = await MessageService.createSystemMessage(
          guild.id,
          guild.system_channel_id,
          7,
          [sender],
        );

        await dispatcher.dispatchEventInChannel(
          guild.id,
          guild.system_channel_id,
          'MESSAGE_CREATE',
          function (socket: WebSocket) {
            return globalUtils.personalizeMessageObject(
              join_msg,
              guild,
              socket.client_build_date,
            );
          },
        );
      }

      delete invite.uses;
      
      return res.status(200).send(invite);
    } catch (error) {
      logText(error, 'error');

      return res.status(500).json(errors.response_500.INTERNAL_SERVER_ERROR);
    }
  },
);

export default router;