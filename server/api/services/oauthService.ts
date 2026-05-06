import { prisma } from '../../prisma.ts';
import globalUtils, { generateString, generateToken } from '../../helpers/globalutils.ts';
import errors from '../../helpers/errors.ts';
import { genSalt, hash } from 'bcrypt';
import { generate } from '../../helpers/snowflake.ts';
import { GuildService } from './guildService.ts';
import { logText } from '../../helpers/logger.ts';
import type { User } from '../../types/user.ts';
import permissions from '../../helpers/permissions.ts';
import { PUBLIC_USER_SELECT } from './accountService.ts';
import { AuditLogService } from './auditLogService.ts';
import { AuditLogActionType } from '../../types/auditlog.ts';

export const OAuthService = {
    async createApplication(ownerId: string, name: string) {
        return prisma.application.create({
            data: {
                id: generate(),
                owner_id: ownerId,
                name: name,
                secret: generateString(20),
                description: ''
            }
        });
    },
    
    async deleteApplication(applicationId: string) {
        await prisma.$transaction([
            prisma.bot.delete({ where: { id: applicationId } }),
            prisma.application.delete({ where: { id: applicationId } })
        ]);
    },

    formatApplication(app: any) {
        if (app.bot) {
            const { public: is_public, require_code_grant, ...botData } = app.bot;

            return {
                ...app,
                bot: botData,
                bot_public: is_public,
                bot_require_code_grant: require_code_grant
            };
        }
        return app;
    },

    async createBot(application: any) {
        const salt = await genSalt(10);
        const pwHash = await hash(generateString(30), salt);
        const discriminator = Math.floor(1000 + Math.random() * 9000).toString();
        const token = generateToken(application.id, pwHash);

        return prisma.bot.create({
            data: {
                id: application.id,
                application_id: application.id,
                username: application.name,
                discriminator,
                token
            }
        });
    },

    async getOAuthDetails(clientId: string, scope: string, account_id: string, isStaff: boolean, staffPrivilege: number) {
        const dbApplication = await prisma.application.findUnique({
            where: { id: clientId },
            include: { bot: true }
        });

        if (!dbApplication) {
            throw { status: 404, error: errors.response_404.UNKNOWN_APPLICATION };
        }

        const application: any = {
            ...dbApplication,
            redirect_uris: [],
            rpc_application_state: 0,
            rpc_origins: []
        };

        if (scope.includes('bot')) {
            const bot = dbApplication.bot;

            if (!bot) throw { status: 404, error: errors.response_404.UNKNOWN_APPLICATION };

            if (!bot.public && dbApplication.owner_id !== account_id) {
                throw { status: 404, error: errors.response_404.UNKNOWN_APPLICATION };
            }

            const { public: is_public, require_code_grant, token, ...botData } = bot;

            application.bot = botData;
            application.bot_public = is_public;
            application.bot_require_code_grant = require_code_grant;
        }

        const account = await prisma.user.findUnique({
            where: {
                id: account_id
            },
            select: PUBLIC_USER_SELECT
        });

        const guilds = await prisma.guild.findMany({
            where: {
                members: { some: { user_id: account_id } }
            },
            include: {
                members: { where: { user_id: account_id } }
            }
        });

        const authorizedGuilds = guilds.filter(guild => {
            const isOwner = guild.owner_id === account_id;
            const isStaffOverride = isStaff && staffPrivilege >= 3;
            
            return isOwner || isStaffOverride || permissions.hasGuildPermissionTo(guild.id, account_id, 'ADMINISTRATOR', null) || permissions.hasGuildPermissionTo(guild.id, account_id, 'MANAGE_GUILD', null);
        }).map(guild => ({
            id: guild.id,
            icon: guild.icon,
            name: guild.name,
            permissions: 2146958719,
            region: null,
        }));

        return {
            authorized: false,
            application,
            bot: application.bot || null,
            user: account,
            guilds: authorizedGuilds,
            redirect_uri: null
        };
    },

    async authorizeBotToGuild(clientId: string, guildId: string, userId: string): Promise<{
        status: number,
        error: {
            code: number,
            message: string
        } | null
    }> {
        const application = await prisma.application.findUnique({
            where: { id: clientId },
            include: { bot: true }
        });

        if (!application || !application.bot) {
            return {
                status: 404,
                error: errors.response_404.UNKNOWN_APPLICATION
            };
        }

        const canJoinGuild = await GuildService.canJoin(application.bot.id, guildId);

        if (!canJoinGuild.canJoin) {
            return { status: 404, error: errors.response_404.UNKNOWN_GUILD };
        }

        const guild = await prisma.guild.findUnique({
            where: { id: guildId },
            include: {
                members: { where: { OR: [{ user_id: userId }, { user_id: application.bot.id }] } },
                bans: { where: { user_id: application.bot.id } }
            }
        });

        if (!guild) {
            return { status: 404, error: errors.response_404.UNKNOWN_GUILD };
        }

        const authorizingUser = guild.members.find(m => m.user_id === userId);
        const botAlreadyThere = guild.members.find(m => m.user_id === application.bot!.id);

        if (!authorizingUser || botAlreadyThere || guild.bans.length > 0) {
            return { status: 403, error: errors.response_403.MISSING_PERMISSIONS };
        }

        const hasPermission = guild.owner_id === userId || permissions.hasGuildPermissionTo(guildId, userId, 'MANAGE_GUILD', null);

        if (!hasPermission) {
            return { status: 403, error: errors.response_403.MISSING_PERMISSIONS };
        } //redundant checks but remove later

        let result = await GuildService.addMember(application.bot.id, guild.id);

        if (result.status !== 200) {
            return {
                status: result.status,
                error: result.error
            }
        }

        await AuditLogService.insertEntry(
            guildId,
            userId,
            application.bot.id,
            AuditLogActionType.BOT_ADD,
            null,
            [],
            {}
        );

        return { status: 200, error: null };
    },

    async getApplicationById(applicationId: string) {
        try {
            const app = await prisma.application.findUnique({
                where: { id: applicationId },
                include: {
                    owner: true,
                    bot: true
                }
            });

            if (!app || !app.owner) {
                return null;
            }

            return {
                id: app.id,
                name: app.name ?? 'My Application',
                icon: app.icon,
                description: app.description ?? '',
                redirect_uris: [],
                rpc_application_state: 0,
                rpc_origins: [],
                secret: app.secret,
                owner: globalUtils.miniUserObject(app.owner as User),
            };
        } catch (error) {
            logText(error, 'error');

            return null;
        }
    },
};