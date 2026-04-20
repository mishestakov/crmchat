import { addDays } from "date-fns";
import { Timestamp } from "firebase/firestore";
import { TFunction } from "i18next";
import { dedent } from "radashi";

import { createActivity } from "./db/activites";
import { createContact } from "./db/contacts";
import { auth } from "./firebase";

export async function createOnboardingContacts(
  workspaceId: string,
  t: TFunction
) {
  await createSupportContact(workspaceId);
  await createTutorialContact(workspaceId, t);
}

async function createTutorialContact(workspaceId: string, t: TFunction) {
  const contact = await createContact({
    isOnboardingContact: true,
    workspaceId,
    ownerId: auth.currentUser!.uid,
    fullName: "CRMChat 101 Tutorial",
    description: dedent`
      Learn how to start with CRMChat in this short intro course 👇
    `,
    avatarUrl:
      "https://firebasestorage.googleapis.com/v0/b/hints-crm.appspot.com/o/bot-media%2Fcrmchat.png?alt=media&token=2e7010b1-0a23-4363-bf09-4da2ca3ab431",
    url: t("web.help.knowledgeBaseUrl"),
  });

  await createActivity({
    workspaceId,
    contactId: contact.id,
    type: "task",
    task: {
      summary: "Learn how to start with CRMChat",
      content: dedent`
        See how you can find new prospects, send outreach campaigns, and manage Telegram deals with your team
      `,
      dueDate: Timestamp.fromDate(addDays(new Date(), 1)),
      completedAt: null,
      completedBy: null,
      notified: false,
    },
  });

  await createActivity({
    workspaceId,
    contactId: contact.id,
    type: "note",
    note: {
      content: dedent`
        👇 Our short intro course
  
        [CRMChat 101 Tutorial](${t("web.help.knowledgeBaseUrl")})
      `,
    },
  });
}

async function createSupportContact(workspaceId: string) {
  await createContact({
    isOnboardingContact: true,
    workspaceId,
    ownerId: auth.currentUser!.uid,
    fullName: "CRMChat Support",
    description: "Any questions or feedback? We're here to help.",
    avatarUrl:
      "https://firebasestorage.googleapis.com/v0/b/hints-crm.appspot.com/o/bot-media%2FSupportAvatar.jpg?alt=media&token=3e30e1d8-06d8-4e91-81eb-75604a4e7f25",
    url: "https://t.me/HintsSupportBot",
  });
}
