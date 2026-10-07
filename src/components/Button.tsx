import type { ComponentProps } from "react";

import { Spinner } from "./Spinner";

type Props = ComponentProps<"button"> & {
  /** An async request started by this button is in flight: show a spinner and refuse further clicks. */
  pending?: boolean;
};

/** A button that can't be pressed again while its request is outstanding. Defaults to `type="button"`. */
export function Button({
  pending = false,
  disabled,
  className = "button",
  type = "button",
  children,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      type={type}
      className={className}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    >
      {pending && <Spinner />}
      {children}
    </button>
  );
}
