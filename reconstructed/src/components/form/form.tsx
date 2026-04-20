import { Suspense } from "react";

import Loader from "@/components/ui/loader";
import { useAppForm } from "@/hooks/app-form";

export function Form({
  form,
  children,
  submitOnCmdEnter = true,
  suspense = true,
  ...formProps
}: React.ComponentProps<"form"> & {
  form: Pick<
    ReturnType<typeof useAppForm>,
    "AppForm" | "handleSubmit" | "formId"
  >;
  submitOnCmdEnter?: boolean;
  suspense?: boolean;
}) {
  return (
    <form.AppForm>
      <form
        {...formProps}
        id={form.formId}
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        onKeyDown={
          submitOnCmdEnter
            ? (e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  e.stopPropagation();
                  form.handleSubmit();
                }
              }
            : undefined
        }
      >
        {suspense ? (
          <Suspense
            fallback={
              <div className="flex h-20 w-full items-center justify-center">
                <Loader />
              </div>
            }
            children={children}
          />
        ) : (
          children
        )}
      </form>
    </form.AppForm>
  );
}
