import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";

import { Button } from "./ui/button";

export function NotFoundComponent() {
  const canGoBack = useCanGoBack();
  const router = useRouter();
  return (
    <div className="flex h-[80vh] w-full select-none flex-col items-center justify-center p-8">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-primary animate-bounce text-6xl font-extrabold">
          404
        </h1>
        <div className="flex flex-col items-center gap-2">
          <p className="text-balance text-center text-xl">
            Well, this is awkward…
          </p>
          <p className="text-muted-foreground max-w-prose text-balance text-center">
            The page you’re looking for doesn’t exist.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link to="/">Go home</Link>
          </Button>
          {canGoBack && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.history.back()}
            >
              Go back
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
