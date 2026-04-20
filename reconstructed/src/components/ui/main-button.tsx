import { useIsPresent } from "motion/react";
import { memo, useEffect } from "react";

import { Button, ButtonProps } from "./button";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useHiddenMainButton } from "@/hooks/useHiddenMainButton";
import { webApp } from "@/lib/telegram";
import { cn } from "@/lib/utils";

function TgButton({
  buttonType = "main",
  position = "bottom",
  onClick,
  children,
  disabled,
  loading,
  color,
  textColor,
  className,
  ...props
}: {
  buttonType?: "main" | "secondary";
  position?: "bottom" | "top" | "left" | "right";
  onClick: (e?: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  color?: `#${string}`;
  textColor?: `#${string}`;
  children: string;
  loading?: boolean;
} & ButtonProps) {
  const isPresent = useIsPresent();
  const isDesktop = useBreakpoint("md");

  const button =
    buttonType === "main" ? webApp?.MainButton : webApp?.SecondaryButton;

  const enabled = isPresent && !isDesktop;

  useEffect(() => {
    if (!enabled) return;

    button?.show();
    return () => {
      button?.hide();
    };
  }, [enabled, button]);

  useEffect(() => {
    if (!enabled) return;

    const onClickHandler = async () => {
      if (loading) return;
      await onClick();
    };

    button?.onClick(onClickHandler);
    return () => {
      button?.offClick(onClickHandler);
    };
  }, [onClick, button, enabled, loading]);

  useEffect(() => {
    if (!enabled) return;

    try {
      button?.setText(children);
    } catch (e) {
      console.warn(e);
      button?.setText("Continue");
    }
  }, [children, button, enabled]);

  useEffect(() => {
    if (!enabled) return;

    if (loading) {
      button?.showProgress();
    } else {
      button?.hideProgress();
    }
  }, [enabled, button, loading]);

  useEffect(() => {
    if (!enabled) return;

    if (disabled || loading) {
      button?.disable();
    } else {
      button?.enable();
    }
  }, [enabled, button, disabled, loading]);

  useEffect(() => {
    if (!enabled) return;

    const originalColor = button?.color;
    const originalTextColor = button?.textColor;
    const originalPosition = button?.position;

    button?.setParams({
      color,
      text_color: textColor,
      position,
    });
    return () => {
      button?.setParams({
        color: originalColor,
        text_color: originalTextColor,
        position: originalPosition,
      });
    };
  }, [enabled, button, color, textColor, position]);

  if (webApp && !isDesktop) {
    return null;
  }

  return (
    <Button
      onClick={onClick}
      {...props}
      variant={buttonType === "main" ? "default" : "secondary"}
      disabled={disabled || loading}
      style={{ backgroundColor: color, color: textColor }}
      className={cn(
        { "transition-opacity hover:opacity-80": color || textColor },
        className
      )}
    >
      {children}
    </Button>
  );
}

export const MainButton = memo(TgButton);
export const SecondaryButton = memo(TgButton);

export function HideMainButton() {
  useHiddenMainButton();
  return null;
}
