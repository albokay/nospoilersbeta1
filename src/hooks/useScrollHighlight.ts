export function useScrollHighlight() {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    // Flash the card after the scroll settles
    const doFlash = () => {
      const s = getComputedStyle(el);
      el.style.position = s.position === "static" ? "relative" : s.position;
      const cover = document.createElement("div");
      cover.className = "flash-cover";
      el.appendChild(cover);
      setTimeout(() => cover.remove(), 1300);
    };

    if ("onscrollend" in window) {
      window.addEventListener("scrollend", doFlash, { once: true });
    } else {
      // Fallback: wait a reasonable time for smooth scroll to finish
      setTimeout(doFlash, 700);
    }
  };
  return { scrollTo };
}
