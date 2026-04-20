import { motion, useScroll, useTransform } from "motion/react";
import { debounce } from "radashi";
import { RefObject, useEffect, useRef, useState } from "react";

import { SelectOption } from "@repo/core/types";

import { NO_VALUE_OPTION } from "../contact-view-filters";
import {
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from "@/components/ui/scroll-area";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { cn } from "@/lib/utils";

const TAB_PADDING = 8;
const CONTENT_PADDING_START = 12;
const GAP = 12;

export function PipelineTabs({
  className,
  options,
  scrollElementRef,
}: {
  className?: string;
  options: SelectOption[];
  scrollElementRef: RefObject<HTMLDivElement | null>;
}) {
  const visible = !useBreakpoint("sm");
  const [activeTab, setActiveTab] = useState<string>();

  const [meta, setMeta] = useState(() => ({
    tabOffsets: [0],
    tabWidths: [0],
    contentOffsets: [0],
  }));

  useEffect(() => {
    if (!visible) {
      return;
    }

    const computeOffsets = debounce({ delay: 100 }, () => {
      const scrollElement = scrollElementRef.current;
      if (!scrollElement) return;

      const tabOffsets: number[] = [];
      const tabWidths: number[] = [];
      const contentOffsets: number[] = [];

      let index = 0;
      for (const option of options) {
        const tab = document.querySelector<HTMLElement>(
          `[data-tab="${option.value}"]`
        );
        if (!tab) continue;

        tabOffsets.push(tab.offsetLeft + TAB_PADDING);
        tabWidths.push(tab.offsetWidth - TAB_PADDING * 2);
        contentOffsets.push(
          CONTENT_PADDING_START + index * (scrollElement.offsetWidth + GAP)
        );
        index++;
      }

      if (tabOffsets.length > 0) {
        setMeta({ tabOffsets, tabWidths, contentOffsets });
      }
    });

    computeOffsets.flush();
    window.addEventListener("resize", computeOffsets);
    return () => window.removeEventListener("resize", computeOffsets);
  }, [visible, options, scrollElementRef]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollPosition = useScroll({
    container: scrollElementRef,
  });
  const pillOffset = useTransform(
    scrollPosition.scrollX,
    meta.contentOffsets,
    meta.tabOffsets
  );
  const pillWidth = useTransform(
    scrollPosition.scrollX,
    meta.contentOffsets,
    meta.tabWidths
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

    const scrollElement = scrollElementRef.current;
    if (!scrollElement) return;

    const viewport = viewportRef.current;
    if (!viewport) return;
    const listener = debounce({ delay: 200 }, () => {
      const scrollGap = 80;

      // Calculate the visible area of the viewport
      const visibleStart = viewport.scrollLeft;
      const visibleEnd = viewport.scrollLeft + viewport.offsetWidth;

      // Calculate the position and size of the active pill indicator
      const pillStart = pillOffset.get();
      const pillEnd = pillStart + pillWidth.get();

      // Check if the pill is outside the visible area
      const isPillBeforeVisible = pillStart < visibleStart;
      const isPillAfterVisible = pillEnd > visibleEnd;
      const isOutOfBounds = isPillBeforeVisible || isPillAfterVisible;

      if (isOutOfBounds) {
        const targetScrollLeft = isPillBeforeVisible
          ? pillStart - scrollGap
          : pillEnd - viewport.offsetWidth + scrollGap;

        viewport.scrollTo({
          left: Math.max(0, targetScrollLeft),
          behavior: "smooth",
        });
      }
    });

    scrollElement.addEventListener("scroll", listener);
    return () => scrollElement.removeEventListener("scroll", listener);
  }, [scrollElementRef, visible, pillOffset, pillWidth]);

  useEffect(() => {
    if (!visible) return;
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) return;

    const listener = debounce({ delay: 200 }, () => {
      const activeTabIndex = meta.tabOffsets.indexOf(pillOffset.get());
      const activeTab = options[activeTabIndex];
      setActiveTab(activeTab?.value);
    });
    listener.flush();

    scrollElement.addEventListener("scroll", listener);
    return () => scrollElement.removeEventListener("scroll", listener);
  }, [scrollElementRef, visible, options, meta.tabOffsets, pillOffset]);

  if (options.length === 0) {
    return null;
  }

  return (
    <div className={cn("bg-background -mx-3 -mb-2", className)}>
      <ScrollAreaRoot
        className={cn("overflow-auto overflow-x-hidden whitespace-nowrap pb-2")}
        type="hover"
      >
        <ScrollAreaViewport ref={viewportRef}>
          <div
            role="tablist"
            className="text-muted-foreground border-b-border relative flex border-b px-2"
          >
            {options.map((option) => (
              <button
                key={option.value}
                role="tab"
                type="button"
                aria-selected={option.value === activeTab}
                className={cn(
                  "hover:text-foreground outline-ring group/tab block whitespace-nowrap py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
                  option.value === NO_VALUE_OPTION.value && "italic",
                  option.value === activeTab && "text-foreground"
                )}
                onClick={() => {
                  const index = options.findIndex(
                    (o) => o.value === option.value
                  );
                  if (index !== -1) {
                    scrollElementRef.current?.scrollTo({
                      left: meta.contentOffsets[index],
                      behavior: "smooth",
                    });
                    // virtualizer.scrollToIndex(index, { align: "start" });
                  }
                }}
                style={{
                  paddingLeft: TAB_PADDING,
                  paddingRight: TAB_PADDING,
                  WebkitTapHighlightColor: "transparent",
                }}
                data-tab={option.value}
              >
                {option.label}
              </button>
            ))}
            <motion.div
              className="border-primary absolute bottom-0 top-0 w-px border-b-[3px]"
              style={{
                marginLeft: -TAB_PADDING,
                translateX: pillOffset,
                scaleX: pillWidth,
                transformOrigin: "left",
              }}
            />
          </div>
        </ScrollAreaViewport>
        <ScrollBar className="h-2" orientation="horizontal" />
      </ScrollAreaRoot>
    </div>
  );
}
