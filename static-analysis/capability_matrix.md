# Capability matrix — code-derived

Rows: **70**. Domains: App shell=7, Workspaces=8, Onboarding=2, CRM=6, Telegram=2, Outreach=15, Billing=1, Settings=19, Integrations=5, Host integration=1, Infra=4.


> **Reading guide:** Columns `trpc`, `orpc`, `firestore_ops`, `i18n_prefixes`, `posthog`, `zod`, `reach` are machine facts. Columns `domain` and `label` are heuristic from URL shape. Likely-scenario prose will be added in a later LLM-enriched version. No prose here.


## Coverage check

- tRPC: 134 calls → 69 unique procedures → 69 covered by rows. Missing: none.
- oRPC: 20 calls → 6 unique procedures → 6 covered by rows. Missing: none.


## App shell

| # | Label | URL | tRPC | oRPC | Firestore (ops) | i18n prefix | posthog | reach |
|---|---|---|---|---|---|---|---|---|
| rootRouteImport | **__root** | `/__root` | — | — | 0 | — | 1 | 10 |
| ProtectedIndexRouteImport | **ProtectedIndex** | `/` | `cello.getInitOptions`, `workspace.createWorkspace` | `workspaces.getMembers` | 33 | — | 2 | 86 |
| ProtectedRouteRouteImport | **ProtectedRoute** | `/` | `telegram.authenticateByInitData` | — | 33 | — | 2 | 24 |
| ProtectedWWorkspaceIdAddPendingA | **w / add-pending-activity — Detail** | `/w/{workspaceId}/add-pending-activity/{id}` | `cello.getInitOptions`, `pendingContact.addPendingActivity`, `pendingContact.getPendingActivity` | — | 33 | web | 0 | 57 |
| ProtectedWWorkspaceIdToolsGroupP | **w / tools / group-parser** | `/w/{workspaceId}/tools/group-parser` | `cello.getInitOptions`, `outreach.tools.createGroupParseRequest` | — | 33 | web | 0 | 50 |
| ProtectedWWorkspaceIdToolsLookal | **w / tools / lookalike-audience** | `/w/{workspaceId}/tools/lookalike-audience` | `cello.getInitOptions`, `outreach.tools.lookalikeAudienceRequest` | — | 33 | web | 0 | 55 |
| ProtectedWWorkspaceIdToolsPhoneN | **w / tools / phone-numbers-converter** | `/w/{workspaceId}/tools/phone-numbers-converter` | `cello.getInitOptions`, `outreach.tools.convertPhoneNumbersRequest` | — | 33 | web | 0 | 54 |


## Workspaces

| # | Label | URL | tRPC | oRPC | Firestore (ops) | i18n prefix | posthog | reach |
|---|---|---|---|---|---|---|---|---|
| ProtectedAcceptInviteWorkspaceId | **accept-invite — Detail** | `/accept-invite/{workspaceId}/{inviteCode}` | `workspace.acceptWorkspaceInvite`, `workspace.getWorkspaceInvite` | — | 0 | web | 0 | 10 |
| ProtectedWWorkspaceIdIndexRouteI | **w — Detail** | `/w/{workspaceId}` | — | — | 0 | — | 0 | 1 |
| ProtectedWWorkspaceIdRouteRouteI | **w — Detail** | `/w/{workspaceId}` | `cello.getInitOptions`, `workspace.createWorkspace` | `workspaces.getMembers` | 33 | — | 2 | 87 |
| ProtectedWWorkspaceIdSettingsWor | **w / settings / workspace — List** | `/w/{workspaceId}/settings/workspace` | `cello.getInitOptions`, `workspace.getPendingInvites` | `workspaces.getMembers` | 33 | web | 1 | 85 |
| ProtectedWWorkspaceIdSettingsWor | **w / settings / workspace / accept-invite — Detail** | `/w/{workspaceId}/settings/workspace/accept-invite/{wId}/{inviteCode}` | — | — | 0 | — | 0 | 1 |
| ProtectedWWorkspaceIdSettingsWor | **w / settings / workspace / invite** | `/w/{workspaceId}/settings/workspace/invite` | `cello.getInitOptions`, `workspace.inviteWorkspaceMember` | `workspaces.getMembers` | 33 | web | 0 | 84 |
| ProtectedWWorkspaceIdSettingsWor | **w / settings / workspace / new — New** | `/w/{workspaceId}/settings/workspace/new` | `cello.getInitOptions`, `workspace.createWorkspace` | `workspaces.getMembers` | 33 | web | 2 | 83 |
| ProtectedWWorkspaceIdSettingsWor | **w / settings / workspace / user — Detail** | `/w/{workspaceId}/settings/workspace/user/{userId}` | `cello.getInitOptions`, `workspace.changeWorkspaceMemberRole`, `workspace.removeWorkspaceMember` | `workspaces.getMembers` | 33 | web | 0 | 87 |


