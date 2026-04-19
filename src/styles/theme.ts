export function injectDOSStyles() {
  const id = "dos-theme";
  if (document.getElementById(id)) return;
  const css = `
:root{
  --dos-bg:#7abd8e; --dos-fg:#FFFFFF; --dos-blue:rgba(0,0,0,0.18); --dos-cyan:#FFFFFF;
  --dos-gray:rgba(255,255,255,0.65); --dos-light:#FFFFFF;
  --dos-accent:#FFFFFF; --danger:#f45028; --green:#7abd8e; --dos-user:#355eb8; --dos-border:#ffffff;
  --icon-color:#fff;
  /* canonical accent blue */
  --blue-light:#adc8d7;
  /* progress dropdown (overridden to green in group context) */
  --progress-bg:#adc8d7; --progress-fg:#355eb8;
  /* type scale */
  --t1:22px; --t2:17px; --t3:15px; --t4:13px;
  /* Top-header spacer height — used by header.site and .stickybar.
     Wide (>=1134px): single row layout (pill overlays logo), ~88px tall → 96.
     Narrow (<1134px): two-row stacked layout with 40px gap between rows,
       ~162px tall (14 top + 74 logo+search + 40 gap + 34 pill) → 168.
     Phone (<600px): search + friend-rooms hide, leaving logo (34) + 40 gap + pill (30),
       ~118px tall → 124.
  */
  --site-header-h:104px;
}
/* Narrow widths use the smaller static png, so the header occupies
   less vertical space — tighter reservation. */
@media(max-width:1133px){ :root{ --site-header-h:56px; } }
@media(max-width:600px){ :root{ --site-header-h:56px; } }

/* ── Friend room context — light-blue theme ─────────────────────────────── */
body.group-context{
  --dos-bg:#adc8d7; --dos-fg:#1a3a4a; --dos-cyan:#1a3a4a;
  --dos-gray:rgba(26,58,74,0.65); --dos-light:#1a3a4a;
  --dos-accent:#1a3a4a; --dos-border:rgba(26,58,74,0.3);
  --dos-blue:rgba(26,58,74,0.08);
  --icon-color:#fff;
  --progress-bg:#7abd8e; --progress-fg:#fff;
  background: linear-gradient(to bottom,#c8dde8 0px,#adc8d7 180px) fixed,#adc8d7;
  background-attachment:fixed;
}
body.group-context.has-header{
  background: linear-gradient(to top,#c8dde8 0px,#adc8d7 250px) fixed,#adc8d7;
  background-attachment:fixed;
}
body.group-context header.site{ background:rgba(173,200,215,0.98); }
body.group-context .stickybar{ background:rgba(173,200,215,0.98); }
/* In friend rooms, reply cards should use dark text matching thread entries (not washed-out blue) */
body.group-context .reply-card{ color:#1a3a4a !important; --dos-accent:#1a3a4a; --dos-cyan:#1a3a4a; --dos-gray:rgba(26,58,74,0.65); border-color:transparent !important; }
/* In friend rooms, star button circle + star should both use the muted border color */
body.group-context .likeWrap{ color:rgba(26,58,74,0.3) !important; border-color:rgba(26,58,74,0.3) !important; }
body.group-context .likeWrap:hover{ background:rgba(26,58,74,0.08) !important; }
/* In friend rooms, the default .btn:hover border-color (--dos-light = dark
   navy) reads as a black outline against the light-blue bg. Swap to white.
   Reply-cards are already handled by the non-contextual .reply-card rules
   further down (border tracks --dos-bg so only the fill change is visible). */
body.group-context .btn:hover{ border-color:#fff !important; }

/* ── Public room context — golden-yellow theme ─────────────────────────────── */
body.public-context{
  --dos-bg:#dea838; --dos-fg:#FFFFFF; --dos-cyan:#FFFFFF;
  --dos-gray:rgba(255,255,255,0.65); --dos-light:#FFFFFF;
  --dos-accent:#FFFFFF; --dos-border:#ffffff;
  --dos-blue:rgba(0,0,0,0.14);
  --progress-bg:#7abd8e; --progress-fg:#fff;
  background: linear-gradient(to bottom,#f0cc60 0px,#dea838 180px) fixed,#dea838;
  background-attachment:fixed;
}
body.public-context.has-header{
  background: linear-gradient(to top,#f0cc60 0px,#dea838 250px) fixed,#dea838;
  background-attachment:fixed;
}
body.public-context header.site{ background:rgba(222,168,56,0.98); }
body.public-context .stickybar{ background:rgba(222,168,56,0.98); }
/* In the yellow public room, reply cards have white bg — swap yellow accents to canon green */
body.public-context .reply-card .btn:not(.btn-danger){ color:#7abd8e !important; border-color:#7abd8e !important; }
body.public-context .reply-card .btn:not(.btn-danger):hover{ background:#7abd8e !important; color:#fff !important; border-color:#7abd8e !important; }
body.public-context .reply-card .likeWrap{ color:#7abd8e !important; border-color:#7abd8e !important; }
body.public-context .reply-card .likeWrap:hover{ background:#7abd8e !important; color:#fff !important; border-color:#7abd8e !important; }
body.public-context .blockquote-ref .blockquote-author,
body.public-context .blockquote-ref .blockquote-text{ color:#7abd8e; }
body.public-context .responding-to-label{ color:#7abd8e; }
body.public-context .btn.post{ background:#7abd8e !important; border-color:#7abd8e !important; color:#fff !important; }
body.public-context .progress-control{ border-color:#7abd8e !important; }
body.group-context .btn.post{ background:#7abd8e !important; border-color:#7abd8e !important; color:#fff !important; }
body.group-context .progress-control{ border-color:#7abd8e !important; }
body.public-context .btn.primary{ background:#7abd8e !important; border-color:#7abd8e !important; color:#fff !important; }
/* New-reply badge in thread list — green instead of yellow in public context */
body.public-context .newReplyBadge{ background:#7abd8e !important; }
/* Radio dot in compose destination selector — green instead of yellow in public context */
body.public-context .radio-dot{ background:#7abd8e !important; }
/* Retag warning box, move-to dropdown, edit textarea — green bg in public context */
body.public-context .retag-warning{ background:#7abd8e !important; }
body.public-context .move-to-dropdown{ background:#7abd8e !important; }
body.public-context .edit-textarea{ background:#7abd8e !important; }
/* compose-submit color now driven by inline styles in the modal */
/* Expand/collapse chip — green text instead of yellow in public context */
body.public-context .expand-chip{ color:#7abd8e !important; }

.brandLink{ cursor:pointer; }
.brandLink:focus-visible{ outline:2px dashed var(--dos-cyan); outline-offset:2px; }

/* Friend room scroll — hide scrollbar */
.friendRoomScroll::-webkit-scrollbar{ display:none; }

/* ── Top header layout ──────────────────────────────────────────────
   Wide screens (>=1134px): single visual row.
     - Left: logo + search stacked (flush to left of viewport)
     - Center: pill + friend-room scroll aligned to the .container width (672px / 92vw centered)
     - Right: sign-out + admin (flush to right of viewport)
   Narrow screens (<1134px): two rows stacked.
     Row 1: logo+search (left) ... signout+admin (right)
     Row 2: pill + friend-room scroll (centered on content column)
*/
/* ── Fixed top header (non-homepage) ──────────────────────────────────
   Two independent fixed elements:
   - .topHeaderColumn — centered at .container width, holds [logo][search][pill]
     in a single row. Transparent background; pointer-events:none on the
     wrapper so clicks pass through empty areas.
   - .topHeaderGutter — top-right cluster with sign-out + admin, fixed to
     the browser viewport edge.
*/
.topHeaderColumn{
  position:fixed; top:14px; left:50%; transform:translateX(-50%);
  width:min(672px, 92vw);
  z-index:1000;
  display:flex; align-items:center; justify-content:space-between; gap:10px;
  pointer-events:none;
}
.topHeaderColumn button,
.topHeaderColumn a,
.topHeaderColumn input,
.topHeaderColumn select,
.topHeaderColumn textarea,
.topHeaderColumn .brand,
.topHeaderColumn .splashSearchWrap,
.topHeaderColumn .profileChip{
  pointer-events:auto;
}
.topHeaderGutter{
  position:fixed; top:14px; right:14px; z-index:1001;
  display:flex; align-items:center; gap:10px;
}
.topHeaderContentRow{
  width:min(672px, 92vw);
  margin:40px auto 0;
  display:flex; justify-content:space-between; align-items:center; gap:10px; min-width:0;
}
@media(min-width:1134px){
  .topHeaderContentRow{
    position:absolute; top:0; left:50%; transform:translateX(-50%);
    margin:0; height:38px;
  }
}
/* The search shrinks to 176px inside the header stack. Override .splashSearchWrap defaults. */
.topHeaderSearch .splashSearchWrap{ width:176px; height:30px; margin:0; }
.topHeaderSearch .splashSearch{ font-size:13px; padding:0 28px; }
.topHeaderSearch .splashSearchIcon{ font-size:14px; }

*{ box-sizing:border-box; }
html,body,#root{ height:100%; }
body{
  margin:0;
  background: linear-gradient(to bottom, #c8e4b0 0px, var(--dos-bg) 180px) fixed, var(--dos-bg);
  background-attachment: fixed;
  color:var(--dos-fg);
  font-size:var(--t3);
  line-height:1.5;
  letter-spacing:0.01em;
  font-family: "Inter","Nunito",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  font-weight:400;
}
/* On the homepage the narrative controls the gradient via a React overlay — kill the CSS one */
body.homepage{
  background: var(--dos-bg);
}
body.has-header{
  background: linear-gradient(to top, #c8e4b0 0px, var(--dos-bg) 250px) fixed, var(--dos-bg);
  background-attachment: fixed;
}

/* full-bleed helpers */
.bleed{ width:100vw; margin-left:calc(50% - 50vw); margin-right:calc(50% - 50vw); }
.bleed-line{ display:none; }

/* layout primitives */
.container{ width:min(672px, 92vw); margin:0 auto; background:transparent; }
hr{ display:none; }
.title{ color:var(--dos-light); font-weight:600; letter-spacing:0.005em; font-size:var(--t2); }
.muted{ color:var(--dos-gray); font-size:var(--t4); }
.card{ background:transparent; border:none; padding:12px; border-radius:24px; }

/* controls */
.badge{
  background:transparent; color:var(--dos-fg); border:2px solid var(--dos-border);
  border-radius:9999px; padding:8px 12px; outline:none; font-weight:500;
}
.badge:focus{ border-color:var(--dos-cyan); }
.btn{
  background:transparent; color:var(--dos-fg); border:2px solid var(--dos-border);
  border-radius:9999px; padding:6px 12px; cursor:pointer; font-weight:500;
}
/* Consistent close-X button: circle, white outline, white X, transparent fill */
.close-x{
  width:28px; height:28px; padding:0; background:transparent;
  border:2px solid #fff; border-radius:50%; color:#fff;
  display:inline-flex; align-items:center; justify-content:center;
  cursor:pointer; flex-shrink:0; line-height:1;
}
.close-x:hover{ background:rgba(255,255,255,0.15); }
.btn.primary{ border-color:var(--dos-cyan); color:var(--dos-cyan); }
.btn:hover{ background:var(--dos-blue); color:white; border-color:var(--dos-light); }
.btn-danger{ border-color:var(--danger); color:var(--danger); }
.btn-danger:hover{ background:var(--danger); color:#fff; border-color:var(--danger); }
/* Standardized write/post button: canon-green fill, white outline, white text */
.btn.post{ background: #7abd8e; color: #fff; border-color: #fff; }
.btn.post:hover{ background: #6aad7e; border-color: #fff; color: #fff; }
/* Fix dark inputs/textareas */
select {
  color: var(--dos-fg);
  background: rgba(0,0,0,0.12);
  appearance: none;
  -webkit-appearance: none;
  border: 2px solid var(--dos-border);
  border-radius: 9999px;
  padding: 5px 32px 5px 14px;
  font-size: 14px;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23ffffff' stroke-width='2' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
}
input, textarea { color: #000; background: #fff; }
input::placeholder, textarea::placeholder { color: #aaa; }
/* Ensure compose/reply typing fields stay white even when .badge or .card class is present */
input.badge, textarea.card, textarea { background: #fff !important; color: #000 !important; }
input.badge::placeholder, textarea::placeholder { color: #aaa !important; }
.h40{ height:40px; display:inline-flex; align-items:center; }

/* sticky bars */
header.site{
  position:sticky; top:0; z-index:90; background:rgba(122,189,142,0.98);
  height: var(--site-header-h);
}
.brand{
  line-height:0; font-size:0;
  display:inline-flex; align-items:center;
}


.siteTagline{
  text-align:center;
  font-size:var(--t2);
  font-weight:600;
  letter-spacing:0.02em;
  margin:4px 0 8px;
}

/* On wider screens, visually tuck the tagline up toward the header bar */
@media (min-width: 901px){
  .siteTagline{
    margin-top:-40px;
  }
}

/* On narrower screens, let it sit clearly below and be a bit smaller */
@media (max-width: 1130px){
  .siteTagline{
    font-size:var(--t2);
    padding:0 16px;
    margin-top:-8px;
  }
}




.stickybar{
  position:sticky; top:var(--site-header-h); z-index:70; background:rgba(122,189,142,0.98);
}

/* banner row 1: title + sort — stacks on mobile */
.bannerRow1{
  display:flex; align-items:center; justify-content:space-between;
  gap:12px; padding:8px 0;
}
/* subtle "hang left" headers */
.hangL{ transform: translateX(-48px); }
/* Profile page folder content — extends border line 48px left to align with hangL headers */
.hangLContent{ margin-left:-48px; padding-left:48px; }

@media (max-width: 768px){
  .bannerRow1{
    flex-direction:column; align-items:center; justify-content:center;
    gap:8px; padding:8px 0; text-align:center;
  }
  .hangL{ transform:none; }
  .hangLContent{ margin-left:0; padding-left:0; }
}

/* homepage search */
.splashSearchWrap{
  position:relative; display:flex; align-items:center;
  width:288px; max-width:90vw; margin:20px auto;
  height:40px; border:2px solid #adc8d7; border-radius:9999px;
  padding:0 16px;
  background:#fef8ea; border-color:#fef8ea; color:#c39431;
}
.splashSearch{
  background:transparent; border:none !important; border-radius:0 !important; outline:none;
  position:absolute; left:0; right:0;
  text-align:center; padding:0 36px;
  font-size:16px; font-weight:600; letter-spacing:0.01em; color:inherit;
}
.splashSearch::placeholder{ color:#f45028; opacity:1; }
.splashSearchIcon{ font-size:18px; opacity:.85; flex-shrink:0; line-height:1; position:relative; z-index:1; }
.dropdownPanel{
  position:absolute; top:calc(100% + 8px); width:288px; max-width:90vw; z-index:9999;
  max-height:300px; overflow:auto; background:rgba(122,189,142,0.97);
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
  border:none; border-radius:23px; box-shadow:0 8px 23px rgba(0,0,0,0.15);
  color:var(--dos-fg);
}

/* "Your shows" */
.listPill{
  width:288px; max-width:90vw; height:40px; border-radius:9999px; padding:0 23px;
  font-size:16px; font-weight:600; letter-spacing:0.01em;
  display:inline-flex; align-items:center; justify-content:center; border:2px solid var(--dos-border);
  text-align:left; text-align-last:left; justify-content:flex-start;
}

/* forum search */
.inlineSearch{ width:520px; max-width:48vw; position:relative; }
.inlineSearch .inlineSearchClear{
  position:absolute; right:8px; top:50%; transform:translateY(-50%); background:transparent; border:none; padding:0;
  font-size:18px; line-height:1; cursor:pointer; color:var(--dos-gray);
}

/* thread/replies */
.threadCard{ border:none; }
.replyBarNew{ background:var(--green); height:6px; }
.clamp3{ display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.redacted{ background:#e8e4dc; color:#888; border:2px solid #ccc; border-radius:23px; }

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
.flash-cover{ position:absolute; inset:0; background:rgba(122,189,142,0.55); pointer-events:none; border-radius:inherit; animation:flash-blink 1.2s ease forwards; }

/* like badge */
.likeWrap{ display:inline-flex; align-items:baseline; gap:4px; user-select:none; }
.likeThis{ font-style:italic; font-weight:700; }

/* watch diary — folder-tab row attached to front page, background pages for depth */
.diaryOuter{
  position:relative; z-index:0;
  margin-top:16px; margin-left:-56px; margin-bottom:24px;
  width: calc(100% + 116px);
}
/* background pages — visual depth only, lower-left cascade */
.diaryBackPage{
  position:absolute; inset:0;
  border:2px solid rgba(255,255,255,0.55);
  background:var(--dos-bg);
}
/* Scroll wrapper around the tab row — lets tabs scroll horizontally while
   preserving the 3px active-tab visual overlap with the card below.
   padding-bottom:4px gives room for the overlap; margin-bottom:-4px
   cancels the extra space so the card sits flush. */
.diaryTabScroller{
  overflow-x:auto; overflow-y:clip;
  /* overflow-y:clip (unlike visible) does NOT trigger the CSS spec's
     visible→auto promotion, so the active tab's -3px bottom overlap
     renders through while horizontal scrolling still works. */
  padding-bottom:4px; margin-bottom:-4px;
  scrollbar-width:none; -webkit-overflow-scrolling:touch;
}
.diaryTabScroller::-webkit-scrollbar{ display:none; }

/* folder tab row sits directly above the front card */
.diaryTabRow{
  display:flex; align-items:flex-end; gap:4px;
  position:relative; z-index:2; overflow:visible;
  padding-left:36px;
  /* min-width keeps the row wider than the scroller so tabs don't wrap */
  min-width:max-content;
}
.diaryTab{
  padding:4px 12px;
  background:rgba(0,0,0,0.22);
  border:2px solid rgba(255,255,255,0.85); border-bottom:none;
  border-radius:8px 8px 0 0;
  color:#fff; font-size:var(--t4); font-weight:500;
  cursor:pointer; white-space:nowrap; position:relative;
}
.diaryTab.active{
  padding:8px 24px;
  background:var(--dos-bg);
  border-color:#fff;
  border-bottom:2px solid var(--dos-bg);
  font-size:var(--t3); font-weight:800;
  text-decoration:none;
  margin-bottom:-3px;
}
/* front card */
.diaryCardWrap{
  position:relative; z-index:1;
}
.diaryCardWrap > .card{ border:2px solid #fff; border-radius:0; padding:0; box-shadow:none; background:var(--dos-bg); }
.diaryCardWrap .threadCard{ border-radius:0; }
.diaryCardWrap .threadCard:last-child{ margin-bottom:0; }

/* Action bar sits above the scroll area — bar is NOT inside the scroll container,
   so entries never bleed through above it. Card becomes a flex column.
   Horizontal padding: 56 left / 60 right makes the inner controls line up with
   the .container left/right edges used elsewhere on the site. */
.profileActionBar{
  flex-shrink:0;
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  background:var(--dos-bg);
  /* Card extends 56L / 60R beyond .container via .diaryOuter's negative
     margin and widened width. The action bar lives inside the card's
     content box (card has a 2px border, padding:0). Padding values:
       left  = card-outer-L-offset (56) − card-border (2) = 54
       right = card-outer-R-offset (60) − card-border (2) = 58
     This puts the write button's outer-left and the dropdown's outer-
     right flush with the content column edges. */
  padding:24px 58px 16px 54px;
  border-bottom:none;
}
/* Scrollable entries region that fills the remaining card height.
   Thread cards inside have an inline margin-left:20 and .card padding-left:12
   (total +32 extra offset), so scrollArea padding-left is 56 − 32 = 24 to
   land the entry text at the .container left edge. Right side keeps the
   full 60 since the threadCard has no right margin. */
.diaryScrollArea{
  flex:1; overflow-y:auto;
  padding:12px 60px 32px 24px;
}

/* profile chip */
.profileChip{
  display:inline-flex; align-items:center; gap:8px; cursor:pointer;
  border:none; padding:6px 10px; border-radius:9999px;
  background: var(--dos-user); height:34px; box-sizing:border-box;
}
.avatar{
  width:24px; height:24px; border:none; border-radius:50%;
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

  /* Diary: tighten on mobile */
  .diaryOuter{ margin-top:8px; margin-left:0; margin-right:0; margin-bottom:12px; width:100%; }
  /* Remove the background depth pages — just show the single front card on mobile */
  .diaryBackPage{ display:none; }
  .diaryTab{ font-size:12px; padding:4px 10px; }
  .diaryTab.active{ font-size:12px; padding:6px 12px; }
  /* Flush first tab with the card's left border line */
  .diaryTabRow{ padding-left:0; }
  /* Keep border, zero padding — action bar + scroll area handle their own padding */
  .diaryCardWrap > .card{ border:2px solid #fff !important; padding:0 !important; }
  .profileActionBar{ padding:10px 16px; }
  .diaryScrollArea{ padding:8px 16px 24px 16px; }
  /* Entry cards: remove the desktop left-margin offset so they're centred in the box */
  .diaryCardWrap .threadCard{ margin-left:0 !important; margin-right:0 !important; }

  /* Forum banner: smaller title so it doesn't wrap awkwardly */
  .bannerTitle{ font-size:17px !important; letter-spacing:0.01em !important; }
  .stickybar .badge{ font-size:15px !important; padding:9px 14px !important; }
  .stickybar .btn{ font-size:15px !important; padding:8px 14px !important; height:auto !important; }

  /* Thread cards: tighten horizontal padding so content has more room */
  .card.threadCard{ padding-left:10px; padding-right:10px; }

  /* Homepage hero */
  .popularHeading{ font-size:16px !important; }

  /* Explanation modals: smaller text so tall modals fit on screen */
  .explanation-card p{ font-size:14px !important; line-height:1.5 !important; margin-bottom:12px !important; }

  /* Profile page: neutralise desktop-only negative margins */
  .profile-journal-heading{ margin-left:0 !important; }
  .profile-responses-section{ margin-top:48px !important; }
  .profile-public-responses{ margin-top:48px !important; }
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
  border-left: 2px solid var(--dos-border);
  background: rgba(0,0,0,0.07);
  padding: 8px 12px;
  margin: 8px 0;
  border-radius: 8px;
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
  color: #7abd8e;
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
  text-decoration: underline dotted rgba(122,189,142,0.55);
  text-underline-offset: 3px;
  text-decoration-thickness: 1px;
  cursor: pointer;
}

/* On the original thread entry (yellow bg) sups and underlines must be white */
.thread-entry-body .cite-sup-btn { color: #fff; }
.thread-entry-body .quoted-passage {
  text-decoration-color: rgba(255,255,255,0.55);
}

/* ── Explanation text ────────────────────────────────────────────────────────
   Used for onboarding / instructional popups. Light-blue card, black text,
   no border. Standard widths: Modal width="min(520px,92vw)".
   Text: 22px / weight 500 / lh 1.7 (main), 19px / italic / opacity 0.65 (footnote).
   Button: .btn with color #000 / borderColor #000.
   ──────────────────────────────────────────────────────────────────────────── */
.explanation-card {
  background: #adc8d7 !important;
  border: none !important;
  color: #000 !important;
}
.explanation-card .btn {
  color: #000 !important;
  border-color: #000 !important;
}
.explanation-card .btn:hover {
  background: rgba(0,0,0,0.08) !important;
  color: #fff !important;
  border-color: #000 !important;
}

/* Quote hint popup — appears above the Quote button when no text is selected */
.quote-hint-popup {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: 280px;
  background: var(--dos-bg);
  color: var(--dos-fg);
  border: none;
  border-radius: 16px;
  padding: 12px 14px 10px;
  font-size: 13px;
  line-height: 1.5;
  z-index: 100;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
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
  color: var(--dos-fg);
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

/* Combined "Insert quotation from [user]. ×" pill in composer */
.insert-quote-chip {
  display: inline-flex;
  align-items: stretch;
  border: 2px solid var(--dos-border);
  border-radius: 9999px;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
}
.insert-quote-main {
  background: transparent;
  color: var(--dos-fg);
  border: none;
  cursor: pointer;
  padding: 5px 10px 5px 14px;
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  line-height: 1.3;
}
.insert-quote-main:hover { background: var(--dos-blue); color: white; }
.insert-quote-cancel {
  background: transparent;
  border: none;
  border-left: 1.5px solid rgba(255,255,255,0.45);
  color: var(--dos-fg);
  cursor: pointer;
  padding: 5px 12px;
  font-size: 15px;
  line-height: 1;
  opacity: 0.7;
  font-family: inherit;
}
.insert-quote-cancel:hover { opacity: 1; background: rgba(0,0,0,0.08); }

/* Pending reference chip — used for link type and post-insert quote state */
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

/* ── Prompt reference (rendered in thread body) ─────────────────────────────
   Editorial blockquote — no border, serif font, PROMPT: label via ::before  */
.prompt-ref {
  background: transparent;
  padding: 6px 0 6px 0;
  margin: 10px 0;
  border: none;
  font-style: italic;
  font-family: Georgia, 'Palatino Linotype', Palatino, serif;
  font-size: 14px;
  line-height: 1.6;
  color: #4b8f6c;
  opacity: 1;
}
.prompt-ref::before {
  content: "PROMPT:";
  display: block;
  font-family: Georgia, 'Palatino Linotype', Palatino, serif;
  font-style: normal;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #4b8f6c;
  margin-bottom: 3px;
}

/* ── Prompt card (the floating suggestion card) ─────────────────────────── */
.prompt-card {
  background: #adc8d7;
  border: none;
  border-radius: 16px;
  padding: 16px 18px 14px;
  color: #000;
  margin-bottom: 12px;
}

/* Buttons inside the prompt card */
.prompt-card-btn {
  background: transparent;
  border: 1.5px solid rgba(0,0,0,0.3);
  border-radius: 9999px;
  padding: 5px 12px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  color: #000;
  font-family: inherit;
  transition: background 120ms;
}
.prompt-card-btn:hover {
  background: rgba(0,0,0,0.08);
}
.prompt-card-btn--use {
  background: #355eb8;
  color: #fff;
  border-color: #355eb8;
}
.prompt-card-btn--use:hover {
  background: #1a44a8;
  border-color: #1a44a8;
}

/* ── Prompt trigger button (inside compose / response area) ─────────────── */
.prompt-btn {
  background: var(--dos-bg);
  border: 2px solid #fff;
  padding: 5px 10px;
  font-size: 13px;
  white-space: nowrap;
  font-weight: 500;
  cursor: pointer;
  color: #fff;
  opacity: 0.75;
  font-family: inherit;
  border-radius: 9999px;
  letter-spacing: 0.01em;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.prompt-btn:hover {
  opacity: 1;
}

`;

  const el = document.createElement("style"); el.id = id; el.textContent = css; document.head.appendChild(el);
}
