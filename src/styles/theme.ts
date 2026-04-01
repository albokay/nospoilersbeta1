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
.bleed-line{ width:100vw; margin-left:calc(50% - 50vw); border:0; border-top:1px solid var(--dos-border); }

/* layout primitives */
.container{ width:min(1040px, 92vw); margin:0 auto; background:transparent; }
hr{ border:none; border-top:1px solid var(--dos-border); }
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
input, textarea, select { color: var(--dos-fg); background: rgba(0,0,0,0.12); }
input::placeholder, textarea::placeholder { color: var(--dos-gray); }
.h40{ height:40px; display:inline-flex; align-items:center; }

/* sticky bars */
header.site{
  position:sticky; top:0; z-index:90; background:rgba(222,168,56,0.98);
  border-bottom:1px solid var(--dos-border);
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
  position:sticky; top:0; z-index:70; border-top:1px solid var(--dos-border);
  border-bottom:1px solid var(--dos-border); background:rgba(222,168,56,0.98);
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
  position:relative; display:flex; align-items:center; justify-content:flex-start;
  width:288px; max-width:90vw; margin:20px auto;
  height:40px; border:3px solid var(--dos-border); border-radius:9999px;
  padding:0 16px; gap:5px;
}
.splashSearch{
  background:transparent; border:none !important; border-radius:0 !important; outline:none;
  flex:1; min-width:0; width:100%;
  text-align:left; padding:0;
  font-size:15px; font-weight:600; letter-spacing:0.01em; color:inherit;
}
.splashSearch::placeholder{ color:inherit; opacity:1; }
.splashSearchIcon{ font-size:18px; opacity:.85; flex-shrink:0; line-height:1; }
.dropdownPanel{
  position:absolute; top:calc(100% + 8px); width:288px; max-width:90vw; z-index:9999;
  max-height:320px; overflow:auto; background:rgba(222,168,56,0.97);
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
  border:3px solid var(--dos-border); border-radius:23px; box-shadow:0 8px 23px rgba(0,0,0,0.15);
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
.flash-cover{ position:absolute; inset:0; background:rgba(255,255,255,0.44); pointer-events:none; opacity:1; transition:opacity 2000ms ease; }

/* like badge */
.likeWrap{ display:inline-flex; align-items:baseline; gap:3px; user-select:none; }
.likeThis{ font-style:italic; font-weight:700; }

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

/* buttons inside white reply cards */
.btn-on-white{ color:#888 !important; border-color:#ccc !important; background:transparent !important; }
.btn-on-white:hover{ background:#aaa !important; border-color:#aaa !important; color:#fff !important; }

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
  zoom: .9;          /* ~90% */
}

/* Optional: keep text crisp on high-DPI while zoomed */
body { -webkit-font-smoothing: antialiased; }

`;
  const el = document.createElement("style"); el.id = id; el.textContent = css; document.head.appendChild(el);
}
