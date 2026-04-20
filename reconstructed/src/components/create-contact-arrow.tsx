import intersect from "path-intersection";
import { debounce } from "radashi";
import { useEffect } from "react";
import rough from "roughjs";

import { webApp } from "@/lib/telegram";

function _drawArrow(arrowEl: SVGSVGElement) {
  const startEl = document.querySelector<HTMLElement>("#arrow-start");
  const endEl = document.querySelector<HTMLElement>("#new-contact-button");
  if (!startEl || !endEl || !arrowEl) {
    return;
  }

  arrowEl.style.width = `${document.body.scrollWidth}px`;
  arrowEl.style.height = `${document.body.scrollHeight}px`;

  const startRect = startEl.getBoundingClientRect();
  const endRect = endEl.getBoundingClientRect();

  const width = endRect.left - startRect.right;
  const height = endRect.top - startRect.bottom;

  const startX = window.scrollX + startRect.left;
  const startY = window.scrollY + startRect.bottom + (height < 50 ? 5 : 30);

  const controlX = startX + width / 12;
  const controlY = startY + height / 1.4;

  const buttonRadius = (endRect.width / 2) * 1.6;
  const buttonCenterX = window.scrollX + endRect.left + endRect.width / 2;
  const buttonCenterY = window.scrollY + endRect.top + endRect.height / 2;

  const intersection = intersect(
    // path to button center
    `M ${buttonCenterX} ${buttonCenterY} Q ${controlX} ${controlY} ${startX} ${startY}`,
    // circle with radius + offset
    `M ${buttonCenterX} ${buttonCenterY} m ${buttonRadius} 0 a ${buttonRadius}, ${buttonRadius} 0 1, 0 ${-buttonRadius * 2} 0 a ${buttonRadius}, ${buttonRadius} 0 1, 0 ${buttonRadius * 2} 0`
  );

  const endX = intersection[0]?.x ?? endRect.left - 10;
  const endY = intersection[0]?.y ?? endRect.top;

  const rc = rough.svg(arrowEl);

  const arrowBody = rc.path(
    `M ${endX} ${endY} Q ${controlX} ${controlY} ${startX} ${startY}`,
    {
      stroke: "currentColor",
      strokeWidth: 2,
      roughness: 2,
      fill: "none",
    }
  );

  const deltaX = controlX - endX;
  const deltaY = controlY - endY;
  const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);

  // Define arrowhead size
  const arrowHeadLength = 15;
  const arrowHeadAngle = 45; // degrees

  // Calculate points for the arrowhead
  const radians = (angle * Math.PI) / 180;
  const arrowPoint2 = {
    x: arrowHeadLength * Math.cos(radians + (Math.PI / 180) * arrowHeadAngle),
    y: arrowHeadLength * Math.sin(radians + (Math.PI / 180) * arrowHeadAngle),
  };
  const arrowPoint3 = {
    x: arrowHeadLength * Math.cos(radians - (Math.PI / 180) * arrowHeadAngle),
    y: arrowHeadLength * Math.sin(radians - (Math.PI / 180) * arrowHeadAngle),
  };
  const arrowHead = rc.path(
    `
      M ${endX} ${endY}
      L ${endX + arrowPoint2.x} ${endY + arrowPoint2.y}
      L ${endX + arrowPoint3.x} ${endY + arrowPoint3.y}
      Z
    `,
    {
      stroke: "currentColor",
      strokeWidth: 2,
      roughness: 1,
      fill: "currentColor",
      fillStyle: "solid",
    }
  );

  arrowEl.innerHTML = "";
  arrowEl.append(arrowBody);
  arrowEl.append(arrowHead);
  arrowEl.style.opacity = "1";
}

function drawArrow(arrowEl: SVGSVGElement) {
  requestAnimationFrame(() => _drawArrow(arrowEl));
}

export function CreateContactArrow() {
  useEffect(() => {
    const arrowEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );
    arrowEl.classList.add(
      "absolute",
      "top-0",
      "left-0",
      "pointer-events-none",
      "text-muted-foreground/50",
      "transition-opacity",
      "opacity-0"
    );
    document.body.append(arrowEl);

    const debouncedDrawArrow = debounce({ delay: 400 }, () =>
      drawArrow(arrowEl)
    );
    const resizeListener = () => {
      arrowEl.style.opacity = "0";
      debouncedDrawArrow();
    };
    webApp?.onEvent("viewportChanged", resizeListener);
    window.addEventListener("resize", resizeListener);
    window.addEventListener("scroll", debouncedDrawArrow);
    const timeout = setTimeout(() => drawArrow(arrowEl), 500);

    return () => {
      webApp?.offEvent("viewportChanged", resizeListener);
      window.removeEventListener("resize", resizeListener);
      window.removeEventListener("scroll", debouncedDrawArrow);
      clearTimeout(timeout);
      arrowEl.remove();
    };
  }, []);

  return <div id="arrow-start" className="size-[1px] bg-transparent"></div>;
}
