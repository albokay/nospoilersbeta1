export function useScrollHighlight() {
  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("response-highlight");
    setTimeout(() => el.classList.remove("response-highlight"), 1600);
  };
  return { scrollTo };
}
