import { max } from "date-fns";
import { get, isEqual } from "radashi";
import { createSelector } from "reselect";

import {
  Color,
  ContactWithId,
  TaskActivityWithId,
  View,
} from "@repo/core/types";
import {
  doesObjectSatisfyFilters,
  normalizeTelegramUsername,
} from "@repo/core/utils";

import { getUnreadCount } from "../contact";
import { WorkspaceState, WorkspacesState } from "./workspaces";

const createWorkspaceSelector = createSelector.withTypes<WorkspaceState>();
const createStoreSelector = createSelector.withTypes<WorkspacesState>();

const EMPTY_ARRAY: [] = [];

export type EnrichedContact = {
  contact: ContactWithId;
  nextStep: TaskActivityWithId | undefined;
  unreadCount: number;
  lastMessageDate: Date | undefined;
};
const sortFn: Record<
  View["sort"],
  (a: EnrichedContact, b: EnrichedContact) => number
> = {
  default: (a, b) => {
    // First, contacts with unread messages come first
    const aHasUnread = a.unreadCount > 0;
    const bHasUnread = b.unreadCount > 0;
    if (aHasUnread !== bHasUnread) {
      return Number(bHasUnread) - Number(aHasUnread);
    }
    // If both have unread messages, sort by lastMessageDate (newest first)
    if (aHasUnread && bHasUnread) {
      if (a.lastMessageDate && b.lastMessageDate) {
        return b.lastMessageDate.getTime() - a.lastMessageDate.getTime();
      }
      if (a.lastMessageDate) return -1;
      if (b.lastMessageDate) return 1;
    }
    return sortFn.dueDate(a, b);
  },
  dueDate: (a, b) => {
    if (!a.nextStep && !b.nextStep) return 0;
    if (!a.nextStep) return 1;
    if (!b.nextStep) return -1;
    return a.nextStep.task.dueDate.seconds - b.nextStep.task.dueDate.seconds;
  },
  fullName: (a, b) =>
    a.contact.fullName.localeCompare(b.contact.fullName, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  createdAt: (a, b) =>
    b.contact.createdAt.seconds - a.contact.createdAt.seconds,
};

export const selectEnrichedContacts = createWorkspaceSelector(
  [
    (state) => state.contacts,
    (state) => state.nextStepByContactId,
    (state) => state.unreadDialogsByPeerId,
    (state) => state.unreadDialogsByNormalizedUsername,
    (state) => state.telegramAccountsById,
    (
      _,
      options: Pick<View, "q" | "filters" | "sort"> & {
        contactType?: "contact" | "group";
        withTelegramId?: boolean;
        withTelegramUsername?: boolean;
        useNewUnread?: boolean;
      }
    ) => options,
  ],
  (
    contacts,
    nextStepByContactId,
    unreadDialogsByPeerId,
    unreadDialogsByNormalizedUsername,
    telegramAccountsById,
    options
  ) => {
    const existingAccountIds = new Set(Object.keys(telegramAccountsById));
    const searchQuery = options.q?.toLowerCase();
    const filters = Object.entries(options.filters);
    const list = contacts.filter((contact) => {
      if (searchQuery) {
        const hasSubstring =
          contact.fullName.toLowerCase().includes(searchQuery) ||
          contact.description?.toLowerCase().includes(searchQuery) ||
          (contact.telegram?.username &&
            `@${contact.telegram.username.toLowerCase()}`.includes(
              searchQuery
            ));
        if (!hasSubstring) {
          return false;
        }
      }

      if (filters && !doesObjectSatisfyFilters(contact, options.filters)) {
        return false;
      }

      if (
        options.contactType &&
        options.contactType !== (contact.type ?? "contact")
      ) {
        return false;
      }

      if (options.withTelegramId && !contact.telegram?.id) {
        return false;
      }

      if (options.withTelegramUsername && !contact.telegram?.username) {
        return false;
      }

      return true;
    });

    const sortByDefaultLegacy = (a: EnrichedContact, b: EnrichedContact) => {
      const aUnread = getUnreadCount(a.contact, existingAccountIds);
      const bUnread = getUnreadCount(b.contact, existingAccountIds);
      if (aUnread !== bUnread) {
        return bUnread - aUnread;
      }
      return sortFn.dueDate(a, b);
    };

    const sort =
      options.sort === "default"
        ? options.useNewUnread
          ? sortFn.default
          : sortByDefaultLegacy
        : sortFn[options.sort];

    return (
      list
        .map((contact): EnrichedContact => {
          const dialogsToCheck = contact.telegram?.id
            ? (unreadDialogsByPeerId[contact.telegram.id] ?? [])
            : contact.telegram?.usernameNormalized
              ? (unreadDialogsByNormalizedUsername[
                  contact.telegram.usernameNormalized
                ] ?? [])
              : [];

          let unreadCount: number = 0;
          let lastMessageDate: Date | undefined = undefined;
          for (const dialog of dialogsToCheck) {
            unreadCount += dialog.unreadCount;

            if (dialog.lastMessageDate) {
              lastMessageDate = lastMessageDate
                ? max([lastMessageDate, dialog.lastMessageDate.toDate()])
                : dialog.lastMessageDate.toDate();
            }
          }

          return {
            contact,
            nextStep: nextStepByContactId[contact.id],
            unreadCount,
            lastMessageDate,
          };
        })
        // eslint-disable-next-line unicorn/no-array-sort
        .sort(sort)
    );
  }
);

export const selectContactById = (state: WorkspaceState, id: string) =>
  state.contactsById[id];

export const selectContactActivities = (state: WorkspaceState, id: string) =>
  state.activitiesByContactId[id] ?? [];

export const selectActivityById = (state: WorkspaceState, id: string) =>
  state.activitiesById[id];

export const selectUnreadDialogsForContact = createWorkspaceSelector(
  [
    (state, contactId?: string) => state.contactsById[contactId ?? ""],
    (state) => state.unreadDialogsByPeerId,
    (state) => state.unreadDialogsByNormalizedUsername,
  ],
  (contact, unreadDialogsByPeerId, unreadDialogsByNormalizedUsername) =>
    contact?.telegram?.id
      ? (unreadDialogsByPeerId[contact.telegram.id] ?? [])
      : contact?.telegram?.usernameNormalized
        ? (unreadDialogsByNormalizedUsername[
            contact.telegram.usernameNormalized
          ] ?? [])
        : []
);

export const selectContactUnreadCount = createWorkspaceSelector(
  [
    (state, contactId: string) => state.contactsById[contactId],
    (_state, _contactId: string, accountId?: string) => accountId,
    (state) => state.unreadDialogsByPeerId,
    (state) => state.unreadDialogsByNormalizedUsername,
  ],
  (
    contact,
    accountId,
    unreadDialogsByPeerId,
    unreadDialogsByNormalizedUsername
  ): number => {
    if (!contact) return 0;

    const dialogsToCheck = contact.telegram?.id
      ? (unreadDialogsByPeerId[contact.telegram.id] ?? [])
      : contact.telegram?.usernameNormalized
        ? (unreadDialogsByNormalizedUsername[
            contact.telegram.usernameNormalized
          ] ?? [])
        : [];

    let sum = 0;
    for (const dialog of dialogsToCheck) {
      if (accountId && dialog.accountId !== accountId) continue;
      sum += dialog.unreadCount;
    }
    return sum;
  }
);

type CadenceActivity = TaskActivityWithId & {
  task: { recurrence: { type: "cadence"; rule: string } };
};
export const selectContactCadence = createWorkspaceSelector(
  [(state, contactId: string) => state.activitiesByContactId[contactId]],
  (activities) =>
    activities?.find(
      (activity): activity is CadenceActivity =>
        activity.type === "task" &&
        activity.task.recurrence?.type === "cadence" &&
        !!activity.task.recurrence?.rule
    ) ?? null
);

export const selectContactByTelegramIdOrUsername = (
  state: WorkspaceState,
  telegramId?: string | number,
  telegramUsername?: string
) => {
  const normalizedUsername = telegramUsername
    ? normalizeTelegramUsername(telegramUsername)
    : undefined;
  return state.contacts.find(
    (contact) =>
      (telegramId &&
        contact.telegram?.id?.toString() === telegramId.toString()) ||
      (normalizedUsername &&
        contact.telegram?.usernameNormalized === normalizedUsername)
  );
};

type DP = {
  name: string;
  type?: "amount";
  values: Array<{
    text: string;
    color?: Color;
  }>;
};
type DPResult = {
  byTelegramId: Record<string, DP[]>;
  byTelegramUsername: Record<string, DP[]>;
};
export const selectDisplayedPropertiesOfTelegramContacts = createStoreSelector(
  [
    (state, workspaceId: string) =>
      state.workspacesById[workspaceId]?.properties?.contacts ?? EMPTY_ARRAY,
    (state, workspaceId: string) =>
      state.workspaceData[workspaceId]?.contacts ?? EMPTY_ARRAY,
  ],
  (properties, contacts): DPResult => {
    const displayedProperties = properties.filter(
      (p) => "displayedInList" in p && p.displayedInList
    );
    const result: {
      byTelegramId: Record<string, DP[]>;
      byTelegramUsername: Record<string, DP[]>;
    } = {
      byTelegramId: {},
      byTelegramUsername: {},
    };
    for (const contact of contacts) {
      const dp: DP[] = [];

      if (contact.telegram?.id || contact.telegram?.username) {
        for (const property of displayedProperties) {
          const value = get(contact, property.key);

          switch (property.type) {
            case "amount": {
              if (value) {
                dp.push({
                  name: property.name,
                  type: "amount",
                  values: [
                    {
                      text: new Intl.NumberFormat(navigator.language).format(
                        value as number
                      ),
                    },
                  ],
                });
              }
              break;
            }
            case "single-select": {
              const option = property.options.find((o) => o.value === value);
              if (option) {
                dp.push({
                  name: property.name,
                  values: [{ text: option.label, color: option.color }],
                });
              }
              break;
            }
            case "multi-select": {
              const options = property.options.filter((o) =>
                (value as string[] | undefined)?.includes(o.value)
              );
              if (options.length > 0) {
                dp.push({
                  name: property.name,
                  values: options.map((o) => ({
                    text: o.label,
                    color: o.color,
                  })),
                });
              }
              break;
            }
          }
        }

        if (dp.length > 0) {
          if (contact.telegram?.id) {
            result.byTelegramId[contact.telegram.id] = dp;
          }
          if (contact.telegram?.username) {
            result.byTelegramUsername[contact.telegram.username.toLowerCase()] =
              dp;
          }
        }
      }
    }

    const lastResult = selectDisplayedPropertiesOfTelegramContacts.lastResult();
    if (isEqual(result, lastResult)) {
      return lastResult;
    }

    return result;
  }
);
