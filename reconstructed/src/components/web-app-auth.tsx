import { signInWithCustomToken } from "firebase/auth";
import { customAlphabet } from "nanoid";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";

import crmchatUi from "@/assets/crmchat-ui.avif";
import logo from "@/assets/crmchat.jpeg";
import metaball from "@/assets/metaball.mp4";
import telegramLogo from "@/assets/telegram-logo.svg";
import { Button } from "@/components/ui/button";
import {
  createWebAuthSession,
  invalidateWebAuthSession,
  subscribeToAuthSession,
} from "@/lib/db/auth";
import { auth } from "@/lib/firebase";
import { AnimatedGroup, AnimatedGroupProps, TextEffect } from "@/lib/motion";

const transitionVariants: AnimatedGroupProps["variants"] = {
  item: {
    hidden: {
      opacity: 0,
      filter: "blur(12px)",
      y: 12,
    },
    visible: {
      opacity: 1,
      filter: "blur(0px)",
      y: 0,
      transition: {
        type: "spring",
        bounce: 0.3,
        duration: 1.5,
      },
    },
  },
};

const generateSessionId = customAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  42
);

function useWebAuth() {
  const posthog = usePostHog();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isValid, setIsValid] = useState(true);

  useEffect(() => {
    const sessionId = generateSessionId();
    setSessionId(sessionId);

    const invalidate = () =>
      invalidateWebAuthSession(sessionId).catch((err) =>
        console.warn("Failed to invalidate auth session", err)
      );
    const unsubscribe = subscribeToAuthSession(sessionId, async (snapshot) => {
      const session = snapshot.data();
      if (session?.token) {
        await signInWithCustomToken(auth, session.token);
        posthog.capture("web_auth_completed");
        invalidate();
      }

      setIsValid(
        !!session?.expiresAt && session.expiresAt.toDate() >= new Date()
      );
    });

    createWebAuthSession(sessionId, posthog.get_distinct_id());

    window.addEventListener("beforeunload", invalidate);
    return () => {
      unsubscribe();
      invalidate();
      window.removeEventListener("beforeunload", invalidate);
    };
  }, [posthog]);

  return {
    isReady: !!sessionId,
    isValid: !!sessionId && isValid,
    startAuth: () => {
      posthog.capture("web_auth_started");
      const url = `tg://resolve?domain=${import.meta.env.VITE_BOT_USERNAME}&start=a_${sessionId ?? ""}`;
      window.open(url, "_blank");
    },
  };
}

function AuthButton() {
  const { isReady, isValid, startAuth } = useWebAuth();
  return (
    <div>
      <Button
        size="lg"
        disabled={!isReady || !isValid}
        onClick={startAuth}
        className="rounded-xl bg-white px-5 text-base transition-colors duration-300 ease-in-out hover:bg-white/70"
      >
        <span className="flex items-center gap-3 text-nowrap">
          {isValid ? (
            <>
              <img src={telegramLogo} alt="Telegram" className="size-5" />
              Login with Telegram
            </>
          ) : (
            "Failed to authenticate"
          )}
        </span>
      </Button>
      {!isValid && (
        <p className="mt-1 text-center text-xs opacity-80">
          Refresh the page to try again
        </p>
      )}
    </div>
  );
}

export default function WebAppAuth() {
  return (
    <div className="dark">
      <main className="text-foreground bg-background overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 isolate hidden contain-strict lg:block"
        >
          <div className="w-140 h-320 -translate-y-87.5 absolute left-0 top-0 -rotate-45 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,hsla(0,0%,85%,.08)_0,hsla(0,0%,55%,.02)_50%,hsla(0,0%,45%,0)_80%)]" />
          <div className="h-320 absolute left-0 top-0 w-60 -rotate-45 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.06)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)] [translate:5%_-50%]" />
          <div className="h-320 -translate-y-87.5 absolute left-0 top-0 w-60 -rotate-45 bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.04)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)]" />
        </div>
        <video
          src={metaball}
          autoPlay
          muted
          loop
          className="absolute inset-0 h-full w-full object-cover"
        />
        <section>
          <div className="relative pt-24">
            <div className="absolute inset-0 size-full [background:radial-gradient(125%_125%_at_50%_100%,transparent_0%,var(--color-background)_75%)]"></div>
            <div className="mx-auto max-w-5xl px-6">
              <div className="flex items-center gap-2">
                <img
                  src={logo}
                  alt="CRMChat"
                  className="border-border h-10 w-10 rounded-lg border"
                />
                <div className="text-xl font-semibold">CRMChat</div>
              </div>
              <div className="sm:mx-auto lg:mr-auto lg:mt-0">
                <TextEffect
                  preset="fade-in-blur"
                  speedSegment={0.3}
                  as="h1"
                  className="mt-8 max-w-2xl text-5xl font-medium md:text-6xl lg:mt-16"
                >
                  Get your Telegram CRM and Telegram Outreach today
                </TextEffect>
                <TextEffect
                  per="line"
                  preset="fade-in-blur"
                  speedSegment={0.3}
                  delay={0.5}
                  as="p"
                  className="text-muted-foreground mt-8 max-w-2xl text-pretty text-lg"
                >
                  CRM & Outreach app for Telegram—parse leads, send automated
                  messages, and manage deals with your team
                </TextEffect>

                <AnimatedGroup
                  variants={{
                    container: {
                      visible: {
                        transition: {
                          staggerChildren: 0.05,
                          delayChildren: 1,
                        },
                      },
                    },
                    ...transitionVariants,
                  }}
                  className="mt-12 flex flex-col items-start gap-2 md:flex-row"
                >
                  <AuthButton key={1} />
                  <Button
                    key={2}
                    asChild
                    size="lg"
                    variant="ghost"
                    className="bg-secondary/60 rounded-xl"
                  >
                    <a href="https://calendly.com/hints/intro">
                      <span className="text-nowrap">Request a demo</span>
                    </a>
                  </Button>
                </AnimatedGroup>
              </div>
            </div>
            <AnimatedGroup
              variants={{
                container: {
                  visible: {
                    transition: {
                      staggerChildren: 0.05,
                      delayChildren: 0.75,
                    },
                  },
                },
                ...transitionVariants,
              }}
            >
              <div className="relative -mr-56 mt-4 overflow-hidden px-2 sm:mr-0 sm:mt-12 md:mt-20">
                <div
                  aria-hidden
                  className="bg-linear-to-b to-background absolute inset-0 z-10 from-transparent from-35%"
                />
                <div className="inset-shadow-2xs ring-background dark:inset-shadow-white/20 bg-background relative mx-auto max-w-5xl overflow-hidden rounded-[30px] border p-4 shadow-lg shadow-zinc-950/15 ring-1">
                  <img
                    className="bg-background aspect-15/8 relative hidden rounded-2xl dark:block"
                    src={crmchatUi}
                    alt="app screen"
                    width="2700"
                    height="1440"
                  />
                </div>
              </div>
            </AnimatedGroup>
          </div>
        </section>
      </main>
    </div>
  );
}
