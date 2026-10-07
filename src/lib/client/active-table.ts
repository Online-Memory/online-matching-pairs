/**
 * The table this browser is seated at, for the presence heartbeat to report to friends. Set by
 * `useTable`; a plain module because the heartbeat lives in the layout, outside any table page.
 */
let active: string | null = null;
const listeners = new Set<() => void>();

export const getActiveTable = () => active;

export function setActiveTable(code: string | null) {
  if (active === code) return;
  active = code;
  listeners.forEach((l) => l());
}

export function onActiveTableChange(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
