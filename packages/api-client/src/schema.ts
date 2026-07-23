export interface paths {
    "/v1/auth/finish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        bt: string;
                    };
                };
            };
            responses: {
                /** @description Session cookie set */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/_dev/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Dev users available for impersonation */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DevUser"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/_dev/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        userId: string;
                    };
                };
            };
            responses: {
                /** @description Cookie set */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Cookie cleared */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/share/{token}/project": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    token: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Client view: campaign + shortlist */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ClientProject"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/share/{token}/placements/{placementId}/decision": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    token: string;
                    placementId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ShareDecision"];
                };
            };
            responses: {
                /** @description Decision saved */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/share/{token}/finalize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    token: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Media plan finalized */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/share/{token}/placements/{placementId}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                };
                header?: never;
                path: {
                    token: string;
                    placementId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Cached channel posts (only_local, no network) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            messages: components["schemas"]["ClientChannelPost"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/share/{token}/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    token: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Client report: published posts + collected metrics */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: components["schemas"]["ClientReportItem"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/share/conv/{token}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    before?: string;
                };
                header?: never;
                path: {
                    token: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Read-only история переписки, newest first */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ConversationMessages"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Current user */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Me"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description All workspaces */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Workspace"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateWorkspace"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Workspace"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["UpdateWorkspace"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Workspace"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Workspace members */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string | null;
                            username: string | null;
                            /** @enum {string} */
                            role: "admin" | "member";
                        }[];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/rkn": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    q?: string;
                    network?: string;
                    page?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description RKN registry page */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RknList"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform-active": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    q?: string;
                    platform?: string;
                    source?: string;
                    cpv?: string;
                    page?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Platform-active channels page */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PlatformActiveList"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invites/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    code: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Invite preview */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PublicInvite"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invites/{code}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    code: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Accepted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            workspaceId: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    q?: string;
                };
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Channels with admins (limit 1000, see CHANNELS_PAGE_LIMIT) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Channel"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["CreateChannel"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Channel"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Channel by id */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Channel"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Channel is used by placements */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        username?: string | null;
                        properties?: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            responses: {
                /** @description Channel updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Channel"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/admins": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        contactIds?: string[];
                        usernames?: string[];
                    };
                };
            };
            responses: {
                /** @description Admins added */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Channel"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/admins/{contactId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                    contactId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Admin removed */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/set-admin": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        contactId?: string;
                        username?: string;
                        maxLink?: string;
                        dm?: boolean;
                        group?: {
                            chatId: string;
                            accountId: string;
                        };
                        external?: {
                            label: string;
                            link?: string;
                        };
                    };
                };
            };
            responses: {
                /** @description Admin/contact-method set */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Channel"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/account-groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    q?: string;
                };
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Groups the workspace accounts are members of */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["AccountGroup"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/sync": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: {
                    force?: boolean | null;
                };
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Channel synced from TG */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Channel"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/max-subscribe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Joined MAX channel (subscribed or pending approval) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Channel"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/subscribe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        accountId: string;
                    };
                };
            };
            responses: {
                /** @description Subscribed (or pending approval) */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/unsubscribe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        accountId: string;
                    };
                };
            };
            responses: {
                /** @description Unsubscribed */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/relation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        status: "none" | "pending" | "working" | "paused" | "unsuitable" | "declined";
                        note: string | null;
                    };
                };
            };
            responses: {
                /** @description Relation status recorded */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Channel"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    fromMessageId?: string;
                    limit?: number;
                };
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Last N messages of the channel (plain-text) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            messages: {
                                id: string;
                                /** Format: date-time */
                                date: string;
                                text: string;
                                entities: {
                                    offset: number;
                                    length: number;
                                    /** @enum {string} */
                                    kind: "bold" | "italic" | "underline" | "strikethrough" | "code" | "pre" | "preCode" | "blockquote" | "url" | "textUrl" | "email" | "phone" | "mention" | "hashtag" | "cashtag";
                                    url?: string;
                                    language?: string;
                                }[];
                                mediaThumb: {
                                    /** @enum {string} */
                                    kind: "photo" | "video" | "animation";
                                    b64: string;
                                    width: number;
                                    height: number;
                                } | null;
                                media: {
                                    /** @enum {string} */
                                    kind: "photo" | "video";
                                    width: number;
                                    height: number;
                                } | null;
                                mediaUrl: string | null;
                                views: number | null;
                                forwards: number | null;
                                replies: number | null;
                                reactions: {
                                    emoji: string;
                                    count: number;
                                }[];
                                isForwarded: boolean;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/placement-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    excludeId?: string;
                    limit?: number;
                };
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Past placements of this channel across campaigns */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                placementId: string;
                                projectId: string;
                                campaignName: string;
                                /** Format: date-time */
                                date: string;
                                priceAmount: number | null;
                                surchargePercent: number | null;
                                bloggerVat: boolean;
                                format: string | null;
                                /** @enum {string|null} */
                                declineBy: "blogger" | "us" | null;
                                declineNote: string | null;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                };
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Channel posts feed (network read, errors → empty) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            messages: {
                                id: string;
                                /** Format: date-time */
                                date: string;
                                text: string;
                                entities: {
                                    offset: number;
                                    length: number;
                                    /** @enum {string} */
                                    kind: "bold" | "italic" | "underline" | "strikethrough" | "code" | "pre" | "preCode" | "blockquote" | "url" | "textUrl" | "email" | "phone" | "mention" | "hashtag" | "cashtag";
                                    url?: string;
                                    language?: string;
                                }[];
                                mediaThumb: {
                                    /** @enum {string} */
                                    kind: "photo" | "video" | "animation";
                                    b64: string;
                                    width: number;
                                    height: number;
                                } | null;
                                media: {
                                    /** @enum {string} */
                                    kind: "photo" | "video";
                                    width: number;
                                    height: number;
                                } | null;
                                mediaUrl: string | null;
                                views: number | null;
                                forwards: number | null;
                                replies: number | null;
                                reactions: {
                                    emoji: string;
                                    count: number;
                                }[];
                                isForwarded: boolean;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/method-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    fromMessageId?: number | null;
                    target?: "group" | "dm";
                };
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Group history with per-message sender */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            messages: {
                                id: string;
                                /** Format: date-time */
                                date: string;
                                text: string;
                                isOutgoing: boolean;
                                senderName: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/{id}/method-send": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        text: string;
                        /** @enum {string} */
                        target?: "group" | "dm";
                    };
                };
            };
            responses: {
                /** @description Sent to group */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/channels/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["ImportChannels"];
                };
            };
            responses: {
                /** @description Import result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ImportChannelsResult"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    q?: string;
                    filters?: string;
                };
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Contacts (опционально отфильтрованные) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contact"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Contact */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contact"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["UpdateContact"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contact"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/sticky": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        accountId: string;
                    };
                };
            };
            responses: {
                /** @description Sticky updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contact"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/max-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description MAX dialog history */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            peer: {
                                name: string;
                                avatarUrl: string | null;
                            };
                            messages: components["schemas"]["MaxDialogMessage"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/max-send": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        text: string;
                    };
                };
            };
            responses: {
                /** @description MAX DM sent */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "sent";
                            messageId: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/note": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        note: string | null;
                    };
                };
            };
            responses: {
                /** @description Note saved */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Contact"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/chat-history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    accountId: string;
                    limit?: number;
                    before?: string;
                };
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Last N messages, newest first */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            messages: {
                                id: string;
                                /** Format: date-time */
                                date: string;
                                isOutgoing: boolean;
                                text: string;
                                entities: {
                                    offset: number;
                                    length: number;
                                    /** @enum {string} */
                                    kind: "bold" | "italic" | "underline" | "strikethrough" | "code" | "pre" | "preCode" | "blockquote" | "url" | "textUrl" | "email" | "phone" | "mention" | "hashtag" | "cashtag";
                                    url?: string;
                                    language?: string;
                                }[];
                                mediaThumb: {
                                    /** @enum {string} */
                                    kind: "photo" | "video" | "animation";
                                    b64: string;
                                    width: number;
                                    height: number;
                                } | null;
                                media: {
                                    /** @enum {string} */
                                    kind: "photo" | "video";
                                    width: number;
                                    height: number;
                                } | null;
                                document: {
                                    fileId: number;
                                    fileName: string;
                                    mimeType: string;
                                    size: number;
                                } | null;
                                sticker: {
                                    thumbFileId: number;
                                    emoji: string;
                                } | null;
                                isPlainText: boolean;
                                reactions: {
                                    emoji: string;
                                    count: number;
                                }[];
                                replyMarkup: {
                                    /** @enum {string} */
                                    kind: "inline" | "keyboard";
                                    rows: {
                                        text: string;
                                        /** @enum {string} */
                                        action: "url" | "send_text" | "unsupported";
                                        url?: string;
                                    }[][];
                                } | null;
                                replyToId: string | null;
                                replyQuote: string | null;
                                albumId: string | null;
                            }[];
                            lastReadOutboxId: string | null;
                            peerStatus: {
                                isOnline: boolean;
                                /** Format: date-time */
                                lastSeenAt: string | null;
                            } | null;
                            peerIsBot: boolean;
                            chatId: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/chat/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        accountId: string;
                    };
                };
            };
            responses: {
                /** @description Closed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/chat/mark-unread": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        accountId: string;
                        value: boolean;
                    };
                };
            };
            responses: {
                /** @description Toggled */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            markedUnread: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/chat/mark-read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        accountId: string;
                    };
                };
            };
            responses: {
                /** @description Read */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/chat/delete-messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        accountId: string;
                        messageIds: string[];
                    };
                };
            };
            responses: {
                /** @description Deleted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/chat/edit-message": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        accountId: string;
                        messageId: string;
                        text: string;
                    };
                };
            };
            responses: {
                /** @description Edited */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/bot-start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        accountId: string;
                    };
                };
            };
            responses: {
                /** @description Bot started */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/share": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        accountId: string;
                    };
                };
            };
            responses: {
                /** @description Активная ссылка на переписку (создана или существующая) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ConversationShare"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{id}/share/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        accountId: string;
                    };
                };
            };
            responses: {
                /** @description Ссылка отозвана (или её не было) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            ok: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/properties": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Properties of the workspace */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Property"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateProperty"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Property"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/properties/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["UpdateProperty"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Property"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{contactId}/activities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    contactId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Activities timeline */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Activity"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    contactId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateActivity"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Activity"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/contacts/{contactId}/activities/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    contactId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    contactId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["UpdateActivity"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Activity"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/accounts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Outreach accounts */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OutreachAccountListItem"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/accounts/{accountId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    accountId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Account */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OutreachAccount"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    accountId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    accountId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["PatchOutreachAccount"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OutreachAccount"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/cooldown": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    accountId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["SetAccountCooldown"];
                };
            };
            responses: {
                /** @description Cooldown set or cleared */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OutreachAccount"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    accountId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Account daily activity */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OutreachAccountActivityDay"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/accounts/auth/send-code": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        phoneNumber: string;
                        /**
                         * @default telegram
                         * @enum {string}
                         */
                        platform?: "telegram" | "max";
                    };
                };
            };
            responses: {
                /** @description Code sent */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            isCodeViaApp: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/accounts/auth/sign-in": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        phoneCode: string;
                        /**
                         * @default telegram
                         * @enum {string}
                         */
                        platform?: "telegram" | "max";
                    };
                };
            };
            responses: {
                /** @description Sign-in result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "sign_in_complete";
                            accountId: string;
                        } | {
                            /** @enum {string} */
                            status: "password_needed";
                        } | {
                            /** @enum {string} */
                            status: "phone_code_invalid";
                        } | {
                            /** @enum {string} */
                            status: "user_not_found";
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/accounts/auth/sign-in-password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        password: string;
                        /**
                         * @default telegram
                         * @enum {string}
                         */
                        platform?: "telegram" | "max";
                    };
                };
            };
            responses: {
                /** @description Password check result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "sign_in_complete";
                            accountId: string;
                        } | {
                            /** @enum {string} */
                            status: "password_invalid";
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/import-contacts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    accountId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Imported peers from account's DM list into contacts */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ImportContactsResp"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/transfer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    accountId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["TransferOutreachAccount"];
                };
            };
            responses: {
                /** @description Owner transferred */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OutreachAccount"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/delegations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    accountId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: components["schemas"]["OutreachAccountDelegation"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    accountId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateOutreachAccountDelegation"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OutreachAccountDelegation"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/delegations/{delegateId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query: {
                    startsAt: string;
                };
                header?: never;
                path: {
                    wsId: string;
                    accountId: string;
                    delegateId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Cancelled or deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Delegation not found or already ended */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/delegations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    delegateId?: string;
                    active?: "true" | "false";
                };
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: components["schemas"]["OutreachAccountDelegation"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Projects */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateProject"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Project */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["UpdateProject"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/readiness": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Чек-лист готовности к запуску (draft) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            leadsTotal: number;
                            leadsEligible: number;
                            leadsNoContact: number;
                            leadsNoRkn: number;
                            leadsManual: number;
                            accountsCount: number;
                            chainReady: boolean;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/activate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Activated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Paused */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Resumed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Completed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Archived */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/unfinalize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Media plan reopened for client editing */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Project"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/leads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    offset?: number | null;
                };
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Leads with progress */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            total: number;
                            repliedCount: number;
                            leads: components["schemas"]["OutreachLeadProgress"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    itemId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    itemId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["MoveProjectItem"];
                };
            };
            responses: {
                /** @description Moved */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/skip": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    itemId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Skipped */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/unskip": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    itemId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Unskipped */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/dunning": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    itemId: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": components["schemas"]["ToggleDunning"];
                };
            };
            responses: {
                /** @description Toggled */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/analytics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    period?: number;
                    grouping?: "day" | "week" | "month";
                    viewMode?: "eventDate" | "sendDate";
                };
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Project analytics aggregates + timeseries */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            totalSent: number;
                            totalRead: number;
                            totalReplied: number;
                            totalLeads: number;
                            /** @enum {string} */
                            grouping: "day" | "week" | "month";
                            /** @enum {string} */
                            viewMode: "eventDate" | "sendDate";
                            series: components["schemas"]["OutreachAnalyticsPoint"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/sample-lead": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Random lead from project (or null if empty) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OutreachSampleLead"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/placements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    stage?: "longlist" | "shortlist" | "all";
                };
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Placements (медиаплан) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Placement"][];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/placements/bulk": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["BulkPlacements"];
                };
            };
            responses: {
                /** @description Bulk add result */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            added: number;
                            channelsCreated: number;
                            skippedInvalid: number;
                            skippedDuplicate: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    placementId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    placementId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["UpdatePlacement"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Placement"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/final-offer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        text: string;
                    };
                };
            };
            responses: {
                /** @description Queued for worker */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            scheduled: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/collect-metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Queued for metrics-worker */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            queued: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/step-message/{kind}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    placementId: string;
                    kind: "contract" | "creative" | "act";
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Помеченное сообщение чата (рендер на лету, альбом учтён) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            messages: components["schemas"]["TaggedMessage"][];
                            media: {
                                idx: number;
                                /** @enum {string} */
                                kind: "photo" | "video";
                                width: number;
                                height: number;
                            }[];
                            /** Format: date-time */
                            editDate: string | null;
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    placementId: string;
                    kind: "contract" | "creative" | "act";
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        chatId: string;
                        messageId: string;
                        albumId: string | null;
                        accountId: string;
                    };
                };
            };
            responses: {
                /** @description Tagged */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    placementId: string;
                    kind: "contract" | "creative" | "act";
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Untagged */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/capture-post": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    placementId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CapturePost"];
                };
            };
            responses: {
                /** @description Снимок поста снят и сохранён */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            snapshot: {
                                /** @enum {string} */
                                platform?: "telegram" | "youtube" | "tiktok" | "dzen";
                                messageId?: string;
                                chatId?: string;
                                text: string;
                                entities: {
                                    offset: number;
                                    length: number;
                                    /** @enum {string} */
                                    kind: "bold" | "italic" | "underline" | "strikethrough" | "code" | "pre" | "preCode" | "blockquote" | "url" | "textUrl" | "email" | "phone" | "mention" | "hashtag" | "cashtag";
                                    url?: string;
                                    language?: string;
                                }[];
                                thumbB64: string | null;
                                thumbW: number | null;
                                thumbH: number | null;
                                coverUrl?: string | null;
                                url?: string | null;
                                media: {
                                    /** @enum {string} */
                                    kind: "photo" | "video";
                                    width: number;
                                    height: number;
                                } | null;
                                views: number | null;
                                forwards: number | null;
                                reactions: {
                                    emoji: string;
                                    count: number;
                                }[];
                                /** Format: date-time */
                                capturedAt: string;
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/creative-doc/collect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    placementId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Креатив залит в Google-док */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            url: string;
                            round: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/creative-doc/freeze": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    placementId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Результат диффа */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            changed: boolean;
                            finalText: string;
                            contactId: string | null;
                            accountId: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/shares": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Active shares */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProjectShare"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateProjectShare"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ProjectShare"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/shares/{shareId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                    shareId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Revoked */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/quick-send/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["QuickSendPreviewQuery"];
                };
            };
            responses: {
                /** @description Active projects for peer */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["QuickSendPreview"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/quick-send": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["QuickSendBody"];
                };
            };
            responses: {
                /** @description Sent */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["QuickSendResult"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/sticker-sets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    accountId: string;
                };
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Installed sticker/emoji sets of the account */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            sets: components["schemas"]["StickerSetInfo"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/sticker-sets/{setId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    accountId: string;
                };
                header?: never;
                path: {
                    wsId: string;
                    setId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Stickers of the set */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            stickers: components["schemas"]["PickerSticker"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/sticker-search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    accountId: string;
                    kind: "sticker" | "emoji";
                    q: string;
                };
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Stickers matching the query */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            stickers: components["schemas"]["PickerSticker"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/sticker-pack": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    accountId: string;
                    name: string;
                };
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Stickers of the pack resolved by name */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            setName: string;
                            title: string;
                            stickers: components["schemas"]["PickerSticker"][];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/tracks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Tracks */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Track"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateTrack"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Track"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/tracks/{trackId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    trackId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    trackId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["UpdateTrack"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["Track"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/tracks/{trackId}/legal-entity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    trackId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Legal entity or null */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LegalEntity"];
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    trackId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["LegalEntityInput"];
                };
            };
            responses: {
                /** @description Upserted */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LegalEntity"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/projects/{projectId}/advertiser": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    projectId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Advertiser legal entity or null */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["LegalEntity"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/stage-templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Stage templates */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StageTemplate"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreateStageTemplate"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StageTemplate"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/stage-templates/{templateId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    templateId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    templateId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["UpdateStageTemplate"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StageTemplate"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/schedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Schedule */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OutreachSchedule"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["OutreachSchedule"];
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["OutreachSchedule"];
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/outreach/dunning": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Dunning */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            pings: ({
                                /** @enum {string} */
                                kind: "text";
                                text: string;
                            } | {
                                /** @enum {string} */
                                kind: "sticker";
                                setName: string;
                                uniqueId: string;
                            })[];
                            intervals: {
                                /** @enum {string} */
                                period: "minutes" | "hours" | "days";
                                value: number;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        pings: ({
                            /** @enum {string} */
                            kind: "text";
                            text: string;
                        } | {
                            /** @enum {string} */
                            kind: "sticker";
                            setName: string;
                            uniqueId: string;
                        })[];
                        intervals: {
                            /** @enum {string} */
                            period: "minutes" | "hours" | "days";
                            value: number;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Updated */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            pings: ({
                                /** @enum {string} */
                                kind: "text";
                                text: string;
                            } | {
                                /** @enum {string} */
                                kind: "sticker";
                                setName: string;
                                uniqueId: string;
                            })[];
                            intervals: {
                                /** @enum {string} */
                                period: "minutes" | "hours" | "days";
                                value: number;
                            }[];
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/invites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Pending invites */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["WorkspaceInvite"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        telegramUsername: string;
                        /**
                         * @default member
                         * @enum {string}
                         */
                        role?: "admin" | "member";
                    };
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["WorkspaceInvite"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/invites/{inviteId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    inviteId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Revoked */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/workspaces/{wsId}/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    userId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Removed */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Last admin cannot leave */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    userId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        role: "admin" | "member";
                    };
                };
            };
            responses: {
                /** @description Updated */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        trace?: never;
    };
    "/v1/workspaces/{wsId}/members/{userId}/dismiss": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    wsId: string;
                    userId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["DismissMemberBody"];
                };
            };
            responses: {
                /** @description Member dismissed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DismissMemberResp"];
                    };
                };
                /** @description Bad transfers (missing/extra/invalid) */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Last admin cannot be dismissed */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        DevUser: {
            id: string;
            name: string | null;
        };
        ClientProject: {
            campaignName: string;
            clientName: string;
            agencyName: string;
            brief: string | null;
            budget: number | null;
            /** Format: date-time */
            finalizedAt: string | null;
            placements: components["schemas"]["ClientPlacement"][];
        };
        ClientPlacement: {
            id: string;
            channel: {
                title: string;
                username: string | null;
                /** @enum {string} */
                platform: "telegram" | "youtube" | "tiktok" | "dzen" | "max";
                memberCount: number | null;
                avgReach: number | null;
                err: number | null;
            } | null;
            price: number | null;
            forecastViews: number | null;
            /** @enum {string} */
            clientStatus: "pending" | "approved" | "rejected";
            clientStatusComment: string | null;
        };
        ShareDecision: {
            /** @enum {string} */
            status: "pending" | "approved" | "rejected";
            comment?: string | null;
        };
        ClientChannelPost: {
            id: string;
            /** Format: date-time */
            date: string;
            text: string;
            entities: {
                offset: number;
                length: number;
                /** @enum {string} */
                kind: "bold" | "italic" | "underline" | "strikethrough" | "code" | "pre" | "preCode" | "blockquote" | "url" | "textUrl" | "email" | "phone" | "mention" | "hashtag" | "cashtag";
                url?: string;
                language?: string;
            }[];
            mediaThumb: {
                /** @enum {string} */
                kind: "photo" | "video" | "animation";
                b64: string;
                width: number;
                height: number;
            } | null;
            views: number | null;
            forwards: number | null;
            replies: number | null;
            reactions: {
                emoji: string;
                count: number;
            }[];
            isForwarded: boolean;
        };
        ClientReportItem: {
            id: string;
            channel: {
                title: string;
                username: string | null;
                /** @enum {string} */
                platform: "telegram" | "youtube" | "tiktok" | "dzen" | "max";
            } | null;
            postUrl: string | null;
            /** Format: date-time */
            publishedAt: string | null;
            views: number | null;
            likes: number | null;
            comments: number | null;
            shares: number | null;
            price: number | null;
            preview: {
                cover: string | null;
                text: string | null;
            } | null;
        };
        ConversationMessages: {
            title: string;
            unavailable: boolean;
            messages: {
                id: string;
                /** Format: date-time */
                date: string;
                isOutgoing: boolean;
                text: string;
                entities: {
                    offset: number;
                    length: number;
                    /** @enum {string} */
                    kind: "bold" | "italic" | "underline" | "strikethrough" | "code" | "pre" | "preCode" | "blockquote" | "url" | "textUrl" | "email" | "phone" | "mention" | "hashtag" | "cashtag";
                    url?: string;
                    language?: string;
                }[];
                mediaThumb: {
                    /** @enum {string} */
                    kind: "photo" | "video" | "animation";
                    b64: string;
                    width: number;
                    height: number;
                } | null;
                media: {
                    /** @enum {string} */
                    kind: "photo" | "video";
                    width: number;
                    height: number;
                } | null;
                document: {
                    fileId: number;
                    fileName: string;
                    mimeType: string;
                    size: number;
                } | null;
                sticker: {
                    thumbFileId: number;
                    emoji: string;
                } | null;
                isPlainText: boolean;
                reactions: {
                    emoji: string;
                    count: number;
                }[];
                replyMarkup: {
                    /** @enum {string} */
                    kind: "inline" | "keyboard";
                    rows: {
                        text: string;
                        /** @enum {string} */
                        action: "url" | "send_text" | "unsupported";
                        url?: string;
                    }[][];
                } | null;
                replyToId: string | null;
                replyQuote: string | null;
                albumId: string | null;
            }[];
        };
        Me: {
            id: string;
            name: string | null;
            username: string | null;
            hasAdminRole: boolean;
        };
        Workspace: {
            id: string;
            name: string;
            /** @enum {string} */
            mode: "bd" | "agency";
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
        };
        CreateWorkspace: {
            name: string;
            /** @enum {string} */
            mode: "bd" | "agency";
        };
        UpdateWorkspace: {
            name?: string;
        };
        RknList: {
            records: components["schemas"]["RknRecord"][];
            filteredTotal: number;
            networks: {
                network: string;
                count: number;
            }[];
            /** Format: date-time */
            lastSyncAt: string | null;
            lastStatus: string | null;
            registryTotal: number;
            pageSize: number;
            syncProgress: {
                /** Format: date-time */
                startedAt: string;
                fetched: number;
                total: number;
            } | null;
        };
        RknRecord: {
            uid: string;
            network: string;
            url: string;
            title: string | null;
            status: string;
        };
        PlatformActiveList: {
            records: components["schemas"]["PlatformActiveRecord"][];
            filteredTotal: number;
            platforms: {
                platform: string;
                count: number;
            }[];
            sources: {
                source: string;
                count: number;
            }[];
            /** Format: date-time */
            lastSyncAt: string | null;
            lastStatus: string | null;
            registryTotal: number;
            pageSize: number;
        };
        PlatformActiveRecord: {
            sourceKey: string;
            source: string;
            platform: string;
            username: string | null;
            link: string | null;
            ownerLogin: string | null;
            lastPostDate: string | null;
            recentPostsCount: number;
            recentViews: number;
            botStatus: string | null;
            isActive: boolean | null;
            isCpv: boolean | null;
            moderationStatus: string | null;
        };
        PublicInvite: {
            workspaceId: string;
            workspaceName: string;
            /** @enum {string} */
            role: "admin" | "member";
            invitedByName: string | null;
            telegramUsername: string;
            expiresAt: string;
            alreadyMember: boolean;
        };
        Channel: {
            id: string;
            workspaceId: string;
            /** @enum {string} */
            platform: "telegram" | "youtube" | "tiktok" | "dzen" | "max";
            externalId: string | null;
            title: string;
            description: string | null;
            /** @enum {string} */
            relationStatus: "none" | "pending" | "working" | "paused" | "unsuitable" | "declined";
            relationHistory: {
                /** @enum {string} */
                status: "none" | "pending" | "working" | "paused" | "unsuitable" | "declined";
                note: string | null;
                byUserId: string;
                byName: string | null;
                /** Format: date-time */
                at: string;
            }[];
            username: string | null;
            link: string | null;
            memberCount: number | null;
            meta: {
                [key: string]: unknown;
            };
            properties: {
                [key: string]: unknown;
            };
            /** Format: date-time */
            syncedAt: string | null;
            /** Format: date-time */
            lastMessageAt: string | null;
            /** Format: date-time */
            unavailableSince: string | null;
            /** Format: date-time */
            unavailableLastCheckAt: string | null;
            unavailableReason: string | null;
            thumbnailB64: string | null;
            isRkn: boolean;
            admins: {
                contactId: string;
                fullName: string | null;
                telegramUsername: string | null;
                primaryAccountId: string | null;
                chatAccounts: {
                    accountId: string;
                    /** Format: date-time */
                    lastInboundAt: string | null;
                    /** Format: date-time */
                    lastOutboundAt: string | null;
                }[];
            }[];
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
        };
        CreateChannel: {
            title: string;
            link?: string | null;
            username?: string | null;
            externalId?: string | null;
            /** @enum {string} */
            platform?: "telegram" | "youtube" | "tiktok" | "dzen" | "max";
            adminContactIds?: string[];
        };
        AccountGroup: {
            chatId: string;
            title: string | null;
            accountId: string;
        };
        ImportChannelsResult: {
            channelsCreated: number;
            channelsUpdated: number;
            channelsSyncSkipped: number;
            adminContactsCreated: number;
            adminContactsRecognized: number;
            skippedNoIdentifier: number;
        };
        ImportChannels: {
            rows: {
                [key: string]: string;
            }[];
            mapping: {
                link?: string;
                title?: string;
                description?: string;
                memberCount?: string;
                adminUsername?: string;
                properties?: {
                    [key: string]: string;
                };
            };
        };
        Contact: {
            id: string;
            workspaceId: string;
            properties: {
                [key: string]: unknown;
            };
            nextStep: {
                /** Format: date-time */
                date: string;
                text: string;
                /** @enum {string} */
                repeat: "none" | "daily" | "weekly" | "monthly";
            } | null;
            unreadCount: number;
            markedUnread: boolean;
            /** Format: date-time */
            lastMessageAt: string | null;
            primaryAccountId: string | null;
            chatAccounts: {
                accountId: string;
                /** Format: date-time */
                lastInboundAt: string | null;
                /** Format: date-time */
                lastOutboundAt: string | null;
            }[];
            note: {
                text: string;
                byUserId: string;
                byName: string | null;
                /** Format: date-time */
                at: string;
            } | null;
            channels: {
                id: string;
                title: string;
                username: string | null;
                memberCount: number | null;
                /** Format: date-time */
                lastMessageAt: string | null;
                hasDm: boolean;
                /** Format: date-time */
                unavailableSince: string | null;
                isRkn: boolean;
                /** @enum {string} */
                relationStatus: "none" | "pending" | "working" | "paused" | "unsuitable" | "declined";
                relationHistory: {
                    /** @enum {string} */
                    status: "none" | "pending" | "working" | "paused" | "unsuitable" | "declined";
                    note: string | null;
                    byUserId: string;
                    byName: string | null;
                    /** Format: date-time */
                    at: string;
                }[];
            }[];
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
        };
        UpdateContact: {
            properties?: {
                [key: string]: unknown;
            };
        };
        MaxDialogMessage: {
            id: string;
            text: string;
            /** Format: date-time */
            time: string;
            outgoing: boolean;
        };
        ConversationShare: {
            token: string;
            url: string;
            /** Format: date-time */
            createdAt: string;
        };
        Property: {
            id: string;
            workspaceId: string;
            key: string;
            name: string;
            /** @enum {string} */
            type: "text" | "single_select" | "multi_select" | "user_select" | "textarea" | "url" | "email" | "tel" | "number";
            order: number;
            required: boolean;
            values: {
                id: string;
                name: string;
            }[] | null;
            /** Format: date-time */
            createdAt: string;
        };
        CreateProperty: {
            key: string;
            name: string;
            /** @enum {string} */
            type: "text" | "single_select" | "multi_select" | "user_select" | "textarea" | "url" | "email" | "tel" | "number";
            required?: boolean;
            values?: {
                id: string;
                name: string;
            }[];
        };
        UpdateProperty: {
            name?: string;
            order?: number;
            required?: boolean;
            values?: {
                id: string;
                name: string;
            }[] | null;
        };
        Activity: {
            id: string;
            workspaceId: string;
            contactId: string;
            /** @enum {string} */
            type: "note" | "reminder";
            text: string;
            /** Format: date-time */
            date: string | null;
            /** @enum {string} */
            repeat: "none" | "daily" | "weekly" | "monthly";
            /** @enum {string} */
            status: "open" | "completed";
            /** Format: date-time */
            completedAt: string | null;
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
        };
        CreateActivity: {
            /** @enum {string} */
            type: "note";
            text: string;
        } | {
            /** @enum {string} */
            type: "reminder";
            text: string;
            /** Format: date-time */
            date: string;
            /** @enum {string} */
            repeat?: "none" | "daily" | "weekly" | "monthly";
        };
        UpdateActivity: {
            text?: string;
            /** Format: date-time */
            date?: string | null;
            /** @enum {string} */
            repeat?: "none" | "daily" | "weekly" | "monthly";
            /** @enum {string} */
            status?: "open" | "completed";
        };
        OutreachAccountListItem: components["schemas"]["OutreachAccount"] & {
            coldSentToday: number;
            coldSent30d: number;
        };
        OutreachAccount: {
            id: string;
            /** @enum {string} */
            platform: "telegram" | "max";
            /** @enum {string} */
            status: "active" | "banned" | "unauthorized";
            tgUserId: string;
            tgUsername: string | null;
            phoneNumber: string | null;
            firstName: string | null;
            outreachName: string | null;
            hasPremium: boolean;
            newLeadsDailyLimit: number;
            /** Format: date-time */
            cooldownUntil: string | null;
            cooldownReason: string | null;
            ownerUserId: string;
            /** Format: date-time */
            createdAt: string;
        };
        PatchOutreachAccount: {
            newLeadsDailyLimit?: number;
            outreachName?: string | null;
        };
        SetAccountCooldown: {
            days: number;
        };
        OutreachAccountActivityDay: {
            date: string;
            coldSends: number;
            events: {
                /** @enum {string} */
                type: "cold_send" | "peer_flood" | "flood_wait" | "banned" | "unauthorized" | "manual_rest" | "resume";
                count: number;
            }[];
        };
        ImportContactsResp: {
            imported: number;
            skipped: number;
            replicaSize: number;
        };
        TransferOutreachAccount: {
            newOwnerUserId: string;
        };
        OutreachAccountDelegation: {
            accountId: string;
            delegateId: string;
            /** Format: date-time */
            startsAt: string;
            /** Format: date-time */
            endsAt: string | null;
            reason: string | null;
            createdBy: string;
            /** Format: date-time */
            createdAt: string;
            delegate: components["schemas"]["DelegateUser"];
        };
        DelegateUser: {
            id: string;
            name: string | null;
            username: string | null;
        } | null;
        CreateOutreachAccountDelegation: {
            delegateId: string;
            /** Format: date-time */
            startsAt?: string;
            /** Format: date-time */
            endsAt?: string | null;
            reason?: string;
        };
        Project: {
            id: string;
            trackId: string;
            name: string;
            /** @enum {string} */
            status: "draft" | "active" | "paused" | "done" | "archived";
            /** @enum {string} */
            phase: "briefing" | "longlist" | "review" | "shortlist" | "production" | "wrapup";
            brief: string | null;
            budgetAmount: number | null;
            /** Format: date-time */
            periodStart: string | null;
            /** Format: date-time */
            periodEnd: string | null;
            tov: string | null;
            constraints: string | null;
            akPercent: number;
            vatEnabled: boolean;
            vatRate: number;
            ordEnabled: boolean;
            splitEnabled: boolean;
            stages: {
                id: string;
                name: string;
                order: number;
            }[];
            /** @enum {string} */
            accountsMode: "all" | "selected";
            accountsSelected: string[];
            opener: {
                text: string;
                warmText?: string | null;
                rknText?: string | null;
            };
            /** Format: date-time */
            activatedAt: string | null;
            /** Format: date-time */
            completedAt: string | null;
            /** Format: date-time */
            clientFinalizedAt: string | null;
            /** Format: date-time */
            createdAt: string;
            unreadCount: number;
            hasMarkedUnread: boolean;
        };
        CreateProject: {
            trackId: string;
            name: string;
            templateId?: string;
            brief?: string;
            budgetAmount?: number;
            /** Format: date-time */
            periodStart?: string;
            /** Format: date-time */
            periodEnd?: string;
            tov?: string;
            constraints?: string;
        };
        UpdateProject: {
            name?: string;
            stages?: {
                id: string;
                name: string;
                order: number;
            }[];
            /** @enum {string} */
            accountsMode?: "all" | "selected";
            accountsSelected?: string[];
            opener?: {
                text: string;
                warmText?: string | null;
                rknText?: string | null;
            };
            /** @enum {string} */
            phase?: "briefing" | "longlist" | "review" | "shortlist" | "production" | "wrapup";
            brief?: string | null;
            budgetAmount?: number | null;
            /** Format: date-time */
            periodStart?: string | null;
            /** Format: date-time */
            periodEnd?: string | null;
            tov?: string | null;
            constraints?: string | null;
            akPercent?: number;
            vatEnabled?: boolean;
            vatRate?: number;
            ordEnabled?: boolean;
            splitEnabled?: boolean;
        };
        OutreachLeadProgress: {
            id: string;
            username: string | null;
            tgUserId: string | null;
            properties: {
                [key: string]: string;
            };
            account: components["schemas"]["OutreachLeadAccount"];
            /** @enum {string|null} */
            accountSource: "scheduled" | "sticky" | null;
            messages: components["schemas"]["OutreachLeadMessageProgress"][];
            /** Format: date-time */
            repliedAt: string | null;
            contactHistory: {
                talked: boolean;
                replied: boolean;
            } | null;
            /** Format: date-time */
            lastMessageAt: string | null;
            contactId: string | null;
            unreadCount: number;
            markedUnread: boolean;
            nextStep: {
                /** Format: date-time */
                date: string;
                text: string;
                /** @enum {string} */
                repeat: "none" | "daily" | "weekly" | "monthly";
            } | null;
            stageId: string | null;
            contactReady: boolean;
            /** Format: date-time */
            skippedAt: string | null;
            /** @enum {string} */
            outreachState: "replied" | "excluded" | "blocked_rkn" | "no_contact" | "bot_manual" | "not_private" | "manual_method" | "not_scheduled" | "in_flight" | "needs_review";
            channel: {
                id: string;
                title: string;
                username: string | null;
                link: string | null;
                platform: string;
                memberCount: number | null;
                isRkn: boolean;
                platformActivity: {
                    sources: ("cpc" | "cpa")[];
                    lastPostDate: string | null;
                    recentPosts: number;
                    recentViews: number;
                    isActive: boolean | null;
                    isCpv: boolean | null;
                    moderationStatus: string | null;
                    botStatus: string | null;
                } | null;
                /** @enum {string} */
                relationStatus: "none" | "pending" | "working" | "paused" | "unsuitable" | "declined";
                suggestedAdmin: string | null;
            } | null;
            contactMethod: {
                kind: string;
                label: string | null;
                link: string | null;
            } | null;
        };
        OutreachLeadAccount: {
            id: string;
            firstName: string | null;
            tgUsername: string | null;
            phoneNumber: string | null;
            hasPremium: boolean;
        } | null;
        OutreachLeadMessageProgress: {
            messageIdx: number;
            dunningRound: number;
            /** @enum {string} */
            status: "pending" | "sent" | "failed" | "cancelled";
            /** Format: date-time */
            sentAt: string | null;
            /** Format: date-time */
            readAt: string | null;
            /** Format: date-time */
            scheduledAt: string | null;
            error: string | null;
        };
        MoveProjectItem: {
            stageId: string | null;
        };
        ToggleDunning: {
            enabled: boolean;
        };
        OutreachAnalyticsPoint: {
            /** Format: date */
            date: string;
            sent: number;
            read: number;
            replied: number;
        };
        OutreachSampleLead: {
            id: string;
            username: string | null;
            properties: {
                [key: string]: string;
            };
        } | null;
        Placement: {
            id: string;
            channel: {
                id: string;
                title: string;
                username: string | null;
                /** @enum {string} */
                platform: "telegram" | "youtube" | "tiktok" | "dzen" | "max";
                memberCount: number | null;
                avgReach: number | null;
                err: number | null;
                hasDm: boolean;
                dmStarCost: number | null;
                isRkn: boolean;
            } | null;
            adminContactId: string | null;
            adminUsername: string | null;
            hasRecipient: boolean;
            contactReady: boolean;
            unread: number;
            teamKnowsAdmin: boolean;
            adminIsBot: boolean;
            account: {
                id: string;
                firstName: string | null;
                tgUsername: string | null;
            } | null;
            /** @enum {string} */
            chainStatus: "not_sent" | "sent" | "read" | "replied" | "declined";
            outreach: {
                totalSteps: number;
                sentCount: number;
                read: boolean;
                /** Format: date-time */
                lastSentAt: string | null;
            };
            available: boolean | null;
            priceAmount: number | null;
            clientPrice: number | null;
            forecastViews: number | null;
            forecastErr: number | null;
            surchargePercent: number | null;
            bloggerVat: boolean;
            format: string | null;
            quotedRates: string | null;
            createShare: number | null;
            /** @enum {string} */
            clientStatus: "pending" | "approved" | "rejected";
            clientStatusComment: string | null;
            /** Format: date-time */
            shortlistedAt: string | null;
            /** @enum {string|null} */
            declineBy: "blogger" | "us" | null;
            declineNote: string | null;
            /** Format: date-time */
            repliedAt: string | null;
            /** Format: date-time */
            finalOfferSentAt: string | null;
            /** @enum {string} */
            finalOfferStatus: "none" | "queued" | "sent" | "failed";
            /** @enum {string} */
            contractStatus: "none" | "sent" | "revising" | "signed";
            /** @enum {string} */
            creativeStatus: "none" | "awaiting" | "internal_review" | "client_review" | "blogger_review" | "revising" | "approved";
            creativeRound: number;
            creativeDocUrl: string | null;
            creativeDocText: string | null;
            /** Format: date-time */
            scheduledAt: string | null;
            erid: string | null;
            eridAdvertiserData: string | null;
            postUrl: string | null;
            /** Format: date-time */
            publishedAt: string | null;
            /** Format: date-time */
            actReceivedAt: string | null;
            stepMessages: {
                contract?: {
                    chatId: string;
                    messageId: string;
                    albumId: string | null;
                    accountId: string;
                    /** Format: date-time */
                    at: string;
                };
                creative?: {
                    chatId: string;
                    messageId: string;
                    albumId: string | null;
                    accountId: string;
                    /** Format: date-time */
                    at: string;
                };
                act?: {
                    chatId: string;
                    messageId: string;
                    albumId: string | null;
                    accountId: string;
                    /** Format: date-time */
                    at: string;
                };
            } | null;
            /** Format: date-time */
            eridSentAt: string | null;
            creativeClientComment: string | null;
            /** Format: date-time */
            creativeClientSentAt: string | null;
            /** @enum {string} */
            metricsStatus: "idle" | "pending" | "done" | "error";
            metricsViews: number | null;
            metricsLikes: number | null;
            metricsComments: number | null;
            metricsShares: number | null;
            /** Format: date-time */
            metricsCollectedAt: string | null;
            metricsError: string | null;
            postSnapshot: {
                /** @enum {string} */
                platform?: "telegram" | "youtube" | "tiktok" | "dzen";
                messageId?: string;
                chatId?: string;
                text: string;
                entities: {
                    offset: number;
                    length: number;
                    /** @enum {string} */
                    kind: "bold" | "italic" | "underline" | "strikethrough" | "code" | "pre" | "preCode" | "blockquote" | "url" | "textUrl" | "email" | "phone" | "mention" | "hashtag" | "cashtag";
                    url?: string;
                    language?: string;
                }[];
                thumbB64: string | null;
                thumbW: number | null;
                thumbH: number | null;
                coverUrl?: string | null;
                url?: string | null;
                media: {
                    /** @enum {string} */
                    kind: "photo" | "video";
                    width: number;
                    height: number;
                } | null;
                views: number | null;
                forwards: number | null;
                reactions: {
                    emoji: string;
                    count: number;
                }[];
                /** Format: date-time */
                capturedAt: string;
            } | null;
            /** Format: date-time */
            createdAt: string;
        };
        BulkPlacements: {
            identifiers: string[];
        };
        UpdatePlacement: {
            available?: boolean | null;
            priceAmount?: number | null;
            clientPrice?: number | null;
            forecastViews?: number | null;
            forecastErr?: number | null;
            surchargePercent?: number | null;
            bloggerVat?: boolean;
            format?: string | null;
            quotedRates?: string | null;
            createShare?: number | null;
            /** @enum {string} */
            clientStatus?: "pending" | "approved" | "rejected";
            shortlisted?: boolean;
            /** @enum {string} */
            declineBy?: "blogger" | "us";
            declineNote?: string | null;
            /** @enum {string} */
            contractStatus?: "none" | "sent" | "revising" | "signed";
            /** @enum {string} */
            creativeStatus?: "none" | "awaiting" | "internal_review" | "client_review" | "blogger_review" | "revising" | "approved";
            creativeRound?: number;
            /** Format: date-time */
            scheduledAt?: string | null;
            erid?: string | null;
            eridAdvertiserData?: string | null;
            postUrl?: string | null;
            /** Format: date-time */
            publishedAt?: string | null;
            /** Format: date-time */
            actReceivedAt?: string | null;
            /** Format: date-time */
            eridSentAt?: string | null;
            creativeClientComment?: string | null;
        };
        TaggedMessage: {
            id: string;
            /** Format: date-time */
            date: string;
            text: string;
            entities: {
                offset: number;
                length: number;
                /** @enum {string} */
                kind: "bold" | "italic" | "underline" | "strikethrough" | "code" | "pre" | "preCode" | "blockquote" | "url" | "textUrl" | "email" | "phone" | "mention" | "hashtag" | "cashtag";
                url?: string;
                language?: string;
            }[];
            mediaThumb: {
                /** @enum {string} */
                kind: "photo" | "video" | "animation";
                b64: string;
                width: number;
                height: number;
            } | null;
            views: number | null;
            forwards: number | null;
            replies: number | null;
            reactions: {
                emoji: string;
                count: number;
            }[];
            isForwarded: boolean;
        };
        CapturePost: {
            url: string;
        };
        ProjectShare: {
            id: string;
            token: string;
            url: string;
            label: string | null;
            /** Format: date-time */
            expiresAt: string | null;
            /** Format: date-time */
            lastSeenAt: string | null;
            /** Format: date-time */
            createdAt: string;
        };
        CreateProjectShare: {
            label?: string;
            /** Format: date-time */
            expiresAt?: string;
        };
        QuickSendPreview: {
            activeProjects: components["schemas"]["ProjectRef"][];
        };
        ProjectRef: {
            id: string;
            name: string;
        };
        QuickSendPreviewQuery: {
            contactId?: string;
            tgUserId?: string;
        };
        QuickSendResult: {
            /** @enum {string} */
            status: "sent";
            cancelledProjects: components["schemas"]["ProjectRef"][];
        };
        QuickSendBody: {
            accountId: string;
            contactId?: string;
            tgUserId?: string;
            text?: string;
            sticker?: {
                remoteId: string;
            };
            entities?: {
                offset: number;
                length: number;
                customEmojiId: string;
            }[];
            replyToMessageId?: string;
        };
        StickerSetInfo: {
            id: string;
            title: string;
            /** @enum {string} */
            kind: "sticker" | "emoji";
        };
        PickerSticker: {
            remoteId: string;
            uniqueId: string | null;
            thumbFileId: number | null;
            emoji: string;
            customEmojiId: string | null;
        };
        Track: {
            id: string;
            name: string;
            properties: {
                [key: string]: unknown;
            };
            /** Format: date-time */
            createdAt: string;
        };
        CreateTrack: {
            name: string;
            properties?: {
                [key: string]: unknown;
            };
        };
        UpdateTrack: {
            name?: string;
            properties?: {
                [key: string]: unknown;
            };
        };
        LegalEntity: {
            id: string;
            trackId: string | null;
            contactId: string | null;
            /** @enum {string} */
            type: "ul" | "ip" | "fl" | "ful" | "ffl";
            inn: string | null;
            name: string | null;
            kpp: string | null;
            ogrn: string | null;
            city: string | null;
            address: string | null;
            phone: string | null;
            oksmNumber: string | null;
            /** Format: date-time */
            createdAt: string;
        } | null;
        LegalEntityInput: {
            /** @enum {string} */
            type: "ul" | "ip" | "fl" | "ful" | "ffl";
            inn?: string | null;
            name?: string | null;
            kpp?: string | null;
            ogrn?: string | null;
            city?: string | null;
            address?: string | null;
            phone?: string | null;
            oksmNumber?: string | null;
        };
        StageTemplate: {
            id: string;
            name: string;
            stages: {
                id: string;
                name: string;
                order: number;
            }[];
            /** Format: date-time */
            createdAt: string;
        };
        CreateStageTemplate: {
            name: string;
            stages?: {
                id: string;
                name: string;
                order: number;
            }[];
        };
        UpdateStageTemplate: {
            name?: string;
            stages?: {
                id: string;
                name: string;
                order: number;
            }[];
        };
        OutreachSchedule: {
            timezone: string;
            dailySchedule: {
                mon: false | {
                    startHour: number;
                    endHour: number;
                };
                tue: false | {
                    startHour: number;
                    endHour: number;
                };
                wed: false | {
                    startHour: number;
                    endHour: number;
                };
                thu: false | {
                    startHour: number;
                    endHour: number;
                };
                fri: false | {
                    startHour: number;
                    endHour: number;
                };
                sat: false | {
                    startHour: number;
                    endHour: number;
                };
                sun: false | {
                    startHour: number;
                    endHour: number;
                };
            };
        };
        WorkspaceInvite: {
            id: string;
            workspaceId: string;
            telegramUsername: string;
            /** @enum {string} */
            role: "admin" | "member";
            code: string;
            createdBy: string;
            createdAt: string;
            expiresAt: string;
        };
        DismissMemberResp: {
            transferredAccountIds: string[];
            revokedDelegations: number;
        };
        DismissMemberBody: {
            transfers: {
                accountId: string;
                newOwnerUserId: string;
            }[];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
