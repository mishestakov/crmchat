import { useMutation } from "@tanstack/react-query";

import { Button } from "../ui/button";
import { useTRPC } from "@/lib/trpc";

export function DevSendMessageNow({
  workspaceId,
  messageId,
}: {
  workspaceId: string;
  messageId: string;
}) {
  const trpc = useTRPC();
  const mutation = useMutation(
    trpc.outreach.sendOutreachMessageNow.mutationOptions()
  );
  return (
    <Button
      className="text-destructive px-0"
      variant="link"
      size="xs"
      onClick={() => {
        if (confirm("Are you sure you want to send this message now?")) {
          mutation.mutate({ workspaceId, messageId });
        }
      }}
      disabled={mutation.isPending}
    >
      [dev] send now
    </Button>
  );
}
