import { Link, LinkProps } from "@tanstack/react-router";
import { MotionProps, m } from "motion/react";
import { FC, HTMLAttributes } from "react";

import { Button } from "./ui/button";

export const MotionLink = m.create(Link) as FC<
  LinkProps & MotionProps & HTMLAttributes<HTMLAnchorElement>
>;

export const MotionButton = m.create(Button);
