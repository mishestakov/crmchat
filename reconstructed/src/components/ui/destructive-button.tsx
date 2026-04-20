import { useEffect, useState } from "react";

import { Button, ButtonProps } from "./button";

export function DestructiveButton({
  disabled,
  enableTimeout = 1500,
  showTimeLeft,
  children,
  ...props
}: ButtonProps & { enableTimeout?: number; showTimeLeft?: boolean }) {
  const [disabledInitially, setDisabledInitially] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(
    Math.ceil(enableTimeout / 1000)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setDisabledInitially(false);
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [enableTimeout]);

  return (
    <Button
      variant="destructive"
      {...props}
      disabled={disabled || disabledInitially}
    >
      {children}
      {disabledInitially && showTimeLeft && ` (${secondsLeft})`}
    </Button>
  );
}
