"use client";

import { useEffect } from "react";
import * as CookieConsent from "vanilla-cookieconsent";
import "vanilla-cookieconsent/dist/cookieconsent.css";

// `run` must only be called once per page load; effects run twice in development (Strict Mode).
let started = false;

/**
 * Cookie notice built on vanilla-cookieconsent. The app only sets cookies it needs to work (the guest id and the
 * sign-in session) and has no analytics or ads, so there is a single, always-on `necessary` category. To add an
 * optional category later, add it under `categories` and gate the script behind `CookieConsent.acceptedCategory`.
 * Colours come from the app palette (see `#cc-main` in globals.css), so the banner follows the light/dark theme.
 */
export function CookieNotice() {
  useEffect(() => {
    if (started) return;
    started = true;
    void CookieConsent.run({
      guiOptions: {
        consentModal: { layout: "box inline", position: "bottom right", equalWeightButtons: false },
        preferencesModal: { layout: "box" },
      },
      categories: { necessary: { enabled: true, readOnly: true } },
      language: {
        default: "en",
        translations: {
          en: {
            consentModal: {
              title: "We use cookies",
              description:
                "Matching Pairs uses a few cookies that keep you signed in and remember who you are at a table. " +
                "We don't use them for tracking or advertising.",
              acceptAllBtn: "Got it",
              showPreferencesBtn: "Cookie details",
            },
            preferencesModal: {
              title: "Cookie details",
              acceptAllBtn: "Got it",
              savePreferencesBtn: "Close",
              sections: [
                {
                  title: "Strictly necessary",
                  description:
                    "These cookies are required for the game to work, so they can't be switched off. " +
                    "They hold your guest id or sign-in session. Your light/dark choice is kept in local storage.",
                  linkedCategory: "necessary",
                },
              ],
            },
          },
        },
      },
    });
  }, []);

  return null;
}
