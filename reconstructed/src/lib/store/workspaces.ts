import { QuerySnapshot, Unsubscribe } from "firebase/firestore";
import { objectify } from "radashi";
import { create } from "zustand";

import {
  ActivityWithId,
  ContactWithId,
  DialogWithId,
  OrganizationWithId,
  OutreachListWithId,
  OutreachSequenceWithId,
  TaskActivityWithId,
  TelegramAccountWithId,
  WithId,
  WorkspaceWithId,
} from "@repo/core/types";

import { subscribeToActivities } from "../db/activites";
import { subscribeToContacts } from "../db/contacts";
import { subscribeToOrganizations } from "../db/organizations";
import {
  subscribeToOutreachLists,
  subscribeToOutreachSequences,
} from "../db/outreach";
import {
  subscribeToTelegramAccounts,
  subscribeToUnreadDialogs,
} from "../db/telegram";
import { subscribeToUserWorkspaces } from "../db/workspaces";
import { measureSnapshot } from "../firebase";

export type WorkspaceState = {
  contacts: ContactWithId[];
  contactsById: Record<string, ContactWithId>;
  contactsLoading: boolean;

  activities: ActivityWithId[];
  activitiesById: Record<string, ActivityWithId>;
  activitiesByContactId: Record<string, ActivityWithId[]>;
  nextStepByContactId: Record<string, TaskActivityWithId>;
  activitiesLoading: boolean;

  telegramAccounts: TelegramAccountWithId[];
  telegramAccountsById: Record<string, TelegramAccountWithId>;
  telegramAccountsLoading: boolean;

  outreachLists: OutreachListWithId[];
  outreachListsById: Record<string, OutreachListWithId>;
  outreachListsLoading: boolean;

  outreachSequences: OutreachSequenceWithId[];
  outreachSequencesById: Record<string, OutreachSequenceWithId>;
  outreachSequencesLoading: boolean;

  unreadDialogs: DialogWithId[];
  unreadDialogsByPeerId: Record<number, DialogWithId[]>;
  unreadDialogsByNormalizedUsername: Record<string, DialogWithId[]>;
  unreadDialogsLoading: boolean;
};

export type WorkspacesState = {
  organizations: OrganizationWithId[];
  organizationsById: Record<string, OrganizationWithId>;
  organizationsLoading: boolean;

  workspaces: WorkspaceWithId[];
  workspacesById: Record<string, WorkspaceWithId>;
  workspacesByOrganizationId: Record<string, WorkspaceWithId[]>;
  workspacesLoading: boolean;

  activeWorkspaceId: string;
  subscriptionsEnabled: boolean;

  workspaceData: {
    [key: string]: WorkspaceState;
  };
};

export type Actions = {
  reset: () => void;

  setActiveWorkspaceId: (id: string) => void;
  setSubscriptionsEnabled: (enable: boolean) => void;

  subscribeToOrganizations: (ids: string[]) => Unsubscribe;
  subscribeToUserWorkspaces: (userId: string) => Unsubscribe;
  subscribeToWorkspaceData: (workspaceId: string) => Unsubscribe;

  _subscribeToContacts: (workspaceId: string) => Unsubscribe;
  _subscribeToActivities: (workspaceId: string) => Unsubscribe;
  _subscribeToTelegramAccounts: (workspaceId: string) => Unsubscribe;
  _subscribeToOutreachLists: (workspaceId: string) => Unsubscribe;
  _subscribeToOutreachSequences: (workspaceId: string) => Unsubscribe;
  _subscribeToUnreadDialogs: (workspaceId: string) => Unsubscribe;
};

