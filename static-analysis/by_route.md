# by_route — per-screen backend surface

Derived from `static_inventory.json` over 376 files / 66 routes.


## CelloRouteImport
- file: `src/routes/cello.tsx`
- reachable files: 5
- Env: VITE_BOT_USERNAME
- i18n keys: 0

## CustomTokenAuthRouteImport
- file: `src/routes/custom-token-auth.tsx`
- reachable files: 16
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged, signInWithCustomToken, signOut
- Env: VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 0

## GoogleCalendarCallbackRouteImport
- file: `src/routes/google-calendar-callback.tsx`
- reachable files: 5
- Env: VITE_BOT_USERNAME
- i18n keys: 14

## LocalRedirectRouteRouteImport
- file: `src/routes/local-redirect.route.tsx`
- reachable files: 1
- i18n keys: 0

## PaymentCallbackRouteImport
- file: `src/routes/payment-callback.tsx`
- reachable files: 5
- Env: VITE_BOT_USERNAME
- i18n keys: 12

## ProtectedAcceptInviteWorkspaceIdInviteCodeRouteImport
- file: `src/routes/_protected/accept-invite.$workspaceId.$inviteCode.tsx`
- reachable files: 10
- tRPC: `workspace.acceptWorkspaceInvite`, `workspace.getWorkspaceInvite`
- Env: VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 12

## ProtectedIndexRouteImport
- file: `src/routes/_protected/index.tsx`
- reachable files: 86
- tRPC: `cello.getInitOptions`, `workspace.createWorkspace`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged, signOut
- Posthog: `$groupidentify`, `workspace_created`
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 64

## ProtectedMiniAppSplatRouteImport
- file: `src/routes/_protected/mini-app.$.tsx`
- reachable files: 86
- tRPC: `cello.getInitOptions`, `workspace.createWorkspace`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged, signOut
- Posthog: `$groupidentify`, `workspace_created`
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 64

## ProtectedRouteRouteImport
- file: `src/routes/_protected/route.tsx`
- reachable files: 24
- tRPC: `telegram.authenticateByInitData`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged, signInWithCustomToken, signOut
- Posthog: `web_auth_completed`, `web_auth_started`
- Env: VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 0

## ProtectedWWorkspaceIdAddPendingActivityIdRouteImport
- file: `src/routes/_protected/w.$workspaceId/add-pending-activity.$id.tsx`
- reachable files: 57
- tRPC: `cello.getInitOptions`, `pendingContact.addPendingActivity`, `pendingContact.getPendingActivity`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 57

## ProtectedWWorkspaceIdContactsContactIdActivitiesActivityIdEditRouteImport
- file: `src/routes/_protected/w.$workspaceId/contacts/$contactId/activities/$activityId.edit.tsx`
- reachable files: 88
- tRPC: `activity.scheduleCalendarEventIfPossible`, `cello.getInitOptions`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Posthog: `activity_created`
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 73

## ProtectedWWorkspaceIdContactsContactIdActivitiesNewRouteImport
- file: `src/routes/_protected/w.$workspaceId/contacts/$contactId/activities/new.tsx`
- reachable files: 89
- tRPC: `activity.scheduleCalendarEventIfPossible`, `cello.getInitOptions`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Posthog: `activity_created`
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 73

## ProtectedWWorkspaceIdContactsContactIdEditRouteImport
- file: `src/routes/_protected/w.$workspaceId/contacts/$contactId/edit.tsx`
- reachable files: 100
- tRPC: `cello.getInitOptions`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Posthog: `contact_updated`
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 113

## ProtectedWWorkspaceIdContactsContactIdIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/contacts/$contactId/index.tsx`
- reachable files: 117
- tRPC: `activity.scheduleCalendarEventIfPossible`, `cello.getInitOptions`, `contact.deleteContacts`, `contact.updateContactAvatar`, `proxy.getProxyStatus`, `telegram.account.getAccountConnectionData`, `telegram.account.reauthenticateWebClient`, `telegram.account.submitReauthPassword`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Posthog: `activity_created`, `chat_opened`
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID, VITE_TELEGRAM_CLIENT_URL
- fetch: HEALTH_CHECK_URL, `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 168

## ProtectedWWorkspaceIdContactsIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/contacts/index.tsx`
- reachable files: 135
- tRPC: `cello.getInitOptions`, `contact.bulkUpdate`, `contact.createContactFromQr`, `contact.deleteContacts`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Posthog: `pipeline_created`
- Env: DEV, VITE_APP_URL, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 201

## ProtectedWWorkspaceIdContactsNewRouteImport
- file: `src/routes/_protected/w.$workspaceId/contacts/new.tsx`
- reachable files: 98
- tRPC: `cello.getInitOptions`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Posthog: `$groupidentify`, `contact_created`
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 113

## ProtectedWWorkspaceIdIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/index.tsx`
- reachable files: 1
- i18n keys: 0

## ProtectedWWorkspaceIdOnboardingIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/onboarding/index.tsx`
- reachable files: 1
- i18n keys: 0

## ProtectedWWorkspaceIdOnboardingStepIdRouteImport
- file: `src/routes/_protected/w.$workspaceId/onboarding/$stepId.tsx`
- reachable files: 28
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Posthog: `onboarding_closed`, `onboarding_screen_viewed`
- Env: VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 69

## ProtectedWWorkspaceIdOutreachAiBotRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/ai-bot.tsx`
- reachable files: 51
- tRPC: `cello.getInitOptions`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 63

## ProtectedWWorkspaceIdOutreachIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/index.tsx`
- reachable files: 49
- tRPC: `cello.getInitOptions`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 61

## ProtectedWWorkspaceIdOutreachScheduleRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/schedule.tsx`
- reachable files: 79
- tRPC: `cello.getInitOptions`, `outreach.rescheduleSequences`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 80

## ProtectedWWorkspaceIdOutreachSequencesIdAccountsRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/sequences/$id.accounts.tsx`
- reachable files: 54
- tRPC: `cello.getInitOptions`
- oRPC: `outreach.sequences.patch`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 57

## ProtectedWWorkspaceIdOutreachSequencesIdContactSettingsIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/sequences/$id.contact-settings.index.tsx`
- reachable files: 95
- tRPC: `cello.getInitOptions`
- oRPC: `outreach.sequences.patch`, `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 120

## ProtectedWWorkspaceIdOutreachSequencesIdContactSettingsOwnersRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/sequences/$id.contact-settings.owners.tsx`
- reachable files: 52
- tRPC: `cello.getInitOptions`
- oRPC: `outreach.sequences.patch`, `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 65

## ProtectedWWorkspaceIdOutreachSequencesIdIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/sequences/$id.index.tsx`
- reachable files: 116
- tRPC: `cello.getInitOptions`, `outreach.generateUploadSignedUrl`, `outreach.getLeads`, `outreach.getSequenceAnalytics`, `outreach.getSequenceStats`, `outreach.updateSequenceStatus`, `outreach.validateTextVariables`
- oRPC: `outreach.sequences.delete`, `outreach.sequences.patch`, `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 203

## ProtectedWWorkspaceIdOutreachSequencesIdLeadsRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/sequences/$id.leads.tsx`
- reachable files: 89
- tRPC: `cello.getInitOptions`, `outreach.getLeads`, `outreach.removeLeadFromSequence`, `outreach.resolveDuplicates`, `outreach.sendOutreachMessageNow`, `outreach.updateLeadProperties`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, NODE_ENV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 125

## ProtectedWWorkspaceIdOutreachSequencesNewCrmRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/sequences/new.crm.tsx`
- reachable files: 104
- tRPC: `cello.getInitOptions`
- oRPC: `outreach.lists.createCrmList`, `outreach.sequences.create`, `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_APP_URL, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 124

## ProtectedWWorkspaceIdOutreachSequencesNewCsvRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/sequences/new.csv.tsx`
- reachable files: 65
- tRPC: `cello.getInitOptions`
- oRPC: `outreach.lists.uploadCsvList`, `outreach.sequences.create`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 81

## ProtectedWWorkspaceIdOutreachSequencesNewIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/sequences/new.index.tsx`
- reachable files: 49
- tRPC: `cello.getInitOptions`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 65

## ProtectedWWorkspaceIdOutreachTelegramAccountsAccountIdRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/telegram-accounts/$accountId.tsx`
- reachable files: 92
- tRPC: `cello.getInitOptions`, `outreach.rescheduleSequences`, `proxy.getProxyStatus`, `telegram.account.toggleWarmup`, `telegram.account.triggerWarmupSession`, `telegram.account.updateAccount`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 103

## ProtectedWWorkspaceIdOutreachTelegramAccountsBuyRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/telegram-accounts/buy.tsx`
- reachable files: 82
- tRPC: `cello.getInitOptions`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 74

## ProtectedWWorkspaceIdOutreachTelegramAccountsIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/telegram-accounts/index.tsx`
- reachable files: 54
- tRPC: `cello.getInitOptions`, `telegram.account.moveAccounts`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 79

## ProtectedWWorkspaceIdOutreachTelegramAccountsNewRouteImport
- file: `src/routes/_protected/w.$workspaceId/outreach/telegram-accounts/new.tsx`
- reachable files: 61
- tRPC: `cello.getInitOptions`, `proxy.getCountries`, `telegram.account.auth`, `telegram.account.authState`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:id`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Posthog: `telegram_account_connected`
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`, https://api.country.is/
- i18n keys: 101