## Onboarding

| # | Label | URL | tRPC | oRPC | Firestore (ops) | i18n prefix | posthog | reach |
|---|---|---|---|---|---|---|---|---|
| ProtectedWWorkspaceIdOnboardingS | **w / onboarding — Detail** | `/w/{workspaceId}/onboarding/{stepId}` | — | — | 33 | web | 2 | 28 |
| ProtectedWWorkspaceIdOnboardingI | **w / onboarding — List** | `/w/{workspaceId}/onboarding` | — | — | 0 | — | 0 | 1 |


## CRM

| # | Label | URL | tRPC | oRPC | Firestore (ops) | i18n prefix | posthog | reach |
|---|---|---|---|---|---|---|---|---|
| ProtectedWWorkspaceIdContactsCon | **w / contacts — Detail** | `/w/{workspaceId}/contacts/{contactId}` | `activity.scheduleCalendarEventIfPossible`, `cello.getInitOptions`, `contact.deleteContacts` +5 | `workspaces.getMembers` | 33 | web | 2 | 117 |
| ProtectedWWorkspaceIdContactsInd | **w / contacts — List** | `/w/{workspaceId}/contacts` | `cello.getInitOptions`, `contact.bulkUpdate`, `contact.createContactFromQr` +1 | `workspaces.getMembers` | 33 | — | 1 | 135 |
| ProtectedWWorkspaceIdContactsCon | **w / contacts / activities / edit** | `/w/{workspaceId}/contacts/{contactId}/activities/{activityId}/edit` | `activity.scheduleCalendarEventIfPossible`, `cello.getInitOptions` | `workspaces.getMembers` | 33 | — | 1 | 88 |
| ProtectedWWorkspaceIdContactsCon | **w / contacts / activities / new — New** | `/w/{workspaceId}/contacts/{contactId}/activities/new` | `activity.scheduleCalendarEventIfPossible`, `cello.getInitOptions` | `workspaces.getMembers` | 33 | — | 1 | 89 |
| ProtectedWWorkspaceIdContactsCon | **w / contacts / edit — Edit** | `/w/{workspaceId}/contacts/{contactId}/edit` | `cello.getInitOptions` | `workspaces.getMembers` | 33 | — | 1 | 100 |
| ProtectedWWorkspaceIdContactsNew | **w / contacts / new — New** | `/w/{workspaceId}/contacts/new` | `cello.getInitOptions` | `workspaces.getMembers` | 33 | — | 2 | 98 |


## Telegram

| # | Label | URL | tRPC | oRPC | Firestore (ops) | i18n prefix | posthog | reach |
|---|---|---|---|---|---|---|---|---|
| ProtectedWWorkspaceIdSettingsTel | **w / settings / telegram-sync** | `/w/{workspaceId}/settings/telegram-sync` | `cello.getInitOptions`, `telegram.client.getFolders`, `telegram.client.getQrState` +6 | — | 33 | web | 1 | 59 |
| ProtectedWWorkspaceIdTelegramRou | **w / telegram** | `/w/{workspaceId}/telegram` | `activity.scheduleCalendarEventIfPossible`, `cello.getInitOptions`, `contact.deleteContacts` +5 | `workspaces.getMembers` | 33 | — | 2 | 121 |


