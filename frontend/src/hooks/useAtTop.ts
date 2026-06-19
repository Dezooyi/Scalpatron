import { useEffect, useState } from "react";

/**
 * Liefert `true`, solange die App ganz oben gescrollt ist.
 *
 * Wichtig: Die App scrollt nicht auf `window` (das äußere Layout ist
 * `h-screen overflow-hidden`), sondern auf einem inneren `<main>`-Element.
 * Wir beobachten deshalb das nächste gefundene scrollbare Element sowie
 * zusätzlich `window`, um robust zu sein.
 *
 * Da der Hook in der App-Wurzel lebt, kann das `<main>`-Element beim
 * ersten Mount noch nicht existieren. Wir versuchen es per rAF
 * wiederholt zu finden und starten den Listener, sobald es verfügbar ist.
 */
export function useAtTop(threshold = 0): boolean {
  const [atTop, setAtTop] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let frame = 0;
    let mounted = true;
    let observed: Element | null = null;

    const compute = () => {
      if (!mounted) return;
      const main = document.querySelector("main.flex-1.overflow-auto") as HTMLElement | null;
      const scrolled = main ? main.scrollTop : window.scrollY;
      setAtTop(scrolled <= threshold);
    };

    const onScroll = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        compute();
      });
    };

    const startObserving = () => {
      const main = document.querySelector("main.flex-1.overflow-auto");
      if (main && main !== observed) {
        if (observed) observed.removeEventListener("scroll", onScroll);
        observed = main;
        main.addEventListener("scroll", onScroll, { passive: true });
      }
      compute();
    };

    // Initiale Suche + mehrere Versuche, falls das Element noch nicht im DOM ist
    const tryAttach = (attempt = 0) => {
      if (!mounted) return;
      startObserving();
      if (!observed && attempt < 20) {
        window.requestAnimationFrame(() => tryAttach(attempt + 1));
      }
    };
    tryAttach();

    // Falls das <main>-Element nachträglich eingefügt wird (z.B. nach Loading-State)
    const mo = new MutationObserver(() => startObserving());
    mo.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      mounted = false;
      if (observed) observed.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      mo.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [threshold]);

  return atTop;
}