## ProtectedWWorkspaceIdRouteRouteImport
- file: `src/routes/_protected/w.$workspaceId/route.tsx`
- reachable files: 87
- tRPC: `cello.getInitOptions`, `workspace.createWorkspace`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged, signOut
- Posthog: `$groupidentify`, `workspace_created`
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_DISABLE_FLOWS, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 64

## ProtectedWWorkspaceIdSettingsAffiliateRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/affiliate.tsx`
- reachable files: 47
- tRPC: `account.getAffiliateInfo`, `cello.getInitOptions`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 65

## ProtectedWWorkspaceIdSettingsApiKeysIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/api-keys/index.tsx`
- reachable files: 50
- tRPC: `apiKey.create`, `apiKey.list`, `cello.getInitOptions`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 77

## ProtectedWWorkspaceIdSettingsApiKeysKeyIdRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/api-keys/$keyId.tsx`
- reachable files: 87
- tRPC: `apiKey.list`, `apiKey.rename`, `apiKey.revoke`, `cello.getInitOptions`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 83

## ProtectedWWorkspaceIdSettingsApiKeysWebhooksIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/api-keys/webhooks.index.tsx`
- reachable files: 80
- tRPC: `cello.getInitOptions`, `webhook.create`, `webhook.list`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 96

## ProtectedWWorkspaceIdSettingsApiKeysWebhooksWebhookIdRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/api-keys/webhooks.$webhookId.tsx`
- reachable files: 88
- tRPC: `cello.getInitOptions`, `webhook.delete`, `webhook.disable`, `webhook.enable`, `webhook.list`, `webhook.rotateSecret`, `webhook.update`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 117

## ProtectedWWorkspaceIdSettingsConnectCrmRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/connect-crm.tsx`
- reachable files: 48
- tRPC: `cello.getInitOptions`, `zapier.status`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 63

## ProtectedWWorkspaceIdSettingsExportRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/export.tsx`
- reachable files: 46
- tRPC: `cello.getInitOptions`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 55

## ProtectedWWorkspaceIdSettingsFeatureFlagsRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/feature-flags.tsx`
- reachable files: 48
- tRPC: `cello.getInitOptions`
- Firestore: `addDoc`, `arrayRemove`, `arrayUnion`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 49

## ProtectedWWorkspaceIdSettingsGoogleCalendarRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/google-calendar.tsx`
- reachable files: 46
- tRPC: `cello.getInitOptions`, `googleCalendar.createConnectionUrl`, `googleCalendar.disconnect`, `googleCalendar.getAccount`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 59

## ProtectedWWorkspaceIdSettingsHelpRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/help.tsx`
- reachable files: 47
- tRPC: `cello.getInitOptions`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 69

## ProtectedWWorkspaceIdSettingsIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/index.tsx`
- reachable files: 48
- tRPC: `account.deleteAccount`, `cello.getInitOptions`, `googleCalendar.getAccount`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged, signOut
- Env: DEV, VITE_APP_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 121

## ProtectedWWorkspaceIdSettingsLocaleRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/locale.tsx`
- reachable files: 47
- tRPC: `cello.getInitOptions`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 55

## ProtectedWWorkspaceIdSettingsMembersAcceptInviteWIdInviteCodeRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/members.accept-invite.$wId.$inviteCode.ts`
- reachable files: 1
- i18n keys: 0

## ProtectedWWorkspaceIdSettingsNotificationsRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/notifications.tsx`
- reachable files: 48
- tRPC: `cello.getInitOptions`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 57

## ProtectedWWorkspaceIdSettingsOrganizationOrganizationIdRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/organization/$organizationId.tsx`
- reachable files: 83
- tRPC: `cello.getInitOptions`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 64

## ProtectedWWorkspaceIdSettingsPropertiesObjectTypeIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/properties.$objectType/index.tsx`
- reachable files: 52
- tRPC: `cello.getInitOptions`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 80

## ProtectedWWorkspaceIdSettingsPropertiesObjectTypeKeyEditRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/properties.$objectType/$key.edit.tsx`
- reachable files: 93
- tRPC: `cello.getInitOptions`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 105

## ProtectedWWorkspaceIdSettingsPropertiesObjectTypeNewTypeRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/properties.$objectType/new.$type.tsx`
- reachable files: 91
- tRPC: `cello.getInitOptions`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 93

## ProtectedWWorkspaceIdSettingsSubscriptionRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/subscription.tsx`
- reachable files: 53
- tRPC: `cello.getInitOptions`, `workspace.subscription.getPrices`, `workspace.subscription.switchPlan`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 127

