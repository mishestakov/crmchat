import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TFunction } from "i18next";
import { Loader2, X } from "lucide-react";
import { useIsPresent } from "motion/react";
import { usePostHog } from "posthog-js/react";
import {
  PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { Property, View } from "@repo/core/types";

import { Button } from "@/components/ui/button";
import { MainButton } from "@/components/ui/main-button";
import { useDisabledVerticalSwipe } from "@/hooks/useDisabledVerticalSwipe";
import { useExpandedView } from "@/hooks/useExpandedView";
import { useProperties } from "@/hooks/useProperties";
import { useUser } from "@/hooks/useUser";
import { useViews } from "@/hooks/useViews";
import { updateUser } from "@/lib/db/users";
import { createOnboardingContacts } from "@/lib/onboarding";
import { getDefaultPipelineStages } from "@/lib/properties";
import { useCurrentWorkspace } from "@/lib/store";
import { webApp } from "@/lib/telegram";
import { cn, generateId } from "@/lib/utils";

const stepIdSchema = z.enum([
  "telegramSales",
  "inviteTeam",
  "chat",
  "sequences",
  "multipleAccounts",
  "parseGroups",
  "aiBot",
  "sync",
]);
type StepId = z.infer<typeof stepIdSchema>;
type Step = {
  bg: {
    from: `#${string}`;
    to: `#${string}`;
  };
  component: React.ComponentType<{
    t: TFunction;
    totalSteps: number;
    currentStep: number;
    navigateNext: () => void;
  }>;
  button?: false;
};

const STEPS: Record<StepId, Step> = {
  telegramSales: {
    bg: {
      from: "#7C3AED",
      to: "#6D28D9",
    },
    component: ({ t }) => {
      return (
        <>
          <OnboardingImage
            src={t("web.onboarding.telegramSalesImage")}
            width={1174}
            height={1190}
            alt="CRMchat"
          />
          <OnboardingTitle>{t("web.onboarding.telegramSales")}</OnboardingTitle>
        </>
      );
    },
  },
  chat: {
    bg: {
      from: "#D37107",
      to: "#be6606",
    },
    component: ({ t }) => {
      return (
        <>
          <OnboardingImage
            src={t("web.onboarding.chatImage")}
            width={1258}
            height={982}
            alt="Chat View"
          />
          <OnboardingTitle>{t("web.onboarding.chat")}</OnboardingTitle>
        </>
      );
    },
  },
  parseGroups: {
    bg: {
      from: "#CB6CE6",
      to: "#c14fe1",
    },
    component: ({ t }) => {
      return (
        <>
          <OnboardingImage
            src={t("web.onboarding.parseGroupsImage")}
            width={1274}
            height={1212}
            alt="Parse groups"
          />
          <OnboardingTitle>{t("web.onboarding.parseGroups")}</OnboardingTitle>
        </>
      );
    },
  },
  sequences: {
    bg: {
      from: "#098760",
      to: "#087956",
    },
    component: ({ t }) => {
      return (
        <>
          <OnboardingImage
            src={t("web.onboarding.sequencesImage")}
            width={1060}
            height={1210}
            alt="Sequences"
          />
          <OnboardingTitle>{t("web.onboarding.sequences")}</OnboardingTitle>
        </>
      );
    },
  },
  multipleAccounts: {
    bg: {
      from: "#D37107",
      to: "#be6606",
    },
    component: ({ t }) => {
      return (
        <>
          <OnboardingImage
            src={t("web.onboarding.multipleAccountsImage")}
            width={1138}
            height={1120}
            alt="Multiple accounts"
          />
          <OnboardingTitle>
            {t("web.onboarding.multipleAccounts")}
          </OnboardingTitle>
        </>
      );
    },
  },
  inviteTeam: {
    bg: {
      from: "#5cc82e",
      to: "#53b429",
    },
    component: ({ t }) => {
      return (
        <>
          <OnboardingImage
            src={t("web.onboarding.inviteTeamImage")}
            width={988}
            height={638}
            alt="Invite team"
          />
          <OnboardingTitle>{t("web.onboarding.inviteTeam")}</OnboardingTitle>
        </>
      );
    },
  },
  aiBot: {
    bg: {
      from: "#f79600",
      to: "#de8700",
    },
    component: ({ t }) => {
      return (
        <>
          <OnboardingImage
            src={t("web.onboarding.aiBotImage")}
            width={1178}
            height={724}
            alt="AI"
          />
          <OnboardingTitle>{t("web.onboarding.aiBot")}</OnboardingTitle>
        </>
      );
    },
  },
  sync: {
    bg: {
      from: "#2281CC",
      to: "#1f74b8",
    },
    component: FinishStep,
    button: false,
  },
};

function getDefaultPropertiesConfig(t: TFunction): {
  pipelineKey: string;
  properties: Property[];
} {
  const pipelineKey = `custom.${generateId()}`;
  const pipelineOptions = getDefaultPipelineStages(t);
  const defaultPipelineValue = pipelineOptions[0]?.value ?? undefined;

  return {
    pipelineKey,
    properties: [
      {
        key: "amount",
        name: t("web.contacts.form.amount"),
        placeholder: t("web.contacts.form.amountPlaceholder"),
        required: false,
        type: "amount",
        displayedInList: true,
      },
      {
        key: pipelineKey,
        name: t("web.defaultPipelineProperty.name"),
        type: "single-select",
        required: true,
        customizable: true,
        options: pipelineOptions,
        defaultValue: defaultPipelineValue,
      },
    ],
  };
}

async function initializePipeline({
  t,
  properties,
  updateProperties,
  views,
  updateViews,
}: {
  t: TFunction;
  properties: Property[];
  updateProperties: (props: Property[]) => Promise<void>;
  views: View[];
  updateViews: (views: View[]) => Promise<void>;
}) {
  const alreadyInitialized = views.some(
    (view) => view.type === "pipeline" && !!view.pipelineProperty
  );
  if (alreadyInitialized) {
    console.log("Pipeline already initialized");
    return;
  }

  const defaultPropertiesConfig = getDefaultPropertiesConfig(t);
  await updateProperties([
    ...properties,
    ...defaultPropertiesConfig.properties,
  ]);
  await updateViews(
    views.map((view) =>
      view.id === "pipeline"
        ? {
            ...view,
            pipelineProperty: defaultPropertiesConfig.pipelineKey,
          }
        : view
    )
  );
}

function FinishStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const workspaceId = useCurrentWorkspace((s) => s.id);
  const { isLoading, completeOnboarding } = useCompleteOnboarding();

  return (
    <>
      <OnboardingImage
        src={t("web.onboarding.syncContactsImage")}
        width={936}
        height={926}
        alt="Sync contacts"
      />
      <OnboardingTitle>{t("web.onboarding.syncContacts")}</OnboardingTitle>

      <MainButton
        className="mt-8 w-full"
        color={"#CB6CE6"}
        textColor={"#fff"}
        loading={isLoading}
        onClick={async () => {
          if (isLoading) return;
          await completeOnboarding();

          navigate({
            to: "/w/$workspaceId/contacts",
            params: { workspaceId },
          });
        }}
      >
        {t("web.onboarding.letsGo")}
      </MainButton>
    </>
  );
}