## Outreach

| # | Label | URL | tRPC | oRPC | Firestore (ops) | i18n prefix | posthog | reach |
|---|---|---|---|---|---|---|---|---|
| ProtectedWWorkspaceIdOutreachInd | **w / outreach — List** | `/w/{workspaceId}/outreach` | `cello.getInitOptions` | — | 33 | web | 0 | 49 |
| ProtectedWWorkspaceIdOutreachAiB | **w / outreach / ai-bot** | `/w/{workspaceId}/outreach/ai-bot` | `cello.getInitOptions` | — | 33 | web | 0 | 51 |
| ProtectedWWorkspaceIdOutreachSch | **w / outreach / schedule** | `/w/{workspaceId}/outreach/schedule` | `cello.getInitOptions`, `outreach.rescheduleSequences` | `workspaces.getMembers` | 33 | web | 0 | 79 |
| ProtectedWWorkspaceIdOutreachSeq | **w / outreach / sequences — Detail** | `/w/{workspaceId}/outreach/sequences/{id}` | `cello.getInitOptions`, `outreach.generateUploadSignedUrl`, `outreach.getLeads` +4 | `outreach.sequences.delete`, `outreach.sequences.patch`, `workspaces.getMembers` | 33 | web | 0 | 116 |
| ProtectedWWorkspaceIdOutreachSeq | **w / outreach / sequences / accounts** | `/w/{workspaceId}/outreach/sequences/{id}/accounts` | `cello.getInitOptions` | `outreach.sequences.patch` | 33 | web | 0 | 54 |
| ProtectedWWorkspaceIdOutreachSeq | **w / outreach / sequences / contact-settings** | `/w/{workspaceId}/outreach/sequences/{id}/contact-settings` | `cello.getInitOptions` | `outreach.sequences.patch`, `workspaces.getMembers` | 33 | web | 0 | 95 |
| ProtectedWWorkspaceIdOutreachSeq | **w / outreach / sequences / contact-settings / owners** | `/w/{workspaceId}/outreach/sequences/{id}/contact-settings/owners` | `cello.getInitOptions` | `outreach.sequences.patch`, `workspaces.getMembers` | 33 | web | 0 | 52 |
| ProtectedWWorkspaceIdOutreachSeq | **w / outreach / sequences / leads** | `/w/{workspaceId}/outreach/sequences/{id}/leads` | `cello.getInitOptions`, `outreach.getLeads`, `outreach.removeLeadFromSequence` +3 | `workspaces.getMembers` | 33 | web | 0 | 89 |
| ProtectedWWorkspaceIdOutreachSeq | **w / outreach / sequences / new — New** | `/w/{workspaceId}/outreach/sequences/new` | `cello.getInitOptions` | — | 33 | web | 0 | 49 |
| ProtectedWWorkspaceIdOutreachSeq | **w / outreach / sequences / new / crm — New** | `/w/{workspaceId}/outreach/sequences/new/crm` | `cello.getInitOptions` | `outreach.lists.createCrmList`, `outreach.sequences.create`, `workspaces.getMembers` | 33 | — | 0 | 104 |
| ProtectedWWorkspaceIdOutreachSeq | **w / outreach / sequences / new / csv — New** | `/w/{workspaceId}/outreach/sequences/new/csv` | `cello.getInitOptions` | `outreach.lists.uploadCsvList`, `outreach.sequences.create` | 33 | — | 0 | 65 |
| ProtectedWWorkspaceIdOutreachTel | **w / outreach / telegram-accounts — Detail** | `/w/{workspaceId}/outreach/telegram-accounts/{accountId}` | `cello.getInitOptions`, `outreach.rescheduleSequences`, `proxy.getProxyStatus` +3 | `workspaces.getMembers` | 33 | web | 0 | 92 |
| ProtectedWWorkspaceIdOutreachTel | **w / outreach / telegram-accounts — List** | `/w/{workspaceId}/outreach/telegram-accounts` | `cello.getInitOptions`, `telegram.account.moveAccounts` | — | 33 | web | 0 | 54 |
| ProtectedWWorkspaceIdOutreachTel | **w / outreach / telegram-accounts / buy** | `/w/{workspaceId}/outreach/telegram-accounts/buy` | `cello.getInitOptions` | `workspaces.getMembers` | 33 | web | 0 | 82 |
| ProtectedWWorkspaceIdOutreachTel | **w / outreach / telegram-accounts / new — New** | `/w/{workspaceId}/outreach/telegram-accounts/new` | `cello.getInitOptions`, `proxy.getCountries`, `telegram.account.auth` +1 | `workspaces.getMembers` | 34 | web | 1 | 61 |