## ProtectedWWorkspaceIdSettingsTelegramSyncRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/telegram-sync.tsx`
- reachable files: 59
- tRPC: `cello.getInitOptions`, `telegram.client.getFolders`, `telegram.client.getQrState`, `telegram.client.sendCode`, `telegram.client.signIn`, `telegram.client.signInWithPassword`, `telegram.client.signOut`, `telegram.client.status`, `telegram.client.triggerSync`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged, signOut
- Posthog: `telegram_sync_auth_complete`
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: https://api.country.is/
- i18n keys: 145

## ProtectedWWorkspaceIdSettingsWorkspaceAcceptInviteWIdInviteCodeRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/workspace/accept-invite.$wId.$inviteCode.tsx`
- reachable files: 1
- i18n keys: 0

## ProtectedWWorkspaceIdSettingsWorkspaceIndexRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/workspace/index.tsx`
- reachable files: 85
- tRPC: `cello.getInitOptions`, `workspace.getPendingInvites`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Posthog: `$groupidentify`
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 75

## ProtectedWWorkspaceIdSettingsWorkspaceInviteRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/workspace/invite.tsx`
- reachable files: 84
- tRPC: `cello.getInitOptions`, `workspace.inviteWorkspaceMember`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 76

## ProtectedWWorkspaceIdSettingsWorkspaceNewRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/workspace/new.tsx`
- reachable files: 83
- tRPC: `cello.getInitOptions`, `workspace.createWorkspace`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Posthog: `$groupidentify`, `workspace_created`
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 68

## ProtectedWWorkspaceIdSettingsWorkspaceUserUserIdRouteImport
- file: `src/routes/_protected/w.$workspaceId/settings/workspace/user.$userId.tsx`
- reachable files: 87
- tRPC: `cello.getInitOptions`, `workspace.changeWorkspaceMemberRole`, `workspace.removeWorkspaceMember`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 89

## ProtectedWWorkspaceIdTelegramRouteImport
- file: `src/routes/_protected/w.$workspaceId/telegram.tsx`
- reachable files: 121
- tRPC: `activity.scheduleCalendarEventIfPossible`, `cello.getInitOptions`, `contact.deleteContacts`, `contact.updateContactAvatar`, `proxy.getProxyStatus`, `telegram.account.getAccountConnectionData`, `telegram.account.reauthenticateWebClient`, `telegram.account.submitReauthPassword`
- oRPC: `workspaces.getMembers`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Posthog: `activity_created`, `chat_opened`
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID, VITE_TELEGRAM_CLIENT_URL
- fetch: HEALTH_CHECK_URL, `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 156

## ProtectedWWorkspaceIdToolsGroupParserRouteImport
- file: `src/routes/_protected/w.$workspaceId/tools/group-parser.tsx`
- reachable files: 50
- tRPC: `cello.getInitOptions`, `outreach.tools.createGroupParseRequest`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 68

## ProtectedWWorkspaceIdToolsLookalikeAudienceRouteImport
- file: `src/routes/_protected/w.$workspaceId/tools/lookalike-audience.tsx`
- reachable files: 55
- tRPC: `cello.getInitOptions`, `outreach.tools.lookalikeAudienceRequest`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 82

## ProtectedWWorkspaceIdToolsPhoneNumbersConverterRouteImport
- file: `src/routes/_protected/w.$workspaceId/tools/phone-numbers-converter.tsx`
- reachable files: 54
- tRPC: `cello.getInitOptions`, `outreach.tools.convertPhoneNumbersRequest`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- i18n keys: 76

## ProtectedWWorkspaceIdWalletTopUpRouteImport
- file: `src/routes/_protected/w.$workspaceId/wallet/top-up.tsx`
- reachable files: 51
- tRPC: `cello.getInitOptions`, `organization.wallet.getTopUpOptions`
- Firestore: `addDoc`, `collection`, `collection:organizations`, `collection:workspaces`, `deleteDoc`, `deleteField`, `doc`, `doc:auth-sessions`, `doc:organizations`, `doc:users`, `doc:workspaces`, `getDoc`, `getDocs`, `limit`, `onSnapshot`, `orderBy`, `orderBy:asc`, `orderBy:createdAt`, `orderBy:executionDate`, `query`, `serverTimestamp`, `setDoc`, `updateDoc`, `where:accountId`, `where:array-contains`, `where:contactId`, `where:executionDate`, `where:in`, `where:peerId`, `where:status`, `where:unread`, `where:usernamesNormalized`, `writeBatch`
- Firebase Auth: onAuthStateChanged
- Env: DEV, VITE_BACKEND_URL, VITE_BOT_USERNAME, VITE_DEV_HOST, VITE_FIREBASE_PROJECT_ID
- fetch: `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`
- i18n keys: 60

## rootRouteImport
- file: `src/routes/__root.tsx`
- reachable files: 10
- Posthog: `$pageview`
- i18n keys: 0