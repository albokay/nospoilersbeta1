export function injectDOSStyles() {
  const id = "dos-theme";
  if (document.getElementById(id)) return;
  const css = `
:root{
  --dos-bg:#dea838; --dos-fg:#FFFFFF; --dos-blue:rgba(0,0,0,0.18); --dos-cyan:#FFFFFF;
  --dos-gray:rgba(255,255,255,0.65); --dos-light:#FFFFFF;
  --dos-accent:#FFFFFF; --danger:#f45028; --green:#7abd8e; --dos-user:#2256c9; --dos-border:#ffffff;
}

.brandLink{ cursor:pointer; }
.brandLink:focus-visible{ outline:2px dashed var(--dos-cyan); outline-offset:2px; }

*{ box-sizing:border-box; }
html,body,#root{ height:100%; background:var(--dos-bg); }
body{
  margin:0;
  background:var(--dos-bg);
  color:var(--dos-fg);
  font-size:16px;
  line-height:1.5;
  letter-spacing:0.01em;
  font-family: "Inter","Nunito",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  font-weight:400;
}

/* full-bleed helpers */
.bleed{ width:100vw; margin-left:calc(50% - 50vw); margin-right:calc(50% - 50vw); }
.bleed-line{ display:none; }

/* layout primitives */
.container{ width:min(1040px, 92vw); margin:0 auto; background:transparent; }
hr{ display:none; }
.title{ color:var(--dos-light); font-weight:600; letter-spacing:0.005em; }
.muted{ color:var(--dos-gray); }
.card{ background:transparent; border:3px solid var(--dos-border); padding:12px; border-radius:23px; }

/* controls */
.badge{
  background:transparent; color:var(--dos-fg); border:3px solid var(--dos-border);
  border-radius:9999px; padding:10px 13px; outline:none; font-weight:500;
}
.badge:focus{ border-color:var(--dos-cyan); }
.btn{
  background:transparent; color:var(--dos-fg); border:3px solid var(--dos-border);
  border-radius:9999px; padding:6px 12px; cursor:pointer; font-weight:500;
}
.btn.primary{ border-color:var(--dos-cyan); color:var(--dos-cyan); }
.btn:hover{ background:var(--dos-blue); color:white; border-color:var(--dos-light); }
.btn-danger{ border-color:var(--danger); color:var(--danger); }
.btn-danger:hover{ background:var(--danger); color:#fff; border-color:var(--danger); }
/* Green styling for +Post */
.btn.post{ background: var(--green); color: #fff; border-color: var(--green); }
.btn.post:hover{ background: #5fa878; border-color: #5fa878; color: #fff; }
/* Fix dark inputs/textareas */
select { color: var(--dos-fg); background: rgba(0,0,0,0.12); }
input, textarea { color: #000; background: #fff; }
input::placeholder, textarea::placeholder { color: #aaa; }
/* Ensure compose/reply typing fields stay white even when .badge or .card class is present */
input.badge, textarea.card, textarea { background: #fff !important; color: #000 !important; }
input.badge::placeholder, textarea::placeholder { color: #aaa !important; }
.h40{ height:40px; display:inline-flex; align-items:center; }

/* sticky bars */
header.site{
  position:sticky; top:0; z-index:90; background:rgba(222,168,56,0.98);
}
.brand{
  line-height:0; font-size:0;
  display:inline-flex; align-items:center;
}


.siteTagline{
  text-align:center;
  font-size:18px;
  font-weight:600;
  letter-spacing:0.02em;
  margin:3px 0 10px;
}

/* On wider screens, visually tuck the tagline up toward the header bar */
@media (min-width: 901px){
  .siteTagline{
    margin-top:-39px;   /* pulls it up closer under NO-SPOILERS */
  }
}

/* On narrower screens, let it sit clearly below and be a bit smaller */
@media (max-width: 1130px){
  .siteTagline{
    font-size:18px;
    padding:0 16px;
    margin-top:-6px;     /* no negative margin = "pops down" */
  }
}




.stickybar{
  position:sticky; top:0; z-index:70; background:rgba(222,168,56,0.98);
}

/* banner row 1: title + sort — stacks on mobile */
.bannerRow1{
  display:flex; align-items:center; justify-content:space-between;
  gap:12px; padding:20px 0 8px;
}
/* subtle "hang left" headers */
.hangL{ transform: translateX(-45px); }
/* Profile page folder content — extends border line 45px left to align with hangL headers */
.hangLContent{ margin-left:-45px; padding-left:45px; }

@media (max-width: 768px){
  .bannerRow1{
    flex-direction:column; align-items:center; justify-content:center;
    gap:8px; padding:16px 0 8px; text-align:center;
  }
  .hangL{ transform:none; }
  .hangLContent{ margin-left:0; padding-left:0; }
}

/* homepage search */
.splashSearchWrap{
  position:relative; display:flex; align-items:center;
  width:288px; max-width:90vw; margin:20px auto;
  height:40px; border:3px solid #bdd4de; border-radius:9999px;
  padding:0 16px;
  background:#fffaf0; border-color:#fffaf0; color:#c39431;
}
.splashSearch{
  background:transparent; border:none !important; border-radius:0 !important; outline:none;
  position:absolute; left:0; right:0;
  text-align:center; padding:0 36px;
  font-size:15px; font-weight:600; letter-spacing:0.01em; color:inherit;
}
.splashSearch::placeholder{ color:inherit; opacity:1; }
.splashSearchIcon{ font-size:18px; opacity:.85; flex-shrink:0; line-height:1; position:relative; z-index:1; }
.dropdownPanel{
  position:absolute; top:calc(100% + 8px); width:288px; max-width:90vw; z-index:9999;
  max-height:300px; overflow:auto; background:rgba(222,168,56,0.97);
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
  border:3px solid var(--dos-border); border-radius:23px; box-shadow:0 8px 23px rgba(0,0,0,0.15);
  color:var(--dos-fg);
}

/* "Your shows" */
.listPill{
  width:288px; max-width:90vw; height:40px; border-radius:9999px; padding:0 23px;
  font-size:15px; font-weight:600; letter-spacing:0.01em;
  display:inline-flex; align-items:center; justify-content:center; border:3px solid var(--dos-border);
  text-align:left; text-align-last:left; justify-content:flex-start;
}

/* forum search */
.inlineSearch{ width:520px; max-width:48vw; position:relative; }
.inlineSearch .inlineSearchClear{
  position:absolute; right:8px; top:50%; transform:translateY(-50%); background:transparent; border:none; padding:0;
  font-size:18px; line-height:1; cursor:pointer; color:var(--dos-gray);
}

/* thread/replies */
.threadCard{ border-color:var(--dos-border); }
.replyBarNew{ background:var(--green); height:6px; }
.clamp3{ display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.redacted{ background:#e8e4dc; color:#888; border:3px solid #ccc; border-radius:23px; }

/* mode toggle */
.modeToggle{ width:240px; height:38px; }
.modeKnob{ transition:left 160ms ease; }

/* flash overlay */
@keyframes flash-blink{
  0%   { opacity:1; }
  28%  { opacity:0.08; }
  52%  { opacity:0.82; }
  100% { opacity:0; }
}
.flash-cover{ position:absolute; inset:0; background:rgba(222,168,56,0.55); pointer-events:none; border-radius:inherit; animation:flash-blink 1.2s ease forwards; }

/* like badge */
.likeWrap{ display:inline-flex; align-items:baseline; gap:3px; user-select:none; }
.likeThis{ font-style:italic; font-weight:700; }

/* watch diary stacked pages — 4 sheets total, back=top-left, front=bottom-right */
.diaryOuter{
  position:relative;
  margin-top:48px; margin-left:48px; margin-bottom:24px;
}
.diaryOuter::before{
  content:""; position:absolute; inset:0;
  border:3px solid #fff; border-radius:0;
  background:var(--dos-bg);
  transform:translate(-48px,-48px); z-index:-3;
}
.diaryCardWrap{
  position:relative; z-index:0;
}
.diaryCardWrap::before,
.diaryCardWrap::after{
  content:""; position:absolute; inset:0;
  border:3px solid #fff; border-radius:0;
  background:var(--dos-bg);
}
.diaryCardWrap::before{ transform:translate(-32px,-32px); z-index:-2; }
.diaryCardWrap::after{  transform:translate(-16px,-16px); z-index:-1; }
.diaryCardWrap > .card{ border:none; border-radius:0; padding:23px 46px 32px 16px; box-shadow:inset 0 0 0 3px #fff; background:var(--dos-bg); }
.diaryCardWrap .threadCard{ border-radius:0; }
.diaryCardWrap .threadCard:last-child{ margin-bottom:0; }

/* profile chip */
.profileChip{
  display:inline-flex; align-items:center; gap:8px; cursor:pointer;
  border:none; padding:6px 10px; border-radius:9999px;
  background: var(--dos-user);
}
.avatar{
  width:22px; height:22px; border:none; border-radius:50%;
  display:inline-grid; place-items:center; font-size:12px; line-height:1;
  background:#fff; color:var(--dos-user); font-weight:700;
}
@media(max-width:600px){
  .profileChipLabel{ display:none; }
  .profileChip{ padding:6px; }
  .brandLogoImg{ height:34px !important; }
  /* Row layout (not column) — avatar + ✕ side-by-side, fits under 56 px header */
  .fixedAuthWrap{ flex-direction:row; align-items:center; gap:8px; }
  .signOutLabel{ display:inline; }
  .signOutX{ display:none; }
  .signOutBtn{ padding:6px 10px; }

  /* Hide non-essential fixed-header items that cause collision on narrow screens */
  .mobileHide{ display:none !important; }

  /* Diary stacked-paper: reduce offsets so they don't bleed off-screen */
  .diaryOuter{ margin-top:20px; margin-left:20px; margin-bottom:12px; }
  .diaryOuter::before{ transform:translate(-20px,-20px); }
  .diaryCardWrap::before{ transform:translate(-13px,-13px); }
  .diaryCardWrap::after{ transform:translate(-7px,-7px); }

  /* Forum banner: show title, all buttons/dropdowns bigger on mobile */
  .bannerTitle{ font-size:26px !important; letter-spacing:0.01em !important; }
  .stickybar .badge{ font-size:17px !important; padding:11px 18px !important; }
  .stickybar .btn{ font-size:17px !important; padding:10px 18px !important; height:auto !important; }

  /* Thread cards: tighten horizontal padding so content has more room */
  .card.threadCard{ padding-left:10px; padding-right:10px; }

  /* Homepage hero: scale down "Popular Right Now" header */
  .popularHeading{ font-size:20px !important; }
}
@media(min-width:601px){
  .signOutX{ display:none; }
}

/* username highlight (site-wide for inline mentions) */
.username, .username a{
  color: var(--dos-accent) !important;
}

/* subtle DOS scrollbars for feed windows */
.scrollWin{
  scrollbar-width: thin;
  scrollbar-color: var(--dos-border) transparent;
}
.scrollWin::-webkit-scrollbar{ width:8px; }
.scrollWin::-webkit-scrollbar-track{ background:transparent; }
.scrollWin::-webkit-scrollbar-thumb{
  background:rgba(255,255,255,0.4); border:1px solid var(--dos-border); border-radius:8px;
}
.scrollWin::-webkit-scrollbar-thumb:hover{ background:rgba(255,255,255,0.6); }

/* Reply cards: white bg, yellow text & buttons */
.reply-card{ background:#fff !important; }
.reply-card .btn:not(.btn-danger){ color:var(--dos-bg) !important; border-color:var(--dos-bg) !important; background:transparent !important; }
.reply-card .btn:not(.btn-danger):hover{ background:var(--dos-bg) !important; color:#fff !important; border-color:var(--dos-bg) !important; }
.reply-card .likeWrap{ color:var(--dos-bg) !important; border-color:var(--dos-bg) !important; background:transparent !important; }
.reply-card .likeWrap:hover{ background:var(--dos-bg) !important; color:#fff !important; border-color:var(--dos-bg) !important; }

/* bottom-right replies badge */
.replyCount{
  position:absolute; right:12px; bottom:8px;
  font-size:18px; color:var(--dos-gray);
}

/* homepage blurb spacing */
.homeAbout{ margin: 36px auto 16px; }
.homeAbout p{ font-size:15px; line-height:1.6; margin: 8px 0; color: var(--dos-fg); }
/* Frontpage accent color override */
.frontAccent,
.frontAccent p,
.frontAccent a,
.frontAccent b {
  color: var(--danger, #f45028) !important;
}
.frontAccent .muted {
  opacity: 1 !important; /* neutralize dimming if present */
}

/* Global mock zoom (Chrome/Chromium only) */
html, body {
  zoom: .9;
}
body { -webkit-font-smoothing: antialiased; }

/* ── Response reference system ───────────────────────────────────────────── */

/* Highlight flash for scroll-to targets */
@keyframes response-highlight-blink {
  0%   { background-color: rgba(255,255,255,0.45); }
  60%  { background-color: rgba(255,255,255,0.18); }
  100% { background-color: transparent; }
}
.response-highlight {
  animation: response-highlight-blink 1.5s ease forwards;
}

/* Blockquote reference rendered inline in body */
.blockquote-ref {
  border-left: 3px solid var(--dos-border);
  background: rgba(0,0,0,0.07);
  padding: 8px 12px;
  margin: 8px 0;
  border-radius: 6px;
  font-style: italic;
}
.blockquote-ref .blockquote-author {
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 4px;
  color: var(--dos-bg);
  opacity: 0.7;
}
.blockquote-ref .blockquote-text {
  font-size: 14px;
  color: var(--dos-bg);
  opacity: 0.85;
}

/* "Responding to" label on link-type responses */
.responding-to-label {
  color: var(--dos-bg);
  font-weight: 400;
  font-style: normal;
  text-decoration: underline;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-size: inherit;
  font-family: inherit;
  line-height: inherit;
}
.responding-to-label:hover { opacity: 0.75; }

/* Superscript wrapper — controls elevation (lower than browser default) */
.cite-sup {
  vertical-align: 0.35em;
  line-height: 0;
}

/* Shared citation superscript button — used inline in body, in headers, and in thread heading */
.cite-sup-btn {
  color: #dea838;
  font-weight: 700;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 1px;
  font-size: 1.5em;
  font-family: inherit;
  line-height: 1;
}
.cite-sup-btn:hover { text-decoration: underline; }

/* Subtle dotted underline on the quoted passage that carries a citation sup */
.quoted-passage {
  text-decoration: underline dotted rgba(222,168,56,0.55);
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
  cursor: pointer;
}

/* Quote hint popup — appears below the Quote button when no text is selected */
.quote-hint-popup {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 280px;
  background: var(--dos-fg);
  color: var(--dos-bg);
  border: 2px solid var(--dos-border);
  border-radius: 14px;
  padding: 12px 14px 10px;
  font-size: 13px;
  line-height: 1.5;
  z-index: 100;
  box-shadow: 0 4px 16px rgba(0,0,0,0.18);
}
.quote-hint-popup p { margin: 0 0 8px; }
.quote-hint-popup p:last-child { margin-bottom: 0; }
.quote-hint-close {
  float: right;
  margin: -2px -4px 4px 8px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: var(--dos-bg);
  opacity: 0.6;
  padding: 0 2px;
  line-height: 1;
}
.quote-hint-close:hover { opacity: 1; }

/* Footnote superscript links (thread-entry heading citations) */
.footnote-sups {
  font-size: 11px;
  margin-top: 4px;
  color: var(--dos-user);
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.footnote-sups sup a,
.footnote-sups sup button {
  color: var(--dos-user);
  text-decoration: none;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 1px;
  font-size: 11px;
  font-family: inherit;
  font-weight: 700;
}
.footnote-sups sup a:hover,
.footnote-sups sup button:hover { text-decoration: underline; }

/* Insert button in composer toolbar */
.insert-btn {
  background: transparent;
  color: var(--dos-fg);
  border: 2px solid var(--dos-border);
  border-radius: 9999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
}
.insert-btn:hover {
  background: var(--dos-blue);
}

/* Pending reference chip in composer */
.pending-ref-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(0,0,0,0.10);
  border: 2px solid var(--dos-border);
  border-radius: 9999px;
  padding: 3px 10px;
  font-size: 12px;
  font-style: italic;
  color: var(--dos-fg);
}
.pending-ref-chip button {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--dos-fg);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  opacity: 0.7;
}
.pending-ref-chip button:hover { opacity: 1; }

`;

  const el = document.createElement("style"); el.id = id; el.textContent = css; document.head.appendChild(el);
}
