import { Link } from "@tanstack/react-router";

import { ContactAvatar } from "@/components/ui/contact-avatar";
import { useCurrentWorkspace, useWorkspaceStore } from "@/lib/store";
import { selectContactById } from "@/lib/store/selectors";

export function ContactCell({ contactId }: { contactId: string }) {
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const contact = useWorkspaceStore((s) => selectContactById(s, contactId));
  if (!contact) {
    return <span>Unknown</span>;
  }
  return (
    <Link
      to="/w/$workspaceId/contacts/$contactId"
      params={{ workspaceId, contactId }}
      target="_blank"
      className="group/contact inline-flex items-center gap-2"
    >
      <ContactAvatar contact={contact} className="size-4 text-[10px]" />
      <span className="font-medium group-hover/contact:underline">
        {contact.fullName}
      </span>
    </Link>
  );
}
