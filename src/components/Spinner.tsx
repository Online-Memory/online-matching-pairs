/** A small ring that inherits the surrounding text colour. Decorative: pair it with text or `aria-busy`. */
export function Spinner() {
  return <span className="spinner" aria-hidden />;
}

/** "Loading…" for a region whose data is still on its way. Announced politely to screen readers. */
export function LoadingNotice({ children = "Loading…" }: { children?: React.ReactNode }) {
  return (
    <p className="notice loading-notice" role="status">
      <Spinner />
      {children}
    </p>
  );
}
