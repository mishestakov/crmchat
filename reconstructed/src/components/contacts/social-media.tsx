import { Globe } from "lucide-react";

import facebookLogo from "@/assets/facebook-logo.svg";
import instagramLogo from "@/assets/instagram-logo.svg";
import linkedinLogo from "@/assets/linkedin-logo.svg";
import redditLogo from "@/assets/reddit-logo.svg";
import telegramLogo from "@/assets/telegram-logo.svg";
import whatsappLogo from "@/assets/whatsapp-logo.svg";
import twitterLogo from "@/assets/x-formerly-twitter-logo.svg";
import { cn } from "@/lib/utils";

type SociaMediaMap = Record<
  string,
  { icon: string; name: string; className?: string }
>;
const socialMediaIcons: SociaMediaMap = {
  "t.me/": { icon: telegramLogo, name: "Telegram" },
  "linkedin.com/": { icon: linkedinLogo, name: "LinkedIn" },
  "x.com/": { icon: twitterLogo, name: "Twitter" },
  "twitter.com/": { icon: twitterLogo, name: "Twitter" },
  "reddit.com/": { icon: redditLogo, name: "Reddit" },
  "facebook.com/": { icon: facebookLogo, name: "Facebook" },
  "wa.me/": { icon: whatsappLogo, name: "WhatsApp" },
  "instagram.com/": {
    icon: instagramLogo,
    name: "Instagram",
    className: "contrast-[0.9] transition-[filter] hover:contrast-100",
  },
};

export function SocialMediaName({ url }: { url: string }) {
  for (const [key, data] of Object.entries(socialMediaIcons)) {
    if (url.includes(key)) {
      return data.name;
    }
  }

  // extract domain
  try {
    const domain = new URL(url).hostname;
    return domain;
  } catch (e) {
    console.warn(`Failed to extract domain from URL ${url}`, e);
    return url;
  }
}

export function SocialMediaIcon({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  for (const [key, data] of Object.entries(socialMediaIcons)) {
    if (url.includes(key)) {
      return (
        <img
          src={data.icon}
          alt={data.name}
          className={cn(data.className, className)}
        />
      );
    }
  }
  return <Globe className={className} />;
}