## Billing

| # | Label | URL | tRPC | oRPC | Firestore (ops) | i18n prefix | posthog | reach |
|---|---|---|---|---|---|---|---|---|
| ProtectedWWorkspaceIdWalletTopUp | **w / wallet / top-up** | `/w/{workspaceId}/wallet/top-up` | `cello.getInitOptions`, `organization.wallet.getTopUpOptions` | — | 33 | — | 0 | 51 |


## Settings

| # | Label | URL | tRPC | oRPC | Firestore (ops) | i18n prefix | posthog | reach |
|---|---|---|---|---|---|---|---|---|
| ProtectedWWorkspaceIdSettingsInd | **w / settings — List** | `/w/{workspaceId}/settings` | `account.deleteAccount`, `cello.getInitOptions`, `googleCalendar.getAccount` | — | 33 | text, web | 0 | 48 |
| ProtectedWWorkspaceIdSettingsAff | **w / settings / affiliate** | `/w/{workspaceId}/settings/affiliate` | `account.getAffiliateInfo`, `cello.getInitOptions` | — | 33 | web | 0 | 47 |
| ProtectedWWorkspaceIdSettingsApi | **w / settings / api-keys — Detail** | `/w/{workspaceId}/settings/api-keys/{keyId}` | `apiKey.list`, `apiKey.rename`, `apiKey.revoke` +1 | `workspaces.getMembers` | 33 | web | 0 | 87 |
| ProtectedWWorkspaceIdSettingsApi | **w / settings / api-keys — List** | `/w/{workspaceId}/settings/api-keys` | `apiKey.create`, `apiKey.list`, `cello.getInitOptions` | — | 33 | web | 0 | 50 |
| ProtectedWWorkspaceIdSettingsApi | **w / settings / api-keys / webhooks** | `/w/{workspaceId}/settings/api-keys/webhooks` | `cello.getInitOptions`, `webhook.create`, `webhook.list` | `workspaces.getMembers` | 33 | web | 0 | 80 |
| ProtectedWWorkspaceIdSettingsApi | **w / settings / api-keys / webhooks — Detail** | `/w/{workspaceId}/settings/api-keys/webhooks/{webhookId}` | `cello.getInitOptions`, `webhook.delete`, `webhook.disable` +4 | `workspaces.getMembers` | 33 | web | 0 | 88 |
| ProtectedWWorkspaceIdSettingsCon | **w / settings / connect-crm** | `/w/{workspaceId}/settings/connect-crm` | `cello.getInitOptions`, `zapier.status` | — | 33 | web | 0 | 48 |
| ProtectedWWorkspaceIdSettingsExp | **w / settings / export** | `/w/{workspaceId}/settings/export` | `cello.getInitOptions` | — | 33 | web | 0 | 46 |
| ProtectedWWorkspaceIdSettingsFea | **w / settings / feature-flags** | `/w/{workspaceId}/settings/feature-flags` | `cello.getInitOptions` | — | 35 | — | 0 | 48 |
| ProtectedWWorkspaceIdSettingsGoo | **w / settings / google-calendar** | `/w/{workspaceId}/settings/google-calendar` | `cello.getInitOptions`, `googleCalendar.createConnectionUrl`, `googleCalendar.disconnect` +1 | — | 33 | web | 0 | 46 |
| ProtectedWWorkspaceIdSettingsHel | **w / settings / help** | `/w/{workspaceId}/settings/help` | `cello.getInitOptions` | — | 33 | web | 0 | 47 |
| ProtectedWWorkspaceIdSettingsLoc | **w / settings / locale** | `/w/{workspaceId}/settings/locale` | `cello.getInitOptions` | — | 33 | text, web | 0 | 47 |
| ProtectedWWorkspaceIdSettingsMem | **w / settings / members / accept-invite — Detail** | `/w/{workspaceId}/settings/members/accept-invite/{wId}/{inviteCode}` | — | — | 0 | — | 0 | 1 |
| ProtectedWWorkspaceIdSettingsNot | **w / settings / notifications** | `/w/{workspaceId}/settings/notifications` | `cello.getInitOptions` | — | 33 | web | 0 | 48 |
| ProtectedWWorkspaceIdSettingsOrg | **w / settings / organization — Detail** | `/w/{workspaceId}/settings/organization/{organizationId}` | `cello.getInitOptions` | `workspaces.getMembers` | 33 | web | 0 | 83 |
| ProtectedWWorkspaceIdSettingsPro | **w / settings / properties — Detail** | `/w/{workspaceId}/settings/properties/{objectType}` | `cello.getInitOptions` | — | 33 | web | 0 | 52 |
| ProtectedWWorkspaceIdSettingsPro | **w / settings / properties / edit** | `/w/{workspaceId}/settings/properties/{objectType}/{key}/edit` | `cello.getInitOptions` | `workspaces.getMembers` | 33 | web | 0 | 93 |
| ProtectedWWorkspaceIdSettingsPro | **w / settings / properties / new — New** | `/w/{workspaceId}/settings/properties/{objectType}/new/{type}` | `cello.getInitOptions` | `workspaces.getMembers` | 33 | — | 0 | 91 |
| ProtectedWWorkspaceIdSettingsSub | **w / settings / subscription** | `/w/{workspaceId}/settings/subscription` | `cello.getInitOptions`, `workspace.subscription.getPrices`, `workspace.subscription.switchPlan` | — | 33 | text, web | 0 | 53 |


