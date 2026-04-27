export interface SpacebarInstance {
    id: string;
    name: string;
    description: string | null;
    image: string | null;
    correspondenceEmail: string | null;
    correspondenceUserID: string | null;
    frontPage: string | null;
    tosPage: string | null;
};

export interface SpacebarInstanceConfig {
    limits_user_maxGuilds: number;
    limits_user_maxBio: number;
    limits_guild_maxEmojis: number;
    limits_guild_maxRoles: number;
    limits_message_maxCharacters: number;
    limits_message_maxAttachmentSize: number;
    limits_message_maxEmbedDownloadSize: number;
    limits_channel_maxWebhooks: number;
    register_dateOfBirth_required: boolean;
    register_password_required: boolean;
    register_disabled: boolean;
    register_requireInvite: boolean;
    register_allowNewRegistration: boolean;
    register_allowMultipleAccounts: boolean;
    guild_autoJoin_canLeave: boolean;
    guild_autoJoin_guilds_x: string[];
    register_email_required: boolean;
    can_recover_account: boolean;
};

export interface SpacebarInstanceDomains {
    cdn: string;
    gateway: string;
    defaultApiVersion: string;
    apiEndpoint: string;
};

export interface SpacebarPingResponse {
    ping: string;
    instance: SpacebarInstance;
};