import { useClosingConfirmation } from "./useClosingConfirmation";
import { useDisabledVerticalSwipe } from "./useDisabledVerticalSwipe";
import { useInputInViewport } from "./useInputInViewport";

export function useFormFeatures() {
  useInputInViewport();
  useDisabledVerticalSwipe();
  useClosingConfirmation();
}