## Integrations

| # | Label | URL | tRPC | oRPC | Firestore (ops) | i18n prefix | posthog | reach |
|---|---|---|---|---|---|---|---|---|
| CelloRouteImport | **cello** | `/cello` | — | — | 0 | — | 0 | 5 |
| CustomTokenAuthRouteImport | **custom-token-auth** | `/custom-token-auth` | — | — | 33 | — | 0 | 16 |
| GoogleCalendarCallbackRouteImpor | **google-calendar-callback** | `/google-calendar-callback` | — | — | 0 | web | 0 | 5 |
| LocalRedirectRouteRouteImport | **local-redirect** | `/local-redirect` | — | — | 0 | — | 0 | 1 |
| PaymentCallbackRouteImport | **payment-callback** | `/payment-callback` | — | — | 0 | web | 0 | 5 |


## Host integration

| # | Label | URL | tRPC | oRPC | Firestore (ops) | i18n prefix | posthog | reach |
|---|---|---|---|---|---|---|---|---|
| ProtectedMiniAppSplatRouteImport | **mini-app — Detail** | `/mini-app/{}` | `cello.getInitOptions`, `workspace.createWorkspace` | `workspaces.getMembers` | 33 | — | 2 | 86 |


## Infra

| # | Label | URL | tRPC | oRPC | Firestore (ops) | i18n prefix | posthog | reach |
|---|---|---|---|---|---|---|---|---|
| orphan::env::MODE | **env: MODE** | `—` | — | — | 0 | — | 0 | 0 |
| orphan::env::PROD | **env: PROD** | `—` | — | — | 0 | — | 0 | 0 |
| orphan::env::VITE_POSTHOG_HOST | **env: VITE_POSTHOG_HOST** | `—` | — | — | 0 | — | 0 | 0 |
| orphan::env::VITE_POSTHOG_KEY | **env: VITE_POSTHOG_KEY** | `—` | — | — | 0 | — | 0 | 0 |


