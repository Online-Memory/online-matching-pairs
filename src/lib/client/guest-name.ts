const KEY = "omp:name";

export function loadGuestName(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveGuestName(name: string) {
  try {
    localStorage.setItem(KEY, name.trim());
  } catch {
    // Private mode etc.: the name just won't be remembered.
  }
}