export const useWorkspacesStore = create<WorkspacesState & Actions>()(
  (set, get, storeApi) => ({
    organizations: [],
    organizationsById: {},
    organizationsLoading: true,

    workspaces: [],
    workspacesById: {},
    workspacesByOrganizationId: {},
    workspacesLoading: true,

    activeWorkspaceId: "",
    subscriptionsEnabled: true,
    workspaceData: {},

    reset: () => {
      set(storeApi.getInitialState());
    },

    setActiveWorkspaceId: (id: string) => {
      set({ activeWorkspaceId: id });
    },

    setSubscriptionsEnabled: (enable: boolean) => {
      set({ subscriptionsEnabled: enable });
    },

    subscribeToOrganizations: (ids: string[]) => {
      if (ids.length === 0) {
        set({
          organizations: [],
          organizationsById: {},
          organizationsLoading: false,
        });
        return () => {};
      }

      return measureSnapshot("Fetching list of organizations", (span) =>
        subscribeToOrganizations(ids, (snapshot) => {
          const organizations = processQuerySnapshot(
            snapshot,
            get().organizations
          );
          const organizationsById = objectify(organizations, (o) => o.id);

          set({
            organizations,
            organizationsById,
            organizationsLoading: false,
          });

          span.end();
        })
      );
    },

    subscribeToUserWorkspaces: (userId: string) => {
      return measureSnapshot("Fetching list of workspaces", (span) =>
        subscribeToUserWorkspaces(userId, (snapshot) => {
          const updatedWorkspaces = processQuerySnapshot(
            snapshot,
            get().workspaces
          );

          const byId: Record<string, WorkspaceWithId> = {};
          const byOrganizationId: Record<string, WorkspaceWithId[]> = {};
          for (const workspace of updatedWorkspaces) {
            byId[workspace.id] = workspace;

            const organizationId = workspace.organizationId;
            byOrganizationId[organizationId] ??= [];
            byOrganizationId[organizationId]!.push(workspace);
          }

          for (const workspace of updatedWorkspaces) {
            // initialize workspace data
            updateWorkspaceData(workspace.id, {});
          }

          set({
            workspaces: updatedWorkspaces,
            workspacesById: byId,
            workspacesByOrganizationId: byOrganizationId,
            workspacesLoading: false,
          });

          span.end();
        })
      );
    },

    subscribeToWorkspaceData: (workspaceId: string) => {
      if (!workspaceId) {
        return () => {};
      }

      const unsubscribeContacts = get()._subscribeToContacts(workspaceId);
      const unsubscribeActivities = get()._subscribeToActivities(workspaceId);
      const unsubscribeTelegramAccounts =
        get()._subscribeToTelegramAccounts(workspaceId);
      const unsubscribeOutreachLists =
        get()._subscribeToOutreachLists(workspaceId);
      const unsubscribeOutreachSequences =
        get()._subscribeToOutreachSequences(workspaceId);
      const unsubscribeUnreadDialogs =
        get()._subscribeToUnreadDialogs(workspaceId);

      return () => {
        unsubscribeContacts();
        unsubscribeActivities();
        unsubscribeTelegramAccounts();
        unsubscribeOutreachLists();
        unsubscribeOutreachSequences();
        unsubscribeUnreadDialogs();
      };
    },

    _subscribeToContacts: (workspaceId: string) => {
      return measureSnapshot("Fetching contacts", (span) =>
        subscribeToContacts(workspaceId, (snapshot) => {
          const contacts = processQuerySnapshot(
            snapshot,
            get().workspaceData[workspaceId]?.contacts ?? [],
            { descending: true }
          );
          const contactsById = objectify(contacts, (c) => c.id);

          updateWorkspaceData(workspaceId, {
            contacts,
            contactsById,
            contactsLoading: false,
          });

          span.end();
        })
      );
    },

    _subscribeToActivities: (workspaceId: string) => {
      return measureSnapshot("Fetching activities", (span) =>
        subscribeToActivities(workspaceId, (snapshot) => {
          const activities = processQuerySnapshot(
            snapshot,
            get().workspaceData[workspaceId]?.activities ?? [],
            { descending: true }
          );

          const activitiesById: Record<string, ActivityWithId> = {};
          const activitiesByContactId: Record<string, ActivityWithId[]> = {};
          const nextStepByContactId: Record<string, TaskActivityWithId> = {};
          for (const activity of activities) {
            activitiesById[activity.id] = activity;

            activitiesByContactId[activity.contactId] ??= [];
            activitiesByContactId[activity.contactId]!.push(activity);

            if (
              activity.type === "task" &&
              !activity.task.completedAt &&
              (!nextStepByContactId[activity.contactId] ||
                activity.task.dueDate <
                  nextStepByContactId[activity.contactId]!.task.dueDate)
            ) {
              nextStepByContactId[activity.contactId] = activity;
            }
          }

          updateWorkspaceData(workspaceId, {
            activities,
            activitiesById,
            activitiesByContactId,
            nextStepByContactId,
            activitiesLoading: false,
          });

          span.end();
        })
      );
    },

    _subscribeToTelegramAccounts: (workspaceId: string) => {
      return measureSnapshot("Fetching telegram accounts", (span) =>
        subscribeToTelegramAccounts(workspaceId, (snapshot) => {
          const telegramAccounts = processQuerySnapshot(
            snapshot,
            get().workspaceData[workspaceId]?.telegramAccounts ?? []
          );
          const telegramAccountsById = objectify(telegramAccounts, (a) => a.id);

          updateWorkspaceData(workspaceId, {
            telegramAccounts,
            telegramAccountsById,
            telegramAccountsLoading: false,
          });

          span.end();
        })
      );
    },

    _subscribeToOutreachLists: (workspaceId: string) => {
      return measureSnapshot("Fetching outreach lists", (span) =>
        subscribeToOutreachLists(workspaceId, (snapshot) => {
          const outreachLists = processQuerySnapshot(
            snapshot,
            get().workspaceData[workspaceId]?.outreachLists ?? [],
            { descending: true }
          );
          const outreachListsById = objectify(outreachLists, (l) => l.id);

          updateWorkspaceData(workspaceId, {
            outreachLists,
            outreachListsById,
            outreachListsLoading: false,
          });

          span.end();
        })
      );
    },

    _subscribeToOutreachSequences: (workspaceId: string) => {
      return measureSnapshot("Fetching outreach sequences", (span) =>
        subscribeToOutreachSequences(workspaceId, (snapshot) => {
          const outreachSequences = processQuerySnapshot(
            snapshot,
            get().workspaceData[workspaceId]?.outreachSequences ?? [],
            { descending: true }
          );
          const outreachSequencesById = objectify(
            outreachSequences,
            (s) => s.id
          );

          updateWorkspaceData(workspaceId, {
            outreachSequences,
            outreachSequencesById,
            outreachSequencesLoading: false,
          });

          span.end();
        })
      );
    },

    _subscribeToUnreadDialogs: (workspaceId: string) => {
      return measureSnapshot("Fetching unread dialogs", (span) =>
        subscribeToUnreadDialogs(workspaceId, (snapshot) => {
          const unreadDialogs = processQuerySnapshot(
            snapshot,
            get().workspaceData[workspaceId]?.unreadDialogs ?? []
          );
          const unreadDialogsByPeerId: Record<number, DialogWithId[]> = {};
          const unreadDialogsByNormalizedUsername: Record<
            string,
            DialogWithId[]
          > = {};
          for (const dialog of unreadDialogs) {
            unreadDialogsByPeerId[dialog.peerId] ??= [];
            unreadDialogsByPeerId[dialog.peerId]!.push(dialog);

            for (const username of dialog.usernamesNormalized) {
              unreadDialogsByNormalizedUsername[username] ??= [];
              unreadDialogsByNormalizedUsername[username]!.push(dialog);
            }
          }

          updateWorkspaceData(workspaceId, {
            unreadDialogs,
            unreadDialogsByPeerId,
            unreadDialogsByNormalizedUsername,
            unreadDialogsLoading: false,
          });

          span.end();
        })
      );
    },
  })
);