## Proof index (sample citations per row)

For full proof trail see `capability_matrix.json`.


### __root
- route: `src/routes/__root.tsx`

### ProtectedIndex
- route: `src/routes/_protected/index.tsx`

### ProtectedRoute
- route: `src/routes/_protected/route.tsx`

### w / add-pending-activity — Detail
- route: `src/routes/_protected/w.$workspaceId/add-pending-activity.$id.tsx`
  - tRPC `pendingContact.getPendingActivity` at `src/routes/_protected/w.$workspaceId/add-pending-activity.$id.split-component.tsx:53`
  - tRPC `pendingContact.addPendingActivity` at `src/routes/_protected/w.$workspaceId/add-pending-activity.$id.split-component.tsx:59`
  - tRPC `pendingContact.getPendingActivity` at `src/routes/_protected/w.$workspaceId/add-pending-activity.$id.tsx:53`

### w / tools / group-parser
- route: `src/routes/_protected/w.$workspaceId/tools/group-parser.tsx`
  - tRPC `outreach.tools.createGroupParseRequest` at `src/routes/_protected/w.$workspaceId/tools/group-parser.split-component.tsx:36`
  - tRPC `outreach.tools.createGroupParseRequest` at `src/routes/_protected/w.$workspaceId/tools/group-parser.tsx:36`

### w / tools / lookalike-audience
- route: `src/routes/_protected/w.$workspaceId/tools/lookalike-audience.tsx`
  - tRPC `outreach.tools.lookalikeAudienceRequest` at `src/routes/_protected/w.$workspaceId/tools/lookalike-audience.split-component.tsx:53`
  - tRPC `outreach.tools.lookalikeAudienceRequest` at `src/routes/_protected/w.$workspaceId/tools/lookalike-audience.tsx:53`

### w / tools / phone-numbers-converter
- route: `src/routes/_protected/w.$workspaceId/tools/phone-numbers-converter.tsx`
  - tRPC `outreach.tools.convertPhoneNumbersRequest` at `src/routes/_protected/w.$workspaceId/tools/phone-numbers-converter.split-component.tsx:36`
  - tRPC `outreach.tools.convertPhoneNumbersRequest` at `src/routes/_protected/w.$workspaceId/tools/phone-numbers-converter.tsx:36`

### accept-invite — Detail
- route: `src/routes/_protected/accept-invite.$workspaceId.$inviteCode.tsx`
  - tRPC `workspace.getWorkspaceInvite` at `src/routes/_protected/accept-invite.$workspaceId.$inviteCode.split-component.tsx:29`
  - tRPC `workspace.acceptWorkspaceInvite` at `src/routes/_protected/accept-invite.$workspaceId.$inviteCode.split-component.tsx:35`
  - tRPC `workspace.getWorkspaceInvite` at `src/routes/_protected/accept-invite.$workspaceId.$inviteCode.tsx:29`

### w — Detail
- route: `src/routes/_protected/w.$workspaceId/index.tsx`

### w — Detail
- route: `src/routes/_protected/w.$workspaceId/route.tsx`

_… (first 10 rows shown; all 70 are in the JSON)_