function useCompleteOnboarding() {
  const user = useUser();

  const { t } = useTranslation();
  const [properties, updateProperties] = useProperties("contacts");
  const { views, updateViews } = useViews("contacts");

  const [isLoading, setIsLoading] = useState(false);

  const completeOnboarding = async () => {
    if (!user?.id) return;

    const alreadyCompleted = user.onboarding?.firstContact;
    if (alreadyCompleted) return;

    setIsLoading(true);
    try {
      await updateUser(user.id, {
        "onboarding.firstContact": true,
      });
      await initializePipeline({
        t,
        properties,
        updateProperties,
        views,
        updateViews,
      });
      if (user.workspaces[0]) {
        await createOnboardingContacts(user.workspaces[0], t);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return { isLoading, completeOnboarding };
}

function usePreloadImages() {
  const { t } = useTranslation();

  const imageUrls = useMemo(() => {
    return [
      t("web.onboarding.telegramSalesImage"),
      t("web.onboarding.chatImage"),
      t("web.onboarding.parseGroupsImage"),
      t("web.onboarding.sequencesImage"),
      t("web.onboarding.multipleAccountsImage"),
      t("web.onboarding.inviteTeamImage"),
      t("web.onboarding.aiBotImage"),
      t("web.onboarding.syncContactsImage"),
    ];
  }, [t]);

  useEffect(() => {
    const imageElements = imageUrls.map((url) => {
      const img = new Image();
      img.src = url;
      return img;
    });

    return () => {
      for (const img of imageElements) {
        img.src = ""; // Clear the image source to free up memory
      }
    };
  }, [imageUrls]);
}

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/onboarding/$stepId"
)({
  component: Onboarding,
  params: {
    parse: z.object({
      stepId: stepIdSchema,
    }).parse,
    stringify: (params) => params,
  },
});

function Onboarding() {
  const { t } = useTranslation();
  const posthog = usePostHog();
  usePreloadImages();

  const { stepId } = Route.useParams();
  const step = STEPS[stepId];
  const StepComponent = step.component;

  const totalSteps = Object.keys(STEPS).length;

  const currentStepIndex = Object.keys(STEPS).indexOf(stepId);
  const navigate = Route.useNavigate();
  const navigateNext = useCallback(() => {
    const nextStepId = Object.keys(STEPS)[currentStepIndex + 1] as
      | StepId
      | undefined;
    if (nextStepId) {
      navigate({
        params: { stepId: nextStepId },
      });
    }
  }, [currentStepIndex, navigate]);

  const isPresent = useIsPresent();
  useEffect(() => {
    if (!isPresent) return;

    const originalBackgroundColor = webApp?.backgroundColor;
    // const originalHeaderColor = webApp?.headerColor;
    const originalBottomBarColor = webApp?.bottomBarColor;
    const originalDocumentBackgroundColor = document.body.style.backgroundColor;

    // webApp?.setHeaderColor(step.bg.from);
    webApp?.setBackgroundColor(step.bg.to);
    webApp?.setBottomBarColor(step.bg.to);
    document.body.style.backgroundColor = step.bg.to;

    return () => {
      webApp?.setBackgroundColor(originalBackgroundColor!);
      // webApp?.setHeaderColor(originalHeaderColor!);
      webApp?.setBottomBarColor(originalBottomBarColor!);
      document.body.style.backgroundColor = originalDocumentBackgroundColor!;
    };
  }, [isPresent, step.bg.from, step.bg.to]);

  useExpandedView();
  useDisabledVerticalSwipe();

  useEffect(() => {
    posthog.capture("onboarding_screen_viewed", {
      step_id: stepId,
      step_number: currentStepIndex + 1,
      total_steps: totalSteps,
    });
  }, [posthog, stepId, currentStepIndex, totalSteps]);

  return (
    <OnboardingStep
      style={{
        background: `linear-gradient(to bottom, ${step.bg.from}, ${step.bg.to})`,
      }}
    >
      <OnboardingProgress
        currentStep={currentStepIndex + 1}
        totalSteps={totalSteps}
      />
      <CloseButton
        stepId={stepId}
        currentStepIndex={currentStepIndex}
        totalSteps={totalSteps}
      />
      <StepComponent
        t={t}
        totalSteps={totalSteps}
        currentStep={currentStepIndex + 1}
        navigateNext={navigateNext}
      />
      {step.button !== false && (
        <MainButton
          className="mt-8 w-full"
          color="#ffffff"
          textColor="#000000"
          onClick={navigateNext}
        >
          {t("web.onboarding.next")}
        </MainButton>
      )}
    </OnboardingStep>
  );
}

function OnboardingProgress({
  currentStep,
  totalSteps,
}: {
  currentStep: number;
  totalSteps: number;
}) {
  return (
    <div className="absolute top-4 flex w-full justify-center">
      <div className="flex space-x-2">
        {Array.from({ length: totalSteps }).map((_, index) => (
          <div
            key={index}
            className={`h-2 w-2 rounded-full ${
              index < currentStep ? "bg-white" : "bg-white/50"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function CloseButton({
  stepId,
  currentStepIndex,
  totalSteps,
}: {
  stepId: StepId;
  currentStepIndex: number;
  totalSteps: number;
}) {
  const { t } = useTranslation();
  const navigate = Route.useNavigate();
  const posthog = usePostHog();
  const user = useUser();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const [isLoading, setIsLoading] = useState(false);

  const { completeOnboarding } = useCompleteOnboarding();

  return (
    <Button
      variant="ghost"
      className="absolute right-0 top-0 text-white/70 hover:bg-transparent hover:text-white"
      disabled={isLoading}
      onClick={async () => {
        if (!user?.id) return;
        setIsLoading(true);

        await completeOnboarding();

        posthog.capture("onboarding_closed", {
          step_id: stepId,
          step_number: currentStepIndex + 1,
          total_steps: totalSteps,
        });

        navigate({
          to: "/w/$workspaceId/contacts",
          params: { workspaceId },
          replace: true,
        });
        setIsLoading(false);
      }}
    >
      <span className="sr-only">{t("web.onboarding.close")}</span>
      {isLoading ? (
        <Loader2 className="size-5 animate-spin" />
      ) : (
        <X className="size-5 opacity-90" />
      )}
    </Button>
  );
}

function OnboardingStep({
  children,
  className,
  style,
}: PropsWithChildren<{ className?: string; style?: React.CSSProperties }>) {
  return (
    <div
      className={cn(
        "flex min-h-[100vh] grow items-center justify-center p-4",
        className
      )}
      style={style}
    >
      <div className="flex w-full max-w-md flex-col items-center justify-center">
        {children}
      </div>
    </div>
  );
}
function OnboardingImage({
  src,
  alt,
  width,
  height,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  const isPresent = useIsPresent();
  return (
    <img
      className="h-full w-full rounded-xl object-contain"
      width={width}
      height={height}
      src={src}
      alt={alt}
      style={{
        opacity: isPresent ? 1 : 0,
        aspectRatio: `${width}/${height}`,
        maxHeight: "65vh",
        maxWidth: "80vw",
      }}
    />
  );
}

function OnboardingTitle({ children }: PropsWithChildren) {
  return (
    <h1 className="mt-8 max-w-[80vw] text-pretty text-center text-3xl font-medium text-slate-50">
      {children}
    </h1>
  );
}