function updateWorkspaceData(
  workspaceId: string,
  data: Partial<WorkspaceState>
) {
  const state = useWorkspacesStore.getState();
  let workspaceData: WorkspaceState | undefined =
    state.workspaceData[workspaceId];

  if (Object.keys(workspaceData ?? {}).length === 0) {
    workspaceData = {
      contacts: [],
      contactsById: {},
      contactsLoading: true,

      activities: [],
      activitiesById: {},
      activitiesByContactId: {},
      nextStepByContactId: {},
      activitiesLoading: true,

      telegramAccounts: [],
      telegramAccountsById: {},
      telegramAccountsLoading: true,

      outreachLists: [],
      outreachListsById: {},
      outreachListsLoading: true,

      outreachSequences: [],
      outreachSequencesById: {},
      outreachSequencesLoading: true,

      unreadDialogs: [],
      unreadDialogsByPeerId: {},
      unreadDialogsByNormalizedUsername: {},
      unreadDialogsLoading: true,
    };
  }

  useWorkspacesStore.setState({
    workspaceData: {
      ...state.workspaceData,
      [workspaceId]: {
        ...workspaceData!,
        ...data,
      },
    },
  });
}

function processQuerySnapshot<T>(
  snapshot: QuerySnapshot<T>,
  currentState: WithId<T>[],
  opts: { descending?: boolean } = {}
): WithId<T>[] {
  const nextState = opts.descending
    ? currentState.toReversed()
    : [...currentState];

  const indexMap = new Map(nextState.map((item, index) => [item.id, index]));
  for (const change of snapshot.docChanges()) {
    const item = {
      ...change.doc.data({ serverTimestamps: "estimate" }),
      id: change.doc.id,
    } as WithId<T>;

    switch (change.type) {
      case "added":
        if (!indexMap.has(item.id)) {
          nextState.push(item);
          indexMap.set(item.id, nextState.length - 1);
        }
        break;
      case "modified": {
        const index = indexMap.get(item.id);
        if (index !== undefined) {
          nextState[index] = item;
        }
        break;
      }
      case "removed": {
        const index = indexMap.get(item.id);
        if (index !== undefined) {
          nextState.splice(index, 1);
          indexMap.delete(item.id);
          for (const [id, idx] of indexMap.entries()) {
            if (idx > index) {
              indexMap.set(id, idx - 1);
            }
          }
        }
        break;
      }
    }
  }

  return opts.descending ? nextState.toReversed() : nextState;
}
