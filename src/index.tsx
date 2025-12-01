import React, { useMemo, useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import ExtensionDock from "./extensions/ExtensionDock";


/** NO-SPOILERS — single-file demo (DOS theme) with Profile tabs + scroll windows + compose post */


const SINGLE_PAGE = true;
const GLOBAL_HEADER_H = 72;
const ROW_PAD_Y = 8; // unified vertical padding for banner rows

/* ------------------------------ DOS THEME ------------------------------ */
function injectDOSStyles() {
  const id = "dos-theme";
  if (document.getElementById(id)) return;
  const css = `
:root{
  --dos-bg:#000000; --dos-fg:#C6C6C6; --dos-blue:#0000AA; --dos-cyan:#00FFFF;
  --dos-gray:#8A8A8A; --dos-light:#E6E6E6; --dos-border:#C0C0C0;
  --dos-accent:#FFFF55; --danger:#ff3030; --green:#00AA00;
}

.brandLink{ cursor:pointer; }
.brandLink:focus-visible{ outline:2px dashed var(--dos-cyan); outline-offset:2px; }

*{ box-sizing:border-box; }
html,body,#root{ height:100%; background:var(--dos-bg); }
body{
  margin:0;
  background:var(--dos-bg);
  color:var(--dos-fg);
  font-size:14px;
  line-height:1.5;
  letter-spacing:0.01em;
  font-family: "IBM Plex Mono","DM Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono","DejaVu Sans Mono","Monaco","Courier New",monospace;
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
.card{ background:transparent; border:1px solid var(--dos-border); padding:12px; }

/* controls */
.badge{
  background:transparent; color:var(--dos-fg); border:1px solid var(--dos-border);
  border-radius:9999px; padding:10px 14px; outline:none; font-weight:500;
}
.badge:focus{ border-color:var(--dos-cyan); }
.btn{
  background:transparent; color:var(--dos-fg); border:1px solid var(--dos-border);
  border-radius:9999px; padding:6px 12px; cursor:pointer; font-weight:500;
}
.btn.primary{ border-color:var(--dos-cyan); color:var(--dos-cyan); }
.btn:hover{ background:var(--dos-blue); color:white; border-color:var(--dos-light); }
.btn-danger{ border-color:var(--danger); color:var(--danger); }
.btn-danger:hover{ background:var(--danger); color:#fff; border-color:var(--danger); }
/* Green styling for +Post */
.btn.post{ border-color: var(--green); color: var(--green); }
/* Fix dark inputs/textareas */
input, textarea, select { color: var(--dos-fg); background: rgba(0,0,0,0.2); }
input::placeholder, textarea::placeholder { color: var(--dos-gray); }
.h40{ height:40px; display:inline-flex; align-items:center; }

/* sticky bars */
header.site{
  position:sticky; top:0; z-index:90; background:rgba(0,0,0,0.99);
  border-bottom:1px solid var(--dos-border);
}
.brand{
  color:var(--dos-accent);
  font-size:46px;
  line-height:1; font-weight:800; letter-spacing:0.02em;
}


.siteTagline{
  text-align:center;
  font-size:18px;
  font-weight:600;
  text-transform:uppercase;
  letter-spacing:0.02em;
  margin:4px 0 10px;
}

/* On wider screens, visually tuck the tagline up toward the header bar */
@media (min-width: 901px){
  .siteTagline{
    margin-top:-39px;   /* pulls it up closer under NO-SPOILERS */
  }
}

/* On narrower screens, let it sit clearly below and be a bit smaller */
@media (max-width: 1280px){
  .siteTagline{
    font-size:18px;
    padding:0 16px;
    margin-top:-6px;     /* no negative margin = “pops down” */
  }
}




.stickybar{
  position:sticky; top:0; z-index:70; border-top:1px solid var(--dos-border);
  border-bottom:1px solid var(--dos-border); background:rgba(0,0,0,0.995);
}

/* homepage search */
.splashSearchWrap{ position:relative; display:flex; justify-content:center; margin:20px 0; }
.splashSearch{
  width:480px; max-width:90vw; text-align:center; padding-left:32px;
  font-size:15px; font-weight:600; letter-spacing:0.01em;
}
.splashSearchIcon{ position:absolute; left:calc(50% - 240px + 10px); top:50%; transform:translateY(-50%); font-size:15px; opacity:.7; }
.dropdownPanel{
  position:absolute; top:calc(100% + 8px); width:480px; max-width:90vw; z-index:9999;
  max-height:320px; overflow:auto; background:rgba(0,0,0,0.55);
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
}

/* "Your shows" */
.listPill{
  width:480px; max-width:90vw; height:40px; border-radius:9999px; padding:0 24px;
  font-size:15px; font-weight:600; letter-spacing:0.01em;
  display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--dos-border);
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
.redacted{ background:#222; color:#E5E7EB; border:1px solid #555; }

/* mode toggle */
.modeToggle{ width:240px; height:38px; }
.modeKnob{ transition:left 160ms ease; }

/* flash overlay */
.flash-cover{ position:absolute; inset:0; background:rgba(255,255,255,0.44); pointer-events:none; opacity:1; transition:opacity 2000ms ease; }

/* like badge */
.likeWrap{ display:inline-flex; align-items:center; gap:6px; user-select:none; }
.likeDots{ letter-spacing:1px; }
.likeBang{ font-weight:900; }
.likeThis{ font-style:italic; font-weight:900; }

/* profile chip */
.profileChip{
  display:inline-flex; align-items:center; gap:8px; cursor:pointer;
  border:1px solid var(--dos-border); padding:6px 10px; border-radius:9999px;
}
.avatar{
  width:22px; height:22px; border:1px solid var(--dos-border); border-radius:50%;
  display:inline-grid; place-items:center; font-size:12px; line-height:1;
  background:rgba(0,0,0,.3);
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
  background:#111; border:1px solid var(--dos-border); border-radius:8px;
}
.scrollWin::-webkit-scrollbar-thumb:hover{ background:#222; }

/* subtle "hang left" headers */
.hangL{ transform: translateX(-45px); } /* ← tweak this */

/* bottom-right replies badge */
.replyCount{
  position:absolute; right:12px; bottom:8px;
  font-size:12px; color:var(--dos-gray);
}

/* homepage blurb spacing */
.homeAbout{ margin: 36px auto 16px; }
.homeAbout p{ font-size:15px; line-height:1.6; margin: 8px 0; color: var(--dos-fg); }
/* Frontpage accent color override */
.frontAccent, 
.frontAccent p, 
.frontAccent a, 
.frontAccent b {
  color: var(--danger, #ff3b30) !important;
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

/* ------------------------------ Portal Modal ------------------------------ */
function Modal({ children, onClose }:{ children: React.ReactNode; onClose: () => void; }) {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  if (!nodeRef.current) {
    nodeRef.current = document.createElement("div");
    nodeRef.current.setAttribute("data-modal-root", "true");
  }
  useEffect(() => {
    const node = nodeRef.current!;
    document.body.appendChild(node);
    return () => { try { document.body.removeChild(node); } catch {} };
  }, []);

  const modal = (
    <div style={{ position:"fixed", inset:0, zIndex:2147483000, display:"grid", placeItems:"center" }}>
      <div onClick={onClose} style={{ position:"absolute", inset:0, background:"rgba(0,0,0,.55)" }} />
      <div className="card" style={{ position:"relative", width:"min(820px,92vw)", background:"rgba(0,0,0,0.25)",
        backdropFilter:"blur(10px)", WebkitBackdropFilter:"blur(10px)" }}>
        {children}
      </div>
    </div>
  );

  return createPortal(modal, nodeRef.current);
}

/* ------------------------------ Catalog & Data ------------------------------ */
const seedShows = [
  { id: "bb", name: "Breaking Bad", seasons: [7, 13, 13, 13, 16] },
  { id: "penguin", name: "The Penguin", seasons: [8] },
  { id: "severance", name: "Severance", seasons: [9, 10] },
  { id: "got", name: "Game of Thrones", seasons: [10,10,10,10,10,10,7,6] },
  { id: "hotd", name: "House of the Dragon", seasons: [10,8] },
  { id: "bcs", name: "Better Call Saul", seasons: [10,10,10,10,10,13] },
  { id: "sopranos", name: "The Sopranos", seasons: [13,13,13,13,13,21] },
  { id: "wire", name: "The Wire", seasons: [13,12,12,13,10] },
  { id: "madmen", name: "Mad Men", seasons: [13,13,13,13,13,14,14] },
  { id: "succession", name: "Succession", seasons: [10,10,9,10] },
  { id: "fargo", name: "Fargo", seasons: [10,10,11,11,10] },
  { id: "chernobyl", name: "Chernobyl", seasons: [5] },
  { id: "td", name: "True Detective", seasons: [8,8,8,6] },
  { id: "westworld", name: "Westworld", seasons: [10,10,8,8] },
  { id: "blackmirror", name: "Black Mirror", seasons: [3,3,6,6,3,5] },
  { id: "mrrobot", name: "Mr. Robot", seasons: [10,12,10,13] },
  { id: "ozark", name: "Ozark", seasons: [10,10,10,14] },
  { id: "thecrown", name: "The Crown", seasons: [10,10,10,10,10,10] },
  { id: "barry", name: "Barry", seasons: [8,8,8,8] },
  { id: "atlanta", name: "Atlanta", seasons: [10,11,10,10] },
  { id: "thebear", name: "The Bear", seasons: [8,10,10] },
  { id: "strangerthings", name: "Stranger Things", seasons: [8,9,8,9,8] },
  { id: "thelastofus", name: "The Last of Us", seasons: [9,7] },
  { id: "andor", name: "Andor", seasons: [12,12] },
  { id: "simshow", name: "Simulated Show", seasons: [8,8,8,8,8] },
];

const USERNAMES = [
  "hi_itsme",
  "BlueSkyChem","RVEnthusiast","LosPollos_99","Heisenfan","CactoidPrime",
  "BetterCallMe","PinkmanVibes","MineralCollector","FlyEpisodeDefender","FringWatch",
  "ABQLocal","CarWashOwner","SaulGoodDude","MadrigalEnjoyer","LydiaBean",
  "GusGusNoSpoils","GaleSingAlong","TucoRageQuit","HuellRules","MikeIsCalm"
];

const TITLES: Record<string,string[]> = {
  bb: [
    "Blue vs. purity chat","Desert as a character","Cold open masterclass","The fly episode appreciation",
    "Choices without saying them out loud","Phone call acting clinic","Green & purple color theory",
    "A certain bell… handled tastefully","Box cutter vibes (no details)","Car wash arc setup","Moral math done visually",
    "Silence and tension working together","The RV a moving stage","Cooking scenes as choreography","That one hallway shot"
  ],
  severance: ["Innie vs. Outie ethics (gentle)","Lumon’s architecture as control","Wellness session cadence","Numbers that feel like feelings","Waffle party aesthetics","Hallway symmetry & dread","Corporate scripture tone study","Orientation theater beats","Break room pacing","Rival departments body language","Knickknacks as ritual","Elevator thresholds","Board as presence","Blue-white palette moods","Music cues and memory seams"],
  penguin: ["Gotham as a character","Club lighting and smoke","Mob politics, not plot points","Patience as power for Oz","Street-level power plays","Rain-soaked frames","Costume texture notes","The new order brewing","Chases with heft","Quiet menace moments","Side crews with agency","Allegiances shifting looks","GCPD as shadow","Night shots that breathe","Territory whispers"],
};
const PREVIEW_BANK: Record<string,string[]> = {
  bb: [
    "The camera treats the desert like an uncluttered stage where small choices read loudly.",
    "Color acts like a mood ring here; nothing is random yet nothing is shouted.",
    "Tension comes from tasks going slightly wrong rather than sudden twists.",
    "The sound mix leaves room for silence to press on the characters.",
    "Props feel practical, not symbolic, which is why they land when we notice them.",
    "You can sense the characters doing math in their heads without dialogue carrying it.",
    "Even the funniest lines are loaded with dread, but it stays playful on the surface.",
    "Editing lingers a beat longer than TV usually allows, and it matters.",
    "The show trusts you to infer, and that trust is energizing.",
  ],
  severance: [
    "The geometry of the space tells a story about permission and obedience.",
    "Every courtesy sounds like choreography; politeness as choreography.",
    "Music is a soft hand on the shoulder guiding you into or out of trance.",
    "Paper and screens feel like religious artifacts rather than tools.",
    "The show makes bureaucracy tactile; you can almost feel the ceiling tiles.",
    "Faces are framed like signage, then allowed to humanize on the next cut.",
    "The script has fun with corporate verbs while tip-toeing around meaning.",
    "The palette is clean but ends up feeling haunted rather than sterile.",
    "Comedy flirts with horror whenever people agree too quickly.",
  ],
  penguin: [
    "Gotham’s streets glisten like they’re always mid-conversation with the rain.",
    "Power shifts are communicated by who’s willing to wait in a room.",
    "The club lighting doesn’t flatter; it interrogates.",
    "Cars feel weighty and slightly mean; the camera respects momentum.",
    "Everyone dresses like they’ve already chosen a side, even if they haven’t.",
    "Dialog pauses are longer than is comfortable and that’s the point.",
    "The sound of shoes on wet concrete is its own supporting character.",
    "Violence is implied by posture more than choreography.",
    "You can smell the leather and gasoline through the screen.",
  ],
};
const REPLIES_BANK: Record<string,string[]> = {
  bb: [
    "The blocking lets two people share the frame without sharing control.",
    "Loved how a practical object becomes a clock for the scene without announcing itself.",
    "The humor never empties the tension; it just loosens the lid for a second.",
    "Wild how quiet the score goes when someone makes the bolder choice.",
    "The palette keeps drifting toward nausea then snaps back to normal—great trick.",
    "Even the establishing shots feel like moral weather reports.",
    "When the camera steps back, it isn’t distance; it’s judgment.",
    "Sound of a machine idling in the background made my shoulders tense.",
    "The cut to hands is doing more work than the dialogue and I adore it.",
    "Every time a door frame slices the screen, it feels like a tiny verdict."
  ],
  severance: [
    "The politeness lands like static; everyone is buzzed with manners.",
    "Hallways do geography and psychology at once—efficient and unnerving.",
    "The score nudges you sideways instead of forward, which fits.",
    "Paper textures make the tech feel ceremonial rather than modern.",
    "Actors deliver corporate lines like they’re reading a map with no legend.",
    "The camera lingers just long enough to make a desk feel like a ritual site.",
    "Loved the way eye contact is rationed here—so specific.",
    "Every click echoes like a small oath.",
    "Light announces itself the way a manager would—helpful but watched.",
    "Comedy arrives on elevator doors: ding, joke, dread."
  ],
  penguin: [
    "Night exteriors have just enough sodium to taste real, not glossy.",
    "Standing still reads as power; great direction.",
    "Cars growl without showing off, which makes the moments pop.",
    "Club scenes feel humid; the camera doesn’t wipe the sweat.",
    "Loved a detail where a character fixes a sleeve as punctuation.",
    "Sound of money counting offscreen did more than an insert would.",
    "Coats hang like declarations; silhouette work is strong.",
    "The cut to a boot heel said everything.",
    "Low angles add weight without comic-book exaggeration.",
    "Quiet beats are allowed to smell like rain and metal."
  ],
};

/* --------------------------------- Utils --------------------------------- */
type Thread = {
  id: string; showId: string; season: number; episode: number;
  author: string; titleBase: string; preview: string; body: string; updatedAt: number;
  likes: number;
  isPrivate?: boolean;
};
type Reply = {
  id: string; threadId: string; showId: string; season: number; episode: number;
  author: string; body: string; updatedAt: number; replyToId?: string;
  likes: number;
};

const randBetween = (min:number,max:number)=> Math.floor(Math.random()*(max-min+1))+min;
const pick = <T,>(arr:T[])=> arr[randBetween(0, arr.length-1)];
const pickMany = <T,>(arr:T[], n:number)=>{
  const used = new Set<number>(); const out:T[] = [];
  while (out.length < Math.min(n, arr.length)) { const i = randBetween(0, arr.length-1); if (!used.has(i)) { used.add(i); out.push(arr[i]); } }
  return out;
};

function composePreview(showId:string){
  const bank = PREVIEW_BANK[showId] || [
    "The camera trusts the room to do some of the talking.",
    "Editing builds pressure without cutting the wick too short.",
    "Performances ask you to lean in instead of chase."
  ];
  const sentences = pickMany(bank, randBetween(2,3));
  const cap = (s:string)=> s.replace(/^\s*[a-z]/, c=>c.toUpperCase());
  return `${cap(sentences[0])}${sentences.length>1? " " + sentences.slice(1).join(" ") : ""}`;
}
function composeLongBody(showId:string){
  const bank = PREVIEW_BANK[showId] || PREVIEW_BANK["bb"];
  const paraCount = randBetween(2,3);
  const paras:string[] = [];
  for(let p=0;p<paraCount;p++){
    const sents = pickMany(bank, randBetween(2,4));
    const cap = (s:string)=> s.replace(/^\s*[a-z]/, c=>c.toUpperCase());
    paras.push(`${cap(sents[0])}${sents.length>1? " " + sents.slice(1).join(" ") : ""}`);
  }
  return paras.join("\n\n");
}
function composeReply(showId:string){
  const bank = REPLIES_BANK[showId] || REPLIES_BANK["bb"];
  const sentences = pickMany(bank, randBetween(2,3));
  return sentences.join(" ");
}

function makeThreads(showId:string, count:number): Thread[] {
  const show = seedShows.find(s=>s.id===showId)!;
  const seasons = show.seasons;
  return Array.from({length:count}).map((_,i)=>{
    const season = randBetween(1, seasons.length);
    const eMax = seasons[season-1] || 10;
    const episode = randBetween(1, eMax);
    const author = pick(USERNAMES.slice(1));
    const titleBase = pick(TITLES[showId] || ["Craft notes","Tone & texture","Blocking beats"]);
    const preview = composePreview(showId);
    const body = composeLongBody(showId);
    return {
      id:`${showId}-t${i+1}`, showId, season, episode, author, titleBase, preview, body,
      updatedAt: Date.now() - randBetween(1, 144)*3600000,
      likes: randBetween(0, 60)
    };
  });
}

/* ------------------------ Seed threads + hi_itsme posts ----------------------- */
const seedThreads: Thread[] = [];




// Helper to push curated posts
function pushPost({
  showId = "bb",
  season,
  episode,
  author,
  title,
  body,
  updatedAtOffsetH = 0,
  likes = 0,
  isPrivate = false
}: {
  showId?: string; season:number; episode:number; author:string; title:string; body:string;
  updatedAtOffsetH?: number; likes?: number; isPrivate?: boolean;
}) {
  const id = `${showId}-${author}-${season}-${episode}-${Math.random().toString(36).slice(2,8)}`;
  seedThreads.push({
    id,
    showId,
    season,
    episode,
    author,
    titleBase: title,
    preview: body.length > 240 ? body.slice(0,240) + "…" : body,
    body,
    updatedAt: Date.now() - updatedAtOffsetH * 3600_000,
    likes,
    isPrivate
  });
}






// Simulated threads & replies for a 5-season, 8-episode show
// You can paste this into your index.tsx (after seedShows / pushPost / repliesByThread)
// and optionally add a new show entry to seedShows:
//
//   { id: "simshow", name: "Simulated Show", seasons: [8,8,8,8,8] },
//
// All posts/replies here use showId: "simshow" and simple placeholder text.



(function seedSimshowReplies() {
  const showId = "simshow";

  // Current max watch progress per viewer
  const progress: Record<string, { season: number; episode: number }> = {
    AA: { season: 1, episode: 2 },
    BB: { season: 1, episode: 7 },
    CC  : { season: 2, episode: 3 },
    DD  : { season: 2, episode: 3 },
    EE  : { season: 2, episode: 7 },
    FF  : { season: 3, episode: 2 },
    GG  : { season: 3, episode: 6 },
    HH  : { season: 3, episode: 8 },
    II  : { season: 4, episode: 1 },
    JJ  : { season: 4, episode: 4 },
    KK  : { season: 4, episode: 5 },
    LL  : { season: 4, episode: 8 },
    MM  : { season: 5, episode: 3 },
    NN  : { season: 5, episode: 5 },
    OO  : { season: 5, episode: 8 },
  };

  type SimpleReplyDef = {
    author: keyof typeof progress;
  };

  function findThread(author: string, season: number, episode: number, titleStart: string): Thread | undefined {
    return seedThreads.find(
      (t) =>
        t.showId === showId &&
        t.author === author &&
        t.season === season &&
        t.episode === episode &&
        t.titleBase.startsWith(titleStart)
    );
  }

  function setReplies(
    thread: Thread | undefined,
    subjectSeason: number,
    subjectEpisode: number,
    defs: SimpleReplyDef[]
  ) {
    if (!thread) return;
    const baseTime = thread.updatedAt;
    repliesByThread[thread.id] = defs.map((d, idx) => {
      const p = progress[d.author];
      return {
        id: `${thread.id}-sim-${idx + 1}`,
        threadId: thread.id,
        showId,
        season: p.season,
        episode: p.episode,
        author: d.author,
        body: `${d.author} — ${String(subjectSeason).padStart(2, "0")}/${String(
          subjectEpisode
        ).padStart(2, "0")} - REPLY about ${String(subjectSeason).padStart(2, "0")}/${String(
          subjectEpisode
        ).padStart(2, "0")}.`,
        updatedAt: baseTime + (idx + 1) * 15 * 60_000,
        likes: randBetween(0, 20),
      } as Reply;
    });
  }

    // THREAD 1: AA — 01/02 - POST about 01/02
    setReplies(
      findThread("AA", 1, 2, "AA — 01/02"),
      1,
      2,
      [
        { author: "BB" },
        { author: "CC" },
        { author: "DD" },
        { author: "EE" },
        { author: "FF" },
        { author: "GG" },
        { author: "HH" },
        { author: "II" },
      ]
    );

    // THREAD 2: BB — 01/07 - POST about 01/07
    setReplies(
      findThread("BB", 1, 7, "BB — 01/07"),
      1,
      7,
      [
        { author: "CC" },
        { author: "DD" },
        { author: "EE" },
        { author: "FF" },
        { author: "GG" },
        { author: "HH" },
        { author: "II" },
        { author: "JJ" },
        { author: "KK" },
      ]
    );

    // THREAD 3: EE — 02/07 - POST about 02/03
    setReplies(
  findThread("EE", 2, 7, "EE — 02/07"),
  2,
  3,
      [
        { author: "CC" },
        { author: "DD" },
        { author: "FF" },
        { author: "GG" },
        { author: "HH" },
        { author: "II" },
        { author: "JJ" },
        { author: "KK" },
        { author: "LL" },
      ]
    );

    // THREAD 4: GG — 03/06 - POST about 02/07
    setReplies(
  findThread("GG", 3, 6, "GG — 03/06"),
  2,
  7,
      [
        { author: "EE" },
        { author: "FF" },
        { author: "HH" },
        { author: "II" },
        { author: "JJ" },
        { author: "KK" },
        { author: "LL" },
        { author: "MM" },
        { author: "NN" },
      ]
    );

    // THREAD 5: FF — 03/02 - POST about 03/02
    setReplies(
      findThread("FF", 3, 2, "FF — 03/02"),
      3,
      2,
      [
        { author: "GG" },
        { author: "HH" },
        { author: "II" },
        { author: "JJ" },
        { author: "KK" },
        { author: "LL" },
        { author: "MM" },
        { author: "NN" },
        { author: "OO" },
      ]
    );

    // THREAD 6: HH — 03/08 - POST about 03/06
    setReplies(
  findThread("HH", 3, 8, "HH — 03/08"),
  3,
  6,
      [
        { author: "GG" },
        { author: "II" },
        { author: "JJ" },
        { author: "KK" },
        { author: "LL" },
        { author: "MM" },
        { author: "NN" },
        { author: "OO" },
      ]
    );

    // THREAD 7: II — 04/01 - POST about 03/08
    setReplies(
  findThread("II", 4, 1, "II — 04/01 - POST about 03/08"),
  3,
  8,
      [
        { author: "HH" },
        { author: "JJ" },
        { author: "KK" },
        { author: "LL" },
        { author: "MM" },
        { author: "NN" },
        { author: "OO" },
      ]
    );

    // THREAD 8: II — 04/01 - POST about 04/01
    setReplies(
      findThread("II", 4, 1, "II — 04/01 - POST about 04/01"),
      4,
      1,
      [
        { author: "JJ" },
        { author: "KK" },
        { author: "LL" },
        { author: "MM" },
        { author: "NN" },
        { author: "OO" },
      ]
    );

    // THREAD 9: OO — 05/08 - POST about 01/02
    setReplies(
  findThread("OO", 5, 8, "OO — 05/08"),
  1,
  2,
      [
        { author: "AA" },
        { author: "CC" },
        { author: "EE" },
        { author: "GG" },
        { author: "JJ" },
        { author: "MM" },
        { author: "NN" },
      ]
    );

    // THREAD 10: NN — 05/05 - POST about 02/03
    setReplies(
  findThread("NN", 5, 5, "NN — 05/05"),
  2,
  3,
      [
        { author: "CC" },
        { author: "DD" },
        { author: "EE" },
        { author: "FF" },
        { author: "GG" },
        { author: "HH" },
        { author: "II" },
        { author: "JJ" },
      ]
    );

    // THREAD 11: GG — 01/07 - POST about 01/07
    setReplies(
      findThread("GG", 1, 7, "GG — 01/07"),
      1,
      7,
      [
        { author: "CC" },
        { author: "DD" },
        { author: "EE" },
        { author: "FF" },
        { author: "HH" },
        { author: "II" },
      ]
    );

    // THREAD 12: KK — 03/02 - POST about 03/02
    setReplies(
      findThread("KK", 3, 2, "KK — 03/02"),
      3,
      2,
      [
        { author: "GG" },
        { author: "HH" },
        { author: "II" },
        { author: "JJ" },
        { author: "LL" },
        { author: "MM" },
      ]
    );

    // THREAD 13: MM — 02/07 - POST about 02/07
    setReplies(
      findThread("MM", 2, 7, "MM — 02/07"),
      2,
      7,
      [
        { author: "EE" },
        { author: "FF" },
        { author: "GG" },
        { author: "HH" },
        { author: "II" },
        { author: "JJ" },
        { author: "KK" },
      ]
    );

    // THREAD 14: NN — 03/06 - POST about 03/06
    setReplies(
      findThread("NN", 3, 6, "NN — 03/06"),
      3,
      6,
      [
        { author: "GG" },
        { author: "HH" },
        { author: "II" },
        { author: "JJ" },
        { author: "KK" },
        { author: "LL" },
      ]
    );

    // THREAD 15: OO — 04/01 - POST about 04/01
    setReplies(
      findThread("OO", 4, 1, "OO — 04/01"),
      4,
      1,
      [
        { author: "JJ" },
        { author: "KK" },
        { author: "LL" },
        { author: "MM" },
        { author: "NN" },
        { author: "OO" },
      ]
    );
  })();








/* ------------------------ CURATED POSTS ------------------------ */
// PopcornTheory (watched S4E3)


pushPost({
  season: 1, episode: 2, author: "PopcornTheory",
  title: "A Perfect Setup, a Disgusting Punchline",
  body: `That bathtub scene should be framed and hung in every film school classroom—preferably above a drain.
It’s gross, funny, efficient storytelling. One bad decision, one literal meltdown. This show wastes zero time teaching its thesis: chemistry is consequence.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 1, episode: 6, author: "PopcornTheory",
  title: "Explosion as Character Arc",
  body: `That moment when Walt walks out and the building erupts behind him? That’s the real ending of the pilot. The transformation is visual, silent, complete.
You can feel the show trusting the image to do what dialogue can’t. If I wrote that scene in a script, I’d underline it twice and probably ruin it with too much description.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 2, episode: 3, author: "PopcornTheory",
  title: "The Bureaucracy of Lies",
  body: `Every episode is an administrative nightmare of cover stories. It’s not a crime saga—it’s a paperwork drama with corpses.
From a structure standpoint, it’s brilliant: every lie becomes a new obstacle, which becomes the next act. Walt isn’t outsmarting anyone; he’s just constantly re-applying for the same moral permit.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 2, episode: 10, author: "PopcornTheory",
  title: "The Dinner Scene That Turned Everything",
  body: `This might be my favorite kind of writing: nothing happens and yet everything changes. A small domestic moment—Walt pouring wine, talking about unfinished business—and the whole story tilts.
It’s not the cancer that’s killing him anymore, it’s ambition. And you can see it flicker in his eyes like a pilot light catching again.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 3, episode: 1, author: "PopcornTheory",
  title: "No Más and the Gospel of Silence",
  body: `The opening with the crawling cousins is transcendent. The composition, the sound design, the refusal to explain itself—this is cinema using mystery instead of exposition.
Breaking Bad feels like it just graduated from realism to myth.
Every frame looks like it was shot by someone who studied Sergio Leone and David Lynch at the same time.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 3, episode: 5, author: "PopcornTheory",
  title: "The Lab as a Love Story",
  body: `The new meth lab reveal feels almost erotic—Walt’s face lit by fluorescent devotion. That sterile, Kubrick-clean environment is the most dangerous temptation in the series so far.
From a design perspective, it’s immaculate. From a character standpoint, it’s poison wrapped in stainless steel.
Filmmakers talk about “production design as character”—this is the best example I’ve seen on television. The set is seducing him.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 3, episode: 12, author: "PopcornTheory",
  title: "Half Measures, Whole Lesson",
  body: `Mike’s story about the domestic violence case is so simple and so brutal that I had to pause it. It’s not just exposition—it’s thesis.
In one monologue, the show defines its moral world: you either commit fully or die trying to be decent.
As a screenwriter, I love how this scene uses anecdote as argument. It’s not about plot; it’s about philosophy.
And the best part? The show immediately contradicts it. The next act is a full measure.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 4, episode: 1, author: "PopcornTheory",
  title: "Box Cutter and the Art of Stillness",
  body: `This might be the single most disciplined piece of television I’ve seen. No score. No quick cuts. Just the unbearable sound of fluorescent lighting and quiet breathing.
It’s violence filmed with the patience of a nature documentary.
Editors usually talk about pacing as rhythm—this scene treats pacing as oxygen control. You feel suffocated until the blade drops.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 4, episode: 3, author: "PopcornTheory",
  title: "Skyler’s Moral Algebra",
  body: `Skyler’s storyline is becoming the most fascinating thing about the show. She’s solving an ethical equation in real time: how much wrong can one tolerate in the name of family?
There’s something heartbreakingly pragmatic about her descent—it’s not about power or thrill; it’s about survival through rationalization.
What kills me is how quiet her evolution is. Walt’s transformation screams; hers whispers.
In a lesser show, she’d be written as resistance. Here, she’s reflection—the only one honest enough to know she’s lying.
If I ever get one of my scripts produced, I want a character half as layered as her.`,
updatedAtOffsetH: randBetween(1, 24*14)
});





// SlateOrbit (watched S3E2)
pushPost({
  season: 1, episode: 1, author: "SlateOrbit",
  title: "The Medium Is the Meth",
  body: `It’s good. But it’s still TV.
That sounds snobby, but I mean it: everything is cut for rhythm, not for silence. The scenes end on beats that feel designed for ad breaks, not oxygen.
Still, it’s the cleanest pilot I’ve seen in years. Feels engineered. Like NASA made it. Which, for me, is both compliment and insult.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 1, episode: 2, author: "SlateOrbit",
  title: "A Bathtub Scene for Late Capitalism",
  body: `You can almost feel the guilt of the middle class melting through the ceiling.
It’s a perfect metaphor for American labor—dissolving the evidence of your own exploitation and making a bigger mess in the process.
Also: I’m never letting my kid near hydrofluoric acid.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 2, episode: 5, author: "SlateOrbit",
  title: "The Show About Scheduling",
  body: `This show has a funny obsession with logistics. “How do we store this?” “Who’s picking up the RV?” It’s bureaucracy with blood pressure.
I find that fascinating. Maybe it’s the new-dad brain talking, but the most stressful part isn’t the crime—it’s the time management.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 2, episode: 10, author: "SlateOrbit",
  title: "Moral Physics and Baby Formula",
  body: `There’s a moment when Walt’s story stops being about cancer and becomes about control.
I recognize the sickness. Directing has a version of it too—you start making choices because you can, not because you should.
I keep wondering what this show would look like if told entirely from Skyler’s point of view. Probably a short film. Probably better.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 3, episode: 1, author: "SlateOrbit",
  title: "A Desert, a Gun, a Man Explaining Himself",
  body: `I have a soft spot for stories that go back to the desert. It’s like cinema’s default setting for consequence.
That crawl sequence at the start was incredible—borderline spiritual—but then the show cut back to exposition and I sighed out loud.
TV can’t help itself; it wants to be mythic and explain the myth. Film would pick one.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 3, episode: 2, author: "SlateOrbit",
  title: "I Don’t Trust the Camera",
  body: `The direction is immaculate, almost too immaculate. I keep waiting for the show to get sloppy—to let a shot breathe past the beat.
You can see every choice, every rack focus. It’s good, but I miss accidents. The best shots in cinema happen when the director gets out of the way.
Still… I watched two episodes back-to-back. So maybe it’s working.`,
updatedAtOffsetH: randBetween(1, 24*14)
});
pushPost({
  season: 3, episode: 2, author: "SlateOrbit",
  title: "I Don’t Trust the Camera",
  body: `The direction is immaculate, almost too immaculate. I keep waiting for the show to get sloppy—to let a shot breathe past the beat.
You can see every choice, every rack focus. It’s good, but I miss accidents. The best shots in cinema happen when the director gets out of the way.
Still… I watched two episodes back-to-back. So maybe it’s working.`,
updatedAtOffsetH: randBetween(1, 24*14)
});





// LoomSignal (mid-S2 “4 Days Out” era)
pushPost({
  season: 1, episode: 1, author: "LoomSignal",
  title: "The Science Fair from Hell",
  body: `Loved the pilot. You can tell it was written by someone who understands curiosity — the way Walt’s mind lights up when he finally applies his skills to something risky.
It’s like every nerd fantasy flipped inside out: “What if I used my power for something terrible, just to feel alive again?”
Also, I’ve taught science outreach classes before… and I swear every teacher I know has had that same blank look he gives in class.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 1, episode: 2, author: "LoomSignal",
  title: "So... the Acid Goes Through the Ceiling?",
  body: `This was pure slapstick horror and I’m here for it.
It’s nice when TV remembers that the laws of chemistry don’t bend for plot convenience.
My whirlyball team once dissolved a trophy in acetone by accident — not the same, but same energy.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 1, episode: 6, author: "LoomSignal",
  title: "Walt’s Midlife Patch Notes",
  body: `I can’t decide if I like this guy or if he just triggers my allergy to men who mistake control for genius.
The show’s smart, though — it never flatters him. You can see the insecurity driving every choice.
Also, that explosion was the exact moment he rebooted into “villain mode.” I’m impressed and unsettled.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 2, episode: 3, author: "LoomSignal",
  title: "The Show About Cleaning Up",
  body: `Half of Breaking Bad is about mopping up evidence and pretending it’s normal.
It’s the weirdest domestic show I’ve ever seen — every scene is either in a kitchen or a crime scene, sometimes both.
I like the rhythm of it. It’s almost meditative. Like karate drills, but with corpses.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 2, episode: 11, author: "LoomSignal",
  title: "Desert Space",
  body: `There’s something about this show’s geography that reminds me of Deep Space Nine — the feeling that morality gets thinner the further you go from civilization.
The desert here is outer space. No law, no oversight, just people improvising ethics.
If DS9 had Walt, Odo would’ve arrested him by episode 2.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 3, episode: 6, author: "LoomSignal",
  title: "The Lab and the Temptation of Order",
  body: `That gleaming underground lab made my jaw drop. It’s almost beautiful — like the architectural equivalent of a lie told perfectly.
I get it, though. There’s comfort in systems. Build something flawless and you forget what’s rotten underneath it.
I know people who build start-ups the same way: the more control they get, the smaller their world becomes.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 3, episode: 12, author: "LoomSignal",
  title: "Half Measures, Whole Truth",
  body: `Mike’s story about the woman and the abuser was hard to listen to — because it’s true, not just narratively, but emotionally.
The lesson isn’t “be ruthless.” It’s “doing the right thing halfway doesn’t count.”
That’s been rattling around my head all night. There’s a weird overlap between martial arts and morality: you either commit to the move, or you get hit harder next time.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 4, episode: 1, author: "LoomSignal",
  title: "The Quiet Terror of Box Cutter",
  body: `The whole sequence was so calm it made me nauseous.
No music, no quick cuts — just that industrial hum. I don’t even like gore, but the restraint made it unbearable in the best way.
It reminded me of how 2001: A Space Odyssey handles violence — measured, procedural, inevitable.
I had to go stretch afterward.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 4, episode: 2, author: "LoomSignal",
  title: "Skyler’s Firewall",
  body: `Skyler’s turning into the only adult in the room, and it’s fascinating. She’s learning to play the system while pretending she’s still outside it.
There’s a quiet dignity in her moves — not pride, exactly, but survival.
It’s refreshing watching a character who isn’t driven by ego or chaos. Just calculation, instinct, and a little fear.
Also, if she took a day off to play whirlyball, she’d probably win.`,
updatedAtOffsetH: randBetween(1, 24*14)
});









// _quietloop (around S4E5)
pushPost({
  season: 1, episode: 1, author: "_quietloop",
  title: "The Pilot Blew Me Away",
  body: `I’m late to this show but WHAT a first episode.
It’s rare for TV to feel this cinematic — like, real framing, real silence, no filler dialogue.
I get why people compare it to Mad Men or The Sopranos, but honestly, the energy feels closer to Moneyball — ordinary guys using math to break the world.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 1, episode: 2, author: "_quietloop",
  title: "The Bathtub Scene Is Still in My Head",
  body: `This show is so good at shifting tone. One minute you’re laughing at the acid through the ceiling, and the next you’re like, “Oh right, these are people’s lives falling apart.”
I listen to The Watch podcast a lot, and Chris Ryan always talks about “tonal control” — this episode nails it.
Also: grossest sound design of all time, award unlocked.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 1, episode: 6, author: "_quietloop",
  title: "Okay, I Get the Hype Now",
  body: `I used to roll my eyes at people calling this the best show ever, but that explosion scene? I actually cheered.
It’s not even the explosion itself — it’s the confidence. The “I’m that guy now” moment.
Walt has officially crossed into anti-hero land. I’m doomed.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 2, episode: 10, author: "_quietloop",
  title: "The Dinner Scene and the Horror of Normalcy",
  body: `I rewatched the dinner scene twice — the one where Walt basically confesses to ambition without saying it. It’s shot like a home video, which makes it hit harder. No score, no tension tricks. Just the unbearable quiet of someone starting to believe their own lie.
It reminded me of something Joanna Robinson once said on Still Watching: that the scariest moments in prestige TV are the ordinary ones — because you can see yourself in them.
That’s what’s brilliant about this show. It’s not about drugs or crime; it’s about denial. Every person here has rewritten their “why” so many times they don’t remember the original code.
Anyway, my mom walked in while I was watching and said, “He’s still lying to his wife?” and I was like, “That’s the whole thing, mom.”`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 3, episode: 6, author: "_quietloop",
  title: "Breaking Bad and the Math of Consequences",
  body: `I think I finally understand why critics call this show “mathematical.” It’s not about plot twists — it’s about equations. Every episode adds or subtracts something from Walt’s morality, and the total always balances out to regret.
But the lab reveal scene… I can’t get over it. The production design is straight-up hypnotic — the light, the order, the hum. It’s like a cathedral to ego.
And yet, as a viewer, I felt weirdly proud of him? Like when your favorite athlete breaks a record, even though you know it’s going to ruin them later.
That’s what good TV does — it traps you inside someone else’s delusion and makes you root for it.
If I ever start my podcast again (RIP “Quiet Takes,” 2019–2020), this would be the first show I’d cover episode by episode. Because it’s not about what happens, it’s about what we justify.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 4, episode: 1, author: "_quietloop",
  title: "Box Cutter Is Pure Dread",
  body: `I actually had to pause halfway through because it was stressing me out so much.
It’s so quiet. Like the show finally trusts you to panic on your own.
I watched the BTS featurette and the director said they lit it like a surgery scene — totally tracks. The color green has never looked scarier.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 4, episode: 5, author: "_quietloop",
  title: "Skyler Might Be the Most Realistic Character on TV",
  body: `I used to hate Skyler when the internet told me to. Now I think she’s the most human person on this show.
She’s calculating but not manipulative, scared but not weak. Watching her plan things feels like watching someone build a new version of themselves from scraps.
There’s this moment where she’s talking to Walt and you can see the exact second she realizes she’ll have to lie better than him to survive. It’s devastating.
Anyway, I’m fully obsessed. And yes, I’m reading essays about gender in Breaking Bad now. Someone stop me.`,
updatedAtOffsetH: randBetween(1, 24*14)
});







// DreamInReverse (S5E6 “Buyout”)
pushPost({
  season: 1, episode: 1, author: "DreamInReverse",
  title: "Yeah, It’s Good",
  body: `Finally watched the pilot. It’s solid.
Not sure I buy the underwear-in-the-desert thing, but the setup’s clear. Guy’s life falls apart, guy makes bad choices. Feels familiar.,
I’ll keep going, I guess.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 1, episode: 2, author: "DreamInReverse",
  title: "Acid Through the Ceiling",
  body: `Pretty disgusting. Also kind of funny.
Reminds me of some contractors I’ve worked with — always convinced they’ve found a “shortcut.”,
They hadn’t.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 1, episode: 6, author: "DreamInReverse",
  title: "The Explosion Was Fine",
  body: `Everyone online calls this one iconic. Sure. It was okay.
I liked that they didn’t overshoot it. One shot, done.
Could’ve used fewer close-ups before, though. Directors love their actors too much.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 2, episode: 10, author: "DreamInReverse",
  title: "Getting Tired of the Lies",
  body: `Halfway through Season 2 and I’m finding it repetitive.
There’s only so many ways you can watch a man ruin his life and call it tension.
That said, there’s something believable in how it’s all small steps. Nobody decides to become awful. They just get used to making small bad choices.
Still, I find myself checking the clock more than I used to.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 3, episode: 6, author: "DreamInReverse",
  title: "That Fancy Lab",
  body: `The new lab setup looks great. Too great, maybe. Everything’s shiny now.
I kind of miss the grimy stuff. It fit better.
Feels like the show’s getting comfortable — the same way people do right before things get dumb.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 4, episode: 1, author: "DreamInReverse",
  title: "Box Cutter",
  body: `That was rough. Not sure I liked it.
Violence doesn’t bother me, but this one felt... off. Like they were daring you to look away. I get it — tension, power, control.
Still, there’s a point where you stop being impressed and just feel tired.
The quiet parts before it were good, though. Reminded me of when people actually used silence instead of background music.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 5, episode: 6, author: "DreamInReverse",
  title: "Midway Through Season 5",
  body: `Half the characters look dead inside. Probably supposed to.
The writing’s fine. Some shots are beautiful. Sometimes it feels like homework.
I watch an episode before bed most nights. It’s a good way to unwind — not great, not bad. Just steady.
That’s more than I can say for most things.`,
updatedAtOffsetH: randBetween(1, 24*14)
});






// EchoMoth (S2E11 “Mandala”)
pushPost({
  season: 1, episode: 1, author: "EchoMoth",
  title: "Okay, I Finally Started It",
  body: `I caved. Everyone in my feed acts like this is a sacred text, so fine.
The pilot was good! Not great, not life-changing, but confident. I respect any show that opens in chaos and then works backward.
I do wish it had a little more color. Everything looks sunburnt.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 1, episode: 2, author: "EchoMoth",
  title: "Acid in the Ceiling, Internet Going Nuts",
  body: `Watched the “melting bathtub” episode and immediately got five memes sent to me.
It’s wild how this show has been meme-ified into slapstick when it’s actually pretty bleak.
That said, props for practical effects. I’ve seen worse stuff at comic-con horror panels that cost more to make.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 1, episode: 6, author: "EchoMoth",
  title: "Walter White Is Every Tech Bro at a Panel",
  body: `I don’t hate it, but Walt’s speeches make me itchy.
He’s the kind of guy who’d interrupt a science-fiction Q&A to “correct” the author on molecular accuracy.
There’s a version of this story where Jesse starts a band instead and I’d probably like that one more.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 2, episode: 10, author: "EchoMoth",
  title: "The Dinner Scene, or: I’ve Had This Conversation in Real Life",
  body: `The dinner scene broke me a little. It’s one of those moments where the show stops trying to be cool and just lets people be miserable together.
You can see the exact moment Skyler checks out — not dramatically, just that invisible flicker of “I’m not doing this again.”
I’ve been at that table before, metaphorically. When someone’s performing their frustration instead of feeling it.
What’s weird is that I still don’t like the show. I admire it, but I don’t trust it. It keeps giving me pain dressed as profundity.
But I get why people love it. It’s precise, like a watch. I just wish it had a little more heart — like Parks and Rec filtered through a meth lab.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 2, episode: 11, author: "EchoMoth",
  title: "Do People Actually Find This Fun?",
  body: `Maybe I’m watching it wrong, but I don’t find Breaking Bad fun.
It’s impressive, yes. The cinematography’s gorgeous. But it’s emotionally exhausting. Everyone’s miserable, and the show treats misery like a flex.
I’m big on stories that make you feel with the characters, not around them. Even when I read dark comics — Saga, Sandman, Monstress — there’s empathy in the horror.
Here, the empathy’s cold. The show loves its own machinery more than its people.
On the other hand, I can’t stop thinking about it. I walked my dog tonight and caught myself framing shots in my head — streetlights, long shadows, the whole Albuquerque color palette. Maybe that’s the real trick: it doesn’t want you to like it. It wants to live rent-free in your brain.
I still prefer Better Call Saul’s theme song, though.`,
updatedAtOffsetH: randBetween(1, 24*14)
});

pushPost({
  season: 2, episode: 11, author: "EchoMoth",
  title: "Still Watching, Still Skeptical",
  body: `Everyone says “Season 3 is where it really starts cooking.”
Sure. That’s what they said about The Walking Dead, too.
I’ll keep going, mostly because my dog likes when I stay on the couch.`,
updatedAtOffsetH: randBetween(1, 24*14)
});




// xxxxxxxxxxxxxxxxxxx




// Helper to push curated posts
function pushPostSev({
  showId = "severance",
  season,
  episode,
  author,
  title,
  body,
  updatedAtOffsetH = 0,
  likes = 0,
  isPrivate = false
}: {
  showId?: string; season:number; episode:number; author:string; title:string; body:string;
  updatedAtOffsetH?: number; likes?: number; isPrivate?: boolean;
}) {
  const id = `${showId}-${author}-${season}-${episode}-${Math.random().toString(36).slice(2,8)}`;
  seedThreads.push({
    id,
    showId,
    season,
    episode,
    author,
    titleBase: title,
    preview: body.length > 240 ? body.slice(0,240) + "…" : body,
    body,
    updatedAt: Date.now() - updatedAtOffsetH * 3600_000,
    likes,
    isPrivate
  });
}

/* ------------------------ CURATED POSTS ------------------------ */
// PopcornTheory (watched S4E3)


pushPostSev({
  season: 1, episode: 2, author: "PopcornTheory",
  title: "Gus Fring: The Most Polite Threat in TV History",
  body: `Every once in a while, a TV show finds a villain so calm that the silence itself becomes violent. Gus Fring is that. Watching him in Box Cutter is like watching a masterclass in negative space — everything not said, not done, not flinched at. Most villains perform their danger. Gus erases his.

The brilliance of that scene isn’t the gore (though, box cutter — come on). It’s that it plays like a visual haiku about control. From the moment he walks in, the rhythm of the show slows down; the camera locks itself into that deliberate, Kubrick-like geometry. No handheld panic, no shaky fear. Just absolute stillness. That stillness is the power. As an editor, I recognize that feeling — when you remove one cut too many and suddenly the whole thing feels predatory. That’s Gus’s energy: the uncut shot of menace.

And Victor, bless his doomed, overconfident soul, walks straight into the metaphor. He’s the guy who confuses proximity with power. He thinks being near genius is the same as having it. He literally tries to mimic Walt’s work to prove his worth — and in doing so, demonstrates the exact lack of judgment that gets him killed. Gus doesn’t just kill him to send a message; he kills him to edit the scene. He’s trimming away the noise, returning the story to its clean, efficient line.

There’s also this visual poetry in the cleanup afterward. Gus calmly showers off the blood, adjusts his tie, and steps back into his day job. It’s a corporate ritual — an execution treated as a workflow. That’s the most chilling part: the scene isn’t built like an action beat, it’s built like a process montage. Step one: eliminate error. Step two: sanitize workspace. Step three: proceed with production.

When Walt and Jesse go back to cooking afterward, it’s less about fear and more about internalized professionalism. They’ve just witnessed a boss-level tutorial in “the consequences of inefficiency.” You could teach this scene in a film class under the title Tone Through Blocking. Every camera placement, every breath, every bead of sweat tells you who holds authorship of the room. Spoiler: it’s not the guy holding the gun. It’s the one holding his silence.`,
updatedAtOffsetH: randBetween(1, 24*14)
});





// xxxxxxxxxxxxxxxxxxx















(function seedSimshowThreads() {
  const showId = "simshow";

  // THREAD 1
  pushPost({
    showId,
    season: 1,
    episode: 2, // current progress 01/02
    author: "AA",
    title: "AA's current progress is 01/02 - POST about 01/01",
    body: "Post about Season 01 Episode 01.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 2
  pushPost({
    showId,
    season: 1,
    episode: 7, // current progress 01/07
    author: "BB",
    title: "BB's current progress is 01/07 - POST is about 01/07",
    body: "Post about Season 01 Episode 07.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 3 (EE has watched ahead to 02/07 but is posting about 02/03)
  pushPost({
    showId,
    season: 2,
    episode: 7, // current progress 02/07
    author: "EE",
    title: "EE's current progress is 02/07 - POST is about 01/06",
    body: "Post about Season 01 Episode 06.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 4 (GG has watched ahead to 03/06 but is posting about 02/07)
  pushPost({
    showId,
    season: 3,
    episode: 6, // current progress 03/06  (WAS 2,7)
    author: "GG",
    title: "GG's current progress is 03/06 - POST is about 02/07",
    body: "Post about Season 02 Episode 07.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 5
  pushPost({
    showId,
    season: 3,
    episode: 2, // current progress 03/02
    author: "FF",
    title: "FF's current progress is 03/02 - POST is about 03/02",
    body: "Post about Season 03 Episode 02.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 6 (HH has watched ahead to 03/08 but is posting about 03/06)
  pushPost({
    showId,
    season: 3,
    episode: 8, // current progress 03/08  (WAS 3,6)
    author: "HH",
    title: "HH's current progress is 03/08 - POST is about 03/06",
    body: "Post about Season 03 Episode 06.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 7 (II has watched ahead to 04/01 but is posting about 03/08)
  pushPost({
    showId,
    season: 4,
    episode: 1, // current progress 04/01  (WAS 3,8)
    author: "II",
    title: "II's current progress is 04/01 - POST is about 03/08",
    body: "Post about Season 03 Episode 08.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 8 (II at same progress, posting about 04/01)
  pushPost({
    showId,
    season: 4,
    episode: 1, // current progress 04/01
    author: "II",
    title: "II's current progress is 04/01 - POST is about 04/01",
    body: "Post about Season 04 Episode 01.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 9 (OO has watched ahead to 05/08 but is posting about 01/02)
  pushPost({
    showId,
    season: 5,
    episode: 8, // current progress 05/08  (WAS 1,2)
    author: "OO",
    title: "OO's current progress is 05/08 - POST is about 01/02",
    body: "Post about Season 01 Episode 02.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 10 (NN has watched ahead to 05/05 but is posting about 02/03)
  pushPost({
    showId,
    season: 5,
    episode: 5, // current progress 05/05  (WAS 2,3)
    author: "NN",
    title: "NN's current progress is 05/05 - POST is about 02/03",
    body: "Post about Season 02 Episode 03.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 11 (historical GG post)
  pushPost({
    showId,
    season: 1,
    episode: 7,
    author: "GG",
    title: "GG's current progress is 01/07 - POST is about 01/07",
    body: "Post about Season 01 Episode 07.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 12 (historical KK post)
  pushPost({
    showId,
    season: 3,
    episode: 2,
    author: "KK",
    title: "KK's current progress is 03/02 - POST is about 03/02",
    body: "Post about Season 03 Episode 02.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 13 (historical MM post)
  pushPost({
    showId,
    season: 2,
    episode: 7,
    author: "MM",
    title: "MM's current progress is 02/07 - POST is about 02/07",
    body: "Post about Season 02 Episode 07.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 14 (historical NN post)
  pushPost({
    showId,
    season: 3,
    episode: 6,
    author: "NN",
    title: "NN's current progress is 03/06 - POST is about 03/06",
    body: "Post about Season 03 Episode 06.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });

  // THREAD 15 (historical OO post)
  pushPost({
    showId,
    season: 4,
    episode: 1,
    author: "OO",
    title: "OO's current progress is 04/01 - POST is about 03/08",
    body: "Post about Season 03 Episode 08.",
    updatedAtOffsetH: randBetween(1, 24 * 14),
  });
})();

















/* --------------------- Seed replies (after threads exist) ------------------ */
const repliesByThread: { [threadId: string]: Reply[] } = {};
(function seedReplies(){
  for(const t of seedThreads){
    if (t.showId === "simshow") continue;
    const show = seedShows.find(s=>s.id===t.showId)!;
    const count = randBetween(4,12);
    const replies: Reply[] = [];
    for(let i=0;i<count;i++){
      const s = randBetween(1, show.seasons.length);
      const e = randBetween(1, show.seasons[s-1] || 1);
      const id = `${t.id}-c${i+1}`;
      const author = pick(USERNAMES.slice(1));
      const body = composeReply(t.showId);
      const updatedAt = t.updatedAt + (i+1)*15*60*1000;
      const maybeParent = i>0 && Math.random()<0.4 ? replies[randBetween(0,i-1)].id : undefined;
      replies.push({ id, threadId:t.id, showId:t.showId, season:s, episode:e, author, body, updatedAt, replyToId: maybeParent, likes: randBetween(0, 35) });
    }
    repliesByThread[t.id] = replies;
  }
})();






/* ----------------- Simulated Show AA–OO replies ----------------- */
(function seedSimshowReplies() {
  const showId = "simshow";

  // current max progress for each viewer (used to tag replies)
  const progress: Record<string, { season: number; episode: number }> = {
    AA: { season: 1, episode: 2 },
    BB: { season: 1, episode: 7 },
    CC: { season: 2, episode: 3 },
    DD: { season: 2, episode: 3 },
    EE: { season: 2, episode: 7 },
    FF: { season: 3, episode: 2 },
    GG: { season: 3, episode: 6 },
    HH: { season: 3, episode: 8 },
    II: { season: 4, episode: 1 },
    JJ: { season: 4, episode: 4 },
    KK: { season: 4, episode: 5 },
    LL: { season: 4, episode: 8 },
    MM: { season: 5, episode: 3 },
    NN: { season: 5, episode: 5 },
    OO: { season: 5, episode: 8 },
  };

  type ViewerId = keyof typeof progress;

  // Each entry describes ONE Simulated Show thread we seeded with pushPost.
  // Keyed by (author, season, episode) so it doesn't depend on title text.
  const configs: {
    author: ViewerId;
    season: number;
    episode: number;
    replyAuthors: ViewerId[];
  }[] = [
    // THREAD 1: AA — 01/02 - POST about 01/02
    { author: "AA", season: 1, episode: 2,
      replyAuthors: ["BB","CC","DD","EE","FF","GG","HH","II"] },

    // THREAD 2: BB — 01/07 - POST about 01/07
    { author: "BB", season: 1, episode: 7,
      replyAuthors: ["CC","DD","EE","FF","GG","HH","II","JJ","KK"] },

    // THREAD 3: EE — 02/07 - POST about 02/03
    { author: "EE", season: 2, episode: 3,
      replyAuthors: ["CC","DD","FF","GG","HH","II","JJ","KK","LL"] },

    // THREAD 4: GG — 03/06 - POST about 02/07
    { author: "GG", season: 2, episode: 7,
      replyAuthors: ["EE","FF","HH","II","JJ","KK","LL","MM","NN"] },

    // THREAD 5: FF — 03/02 - POST about 03/02
    { author: "FF", season: 3, episode: 2,
      replyAuthors: ["GG","HH","II","JJ","KK","LL","MM","NN","OO"] },

    // THREAD 6: HH — 03/08 - POST about 03/06
    { author: "HH", season: 3, episode: 6,
      replyAuthors: ["GG","II","JJ","KK","LL","MM","NN","OO"] },

    // THREAD 7: II — 04/01 - POST about 03/08
    { author: "II", season: 3, episode: 8,
      replyAuthors: ["HH","JJ","KK","LL","MM","NN","OO"] },

    // THREAD 8: II — 04/01 - POST about 04/01
    { author: "II", season: 4, episode: 1,
      replyAuthors: ["JJ","KK","LL","MM","NN","OO"] },

    // THREAD 9: OO — 05/08 - POST about 01/02
    { author: "OO", season: 1, episode: 2,
      replyAuthors: ["AA","CC","EE","GG","JJ","MM","NN"] },

    // THREAD 10: NN — 05/05 - POST about 02/03
    { author: "NN", season: 2, episode: 3,
      replyAuthors: ["CC","DD","EE","FF","GG","HH","II","JJ"] },

    // THREAD 11: GG — 01/07 - POST about 01/07 (historical)
    { author: "GG", season: 1, episode: 7,
      replyAuthors: ["CC","DD","EE","FF","HH","II"] },

    // THREAD 12: KK — 03/02 - POST about 03/02 (historical)
    { author: "KK", season: 3, episode: 2,
      replyAuthors: ["GG","HH","II","JJ","LL","MM"] },

    // THREAD 13: MM — 02/07 - POST about 02/07 (historical)
    { author: "MM", season: 2, episode: 7,
      replyAuthors: ["EE","FF","GG","HH","II","JJ","KK"] },

    // THREAD 14: NN — 03/06 - POST about 03/06 (historical)
    { author: "NN", season: 3, episode: 6,
      replyAuthors: ["GG","HH","II","JJ","KK","LL"] },

    // THREAD 15: OO — 04/01 - POST about 04/01 (historical)
    { author: "OO", season: 4, episode: 1,
      replyAuthors: ["JJ","KK","LL","MM","NN","OO"] },
  ];

  // Build a quick lookup of simshow threads by (author, season, episode)
  const threadsByKey = new Map<string, Thread[]>();
  for (const t of seedThreads) {
    if (t.showId !== showId) continue;
    const key = `${t.author}-${t.season}-${t.episode}`;
    const arr = threadsByKey.get(key) || [];
    arr.push(t);
    threadsByKey.set(key, arr);
  }

  // For each configured thread, overwrite repliesByThread[t.id]
  for (const cfg of configs) {
    const key = `${cfg.author}-${cfg.season}-${cfg.episode}`;
    const threads = threadsByKey.get(key) || [];
    if (!threads.length) continue;

    for (const t of threads) {
      const baseTime = t.updatedAt;

      repliesByThread[t.id] = cfg.replyAuthors.map((authorId, idx) => {
        const p = progress[authorId];

        const subjS = String(t.season).padStart(2, "0");
        const subjE = String(t.episode).padStart(2, "0");
        const progS = String(p.season).padStart(2, "0");
        const progE = String(p.episode).padStart(2, "0");

        const isAhead =
          p.season > t.season ||
          (p.season === t.season && p.episode > t.episode);

        const body = isAhead
          ? `${authorId} — has watched S${progS}E${progE} but is REPLYING about S${subjS}E${subjE}.`
          : `${authorId} — has watched S${subjS}E${subjE} - and is REPLYING about S${subjS}E${subjE}.`;

        return {
          id: `${t.id}-sim-${idx + 1}`,
          threadId: t.id,
          showId,
          season: p.season,   // viewer’s own watch progress
          episode: p.episode,
          author: authorId,
          body,
          updatedAt: baseTime + (idx + 1) * 15 * 60_000,
          replyToId: undefined,
          likes: randBetween(0, 20),
        } as Reply;
      });
    }
  }
})();













/* time utilities */
const timeAgo = (ms:number)=>{
  const diffMs = Date.now() - ms;
  const hours = Math.max(1, Math.floor(diffMs/3_600_000));
  if (hours >= 24) {
    const days = Math.floor(hours/24);
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  return hours===1 ? "<1 hr. ago" : `${hours} hr. ago`;
};
const buildProgressOptions = (show:{seasons?:number[]})=>{
  const out: {id:string;label:string;s:number;e:number}[]=[];
  const seasons = show?.seasons || [];
  for(let s=1;s<=seasons.length;s++){
    const eMax = seasons[s-1] || 1;
    for(let e=1;e<=eMax;e++){
      const id = `${s}-${e}`;
      out.push({ id, label:`you’ve watched S${String(s).padStart(2,"0")} E${String(e).padStart(2,"0")}`, s, e });
    }
  }
  return out;
};
const canView = (t:{season:number;episode:number}, p?:{s:number;e:number}) => !!p && (t.season < p.s || (t.season===p.s && t.episode<=p.e));

/* Count only replies visible under a given progress, including parent chain visibility */
const visibleRepliesCount = (threadId:string, prog?:{s:number;e:number})=>{
  if(!prog) return 0;
  const list = repliesByThread[threadId] || [];
  const byId: Record<string, Reply> = {};
  list.forEach(r=> byId[r.id]=r);
  const chainVisible = (r:Reply)=>{
    if(!canView({season:r.season, episode:r.episode}, prog)) return false;
    let cur = r.replyToId ? byId[r.replyToId] : null;
    while(cur){
      if(!canView({season:cur.season, episode:cur.episode}, prog)) return false;
      cur = cur.replyToId ? byId[cur.replyToId] : null;
    }
    return true;
  };
  return list.filter(chainVisible).length;
};







/* ----------------- CURATED REPLIES FOR POPCORNTHEORY THREADS ----------------- */

(function seedPopcornTheoryReplies(){
  function findPopcornThread(season: number, episode: number, titleStart: string) {
    return seedThreads.find(t =>
      t.showId === "bb" &&
      t.author === "PopcornTheory" &&
      t.season === season &&
      t.episode === episode &&
      t.titleBase.startsWith(titleStart)
    );
  }

  type ReplyDef = {
    author: string;
    season: number;  // replier's watch progress (season)
    episode: number; // replier's watch progress (episode)
    body: string;
  };

  function setCuratedReplies(t: Thread | undefined, defs: ReplyDef[]) {
    if (!t) return;
    const baseTime = t.updatedAt;
    const curated: Reply[] = defs.map((d, idx) => ({
      id: `${t.id}-pc${idx + 1}`,
      threadId: t.id,
      showId: t.showId,
      season: d.season,
      episode: d.episode,
      author: d.author,
      body: d.body,
      updatedAt: baseTime + (idx + 1) * 15 * 60_000,
      likes: randBetween(0, 28),
    }));
    // overwrite the auto-random replies for this thread
    repliesByThread[t.id] = curated;
  }

  /* ---------- S1E2 – “A Perfect Setup, a Disgusting Punchline” ---------- */

  const t_1_2 = findPopcornThread(1, 2, "A Perfect Setup");
  setCuratedReplies(t_1_2, [
    {
      author: "RVEnthusiast",
      season: 1, episode: 2,
      body: `What I love is how avoidable the whole thing is. Walt literally gives Jesse the correct instructions, and the show still sides with the bad decision because it’s funnier and more honest. Gravity becomes a co-writer.`
    },
    {
      author: "BlueSkyChem",
      season: 2, episode: 3,
      body: `It’s such a neat inversion of “clean crime” movies. Instead of a tidy cut to a barrel in the desert, we get structural damage and a hallway full of gore. The world refuses to keep their secret for them.`
    },
    {
      author: "FlyEpisodeDefender",
      season: 3, episode: 1,
      body: `Also wild that this is basically their first real “process” scene. It’s project management gone to hell: bad materials, ignored safety notes, terrible communication, and then nature files the incident report.`
    },
  ]);

  /* ---------- S1E6 – “Explosion as Character Arc” ---------- */

  const t_1_6 = findPopcornThread(1, 6, "Explosion as Character Arc");
  setCuratedReplies(t_1_6, [
    {
      author: "LosPollos_99",
      season: 1, episode: 6,
      body: `The walk-out shot only works because we’ve seen Walt be so small for five episodes. It’s not just “cool guy in front of fire,” it’s a guy realizing he can make the universe flinch for once.`
    },
    {
      author: "GusGusNoSpoils",
      season: 3, episode: 5,
      body: `My favorite part is how cheap the trick is on paper: throw rock, boom. But the framing treats it like a spiritual awakening. That’s kind of the whole show—petty tools treated like holy relics.`
    },
    {
      author: "MineralCollector",
      season: 4, episode: 1,
      body: `You can almost see the future Heisenberg silhouette get born in that shot. Later, when the show goes much darker, this feels like the first time he tries on the costume and it accidentally fits.`
    },
  ]);

  /* ---------- S2E3 – “The Bureaucracy of Lies” ---------- */

  const t_2_3 = findPopcornThread(2, 3, "The Bureaucracy of Lies");
  setCuratedReplies(t_2_3, [
    {
      author: "BetterCallMe",
      season: 2, episode: 3,
      body: `The fugue state cover story is peak red tape. He literally invents a paperwork diagnosis for disappearing. It’s like he’s weaponizing the fact that hospitals and cops are buried in forms.`
    },
    {
      author: "SaulGoodDude",
      season: 3, episode: 1,
      body: `Every time Walt “resolves” a lie, he actually creates a new department. Skyler, Hank, the doctors, the school—everyone gets their own slightly different version of the memo. No wonder the admin load explodes.`
    },
    {
      author: "CarWashOwner",
      season: 4, episode: 3,
      body: `What kills me is that he still acts offended when people don’t believe him. Like: sir, you have filled out sixteen contradictory forms about your own life. The system is working exactly as you designed it.`
    },
  ]);

  /* ---------- S2E10 – “The Dinner Scene That Turned Everything” ---------- */

  const t_2_10 = findPopcornThread(2, 10, "The Dinner Scene That Turned Everything");
  setCuratedReplies(t_2_10, [
    {
      author: "PinkmanVibes",
      season: 2, episode: 10,
      body: `That tequila moment with Walt Jr. is so rough. You can feel the scene flip from “we’re celebrating” to “something is broken here” without anyone saying it. The power trip leaks out of him by accident.`
    },
    {
      author: "ABQLocal",
      season: 3, episode: 1,
      body: `I love how the scene is staged around that table. Walt in host mode, Hank doing his usual bluster, Skyler watching the temperature rise. It’s like a pressure cooker with nice stemware.`
    },
    {
      author: "Heisenfan",
      season: 4, episode: 1,
      body: `You’re right that this is the pivot away from cancer. Once you’ve seen more of the show, it feels like the last time his illness is an excuse instead of a background condition for his ambition.`
    },
  ]);

  /* ---------- S3E1 – “No Más and the Gospel of Silence” ---------- */

  const t_3_1 = findPopcornThread(3, 1, "No Más and the Gospel of Silence");
  setCuratedReplies(t_3_1, [
    {
      author: "CactoidPrime",
      season: 3, episode: 1,
      body: `The crawl sequence is so good because the show refuses to translate it for you. No subtitles, no exposition dump, just an image ritual that you’re forced to sit with until the meaning clicks later.`
    },
    {
      author: "FringWatch",
      season: 3, episode: 6,
      body: `It’s also the first time Albuquerque feels like part of a larger mythic landscape. Up to now we’ve mostly been in houses, schools, and junkyards. Suddenly there’s this pilgrimage happening in the margins.`
    },
    {
      author: "MikeIsCalm",
      season: 4, episode: 1,
      body: `What I love is how quiet Walt’s own scenes feel against that opener. The cousins are pure intention; Walt is pure noise. The silence belongs to the people who already know exactly what they’re here to do.`
    },
  ]);

  /* ---------- S3E5 – “The Lab as a Love Story” ---------- */

  const t_3_5 = findPopcornThread(3, 5, "The Lab as a Love Story");
  setCuratedReplies(t_3_5, [
    {
      author: "GaleSingAlong",
      season: 3, episode: 5,
      body: `The way he walks into that lab is exactly how people shoot meet-cute scenes. Eye contact, slow walk, the little half-smile. It’s a rom-com beat pointed at stainless steel.`
    },
    {
      author: "MadrigalEnjoyer",
      season: 4, episode: 3,
      body: `Production-design-as-character is right on. You can basically chart Walt’s soul by his workspaces: RV chaos, makeshift basements, and then this cathedral where every surface says “you belong here.”`
    },
    {
      author: "LydiaBean",
      season: 5, episode: 3,
      body: `What’s really scary is how fast the lab normalizes everything. Once the environment looks legitimate, it’s easier to pretend the work is legitimate too. The set is seducing us along with him.`
    },
  ]);

  /* ---------- S3E12 – “Half Measures, Whole Lesson” ---------- */

  const t_3_12 = findPopcornThread(3, 12, "Half Measures, Whole Lesson");
  setCuratedReplies(t_3_12, [
    {
      author: "MikeIsCalm",
      season: 3, episode: 12,
      body: `As someone who loves good crime writing, that monologue feels like a mission statement and a resignation letter at the same time. Mike is telling Walt exactly how not to be him, and you know it won’t land.`
    },
    {
      author: "TucoRageQuit",
      season: 4, episode: 2,
      body: `What gets me is the structure: calm story, simple rule, and then the show immediately breaks its own rule in the most shocking way possible. It’s thesis, antithesis, and then a car coming out of nowhere.`
    },
    {
      author: "GusGusNoSpoils",
      season: 5, episode: 1,
      body: `You can watch the whole series through the lens of that speech. Every time someone tries a half measure, the universe eventually corrects it with something horrifying. Full measures are just the ones we notice more.`
    },
  ]);

  /* ---------- S4E1 – “Box Cutter and the Art of Stillness” ---------- */

  const t_4_1 = findPopcornThread(4, 1, "Box Cutter and the Art of Stillness");
  setCuratedReplies(t_4_1, [
    {
      author: "MineralCollector",
      season: 4, episode: 1,
      body: `The part that wrecks me is Gus changing clothes twice. Suit → lab gear → suit. It’s like the murder is just a brief task slotted between meetings. No music, no speech, just a calendar item.`
    },
    {
      author: "FringWatch",
      season: 4, episode: 7,
      body: `You’re dead on about “oxygen control.” The edit feels like someone slowly turning down the air in the room. By the time the box cutter actually moves, you’re desperate for *anything* to break the tension.`
    },
    {
      author: "HuellRules",
      season: 5, episode: 2,
      body: `Also appreciate that the camera almost never flinches. No shaky coverage, no frantic cutting. It’s weirdly respectful, which somehow makes it ten times more upsetting.`
    },
  ]);

  /* ---------- S4E3 – “Skyler’s Moral Algebra” ---------- */

  const t_4_3 = findPopcornThread(4, 3, "Skyler’s Moral Algebra");
  setCuratedReplies(t_4_3, [
    {
      author: "CarWashOwner",
      season: 4, episode: 3,
      body: `“Moral algebra” is such a good way to put it. You can see her trying to balance columns: kids, house, lies, money. She’s not chasing a thrill, she’s trying to make the numbers stop screaming.`
    },
    {
      author: "BlueSkyChem",
      season: 5, episode: 1,
      body: `What I love is how un-showy her turn is. No big villain monologue, just a series of tiny, awful compromises. She’s basically doing forensic accounting on her own conscience.`
    },
    {
      author: "hi_itsme",
      season: 5, episode: 8,
      body: `In a lot of crime stories, the spouse either leaves or forgives. Skyler does neither. She stays, adapts, and never lets herself forget that what she’s doing is wrong. That tension is what makes her so sharp.`
    },
  ]);

})();









/* ----------------- CURATED REPLIES FOR SLATEORBIT THREADS ------------------ */

(function seedSlateOrbitReplies(){
  function findSlateThreads(season: number, episode: number, titleStart: string): Thread[] {
    return seedThreads.filter(t =>
      t.showId === "bb" &&
      t.author === "SlateOrbit" &&
      t.season === season &&
      t.episode === episode &&
      t.titleBase.startsWith(titleStart)
    );
  }

  type SlateReplyDef = {
    author: string;
    season: number;  // replier's watch progress (season)
    episode: number; // replier's watch progress (episode)
    body: string;
  };

  function setSlateReplies(threads: Thread[], defs: SlateReplyDef[]) {
    if (!threads.length) return;
    for (const t of threads) {
      const baseTime = t.updatedAt;
      const curated: Reply[] = defs.map((d, idx) => ({
        id: `${t.id}-sc${idx + 1}`,
        threadId: t.id,
        showId: t.showId,
        season: d.season,
        episode: d.episode,
        author: d.author,
        body: d.body,
        updatedAt: baseTime + (idx + 1) * 15 * 60_000,
        likes: randBetween(0, 28),
      }));
      repliesByThread[t.id] = curated;
    }
  }

  /* ---------- S1E1 – “The Medium Is the Meth” ---------- */

  const s1e1_threads = findSlateThreads(1, 1, "The Medium Is the Meth");
  setSlateReplies(s1e1_threads, [
    {
      author: "RVEnthusiast",
      season: 1, episode: 1,
      body: `I kind of like that it owns its TV bones. The cold open RV chaos feels like a teaser for a different show, and then the ad-break rhythms you’re talking about lull you back into “normal life” between each escalation.`
    },
    {
      author: "BlueSkyChem",
      season: 2, episode: 13,
      body: `On a rewatch, those “engineered” beats hit different once we know the teddy bear isn’t just an edgy flourish. It really does feel like the pilot is designing a controlled experiment that’s going to blow apart the neighborhood.`
    },
    {
      author: "FlyEpisodeDefender",
      season: 4, episode: 11,
      body: `If you stick with it, I think the show slowly earns the silence you’re missing here. By the time we get to things like the RV desert marathons and the almost-wordless stuff in the lab, it’s like they’ve graduated from TV timing to something closer to what you’re asking for.`
    },
  ]);

  /* ---------- S1E2 – “A Bathtub Scene for Late Capitalism” ---------- */

  const s1e2_threads = findSlateThreads(1, 2, "A Bathtub Scene for Late Capitalism");
  setSlateReplies(s1e2_threads, [
    {
      author: "CarWashOwner",
      season: 1, episode: 2,
      body: `Totally. The part that gets me is that they’re trying to dispose of evidence like a company trying to manage waste off the books. It’s not just a gross gag, it’s industrial negligence happening in a hallway.`
    },
    {
      author: "PinkmanVibes",
      season: 3, episode: 6,
      body: `The ceiling giving out is such a good mission statement for the show’s ethics. You can try to dissolve the problem in the back room, but sooner or later it crashes into the living space in front of people who had nothing to do with it.`
    },
    {
      author: "ABQLocal",
      season: 5, episode: 6,
      body: `I like your “middle class guilt” take, because so much later on is just fancier versions of this shot. Money laundering, shell companies, train heists—it’s all different flavors of “maybe the mess will stay where we put it this time.”`
    },
  ]);

  /* ---------- S2E5 – “The Show About Scheduling” ---------- */

  const s2e5_threads = findSlateThreads(2, 5, "The Show About Scheduling");
  setSlateReplies(s2e5_threads, [
    {
      author: "TheScheduleIsTheStory",
      season: 2, episode: 5,
      body: `Love this. It really is a show about task lists. Who’s driving, who’s holding, who’s watching the stash. The panic is less “are we evil?” and more “do we have capacity this week?”`
    },
    {
      author: "GaleSingAlong",
      season: 3, episode: 6,
      body: `Once the RV becomes evidence, the logistics obsession turns into horror. It’s not just a vehicle, it’s a rolling hard drive of felonies, and the calendar suddenly includes things like “destroy our entire history by 3pm.”`
    },
    {
      author: "MadrigalEnjoyer",
      season: 4, episode: 8,
      body: `What’s funny is how far up the chain that scheduling anxiety travels. By the time we’re watching multinational suits panic about distribution lanes and fronts, it’s the same energy as Jesse trying to wrangle his tiny crew—just with nicer stationery.`
    },
  ]);

  /* ---------- S2E10 – “Moral Physics and Baby Formula” ---------- */

  const s2e10_threads = findSlateThreads(2, 10, "Moral Physics and Baby Formula");
  setSlateReplies(s2e10_threads, [
    {
      author: "Heisenfan",
      season: 2, episode: 10,
      body: `Yeah, this is the point where “providing for my family” starts to feel like a cover story even to him. The party scene plays like a failed experiment in being normal, and he hates the results.`
    },
    {
      author: "SkylerPointOfView",
      season: 3, episode: 1,
      body: `A Skyler-only version would be incredible. From her side, the pivot isn’t cancer → control, it’s “supportive wife” → “forensic accountant of this man’s bullshit.” She’s doing moral physics while everyone else is doing vibes.`
    },
    {
      author: "EmpireBusiness",
      season: 5, episode: 6,
      body: `As someone who’s seen the whole thing, this episode feels like the first time he really gets high on the idea of control for its own sake. The baby monitor and the hardware store aisle are just early prototypes of the empire pitch.`
    },
  ]);

  /* ---------- S3E1 – “A Desert, a Gun, a Man Explaining Himself” ---------- */

  const s3e1_threads = findSlateThreads(3, 1, "A Desert, a Gun, a Man Explaining Himself");
  setSlateReplies(s3e1_threads, [
    {
      author: "CactoidPrime",
      season: 3, episode: 1,
      body: `I love that the desert here is doing three jobs at once: fallout from the sky, rehab processing, and that little roadside gun ritual. It’s consequence, therapy, and performance all baked into the same location.`
    },
    {
      author: "FringWatch",
      season: 4, episode: 1,
      body: `I get what you mean about explanation sneaking in after the crawl, but I kind of like the whiplash. The show keeps bouncing between pure image (shrines, cousins, sky) and dudes trying to justify themselves, and the gap between those is where all the dread lives.`
    },
    {
      author: "OzymandiasFan",
      season: 5, episode: 14,
      body: `If you stick with it, the desert eventually gets the last word. All the explaining, all the myth-building, and you still end up back out there with a gun and a man who’s out of stories. This episode feels like the first draft of that ending.`
    },
  ]);

  /* ---------- S3E2 – “I Don’t Trust the Camera” (both copies) ---------- */

  const s3e2_threads = findSlateThreads(3, 2, "I Don’t Trust the Camera");
  setSlateReplies(s3e2_threads, [
    {
      author: "MikeIsCalm",
      season: 3, episode: 2,
      body: `I kind of love that you don’t trust it yet. The precision is so showy you can see the storyboard. For me the fun is waiting for the moments when the blocking fails a little and you realize the characters have outgrown the frame they built for them.`
    },
    {
      author: "ProblemDog",
      season: 4, episode: 7,
      body: `Later on they start weaponizing that immaculate coverage. There are scenes where the camera is so composed it feels like a lie the show is telling you, and then some tiny “mistake” in the background is the thing that actually matters.`
    },
    {
      author: "FlyEpisodeDefender",
      season: 5, episode: 4,
      body: `If you’re missing accidents, wait until you get to some of the long, static setups where the only “action” is an actor’s face falling apart. It’s still meticulous, but it stops feeling like demo reel material and starts feeling like surveillance.`
    },
  ]);

})();







/* ----------------- CURATED REPLIES FOR LOOMSIGNAL THREADS ------------------ */

(function seedLoomSignalReplies(){
  function findLoomThreads(season: number, episode: number, titleStart: string): Thread[] {
    return seedThreads.filter(t =>
      t.showId === "bb" &&
      t.author === "LoomSignal" &&
      t.season === season &&
      t.episode === episode &&
      t.titleBase.startsWith(titleStart)
    );
  }

  type LoomReplyDef = {
    author: string;
    season: number;  // replier's watch progress (season)
    episode: number; // replier's watch progress (episode)
    body: string;
  };

  function setLoomReplies(threads: Thread[], defs: LoomReplyDef[]) {
    if (!threads.length) return;
    for (const t of threads) {
      const baseTime = t.updatedAt;
      const curated: Reply[] = defs.map((d, idx) => ({
        id: `${t.id}-lc${idx + 1}`,
        threadId: t.id,
        showId: t.showId,
        season: d.season,
        episode: d.episode,
        author: d.author,
        body: d.body,
        updatedAt: baseTime + (idx + 1) * 15 * 60_000,
        likes: randBetween(0, 28),
      }));
      repliesByThread[t.id] = curated;
    }
  }

  /* ---------- S1E1 – “The Science Fair from Hell” ---------- */

  const ls_s1e1 = findLoomThreads(1, 1, "The Science Fair from Hell");
  setLoomReplies(ls_s1e1, [
    {
      author: "BlueSkyChem",
      season: 1, episode: 1,
      body: `That’s exactly why the RV scenes hit so hard for me. You can see the same guy who explains combustion to bored kids suddenly realizing he can run the wildest lab in town. It’s a science fair where someone swapped out the baking soda volcano for actual stakes.`
    },
    {
      author: "PinkmanVibes",
      season: 2, episode: 6,
      body: `As someone who barely scraped through chemistry, it’s both funny and sad that the first time Walt gets real engagement is from a former student who’s now his partner in crime. All that potential, and the only hands-on learning is happening in a death van.`
    },
    {
      author: "EmpireBusiness",
      season: 5, episode: 3,
      body: `Rewatching after the whole empire speech, the pilot feels like a guy giving a TED Talk about change while secretly pitching himself on becoming the case study. The “what if I used my power for something terrible?” thought never really leaves the room after this.`
    },
  ]);

  /* ---------- S1E2 – “So... the Acid Goes Through the Ceiling?” ---------- */

  const ls_s1e2 = findLoomThreads(1, 2, "So... the Acid Goes Through the Ceiling?");
  setLoomReplies(ls_s1e2, [
    {
      author: "CarWashOwner",
      season: 1, episode: 2,
      body: `I laughed way too hard at how matter-of-fact the house is about rejecting their plan. They try to outsource the mess to the bathtub and the building says “nope,” and just drops the invoice into the hallway.`
    },
    {
      author: "TheScheduleIsTheStory",
      season: 2, episode: 11,
      body: `This episode is where I realized the show is obsessed with maintenance. Clean the evidence, mop the floor, fix the story. When the ceiling gives out, it feels like reality refusing to be one more thing they can tidy.`
    },
    {
      author: "ProblemDog",
      season: 4, episode: 7,
      body: `What kills me on a rewatch is how small this disaster is compared to later ones, but it’s shot with the same sense of “you don’t come back from this.” The scale changes over the seasons, the feeling doesn’t.`
    },
  ]);

  /* ---------- S1E6 – “Walt’s Midlife Patch Notes” ---------- */

  const ls_s1e6 = findLoomThreads(1, 6, "Walt’s Midlife Patch Notes");
  setLoomReplies(ls_s1e6, [
    {
      author: "LosPollos_99",
      season: 1, episode: 6,
      body: `That explosion honestly feels like a software update notification. “Heisenberg 1.0 is ready to install. Restart now?” And he hits yes without reading the changelog about side effects.`
    },
    {
      author: "GusGusNoSpoils",
      season: 3, episode: 1,
      body: `You’re spot on about control vs. genius. Every time he pulls a stunt like this, he seems less interested in solving a problem and more interested in proving he’s the smartest person in the room, even when the room is on fire.`
    },
    {
      author: "OzymandiasFan",
      season: 5, episode: 14,
      body: `By the time you get to the end, this moment reads like the first shaky monologue in a long villain audition. The bald head, the swagger, the chemistry trick—it’s all there, just not calibrated yet for how much damage he’s going to do.`
    },
  ]);

  /* ---------- S2E3 – “The Show About Cleaning Up” ---------- */

  const ls_s2e3 = findLoomThreads(2, 3, "The Show About Cleaning Up");
  setLoomReplies(ls_s2e3, [
    {
      author: "TheScheduleIsTheStory",
      season: 2, episode: 3,
      body: `I love your “domestic show” read. Half the scenes really are about wiping surfaces and rehearsing stories. Every cook seems to come with a matching chore list.`
    },
    {
      author: "SaulGoodDude",
      season: 3, episode: 3,
      body: `Once Saul shows up, it becomes even more literal: he’s basically a professional janitor for consequences. Paperwork, cover stories, disappearing acts—he just uses legal pads instead of mops.`
    },
    {
      author: "MikeIsCalm",
      season: 4, episode: 2,
      body: `By the time Mike is fully in the picture, the show has three separate cleanup departments: physical, legal, and emotional. What never really gets cleaned is the people doing all that work. They just get more practiced at hiding the stains.`
    },
  ]);

  /* ---------- S2E11 – “Desert Space” ---------- */

  const ls_s2e11 = findLoomThreads(2, 11, "Desert Space");
  setLoomReplies(ls_s2e11, [
    {
      author: "CactoidPrime",
      season: 2, episode: 11,
      body: `The DS9 comparison is so good. Every time they drive out past the city lights, you can feel the rules thinning out. The same people look different in that light, like they’re stepping onto a different station.`
    },
    {
      author: "FringWatch",
      season: 3, episode: 1,
      body: `After the plane crash, the sky over that desert feels haunted. It’s not just empty land anymore, it’s airspace with ghosts, which makes every new “deal in the middle of nowhere” land a little heavier.`
    },
    {
      author: "SalamancaShrine",
      season: 4, episode: 1,
      body: `What I like is that the desert never picks a side. Cops, cartel, cooks—they all use it the same way: somewhere to hide things they can’t face at home. In that sense it really is outer space: just vacuum, reflecting whatever junk you bring with you.`
    },
  ]);

  /* ---------- S3E6 – “The Lab and the Temptation of Order” ---------- */

  const ls_s3e6 = findLoomThreads(3, 6, "The Lab and the Temptation of Order");
  setLoomReplies(ls_s3e6, [
    {
      author: "GaleSingAlong",
      season: 3, episode: 6,
      body: `Calling it “the architectural equivalent of a lie told perfectly” is perfect. Gale basically treats that place like a temple, and it’s easy to see why Walt feels invited to become its high priest.`
    },
    {
      author: "MadrigalEnjoyer",
      season: 4, episode: 8,
      body: `The comfort in systems thing hits hard. Once the lab is running, the horror isn’t loud anymore—it’s scheduled. Six cooks a week, waste handled, product distributed. Evil with a maintenance contract.`
    },
    {
      author: "LydiaBean",
      season: 5, episode: 2,
      body: `As someone who works in spreadsheets all day, the scariest part for me is how scalable it looks. Swap in a new cook, swap in a new market, keep the shiny control panel. That’s basically the Madrigal motto.`
    },
  ]);

  /* ---------- S3E12 – “Half Measures, Whole Truth” ---------- */

  const ls_s3e12 = findLoomThreads(3, 12, "Half Measures, Whole Truth");
  setLoomReplies(ls_s3e12, [
    {
      author: "MikeIsCalm",
      season: 3, episode: 12,
      body: `You’re right that the story lands because it feels stolen from real life. It’s not a cool assassin anecdote, it’s a cop admitting he tried to do the right thing in a way that let everyone down worse.`
    },
    {
      author: "ProblemDog",
      season: 4, episode: 7,
      body: `The martial arts overlap is such a good angle. Mike is basically describing bad form: you step in with doubt, you pull the punch, and the counter hit is twice as brutal. The show keeps proving him right.`
    },
    {
      author: "OzymandiasFan",
      season: 5, episode: 14,
      body: `On a full-series rewatch, that speech feels like the pivot away from pretending this can be done gently. Every “I’ll fix this later” choice after this episode has a body count attached. That’s the whole truth he’s warning Walt about.`
    },
  ]);

  /* ---------- S4E1 – “The Quiet Terror of Box Cutter” ---------- */

  const ls_s4e1 = findLoomThreads(4, 1, "The Quiet Terror of Box Cutter");
  setLoomReplies(ls_s4e1, [
    {
      author: "MineralCollector",
      season: 4, episode: 1,
      body: `The industrial hum wrecked me too. It sounds like the building is working overtime while everyone inside is trying very hard not to breathe too loud. No score, just ventilation and dread.`
    },
    {
      author: "FringWatch",
      season: 4, episode: 11,
      body: `I love the 2001 comparison. Gus walking around in that lab gear has the same “calm machine malfunctions a man” vibe. You get the sense he already decided what this scene was going to look like days ago.`
    },
    {
      author: "HuellRules",
      season: 5, episode: 8,
      body: `Knowing how their war ends, this feels like the lesson Walt never forgets: you don’t have to shout to be terrifying. You just have to make the worst thing in the room feel like a routine procedure.`
    },
  ]);

  /* ---------- S4E2 – “Skyler’s Firewall” ---------- */

  const ls_s4e2 = findLoomThreads(4, 2, "Skyler’s Firewall");
  setLoomReplies(ls_s4e2, [
    {
      author: "SkylerPointOfView",
      season: 4, episode: 2,
      body: `“Firewall” is exactly it. She’s not out of the system anymore; she’s the one setting up partitions and air gaps so the damage doesn’t take everything down at once. It’s bleak and weirdly heroic at the same time.`
    },
    {
      author: "CarWashOwner",
      season: 4, episode: 11,
      body: `Watching her rehearse phone calls and script cover stories is almost scarier than any gun scene. She’s doing crisis management in real time, and the only thing she’s protecting is whatever’s left of the kids’ future.`
    },
    {
      author: "FiftyOneWatcher",
      season: 5, episode: 4,
      body: `When you get to the pool scene in “Fifty-One,” this post feels prophetic. The firewall is still up, but she’s burning out behind it. She’s the only one not driven by ego, and the show makes it clear how much that costs her.`
    },
  ]);

})();







/* ----------------- CURATED REPLIES FOR _QUIETLOOP THREADS ------------------ */

(function seedQuietloopReplies(){
  function findQuietThreads(season: number, episode: number, titleStart: string): Thread[] {
    return seedThreads.filter(t =>
      t.showId === "bb" &&
      t.author === "_quietloop" &&
      t.season === season &&
      t.episode === episode &&
      t.titleBase.startsWith(titleStart)
    );
  }

  type QuietReplyDef = {
    author: string;
    season: number;  // replier's watch progress (season)
    episode: number; // replier's watch progress (episode)
    body: string;
  };

  function setQuietReplies(threads: Thread[], defs: QuietReplyDef[]) {
    if (!threads.length) return;
    for (const t of threads) {
      const baseTime = t.updatedAt;
      const curated: Reply[] = defs.map((d, idx) => ({
        id: `${t.id}-qc${idx + 1}`,
        threadId: t.id,
        showId: t.showId,
        season: d.season,
        episode: d.episode,
        author: d.author,
        body: d.body,
        updatedAt: baseTime + (idx + 1) * 15 * 60_000,
        likes: randBetween(0, 28),
      }));
      repliesByThread[t.id] = curated;
    }
  }

  /* ---------- S1E1 – “The Pilot Blew Me Away” ---------- */

  const q_s1e1 = findQuietThreads(1, 1, "The Pilot Blew Me Away");
  setQuietReplies(q_s1e1, [
    {
      author: "RVEnthusiast",
      season: 1, episode: 1,
      body: `Same. I was ready for “good cable show” vibes, not a full little movie. The pants falling from the sky into that wide frame is such a goofy image, but the way they shoot it tells you they’re going to take even the dumb bits seriously.`
    },
    {
      author: "BlueSkyChem",
      season: 2, episode: 13,
      body: `On a rewatch, the pilot feels like the control group in an experiment. Ordinary house, ordinary job, and then one impossible variable gets added and the whole thing blows apart over Albuquerque. You can basically draw a line from the opening RV shot to the pink bear in the pool.`
    },
    {
      author: "EmpireBusiness",
      season: 5, episode: 6,
      body: `The Moneyball comparison is so good because later the “math to break the world” stuff stops being cute. At first it’s “what if I apply chemistry to this one little scam,” and by the time he’s talking about empires, you realize the pilot was his origin story pitch and we all bought in.`
    },
  ]);

  /* ---------- S1E2 – “The Bathtub Scene Is Still in My Head” ---------- */

  const q_s1e2 = findQuietThreads(1, 2, "The Bathtub Scene Is Still in My Head");
  setQuietReplies(q_s1e2, [
    {
      author: "CarWashOwner",
      season: 1, episode: 2,
      body: `The sound of that sludge hitting the floor is honestly worse than anything we see. You’re right, the tonal control is wild: it’s a Looney Tunes gag that never lets you forget it used to be a person.`
    },
    {
      author: "ProblemDog",
      season: 3, episode: 12,
      body: `The show keeps finding new ways to stage “you can’t just wash this away” — here it’s the ceiling, later it’s Jesse staring at kid-sized bike tracks in the dirt. The mess always escapes the container they try to put it in.`
    },
    {
      author: "DeadFreight",
      season: 5, episode: 5,
      body: `What’s messed up is how this scene feels like training wheels for later. First it’s acid and a bathtub, later it’s a whole train job and that same whiplash from “we pulled it off” to “oh god what did we do” in about three seconds.`
    },
  ]);

  /* ---------- S1E6 – “Okay, I Get the Hype Now” ---------- */

  const q_s1e6 = findQuietThreads(1, 6, "Okay, I Get the Hype Now");
  setQuietReplies(q_s1e6, [
    {
      author: "LosPollos_99",
      season: 1, episode: 6,
      body: `That walk out of the building is the first time the show lets him feel like the main character in his own life. It’s ridiculous and earned at the same time, which is kind of the series in one shot.`
    },
    {
      author: "GusGusNoSpoils",
      season: 3, episode: 6,
      body: `I like how low-tech his “superpower” is here. It’s just rocks and confidence. Later, when he’s surrounded by stainless steel and real money, you can still see the guy who figured out he could scare a room with one good trick.`
    },
    {
      author: "SayMyName",
      season: 5, episode: 7,
      body: `Watching this after he starts demanding people say his name is brutal. This is the moment where blowing up a little office feels like the peak. By the time he’s staring down whole crews in the desert, this reads like his audition tape.`
    },
  ]);

  /* ---------- S2E10 – “The Dinner Scene and the Horror of Normalcy” ---------- */

  const q_s2e10 = findQuietThreads(2, 10, "The Dinner Scene and the Horror of Normalcy");
  setQuietReplies(q_s2e10, [
    {
      author: "SkylerPointOfView",
      season: 2, episode: 10,
      body: `Love this read. The scene looks like every awkward family dinner ever, which makes the power imbalance feel worse. Nobody knows they’re in a horror story yet except us and Walt’s ego.`
    },
    {
      author: "Heisenfan",
      season: 4, episode: 3,
      body: `It’s wild how much of the show’s thesis is already there: control, denial, performance. Once you’ve seen Skyler doing her own careful lies with the car wash and Hank’s bills, this little “non-confession” plays like the first bad draft of everyone’s cover story.`
    },
    {
      author: "FiftyOneWatcher",
      season: 5, episode: 4,
      body: `If this dinner freaked you out, wait until you get to his birthday in Season 5. Same basic setup—table, cake, family—and everyone silently screaming for completely different reasons. It’s like the show keeps updating the firmware on “horror of normalcy.”`
    },
  ]);

  /* ---------- S3E6 – “Breaking Bad and the Math of Consequences” ---------- */

  const q_s3e6 = findQuietThreads(3, 6, "Breaking Bad and the Math of Consequences");
  setQuietReplies(q_s3e6, [
    {
      author: "GaleSingAlong",
      season: 3, episode: 6,
      body: `The “equations” thing really clicks for me here too. Gale is literally treating crime like a beautifully balanced formula, and Walt can’t resist solving the hardest version of the problem even when the answer is clearly “everyone gets hurt.”`
    },
    {
      author: "MadrigalEnjoyer",
      season: 4, episode: 8,
      body: `That lab really is a cathedral to ego. It’s also a spreadsheet made out of steel: inputs, outputs, tolerances, margins. The terrifying part is how quickly the system makes monstrous choices feel like just another line item.`
    },
    {
      author: "GlidingOverAll",
      season: 5, episode: 8,
      body: `Once you’ve seen the montage of how far the business expands, posts like this hit even harder. The show keeps doing the math honestly: every improvement in the process gets matched by an equal and opposite disaster somewhere else. The balance sheet always closes.`
    },
  ]);

  /* ---------- S4E1 – “Box Cutter Is Pure Dread” ---------- */

  const q_s4e1 = findQuietThreads(4, 1, "Box Cutter Is Pure Dread");
  setQuietReplies(q_s4e1, [
    {
      author: "MineralCollector",
      season: 4, episode: 1,
      body: `The surgery-light comparison is perfect. Everything is too clean. Bright, sterile, nothing to hide behind. It feels less like a murder and more like someone performing a procedure they already rehearsed in their head a hundred times.`
    },
    {
      author: "FringWatch",
      season: 4, episode: 11,
      body: `What kills me is how mundane Gus makes it. Change clothes, do the unthinkable, change back, go to work. No speech, no gloating. For all of Walt’s big monologues, this quiet little sequence ends up defining the whole season’s vibe.`
    },
    {
      author: "EndTimes",
      season: 4, episode: 12,
      body: `Once you get closer to the finale, this scene feels like the moment Walt realizes what kind of story he’s actually in. Gus shows him what “pure dread” really looks like, and Walt spends the rest of the season trying to learn that language.`
    },
  ]);

  /* ---------- S4E5 – “Skyler Might Be the Most Realistic Character on TV” ---------- */

  const q_s4e5 = findQuietThreads(4, 5, "Skyler Might Be the Most Realistic Character on TV");
  setQuietReplies(q_s4e5, [
    {
      author: "CarWashOwner",
      season: 4, episode: 5,
      body: `Totally with you. Watching her figure out the car wash numbers is somehow more stressful than half the gun scenes. She’s doing risk assessment, cash flow, and emotional triage all at once.`
    },
    {
      author: "SkylerPointOfView",
      season: 5, episode: 1,
      body: `I like that she’s allowed to be furious, smart, and wrong all at the same time. Her plans are “realistic” in the sense that they’re messy and reactive. She’s not a secret mastermind, she’s a person trying not to drown in someone else’s decisions.`
    },
    {
      author: "FiftyOneWatcher",
      season: 5, episode: 4,
      body: `By the time you hit the pool scene, your post basically turns into prophecy. She really is building a new version of herself out of scraps, and the show never pretends that process is noble or fun. It’s just necessary.`
    },
  ]);

})();








/* ----------------- CURATED REPLIES FOR DreamInReverse THREADS ------------------ */

(function seedDreamInReverseReplies(){
  function findDIRThreads(season: number, episode: number, titleStart: string): Thread[] {
    return seedThreads.filter(t =>
      t.showId === "bb" &&
      t.author === "DreamInReverse" &&
      t.season === season &&
      t.episode === episode &&
      t.titleBase.startsWith(titleStart)
    );
  }

  type DIRReplyDef = {
    author: string;
    season: number;  // replier's watch progress
    episode: number; // replier's watch progress
    body: string;
  };

  function setDIRReplies(threads: Thread[], defs: DIRReplyDef[]) {
    if (!threads.length) return;
    for (const t of threads) {
      const baseTime = t.updatedAt;
      const curated: Reply[] = defs.map((d, idx) => ({
        id: `${t.id}-dc${idx + 1}`,
        threadId: t.id,
        showId: t.showId,
        season: d.season,
        episode: d.episode,
        author: d.author,
        body: d.body,
        updatedAt: baseTime + (idx + 1) * 15 * 60_000,
        likes: randBetween(0, 30),
      }));
      repliesByThread[t.id] = curated;
    }
  }

  /* ---------- S1E1 – “Yeah, It’s Good” ---------- */

  const dir_s1e1 = findDIRThreads(1, 1, "Yeah, It’s Good");
  setDIRReplies(dir_s1e1, [
    {
      author: "RVEnthusiast",
      season: 1, episode: 1,
      body: `The pilot really does toss you into chaos fast. I love that the RV somehow feels both slapstick and terrifying — it's a warning shot of how weird this show's tone can get.`
    },
    {
      author: "SlateOrbit",
      season: 2, episode: 3,
      body: `If this felt familiar, wait for how quickly the show starts peeling away Walt's “normal guy” layer. The pants flying through the desert reads like foreshadowing once you know how unhinged things get.`
    },
    {
      author: "QuietLoop",
      season: 4, episode: 1,
      body: `The moment you're like “yeah it's good” is exactly when the show starts tugging on the wire. Funny in hindsight knowing how far the desert and underwear imagery echo down the line.`
    },
  ]);

  /* ---------- S1E2 – “Acid Through the Ceiling” ---------- */

  const dir_s1e2 = findDIRThreads(1, 2, "Acid Through the Ceiling");
  setDIRReplies(dir_s1e2, [
    {
      author: "LoomSignal",
      season: 1, episode: 2,
      body: `This episode nails the chaotic energy of two guys trying to solve a crisis with zero shared skillset. The ceiling gag is horrible and hilarious, which becomes kind of the show's signature.`
    },
    {
      author: "PopcornTheory",
      season: 2, episode: 11,
      body: `You're right to call out contractor energy — Jesse’s shortcuts are basically a thesis statement for half the show. Every time he tries to “wing it,” something collapses. Literally, here.`
    },
    {
      author: "ProblemDog",
      season: 4, episode: 7,
      body: `On a rewatch, this feels tiny compared to later disasters, but emotionally it's the same vibe: they try to hide a mess, and the universe says “absolutely not.”`
    },
  ]);

  /* ---------- S1E6 – “The Explosion Was Fine” ---------- */

  const dir_s1e6 = findDIRThreads(1, 6, "The Explosion Was Fine");
  setDIRReplies(dir_s1e6, [
    {
      author: "QuietLoop",
      season: 1, episode: 6,
      body: `I get you — it's more muted than the hype suggested. But that weird restraint makes Walt's swagger afterwards land harder. He’s trying on a persona he doesn't fit yet.`
    },
    {
      author: "SlateOrbit",
      season: 2, episode: 1,
      body: `Something I love is how “small” this moment feels compared to where Walt's confidence ends up. This is like his training wheels Heisenberg moment.`
    },
    {
      author: "LoomSignal",
      season: 3, episode: 3,
      body: `Later seasons make this one feel almost modest. It's funny watching him play it cool when you know he grows into the guy who uses fear as a second language.`
    },
  ]);

  /* ---------- S2E10 – “Getting Tired of the Lies” ---------- */

  const dir_s2e10 = findDIRThreads(2, 10, "Getting Tired of the Lies");
  setDIRReplies(dir_s2e10, [
    {
      author: "PopcornTheory",
      season: 2, episode: 10,
      body: `Season 2 definitely leans into the “mess compounds slowly” vibe. It feels repetitive because Walt keeps thinking he's solving the problem when he's making it bigger.`
    },
    {
      author: "QuietLoop",
      season: 3, episode: 4,
      body: `You're not wrong — the show is doing incremental slippage on purpose. Every lie is a brick in a wall he won't admit he's building.`
    },
    {
      author: "SlateOrbit",
      season: 4, episode: 3,
      body: `The fatigue you're feeling becomes part of the emotional payoff. Later, you look back at this stretch as the last point where the damage was still containable.`
    },
  ]);

  /* ---------- S3E6 – “That Fancy Lab” ---------- */

  const dir_s3e6 = findDIRThreads(3, 6, "That Fancy Lab");
  setDIRReplies(dir_s3e6, [
    {
      author: "LoomSignal",
      season: 3, episode: 6,
      body: `The jump from RV grime to chrome perfection is jarring, and I think that's the point — it's seducing Walt. The lab is like a mirror reflecting back his idealized self.`
    },
    {
      author: "QuietLoop",
      season: 4, episode: 2,
      body: `The polish does make things feel less “fun,” but it pays off because the tension shifts from survival chaos to controlled pressure. The walls themselves feel complicit.`
    },
    {
      author: "SlateOrbit",
      season: 5, episode: 1,
      body: `Wild how much the environment tracks his psychology. Gone is the scrappy desperation — now it's precision, pride, and a workspace that flatters his ego.`
    },
  ]);

  /* ---------- S4E1 – “Box Cutter” ---------- */

  const dir_s4e1 = findDIRThreads(4, 1, "Box Cutter");
  setDIRReplies(dir_s4e1, [
    {
      author: "RVEnthusiast",
      season: 4, episode: 1,
      body: `The quiet is the scariest part. Gus setting up his clothes with the slow patience of a surgeon made the whole room feel like it shrank.`
    },
    {
      author: "FringWatch",
      season: 4, episode: 11,
      body: `Totally agree — the violence lands because the buildup is suffocating. It's like the camera is afraid to make a sound.`
    },
    {
      author: "HuellRules",
      season: 5, episode: 2,
      body: `This scene ages weirdly well. It's less “shock moment” and more a thesis on Gus: efficiency, silence, and a controlled brutality Walt spends the season trying to imitate.`
    },
  ]);

  /* ---------- S5E6 – “Midway Through Season 5” ---------- */

  const dir_s5e6 = findDIRThreads(5, 6, "Midway Through Season 5");
  setDIRReplies(dir_s5e6, [
    {
      author: "LoomSignal",
      season: 5, episode: 6,
      body: `I felt that emotional distance too. It's like everyone's running on fumes and self-preservation. The show leans into the exhaustion.`
    },
    {
      author: "PopcornTheory",
      season: 5, episode: 10,
      body: `This middle stretch is heavy, but it pays off. The mood you're feeling becomes part of the collapse the show is steering toward.`
    },
    {
      author: "QuietLoop",
      season: 5, episode: 14,
      body: `Funny reading this knowing what’s coming. This is the last moment where anyone still thinks things are “manageable.” The bottom falls out fast.`
    },
  ]);

})();









/* ----------------- CURATED REPLIES FOR EchoMoth THREADS ------------------ */

(function seedEchoMothReplies(){
  function findEchoThreads(season: number, episode: number, titleStart: string): Thread[] {
    return seedThreads.filter(t =>
      t.showId === "bb" &&
      t.author === "EchoMoth" &&
      t.season === season &&
      t.episode === episode &&
      t.titleBase.startsWith(titleStart)
    );
  }

  type EchoReplyDef = {
    author: string;
    season: number;  // replier's watch progress
    episode: number; // replier's watch progress
    body: string;
  };

  function setEchoReplies(threads: Thread[], defs: EchoReplyDef[]) {
    if (!threads.length) return;
    for (const t of threads) {
      const baseTime = t.updatedAt;
      const curated: Reply[] = defs.map((d, idx) => ({
        id: `${t.id}-ec${idx + 1}`,
        threadId: t.id,
        showId: t.showId,
        season: d.season,
        episode: d.episode,
        author: d.author,
        body: d.body,
        updatedAt: baseTime + (idx + 1) * 15 * 60_000,
        likes: randBetween(0, 28),
      }));
      repliesByThread[t.id] = curated;
    }
  }

  /* ---------- S1E1 – “Okay, I Finally Started It” ---------- */

  const em_s1e1 = findEchoThreads(1, 1, "Okay, I Finally Started It");
  setEchoReplies(em_s1e1, [
    {
      author: "PopcornTheory",
      season: 1, episode: 1,
      body: `I like how you put it: “confident.” The pilot isn’t mind-blowing yet, but that calm swagger in how it jumps from chaos back to breakfast says a lot about the kind of story it wants to be.`
    },
    {
      author: "LoomSignal",
      season: 2, episode: 8,
      body: `The sunburnt look really grew on me once I realized how much they’re using color as mood. The palette shifts a bit as things widen out beyond suburbia, but that baked, slightly sick feeling never totally leaves.`
    },
    {
      author: "QuietLoop",
      season: 4, episode: 1,
      body: `It’s funny you mention wanting “more color” because later they start weaponizing it — bright fast-food logos, kids’ bedrooms, the pool — against how bleak the choices are. The pilot’s like the seed of that whole visual language.`
    },
  ]);

  /* ---------- S1E2 – “Acid in the Ceiling, Internet Going Nuts” ---------- */

  const em_s1e2 = findEchoThreads(1, 2, "Acid in the Ceiling, Internet Going Nuts");
  setEchoReplies(em_s1e2, [
    {
      author: "RVEnthusiast",
      season: 1, episode: 2,
      body: `Same whiplash for me: the scene is memeable as hell, but in context it’s just two deeply unqualified people failing at cleaning up a nightmare. The house basically files a complaint by dropping the mess in the hallway.`
    },
    {
      author: "LoomSignal",
      season: 2, episode: 11,
      body: `I like your “slapstick wrapped around bleak” read. Season 2 keeps pushing that line — the gag lands, but the emotional invoice arrives a couple of episodes later.`
    },
    {
      author: "ProblemDog",
      season: 4, episode: 7,
      body: `On a rewatch this feels like their training-wheels disaster. Later messes are bigger, but the pattern stays the same: try to dissolve the problem somewhere private, watch it bleed into the rest of the world anyway.`
    },
  ]);

  /* ---------- S1E6 – “Walter White Is Every Tech Bro at a Panel” ---------- */

  const em_s1e6 = findEchoThreads(1, 6, "Walter White Is Every Tech Bro at a Panel");
  setEchoReplies(em_s1e6, [
    {
      author: "SlateOrbit",
      season: 1, episode: 6,
      body: `“Tech bro at a panel” is painfully accurate. Every time he slips into lecture mode you can see him enjoying that more than actually listening to anyone in the room.`
    },
    {
      author: "GaleSingAlong",
      season: 3, episode: 6,
      body: `The show leans into that dissonance later by giving us someone who actually loves the science and the work, and suddenly Walt’s speeches feel way more like ego than curiosity.`
    },
    {
      author: "EmpireBusiness",
      season: 5, episode: 6,
      body: `Your alternate version where Jesse starts a band instead is hilarious because the series kind of keeps punishing Walt for wanting to be the guy onstage instead of the guy in the crowd. The panel energy never really goes away.`
    },
  ]);

  /* ---------- S2E10 – “The Dinner Scene, or: I’ve Had This Conversation in Real Life” ---------- */

  const em_s2e10 = findEchoThreads(2, 10, "The Dinner Scene, or: I’ve Had This Conversation in Real Life");
  setEchoReplies(em_s2e10, [
    {
      author: "SkylerPointOfView",
      season: 2, episode: 10,
      body: `Totally with you on the “invisible flicker” where Skyler checks out. It’s such a small, real choice — no big blowup, just that quiet internal “I’m done” you only notice if you’ve lived through it.`
    },
    {
      author: "Heisenfan",
      season: 3, episode: 3,
      body: `I like that you don’t quite trust the show yet. It really does walk a line between honest pain and flexing its own precision. For me this scene is one of the few places where the machinery steps back and lets the actors breathe.`
    },
    {
      author: "FiftyOneWatcher",
      season: 5, episode: 4,
      body: `If this dinner felt too much like real life, wait until you hit later family-table moments. The show keeps revisiting that “performed frustration” energy, but in weirder, sadder configurations.`
    },
  ]);

  /* ---------- S2E11 – “Do People Actually Find This Fun?” ---------- */

  const em_s2e11_fun = findEchoThreads(2, 11, "Do People Actually Find This Fun?");
  setEchoReplies(em_s2e11_fun, [
    {
      author: "LoomSignal",
      season: 2, episode: 11,
      body: `I don’t really find it “fun” either, at least not in a comfort-watch way. It feels more like a long anxiety dream with really good blocking. Respectable, but not cozy.`
    },
    {
      author: "QuietLoop",
      season: 3, episode: 5,
      body: `Your “empathy’s cold” line hits. For me the show’s empathy lives in negative space — in what it refuses to turn into a joke or an easy catharsis. That can absolutely feel like the series loving its gears more than its people, though.`
    },
    {
      author: "EchoMothFan",
      season: 4, episode: 2,
      body: `The bit about framing shots on your dog walk is so real. I think that’s the hook: even if you never fully warm to the characters, the way it teaches you to look at parking lots and streetlights is weirdly addictive.`
    },
  ]);

  /* ---------- S2E11 – “Still Watching, Still Skeptical” ---------- */

  const em_s2e11_skeptical = findEchoThreads(2, 11, "Still Watching, Still Skeptical");
  setEchoReplies(em_s2e11_skeptical, [
    {
      author: "PopcornTheory",
      season: 3, episode: 1,
      body: `“Season 3 is where it really starts cooking” made me laugh because that’s exactly what people told me too. I don’t know if it becomes more “fun,” but the show definitely leans into its own weirdness a bit more.`
    },
    {
      author: "LoomSignal",
      season: 3, episode: 7,
      body: `Honestly, watching while skeptical might be the best way to do it. The show loves to be clever; side-eyeing it as you go keeps the hype at arm’s length.`
    },
    {
      author: "DeadFreight",
      season: 5, episode: 5,
      body: `As someone who powered through on the promise that it would “start cooking,” I kind of respect you for admitting you’re here mostly because your dog likes the couch. That’s maybe the healthiest relationship to this show I’ve seen.`
    },
  ]);

})();















/* ------------------------------ SearchShows ------------------------------ */
function SearchShows({ onPick, onStartNewForum }:{
  onPick: (showId: string) => void; onStartNewForum: (query: string) => void;
}){
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);

  const matches = useMemo(()=>{
    const q = query.trim().toLowerCase();
    if(!q) return [];
    return seedShows.filter(s => s.name.toLowerCase().includes(q)).slice(0,25);
  }, [query]);

  useEffect(()=>{ if(hi >= matches.length) setHi(0); }, [matches.length]);

  const choose = (idx: number)=>{
    const m = matches[idx];
    if(!m) return;
    onPick(m.id);
    setQuery(m.name);
    setOpen(false);
  };

  return (
    <div className="splashSearchWrap">
      <span className="splashSearchIcon" aria-hidden>🔍</span>
      <input
        placeholder="find a show"
        className="badge splashSearch"
        value={query}
        onChange={(e)=>{ setQuery(e.target.value); setOpen(true); }}
        onFocus={()=> setOpen(true)}
        onBlur={()=> setTimeout(()=> setOpen(false), 120)}
        onKeyDown={(e)=>{
          if(!open && (e.key==="ArrowDown" || e.key==="ArrowUp")) setOpen(true);
          if(e.key==="ArrowDown"){ e.preventDefault(); setHi(h=> Math.min(h+1, Math.max(0, matches.length-1))); }
          if(e.key==="ArrowUp"){ e.preventDefault(); setHi(h=> Math.max(h-1, 0)); }
          if(e.key==="Enter"){ e.preventDefault(); if(matches.length) choose(hi); }
          if(e.key==="Escape"){ setOpen(false); }
        }}
        aria-autocomplete="list"
        aria-expanded={open && !!query}
        aria-controls="search-suggest"
      />
      {open && !!query && (
        <div id="search-suggest" className="card dropdownPanel" role="listbox">
          {matches.length===0 && <div className="muted">No matches</div>}
          {matches.map((m, idx)=>(
            <div
              key={m.id}
              role="option"
              aria-selected={idx===hi}
              style={{ padding:"6px 8px", cursor:"pointer", background: idx===hi ? "rgba(0,255,255,.15)" : "transparent" }}
              onMouseEnter={()=>setHi(idx)}
              onMouseDown={(e)=>{ e.preventDefault(); choose(idx); }}
            >
              {m.name}
            </div>
          ))}
          <div style={{margin:"6px 0",borderTop:"1px solid var(--dos-border)"}} />
          <div style={{display:"flex",justifyContent:"center",padding:"6px 0"}}>
            <button className="btn" onMouseDown={(e)=>{ e.preventDefault(); onStartNewForum(query.trim()); setOpen(false); }}>
              Start a new forum
            </button>
          </div>
          <div className="muted" style={{textAlign:"center",fontSize:12, paddingBottom:6}}>
            Showing {matches.length} of {seedShows.length}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- Profile -------------------------------- */
function Tabs({ tabs, value, onChange }:{
  tabs: { id:string; label:string }[];
  value: string;
  onChange: (id:string)=>void;
}){
  return (
    <div style={{display:"inline-flex",border:"1px solid var(--dos-border)", marginLeft:12}}>
      {tabs.map((t, i)=>(
        <button
          key={t.id}
          className="btn"
          onClick={()=>onChange(t.id)}
          style={{
            border:"none",
            borderRight: i<tabs.length-1 ? "1px solid var(--dos-border)" : "none",
            background: value===t.id ? "var(--dos-blue)" : "transparent",
            color: value===t.id ? "#fff" : "var(--dos-fg)",
            borderRadius:0
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ProfilePage({
  username,
  progress,
  likesThreads, likesReplies, likedByUserThreads, likedByUserReplies,
  openThreadWithFocus, openShow, onClose
}:{
  username: string;
  progress: Record<string,{s:number;e:number}>;
  likesThreads: Record<string, number>;
  likesReplies: Record<string, number>;
  likedByUserThreads: Record<string, boolean>;
  likedByUserReplies: Record<string, boolean>;
  openThreadWithFocus: (showId:string, threadId:string, replyId?:string)=>void;
  openShow: (showId:string)=>void;
  onClose: ()=>void;
}){

  // Only show my posts up to progress
  const myThreadsAll = useMemo(()=> seedThreads
    .filter(t => t.author === username)
    .filter(t => canView({season:t.season, episode:t.episode}, progress[t.showId]))
    .sort((a,b)=> b.updatedAt - a.updatedAt), [username, progress]);

  const postTabs = useMemo(()=>{
  const ids = Array.from(new Set(myThreadsAll.map(t=>t.showId)));
  return ids.map(id => ({ id, label: seedShows.find(s=>s.id===id)?.name || id }));
}, [myThreadsAll]);

  const [postTab, setPostTab] = useState<string>(postTabs[0]?.id || "");
  useEffect(()=>{ if (!postTabs.find(t=>t.id===postTab) && postTabs[0]) setPostTab(postTabs[0].id); }, [postTabs, postTab]);
  const myThreads = useMemo(()=> myThreadsAll.filter(t=>t.showId===postTab), [myThreadsAll, postTab]);

  // Replies to or from me, but only within my progress (and with visible parent chains)
  const repliesToMeAll = useMemo(()=>{
    const out: { r: Reply; t: Thread }[] = [];
    for (const t of seedThreads) {
      const list = repliesByThread[t.id] || [];
      const byId: Record<string, Reply> = {}; list.forEach(r => byId[r.id]=r);
      const prog = progress[t.showId];
      const chainVisible = (r:Reply)=>{
        if(!canView({season:r.season, episode:r.episode}, prog)) return false;
        let cur = r.replyToId ? byId[r.replyToId] : null;
        while(cur){
          if(!canView({season:cur.season, episode:cur.episode}, prog)) return false;
          cur = cur.replyToId ? byId[cur.replyToId] : null;
        }
        return true;
      };
      for (const r of list) {
        if (!r.replyToId) continue;
        const parent = list.find(x=>x.id===r.replyToId);
        const involvesMe = (parent && parent.author === username) || (r.author === username);
        if (involvesMe && chainVisible(r)) out.push({ r, t });
      }
    }
    return out.sort((a,b)=> (b.r.updatedAt - a.r.updatedAt)).slice(0,200);
  }, [username, progress]);

  const replyTabs = useMemo(()=>{
  const ids = Array.from(new Set(repliesToMeAll.map(p=>p.t.showId)));
  return ids.map(id => ({ id, label: seedShows.find(s=>s.id===id)?.name || id }));
}, [repliesToMeAll]);

  const [replyTab, setReplyTab] = useState<string>(replyTabs[0]?.id || "");
  useEffect(()=>{ if (!replyTabs.find(t=>t.id===replyTab) && replyTabs[0]) setReplyTab(replyTabs[0].id); }, [replyTabs, replyTab]);
  const repliesToMe = useMemo(()=> repliesToMeAll.filter(p=>p.t.showId===replyTab), [repliesToMeAll, replyTab]);

  // YOU LIKED — apply progress filters
  const likedThreadsList = useMemo(()=> seedThreads
    .filter(t=> likedByUserThreads[t.id])
    .filter(t=> canView({season:t.season, episode:t.episode}, progress[t.showId]))
    .sort((a,b)=> b.updatedAt - a.updatedAt), [likedByUserThreads, progress]);

  const likedRepliesList = useMemo(()=>{
    const rows: { r:Reply; t:Thread }[] = [];
    for (const tid of Object.keys(repliesByThread)) {
      const list = repliesByThread[tid];
      const t = seedThreads.find(x=>x.id===tid);
      if (!t) continue;
      const byId: Record<string, Reply> = {}; list.forEach(r => byId[r.id]=r);
      const prog = progress[t.showId];
      const chainVisible = (r:Reply)=>{
        if(!canView({season:r.season, episode:r.episode}, prog)) return false;
        let cur = r.replyToId ? byId[r.replyToId] : null;
        while(cur){
          if(!canView({season:cur.season, episode:cur.episode}, prog)) return false;
          cur = cur.replyToId ? byId[cur.replyToId] : null;
        }
        return true;
      };
      for (const r of list) if (likedByUserReplies[r.id] && chainVisible(r)) rows.push({ r, t });
    }
    return rows.sort((a,b)=> b.r.updatedAt - a.r.updatedAt);
  }, [likedByUserReplies, progress]);


// --- You Liked: Posts tabs/state/filter
const likedPostTabs = useMemo(()=>{
  const ids = Array.from(new Set(likedThreadsList.map(t=>t.showId)));
  return ids.map(id => ({ id, label: seedShows.find(s=>s.id===id)?.name || id }));
}, [likedThreadsList]);

const [likedPostTab, setLikedPostTab] = useState<string>(likedPostTabs[0]?.id || "");
useEffect(()=>{
  if (!likedPostTabs.find(t=>t.id===likedPostTab) && likedPostTabs[0]) {
    setLikedPostTab(likedPostTabs[0].id);
  }
}, [likedPostTabs, likedPostTab]);

const likedThreads = useMemo(
  ()=> likedPostTab ? likedThreadsList.filter(t=>t.showId===likedPostTab) : likedThreadsList,
  [likedThreadsList, likedPostTab]
);

// --- You Liked: Replies tabs/state/filter
const likedReplyTabs = useMemo(()=>{
  const ids = Array.from(new Set(likedRepliesList.map(p=>p.t.showId)));
  return ids.map(id => ({ id, label: seedShows.find(s=>s.id===id)?.name || id }));
}, [likedRepliesList]);

const [likedReplyTab, setLikedReplyTab] = useState<string>(likedReplyTabs[0]?.id || "");
useEffect(()=>{
  if (!likedReplyTabs.find(t=>t.id===likedReplyTab) && likedReplyTabs[0]) {
    setLikedReplyTab(likedReplyTabs[0].id);
  }
}, [likedReplyTabs, likedReplyTab]);

const likedReplies = useMemo(
  ()=> likedReplyTab ? likedRepliesList.filter(p=>p.t.showId===likedReplyTab) : likedRepliesList,
  [likedRepliesList, likedReplyTab]
);







  return (
    <section className="container" style={{paddingBottom:28}}>
      {/* Profile header bar — one row: avatar + name + is watching + rail + home */}
      <div className="stickybar bleed" style={{top:GLOBAL_HEADER_H}}>
        <div className="container" style={{padding:`${ROW_PAD_Y}px 0`}}>
          <div className="hangL" style={{display:"flex", alignItems:"center", gap:12}}>
            <div style={{display:"flex", alignItems:"center", gap:12, flex:"0 0 auto"}}>
              <div className="avatar">{(username?.[0] || "?").toUpperCase()}</div>
              <div className="title" style={{fontSize:22, fontWeight:700, color:"var(--dos-fg)"}}>{username}
              </div>

              <div className="muted" style={{fontStyle:"italic", fontWeight:600, letterSpacing:0.2}}>is watching…</div>
            </div>

            <div
              className="scrollWin"
              style={{display:"flex", gap:12, overflowX:"auto", padding:"4px 0", flex:"1 1 auto"}}
            >
              {Object.keys(progress)
                .sort((a,b)=>{
                  const showA = seedShows.find(s=>s.id===a);
                  const showB = seedShows.find(s=>s.id===b);
                  const pa = progress[a]; const pb = progress[b];
                  const ra = showA ? (pa.s-1) + (pa.e / (showA.seasons[pa.s-1]||1)) : 0;
                  const rb = showB ? (pb.s-1) + (pb.e / (showB.seasons[pb.s-1]||1)) : 0;
                  return rb - ra;
                })
                .map(sid=>{
                  const s = seedShows.find(x=>x.id===sid);
                  return (
                    <a
                      key={sid}
                      onClick={()=>openShow(sid)}
                      style={{cursor:"pointer", textDecoration:"underline", whiteSpace:"nowrap"}}
                      title={`Go to ${s?.name || sid}`}
                    >
                      {s?.name || sid}
                    </a>
                  );
                })
              }
            </div>

            <div style={{flex:"0 0 auto"}}>
              <button className="btn h40" onClick={onClose}>Homepage</button>
            </div>
          </div>
        </div>
      </div>

      <div className="container" style={{marginTop:16}}>
        {/* Your posts */}
        <section style={{marginTop:16}}>
          <div style={{display:"flex", alignItems:"center", justifyContent:"flex-start", marginBottom:8}}>
            <div className="title hangL" style={{fontSize:18}}>Your posts</div>
            <Tabs tabs={postTabs} value={postTab} onChange={setPostTab} />
          </div>

          <div className="card scrollWin" style={{maxHeight: 6*120 + 48, overflow:"auto"}}>
            {myThreads.length === 0 && <div className="muted">No posts yet.</div>}
            {myThreads.map(t=>(
              <div
                key={t.id}
                className="card threadCard"
                style={{margin:"10px 0", cursor:"pointer", position:"relative"}}
                onClick={()=>openThreadWithFocus(t.showId, t.id)}
              >
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div className="title" style={{fontSize:18}}>
  {t.isPrivate && <span title="Private" aria-label="Private" style={{marginRight:8}}>🔒</span>}
  {t.titleBase}
  {t.showId !== "simshow" && (
    <span style={{color:"var(--dos-cyan)"}}>
      {` — S${String(t.season).padStart(2,"0")}E${String(t.episode).padStart(2,"0")}`}
    </span>
  )}
</div>
                  <div className="muted" style={{fontSize:14}}>
                    <span className="username">@{t.author}</span> • {timeAgo(t.updatedAt)}
                  </div>
                </div>
                <div className="muted" style={{fontSize:14, marginTop:4}}>
                  {seedShows.find(s=>s.id===t.showId)?.name || t.showId}
                </div>
                <div style={{marginTop:6}} className="clamp3">{t.preview}</div>

                {/* reply count — respects progress */}
                <div className="replyCount">💬 { visibleRepliesCount(t.id, progress[t.showId]) }</div>
              </div>
            ))}
          </div>
        </section>

        {/* Replies to you */}
        <section style={{marginTop:24}}>
          <div style={{display:"flex", alignItems:"center", justifyContent:"flex-start", marginBottom:8}}>
            <div className="title hangL" style={{fontSize:18}}>Replies to you</div>
            <Tabs tabs={replyTabs} value={replyTab} onChange={setReplyTab} />
          </div>

          <div className="card scrollWin" style={{maxHeight: 6*110 + 48, overflow:"auto"}}>
            {repliesToMe.length === 0 && <div className="muted">No replies yet.</div>}
            {repliesToMe.map(({r,t})=>(
              <div key={r.id} className="card" style={{margin:"10px 0", cursor:"pointer"}}
                   onClick={()=>openThreadWithFocus(t.showId, t.id, r.id)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div className="muted" style={{fontSize:14}}>
                    On <b>{t.titleBase}</b> <span style={{color:"var(--dos-cyan)"}}>S{String(r.season).padStart(2,"0")}E{String(r.episode).padStart(2,"0")}</span> • <span className="username">@{r.author}</span> • {timeAgo(r.updatedAt)}
                  </div>
                </div>
                <div style={{marginTop:6, fontSize:15}} className="clamp3">{r.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* You liked */}
        <section style={{marginTop:24}}>
          <div className="title hangL" style={{fontSize:18, marginBottom:8}}>You liked</div>

          <div className="card" style={{marginBottom:12}}>
            <div className="title" style={{fontSize:16}}>Posts</div>
{likedPostTabs.length > 0 && (
  <Tabs tabs={likedPostTabs} value={likedPostTab} onChange={setLikedPostTab} />
)}
<div className="card scrollWin" style={{maxHeight:6*120+48, overflow:"auto"}}>
  {likedThreads.length===0 && <div className="muted">You haven’t liked any posts yet.</div>}
  {likedThreads.map(t=>(

                <div
                  key={t.id}
                  className="card"
                  style={{margin:"10px 0", cursor:"pointer", position:"relative"}}
                  onClick={()=> openThreadWithFocus(t.showId, t.id)}
                >
                  <div className="muted" style={{fontSize:14}}>
                    {seedShows.find(s=>s.id===t.showId)?.name || t.showId} • {timeAgo(t.updatedAt)}
                  </div>
                  <div className="title" style={{fontSize:18, marginTop:6}}>
                    {t.titleBase} <span style={{color:"var(--dos-cyan)"}}>— S{String(t.season).padStart(2,"0")}E{String(t.episode).padStart(2,"0")}</span>
                  </div>
                  <div style={{marginTop:6}} className="clamp3">{t.preview}</div>
                  <div className="replyCount">💬 { visibleRepliesCount(t.id, progress[t.showId]) }</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
  <div className="title" style={{fontSize:16}}>Replies</div>
  {likedReplyTabs.length > 0 && (
    <Tabs tabs={likedReplyTabs} value={likedReplyTab} onChange={setLikedReplyTab} />
  )}
  <div className="card scrollWin" style={{maxHeight:6*110+48, overflow:"auto"}}>
    {likedReplies.length===0 && <div className="muted">You haven’t liked any replies yet.</div>}
    {likedReplies.map(({r,t})=>(

                <div key={r.id} className="card" style={{margin:"10px 0", cursor:"pointer"}}
                     onClick={()=> openThreadWithFocus(t.showId, t.id, r.id)}>
                  <div className="muted" style={{fontSize:14}}>
                    On <b>{t.titleBase}</b> <span style={{color:"var(--dos-cyan)"}}>S{String(r.season).padStart(2,"0")}E{String(r.episode).padStart(2,"0")}</span> • <span className="username">@{r.author}</span> • {timeAgo(r.updatedAt)}
                  </div>
                  <div style={{marginTop:6}}>{r.body}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Your shows quick links */}
        <section style={{marginTop:24}}>
          <div className="title hangL" style={{fontSize:18, marginBottom:8}}>Your shows</div>
          <div className="card">
            {Object.keys(progress).length===0 && <div className="muted">No shows yet.</div>}
            {Object.keys(progress).map((sid)=>(
              <a key={sid} onClick={()=>openShow(sid)} style={{display:"block",padding:"6px 8px",borderRadius:8,cursor:"pointer"}}>
                {seedShows.find(s=>s.id===sid)?.name || sid}
              </a>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

/* ----------------------------------- App ---------------------------------- */
function App(){
  useEffect(injectDOSStyles, []);

  const username = "hi_itsme";

  const [expandedShowId,setExpandedShowId]=useState<string|null>(null);
  const [activeThreadId,setActiveThreadId]=useState<string|null>(null);
  const [focusReplyId, setFocusReplyId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);

  // Include Severance as one of your shows
  const [progress,setProgress]=useState<{[sid:string]:{s:number;e:number}}>({
  });

  const [pickShowId,setPickShowId]=useState<string|null>(null);
  const pickShow = useMemo(()=>seedShows.find(s=>s.id===pickShowId)||null,[pickShowId]);
  const [hasPendingChange,setHasPendingChange]=useState(false);
  const [firstSel, setFirstSel] = useState<{s:number;e:number} | null>(null);
  useEffect(()=>{
    if (pickShowId) {
      const init = progress[pickShowId] || { s:1, e:1 };
      setFirstSel(init);
    }
  },[pickShowId, progress]);

  const [newHighlights,setNewHighlights]=useState<{[sid:string]:{[tid:string]:true}}>({});
  const [visitedThreads,setVisitedThreads]=useState<{[tid:string]:true}>({});

  const [likesThreads, setLikesThreads] = useState<Record<string, number>>({});
  const [likesReplies, setLikesReplies] = useState<Record<string, number>>({});
  const [likedByUserThreads, setLikedByUserThreads] = useState<Record<string, boolean>>({});
  const [likedByUserReplies, setLikedByUserReplies] = useState<Record<string, boolean>>({});

  useEffect(()=>{
    const lt: Record<string, number> = {};
    seedThreads.forEach(t=>{ lt[t.id] = t.likes; });
    const lr: Record<string, number> = {};
    Object.keys(repliesByThread).forEach(tid=>{
      repliesByThread[tid].forEach(r=>{ lr[r.id] = r.likes; });
    });
    setLikesThreads(lt); setLikesReplies(lr);
  },[]);

  const computeVisibleIds=(sid:string, prog?:{s:number;e:number})=>
    !prog?[]: seedThreads.filter(t=>t.showId===sid).filter(t=>canView(t,prog)).map(t=>t.id);

  const updateProgressFor=(sid:string,next:{s:number;e:number})=>{
    setProgress(prev=>{
      const before=prev[sid]; const beforeIds=computeVisibleIds(sid,before); const afterIds=computeVisibleIds(sid,next);
      const isNew:any={}; afterIds.forEach(id=>{ if(!beforeIds.includes(id)) isNew[id]=true; });
      setNewHighlights(nh=>({...nh,[sid]:isNew}));
      return {...prev,[sid]:next};
    });
  };

  const openShow = (id:string)=>{
    if(!id) return;
    setShowProfile(false);
    setExpandedShowId(id);
    setActiveThreadId(null);
    setFocusReplyId(null);
    requestAnimationFrame(()=>window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
  };

  const openThreadWithFocus = (showId:string, threadId:string, replyId?:string)=>{
    openShow(showId);
    setActiveThreadId(threadId);
    setFocusReplyId(replyId || null);
    requestAnimationFrame(()=>window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" }));
  };

  const goHomepage = ()=>{
    setExpandedShowId(null);
    setActiveThreadId(null);
    setFocusReplyId(null);
    setShowProfile(false);
    requestAnimationFrame(()=>window.scrollTo({ top: 0, behavior: "auto" }));
  };

  const handlePickFromSearch = (showId:string)=>{
    if(progress[showId]) openShow(showId);
    else { setPickShowId(showId); setShowProfile(false); }
  };
  const handleStartNewForum = (query: string)=>{
    const name = query || prompt("Name your new show/forum:");
    if(!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g,"").slice(0,24) || `show${Date.now()}`;
    alert(`(Demo) Created forum “${name}”. Add it to your catalog / backend later.`);
    setProgress(p => ({ ...p, [id]: { s:1, e:1 } }));
    openShow(id);
  };

  








const header = (
  <header className="site bleed">
    <div
      style={{
        height: GLOBAL_HEADER_H,
        display: "flex",
        alignItems: "center",
        padding: "0 0",
        width: "100%",
      }}
    >
      {/* LEFT: brand */}
      <div style={{ flex: "0 0 auto", marginLeft: 20 }}>
        <h1
          className="brand brandLink"
          style={{ margin: 0 }}
          tabIndex={0}
          aria-label="Go to homepage"
          onClick={goHomepage}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              goHomepage();
            }
          }}
        >
          NO-SPOILERS
        </h1>
      </div>

      {/* RIGHT: profile chip */}
      <div
        style={{
          marginLeft: "auto",
          marginRight: 20,
          display: "flex",
          alignItems: "center",
        }}
      >
        <button
          className="profileChip"
          onClick={() => {
            setExpandedShowId(null);
            setActiveThreadId(null);
            setFocusReplyId(null);
            setShowProfile(true);
            requestAnimationFrame(() =>
              window.scrollTo({ top: GLOBAL_HEADER_H, behavior: "auto" })
            );
          }}
          title="View profile"
        >
          <span className="avatar">h</span>
          <span style={{ fontWeight: 700, color: "#000" }}>hi_itsme</span>
        </button>
      </div>
    </div>

    {/* Tagline sits below the row; CSS will “tuck” it up on wide screens */}
    <div className="siteTagline">
      TALK ABOUT THE SHOWS YOU&apos;RE CATCHING UP ON
    </div>
  </header>
);


















  return (
    <section className="container" style={{paddingBottom:28}}>
      {header}
      <ExtensionDock />
      {!showProfile && (
        <>
          <SearchShows onPick={handlePickFromSearch} onStartNewForum={handleStartNewForum} />
          <div style={{display:"grid",gridTemplateColumns:"1fr",gap:28, placeItems:"center"}}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:28, fontWeight:800, letterSpacing:0.5, textTransform:"uppercase", marginBottom:8}}>
                Popular Right Now
              </div>
              <div style={{fontSize:26}}>
                {["bb","penguin","simshow"].map((id, idx, arr)=>{
                  const s = seedShows.find(x=>x.id===id);
                  if(!s) return null;
                  const sep = idx < arr.length-1 ? " / " : "";
                  return (
                    <span key={id}>
                      <a onClick={()=>handlePickFromSearch(id)} style={{cursor:"pointer"}}>{s.name}</a>
                      {sep}
                    </span>
                  );
                })}
              </div>
            </div>
            <YourShowsSelect
              progress={progress}
              value={""}
              onChange={(id)=>{ if(id) openShow(id); }}
            />
          </div>

          {/* About blurb — shows only on the actual homepage, hides on forum/profile */}
          {!expandedShowId && (
            <div className="homeAbout" style={{display:"flex", justifyContent:"center"}}>
              <div style={{maxWidth: 460, width:"100%", padding:"30px 16px"}}>
               <p>** Hello friendly beta-tester!<br /></p><br></br>
                <p>The BREAKING BAD forum is populated with posts that discuss the actual show. THE PENGUIN forum is empty. Right now you can create posts across all forums (but not replies). <br></br><br></br>
               If you haven’t seen BREAKING BAD and don’t want spoilers while beta testing, you can use “Simulated Show” to test the logic of the show. It is a thread with generic posts that should help you understand the logic of the site. <br></br><br></br>
                Below are some notes for myself about where things are and where they can go. Feel free to read them if you are interested. <br></br><br></br>
                — Alborz<br></br><br></br>
                P.S.: This is a mock site — the back button on your browser window will leave the site altogether. And refreshing your page will reset the site.
</p>
                <br></br><br></br><br></br>
                <div className="frontAccent">
                <p>IDEAS FOR THE FUTURE:</p>
                <p>- functional friends / watch together features</p>
                <p>- a.i.-generated wiki-style-summaries of show (plot / characters / etc.), up to your viewing progress </p>
                <p>- figure out: start with only a handful of shows and reach out to show communities to build beta users? Is it like Facebook — growing show by show (vs college by college)? Or can anyone create a new forum for whatever show they’re watching?</p>
                <p>- think more about “watch diary” vibes (like Letterboxd) so that there is built-in value even before the forum is fully active and lively</p>
                <p>- figure out way of seeding shows with links to existing articles (using dates to align with watch progress) and existing external forum posts. This is another potential way of creating value before forum is fully active)</p>
                <p>- think more about anti-scroll, anti-distraction, anti-addiction ethos. This is a healthy place to engage deeply and intentionally with the shows you love (or hate)</p>
                <p>- tag show types on the backend (prestige, comedy, sitcom, reality, etc.) so that prompt suggestions are populated according to show type</p>
                <br></br>
                <p>THOUGHTS ABOUT TROLLS:</p>
                <p>- there is a lot of trolling friction that makes the troll's experience unsatisfying</p>
                <p>- remember, once a troll’s progress is set, their posts won’t be visible to earlier watchers. Trolling only moves forward in time.</p>
                <p>- a troll has to pick a season and episode from which to troll. if they pick very early, then they don't have as much runway to troll because most of the forum will be hidden from them. And most of the reactions to their troll will be hidden from them. If they pick later, then fewer viewers will see their trolling. All of this discourages the behavior</p>
                <p>- enforce time limits on updating show progress (since someone can’t honestly have watched a new episode in less time than an episode length)</p>
                <p>- setting your progress backwards is disabled, so a troll can’t decide to be a troll retroactively</p>
                <p></p>
              </div>
              </div>
            </div>
          )}
        </>
      )}

      {showProfile && (
        <ProfilePage
          username={username}
          progress={progress}
          likesThreads={likesThreads}
          likesReplies={likesReplies}
          likedByUserThreads={likedByUserThreads}
          likedByUserReplies={likedByUserReplies}
          openThreadWithFocus={openThreadWithFocus}
          openShow={openShow}
          onClose={goHomepage}
        />
      )}

      {SINGLE_PAGE && !showProfile && expandedShowId && (
        <div style={{marginTop:40}}>
          <ShowSection
            username={username}
            showId={expandedShowId}
            progress={progress}
            updateProgressFor={(sid, next)=>{
  setProgress(prev=>{
    const before = prev[sid];
    const computeVisibleIds = (sid:string, prog?:{s:number;e:number}) => {
      if (!prog) return [] as string[];
      return seedThreads
        .filter(t=> t.showId === sid)
        .filter(t=> !t.isPrivate)
        .filter(t=> canView({season:t.season, episode:t.episode}, prog))
        .map(t=> t.id);
    };
    const beforeIds = computeVisibleIds(sid, before);
    const afterIds  = computeVisibleIds(sid, next);
    const newly = {} as {[tid:string]:true};
    for (const id of afterIds) if (!beforeIds.includes(id)) newly[id] = true;
    if (Object.keys(newly).length) {
      setNewHighlights(nh => ({ ...nh, [sid]: newly }));
    }
    return { ...prev, [sid]: next };
  });
}}
            newHighlights={newHighlights}
            setNewHighlights={setNewHighlights}
            visitedThreads={visitedThreads}
            setVisitedThreads={setVisitedThreads}
            activeThreadId={activeThreadId}
            setActiveThreadId={setActiveThreadId}
            onHomepage={goHomepage}
            likesThreads={likesThreads}
            setLikesThreads={setLikesThreads}
            likesReplies={likesReplies}
            setLikesReplies={setLikesReplies}
            likedByUserThreads={likedByUserThreads}
            setLikedByUserThreads={setLikedByUserThreads}
            likedByUserReplies={likedByUserReplies}
            setLikedByUserReplies={setLikedByUserReplies}
            focusReplyId={focusReplyId}
          />
        </div>
      )}

      {pickShow && (
        <Modal onClose={()=>setPickShowId(null)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
            <h3 className="title" style={{fontSize:20,margin:0}}>Set your progress</h3>
            <button className="btn" onClick={()=>setPickShowId(null)}>✕</button>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <OneSelectProgress
              show={pickShow}
              value={progress[pickShow.id] || {s:1,e:1}}
              onConfirm={(val)=>{
                setFirstSel(val);
                updateProgressFor(pickShow.id,val);
                setHasPendingChange(false);
                setPickShowId(null);
                openShow(pickShow.id);
              }}
              onPendingChange={setHasPendingChange}
              requireConfirm={false}
              onChangeSelected={(val)=> setFirstSel(val)}
            />
            <div style={{marginLeft:"auto",display:"flex",gap:8}}>
              <button className="btn" onClick={()=>setPickShowId(null)}>Cancel</button>
              <button
                className="btn primary"
                onClick={()=>{
  const chosen = firstSel || (progress[pickShow.id] || {s:1,e:1});

  // NEW: tell the dock your BB progress
  if (pickShow.id === "bb") {
    window.dispatchEvent(new CustomEvent("dock:progress", {
      detail: { showId: "bb", s: chosen.s, e: chosen.e }
    }));
  }

  updateProgressFor(pickShow.id, chosen);
  setPickShowId(null);
  openShow(pickShow.id);
}}
              >
                Confirm
              </button>
            </div>
          </div>
          <p className="muted" style={{fontSize:14,marginTop:8}}>Your feed will only show posts up to your selected episode.</p>
        </Modal>
      )}
    </section>
  );
}

/* --------------------- Your Shows (controlled select) --------------------- */
function YourShowsSelect({
  progress, value, onChange
}:{ progress: Record<string,{s:number;e:number}>; value: string; onChange:(id:string)=>void; }){
  const keys = Object.keys(progress);
  return (
    <div style={{width:"100%", display:"flex", flexDirection:"column", alignItems:"center"}}>
      <div style={{fontSize:28, fontWeight:800, letterSpacing:0.5, textTransform:"uppercase", marginBottom:12}}>
        Your Shows
      </div>
      <select
        className="badge listPill"
        value={value}
        onChange={(ev)=> onChange(ev.target.value)}
      >
        <option value="" disabled>Select your show</option>
        {keys.map((id)=>{
          const s = seedShows.find(x=>x.id===id);
          return <option key={id} value={id}>{s?.name || id}</option>;
        })}
      </select>
    </div>
  );
}

/* ------------------------------- ShowSection ------------------------------- */
function ShowSection({
  username, showId, progress, updateProgressFor, newHighlights, setNewHighlights,
  visitedThreads, setVisitedThreads, activeThreadId, setActiveThreadId, onHomepage,
  likesThreads, setLikesThreads, likedByUserThreads, setLikedByUserThreads,
  likesReplies, setLikesReplies, likedByUserReplies, setLikedByUserReplies,
  focusReplyId
}: any){
  const show = seedShows.find((s)=>s.id===showId) || { id: showId, name: showId, seasons: [10] };

  const [sortBy, setSortBy] = useState<"post"|"episode"|"hot">("post");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState<"standard"|"risky">("standard");
  const [composeOpen, setComposeOpen] = useState(false);

  
  const [threadsVersion, setThreadsVersion] = useState(0);
const bannerRef = useRef<HTMLDivElement|null>(null);
  const topRef = bannerRef;

  const scoreThread = (t: Thread, q: string) => {
    const text = `${t.titleBase} ${t.preview} ${t.body} ${t.author}`.toLowerCase();
    const phrase = q.trim().toLowerCase();
    const tokens = Array.from(new Set(phrase.split(/\s+/).filter(Boolean)));
    if (tokens.length === 0) return 0;
    let score = 0;
    if (text.includes(phrase)) score += 3;
    for (const tok of tokens) if (text.includes(tok)) score += 1;
    for (let i=0;i<tokens.length-1;i++){
      const bigram = `${tokens[i]} ${tokens[i+1]}`;
      if (text.includes(bigram)) score += 2;
    }
    return score;
  };

  const baseVisible = useMemo(()=>{
  const prog = progress[showId];
  let list = seedThreads
    .filter(t=>t.showId===showId)
    .filter(t=>!t.isPrivate)
    .filter(t=>canView(t,prog));

    if (searchQuery.trim()) {
      const withScores = list
        .map(t => ({ t, s: scoreThread(t, searchQuery) }))
        .filter(x => x.s > 0)
        .sort((a,b)=> (b.s - a.s) || (b.t.updatedAt - a.t.updatedAt));
      list = withScores.map(x=>x.t);
    }

    if (sortBy === "post") {
      list = [...list].sort((a,b)=> b.updatedAt - a.updatedAt);
    } else if (sortBy === "episode") {
      list = [...list].sort((a,b)=>{
        if (a.season !== b.season) return b.season - a.season;
        if (a.episode !== b.episode) return b.episode - a.episode;
        return b.updatedAt - a.updatedAt;
      });
    } else if (sortBy === "hot") {
      list = [...list].sort((a,b)=>{
        const la = likesThreads[a.id] ?? a.likes;
        const lb = likesThreads[b.id] ?? b.likes;
        if (lb !== la) return lb - la;
        return b.updatedAt - a.updatedAt;
      });
    }

    return list;
  }, [showId, progress, searchQuery, sortBy, likesThreads, threadsVersion]);

  const [limit,setLimit]=useState(10);
  const sentinelRef = useRef<HTMLDivElement|null>(null);

  useEffect(()=>setLimit(10),[showId,progress[showId]?.s,progress[showId]?.e, searchQuery, sortBy]);
  useEffect(()=>{
    if(!sentinelRef.current) return;
    const el = sentinelRef.current;
    const obs = new IntersectionObserver(entries=>{
      if(entries[0]?.isIntersecting) setLimit(n=>Math.min(n+10,baseVisible.length));
    },{rootMargin:"200px"});
    obs.observe(el);
    return ()=>obs.disconnect();
  },[baseVisible.length]);

  const displayed = useMemo(()=>baseVisible.slice(0,limit),[baseVisible,limit]);
  const thread = activeThreadId ? seedThreads.find(t=>t.id===activeThreadId && t.showId===showId) : null;

  useEffect(()=>{
    if(thread?.id){
      const tid = thread.id;
      setVisitedThreads((v:any)=>({...v,[tid]:true}));
      setNewHighlights((nh:any)=>{ const next = {...(nh[showId]||{})}; delete next[tid]; return {...nh,[showId]:next}; });
    }
  },[thread?.id,showId,setVisitedThreads,setNewHighlights]);

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>)=>{
    if (e.key === "Enter") { setSearchQuery(searchInput); setLimit(10); }
  };
  const clearSearch = ()=>{ setSearchInput(""); setSearchQuery(""); setLimit(10); };

  const scrollToShowTop = ()=>{
    const y = (topRef.current?.getBoundingClientRect().top || 0) + window.scrollY;
    window.scrollTo({ top: y - GLOBAL_HEADER_H, behavior: "auto" });
  };

  const likeThread = (tid:string)=>{
    setLikesThreads((m:any)=>({ ...m, [tid]: (m[tid] ?? (seedThreads.find(t=>t.id===tid)?.likes||0)) + 1 }));
    setLikedByUserThreads((u)=> u[tid] ? u : ({ ...u, [tid]: true }));
  };
  const likeReply = (rid:string)=>{
    setLikesReplies((m:any)=>({ ...m, [rid]: (m[rid] ?? (Object.values(repliesByThread).flat().find(r=>r.id===rid)?.likes||0)) + 1 }));
    setLikedByUserReplies((u)=> u[rid] ? u : ({ ...u, [rid]: true }));
  };

  /* ---- Compose Post ---- */
  const [postTitle,setPostTitle]=useState("");
  const [postBody,setPostBody]=useState("");
  const postProgress = progress[showId] || {s:1,e:1};

  const submitPost = (isPrivate=false)=>{
    const title = (postTitle || "").trim();
    const body = (postBody || "").trim();
    if (!title && !body) { alert("Write something first."); return; }
    const now = Date.now();
    const id = `${showId}-u-${now}`;
    const t: Thread = {
      id, showId, season: postProgress.s, episode: postProgress.e,
      author: username, titleBase: title || "Untitled note",
      preview: (body || "").slice(0,240) + ((body || "").length>240 ? "…" : ""),
      body: body || "(blank)",
      updatedAt: now, likes: 0, isPrivate
    };
    seedThreads.push(t);
    repliesByThread[id] = [];
    setThreadsVersion(v=>v+1);
// make it visible & mark as new highlight for others who advance later (not needed here)
    setComposeOpen(false);
    setPostTitle(""); setPostBody("");
    // open the new thread
    setActiveThreadId(id);
    setTimeout(()=> scrollToShowTop(), 0);
  };

  return (
    <section className="container" style={{paddingTop:16}}>
      {/* TWO-ROW STICKY BANNER */}
      <div className="stickybar bleed" style={{top:GLOBAL_HEADER_H}} ref={bannerRef}>
        <div className="container">
          {/* Row 1 */}
          <div style={{display:"flex",alignItems:"center", justifyContent:"space-between", gap:12, padding:`${ROW_PAD_Y}px 0`}}>
            <span
              className="hangL"
              role={thread ? "button" : "heading"}
              title={thread ? "Back to forum" : "Forum"}
              onClick={thread ? ()=>{ setActiveThreadId(null); setTimeout(()=> scrollToShowTop(), 0); } : undefined}
              style={{
                fontSize:28, fontWeight:800, letterSpacing:.5, textTransform:"uppercase",
                color:"var(--dos-light)", cursor: thread ? "pointer" : "default", userSelect:"none", flex:"0 0 auto"
              }}
            >
              {String((seedShows.find(s=>s.id===showId)?.name)||showId)}
            </span>

            <div className="inlineSearch" style={{flex:"1 1 auto", display:"flex", justifyContent:"center"}}>
              <input
                placeholder="search in this forum (press Enter)"
                className="badge"
                value={searchInput}
                onChange={(e)=>setSearchInput(e.target.value)}
                onKeyDown={onSearchKey}
                style={{width:"100%", paddingRight: (searchInput || searchQuery) ? 28 : 12}}
              />
              {(searchInput || searchQuery) && (
                <button aria-label="Clear search" onClick={clearSearch} className="inlineSearchClear">×</button>
              )}
            </div>

            {!thread && (
              <div style={{display:"flex",alignItems:"center",gap:8, flex:"0 0 auto"}}>
                <select className="badge" value={sortBy} onChange={(e)=>setSortBy(e.target.value as any)}>
                  <option value="post">Post date</option>
                  <option value="episode">Episode order</option>
                  <option value="hot">Hot</option>
                </select>
              </div>
            )}
          </div>

          <hr className="bleed-line" />

          {/* Row 2 */}
          <div
            style={{
              display:"flex",
              alignItems:"center",
              justifyContent: "space-between",
              gap:12,
              padding:`${ROW_PAD_Y}px 0`
            }}
          >
            {/* Left side: +New Post (when browsing the forum list) OR Back to forum (inside a thread) */}
{!thread ? (
  <button
    className="btn post h40"
    onClick={()=> setComposeOpen(true)}
    title="Start a new post (will auto-tag to your current S/E)"
  >
    + New Post
  </button>
) : (
  <button
    className="btn h40"
    onClick={()=>{ setActiveThreadId(null); setTimeout(()=> scrollToShowTop(), 0); }}
  >
    ← Back to forum
  </button>
)}
            {/* Right side: Mode toggle (on the right when inside thread), progress & Homepage/none */}
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              {thread && (
                <ModeToggle
                  value={mode}
                  onToggle={()=> setMode(m => (m === "risky" ? "standard" : "risky"))}
                />
              )}
              <OneSelectProgress
                show={seedShows.find(s=>s.id===showId) || {seasons:[10]}}
                value={progress[showId] || {s:1,e:1}}
                onConfirm={(val)=>updateProgressFor(showId,val)}
                requireConfirm={true}
              />
            </div>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      {thread ? (
        <InlineThreadView
          thread={{...thread, likes: likesThreads[thread.id] ?? thread.likes}}
          show={seedShows.find(s=>s.id===showId) || {name:showId}}
          onBack={()=>{
            setActiveThreadId(null);
            setTimeout(()=> scrollToShowTop(), 0);
          }}
          progressForShow={progress[showId] || {s:1,e:1}}
          onMountAlignTop={()=> scrollToShowTop()}
          likeThread={()=> likeThread(thread.id)}
          likedByUser={!!likedByUserThreads[thread.id]}
          likesCount={likesThreads[thread.id] ?? thread.likes}
          likeReply={likeReply}
          likesReplies={likesReplies}
          likedByUserReplies={likedByUserReplies}
          mode={mode}
          focusReplyId={focusReplyId}
        />
      ) : (
        <div style={{marginTop:12}}>
          {displayed.map((t)=>{
            const isNew = !!newHighlights[showId]?.[t.id];
            const isRead = !!visitedThreads[t.id];
            const likeCt = likesThreads[t.id] ?? t.likes;
            const replyCt = visibleRepliesCount(t.id, progress[showId]);

            return (
              <div
                key={t.id}
                className="card threadCard"
                style={{
                  margin:"12px 0",
                  opacity:isRead?0.41:1,
                  cursor:"pointer",
                  position:"relative",
                  paddingTop: 12,
                  borderLeft: isNew ? "8px solid var(--green)" : "1px solid var(--dos-border)"
                }}
                onClick={()=>{
  setVisitedThreads((v:any)=>({ ...v, [t.id]: true }));
  setNewHighlights((nh:any)=>{
    const next = { ...(nh[showId] || {}) };
    delete next[t.id];
    return { ...nh, [showId]: next };
  });
  setActiveThreadId(t.id);
  setTimeout(()=> scrollToShowTop(), 0);
}}
              >
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <h2 style={{margin:0,fontSize:22}} className="title">
                    <span>{t.titleBase}</span>
                    <span style={{color:"var(--dos-cyan)"}}>{` — S${String(t.season).padStart(2,"0")}E${String(t.episode).padStart(2,"0")}`}</span>
                  </h2>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <LikeBadge count={likeCt} readOnly title="open post to vote" />
                  </div>
                </div>

                <div className="muted" style={{marginTop:4,fontSize:14}}>
                  {show.name} • S{t.season}E{t.episode} • Started by <span className="username">@{t.author}</span> • {timeAgo(t.updatedAt)}
                </div>

                <div style={{marginTop:6}}>
                  <div className="clamp3">{t.preview}</div>
                </div>

                {/* reply count badge (progress-aware) */}
                <div className="replyCount">💬 {replyCt}</div>
              </div>
            );
          })}
          {displayed.length<baseVisible.length && <div ref={sentinelRef} style={{height:1}} />}
          {displayed.length===0 && <div className="muted" style={{fontSize:14}}>No posts match your filters.</div>}
        </div>
      )}

      {/* Compose modal */}
      {composeOpen && (
        <Modal onClose={()=> setComposeOpen(false)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
            <h3 className="title" style={{margin:0}}>New Post</h3>
            <button className="btn" onClick={()=> setComposeOpen(false)}>✕</button>
          </div>

          <div style={{marginTop:12, display:"grid", gap:10}}>
            <input
              className="badge"
              placeholder="Title"
              value={postTitle}
              onChange={(e)=> setPostTitle(e.target.value)}
              style={{width:"100%", height:40, fontWeight:700}}
            />
            <div className="muted" style={{fontSize:13}}>
              Your post is automatically marked to <b>S{String(postProgress.s).padStart(2,"0")}E{String(postProgress.e).padStart(2,"0")}</b> and will only show to people who’ve watched at least that far.
            </div>

            <textarea
              className="card"
              placeholder="Food for thought: did that last episode remind you of something from earlier in the show...or even from your own life?"
              value={postBody}
              onChange={(e)=> setPostBody(e.target.value)}
              style={{width:"100%", height:260, resize:"vertical"}}
            />
           
            <div style={{display:"flex", justifyContent:"flex-end", gap:8, flexWrap:"wrap"}}>
  <button className="btn" onClick={()=> setComposeOpen(false)}>Cancel</button>
  <button className="btn btn-danger" onClick={()=>submitPost(false)}>Post</button>
  <button className="btn post" onClick={()=>submitPost(true)}>Post privately</button>
</div>
          </div>
        </Modal>
      )}
    </section>
  );
}

/* ------------------------------- Like Badge ------------------------------- */
function LikeBadge({
  count, userLiked, onClick, title="this post!", readOnly=false
}:{ count: number; userLiked?: boolean; onClick?: (e: React.MouseEvent)=>void; title?: string; readOnly?: boolean; }){
  const dots = Math.min(39, Math.max(0, count || 0));
  const reachedThis = (count || 0) >= 40;
  const clickable = !!onClick && !readOnly;
  const color = userLiked ? "var(--green)" : "var(--dos-fg)";
  return (
    <button
      className="likeWrap"
      onClick={clickable ? onClick : undefined}
      title={title}
      style={{
        border:"1px solid var(--dos-border)", borderRadius:9999, padding:"2px 8px",
        color, background:"transparent", cursor: clickable ? "pointer" : "default"
      }}
    >
      <span className="likeDots">{'.'.repeat(dots)}</span>
      {reachedThis ? <span className="likeThis">this!</span> : <span className="likeBang">!</span>}
    </button>
  );
}

/* ------------------------------- Replies ------------------------------- */
function RepliesList({
  thread, progressForShow, riskyMode=false,
  likeReply, likesReplies, likedByUserReplies, focusReplyId
}:{thread:Thread; progressForShow?: {s:number;e:number}; riskyMode?: boolean;
  likeReply: (rid:string)=>void; likesReplies: Record<string,number>; likedByUserReplies: Record<string,boolean>;
  focusReplyId?: string | null;
}){
  const replies = repliesByThread[thread.id] || [];
  const byId = useMemo(()=>{
    const map: Record<string, Reply> = {};
    for(const r of replies) map[r.id]=r;
    return map;
  },[replies]);

  const [revealed, setRevealed] = useState<Record<string, true>>({});
  const [progressReveal, setProgressReveal] = useState<Record<string, true>>({});
  const [promptFor, setPromptFor] = useState<Reply | null>(null);

  // Jump to focused reply (from profile) and highlight it
  useEffect(()=>{
    if (!focusReplyId) return;
    const run = () => {
      const el = document.getElementById(`c-${focusReplyId}`);
      if (!el) return;
      el.scrollIntoView({ behavior:"smooth", block:"center" });
      const cover = document.createElement("div");
      cover.className = "flash-cover";
      const s = getComputedStyle(el);
      (el as HTMLElement).style.position = (s.position === "static") ? "relative" : s.position;
      el.appendChild(cover);
      requestAnimationFrame(()=>{ cover.style.opacity = "0"; });
      setTimeout(()=> cover.remove(), 2000);
    };
    setTimeout(run, 80);
  }, [focusReplyId]);

  const prevProgRef = useRef<{s:number;e:number} | undefined>(progressForShow);
  useEffect(()=>{
    const prev = prevProgRef.current;
    const cur = progressForShow;
    if (prev && cur && (prev.s !== cur.s || prev.e !== cur.e)) {
      const updates: Record<string, true> = {};
      for (const r of replies) {
        const was = canView({season:r.season, episode:r.episode}, prev);
        const now = canView({season:r.season, episode:r.episode}, cur);
        if (!was && now) updates[r.id] = true;
      }
      if (Object.keys(updates).length) setProgressReveal(pr => ({...pr, ...updates}));
    }
    prevProgRef.current = cur;
  }, [progressForShow, replies]);

  const canSeeSelf = (r: Reply) => canView({season:r.season, episode:r.episode}, progressForShow);

  const isAncestorRedacted = (r: Reply): boolean => {
    let cur = r.replyToId ? byId[r.replyToId] : null;
    while (cur) {
      const curWithin = canSeeSelf(cur);
      const curRevealed = !!revealed[cur.id];
      if (!riskyMode) {
        if (!curWithin) return true;
      } else {
        if (!curWithin && !curRevealed) return true;
      }
      cur = cur.replyToId ? byId[cur.replyToId] : null;
    }
    return false;
  };

  const isVisible = (r: Reply): { show: boolean; redacted: boolean } => {
    const within = canSeeSelf(r);
    const parentRedacted = isAncestorRedacted(r);

    if (!riskyMode) {
      if (!within || parentRedacted) return { show: false, redacted: false };
      return { show: true, redacted: false };
    } else {
      const needRedact = (!within || parentRedacted) && !revealed[r.id];
      return { show: !needRedact, redacted: needRedact };
    }
  };

  const scrollTo = (replyId:string, flash=false)=>{
    const el = document.getElementById(`c-${replyId}`);
    if(!el) el?.scrollIntoView?.({behavior:"smooth",block:"center"});
    else {
      el.scrollIntoView({behavior:"smooth",block:"center"});
      if (flash) {
        const cover = document.createElement("div");
        cover.className = "flash-cover";
        const style = getComputedStyle(el);
        (el as HTMLElement).style.position = (style.position === "static") ? "relative" : style.position;
        el.appendChild(cover);
        requestAnimationFrame(()=>{ cover.style.opacity = "0"; });
        setTimeout(()=>{ cover.remove(); }, 2000);
      }
    }
  };

  const replyLabel = (r: Reply)=>{
    return `This viewer has watched S${String(r.season).padStart(2,"0")}E${String(r.episode).padStart(2,"0")}. Click to reveal.`;
  };

  return (
    <>
      {promptFor && riskyMode && (
        <Modal onClose={()=>setPromptFor(null)}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
            <h3 className="title" style={{margin:0}}>Are you sure?</h3>
            <button className="btn" onClick={()=>setPromptFor(null)}>✕</button>
          </div>
          <p className="muted" style={{marginTop:6}}>There may be spoilers ahead!</p>
          <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
            <button className="btn btn-danger" onClick={()=>setPromptFor(null)}>Nevermind</button>
            <button
              className="btn btn-danger"
              onClick={()=>{
                if (!promptFor) return;
                const id = promptFor.id;
                setRevealed((r)=>({...r, [id]: true}));
                setPromptFor(null);
                setTimeout(()=>scrollTo(id, true), 0);
              }}
            >
              I’ll risk it.
            </button>
          </div>
        </Modal>
      )}

      <div style={{display:"grid",gap:12}}>
        {replies.map((r)=>{
          const vis = isVisible(r);
          const byIdMap = byId;
          const parent = r.replyToId ? byIdMap[r.replyToId] : null;
          const likeCt = likesReplies[r.id] ?? r.likes;

          if (!riskyMode && !vis.show) return null;

          if (riskyMode && vis.redacted) {
            return (
              <div
                key={r.id}
                id={`c-${r.id}`}
                className="card redacted"
                onClick={()=>setPromptFor(r)}
                style={{ marginLeft:8, cursor:"pointer", display:"flex", alignItems:"center", minHeight:32, padding:"4px 10px",
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}
                title="Click to reveal — may contain spoilers"
              >
                <div style={{fontWeight:700, fontSize:13, lineHeight:1}}>
                  {replyLabel(r)}
                </div>
              </div>
            );
          }

          return (
            <div
              key={r.id}
              id={`c-${r.id}`}
              className="card"
              style={{ borderLeft: (progressReveal[r.id] ? "8px solid var(--green)" : "4px solid var(--dos-border)"), marginLeft:8, position:"relative" }}
            >
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:14}}>
  <b className="username">@{r.author}</b>{" "}
  {thread.showId !== "simshow" && (
    <span style={{color:"var(--dos-cyan)",fontWeight:700}}>
      S{String(r.season).padStart(2,"0")}E{String(r.episode).padStart(2,"0")}
    </span>
  )}
</div>
                <div className="muted" style={{fontSize:12}}>{timeAgo(r.updatedAt)}</div>
              </div>

              {parent && canView({season:parent.season,episode:parent.episode}, progressForShow) && (
                <div style={{fontSize:12,marginTop:4}} className="muted">
                  ↪︎{" "}
                  <button
                    onClick={()=>scrollTo(parent.id, true)}
                    style={{textDecoration:"underline", background:"transparent", border:0, color:"var(--dos-accent)", cursor:"pointer"}}
                  >
                    in reply to
                  </button>{" "}
                  @{parent.author}
                </div>
              )}

              <div style={{marginTop:8,fontSize:15}}>{r.body}</div>

              <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",gap:10, marginTop:10}}>
                <LikeBadge
                  count={likeCt}
                  userLiked={!!likedByUserReplies[r.id]}
                  onClick={()=> likeReply(r.id)}
                  title="this post!"
                />
                <button className="btn">Reply</button>
              </div>
            </div>
          );
        })}
        {replies.length===0 && <div className="muted" style={{fontSize:14}}>No replies yet.</div>}
      </div>
    </>
  );
}

/* ------------------------------ Thread View ------------------------------ */
function InlineThreadView({
  thread, show, onBack, progressForShow, onMountAlignTop,
  likeThread, likedByUser, likesCount,
  likeReply, likesReplies, likedByUserReplies,
  mode, focusReplyId
}:{thread:Thread;show:any;onBack:()=>void; progressForShow?: {s:number;e:number}; onMountAlignTop?: ()=>void;
  likeThread: ()=>void; likedByUser: boolean; likesCount: number;
  likeReply: (rid:string)=>void; likesReplies: Record<string,number>; likedByUserReplies: Record<string,boolean>;
  mode: "standard" | "risky"; focusReplyId?: string | null;
}){
  useEffect(()=>{ onMountAlignTop?.(); }, []);

  return (
    <section className="container" style={{padding:"16px 0 24px"}}>
      <div className="card" style={{marginTop:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h2 style={{margin:0,fontSize:22}} className="title">
  <span>{thread.titleBase}</span>
  {thread.showId !== "simshow" && (
    <span style={{color:"var(--dos-cyan)"}}>
      {` — S${String(thread.season).padStart(2,"0")}E${String(thread.episode).padStart(2,"0")}`}
    </span>
  )}
</h2>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <LikeBadge
              count={likesCount}
              userLiked={likedByUser}
              onClick={(e)=>{ e.stopPropagation(); likeThread(); }}
              title="this post!"
            />
            <button className="btn">Reply</button>
          </div>
        </div>

        <div className="muted" style={{marginTop:4,fontSize:14}}>
          {show.name} • S{thread.season}E{thread.episode} • Started by <span className="username">@{thread.author}</span> • {timeAgo(thread.updatedAt)}
        </div>

        <div style={{marginTop:12}}>
          <div style={{whiteSpace:"pre-wrap"}}>{thread.body}</div>
        </div>

        <div style={{marginTop:12}}>
          <RepliesList
            thread={thread}
            progressForShow={progressForShow}
            riskyMode={mode === "risky"}
            likeReply={likeReply}
            likesReplies={likesReplies}
            likedByUserReplies={likedByUserReplies}
            focusReplyId={focusReplyId}
          />
        </div>
      </div>
    </section>
  );
}

/* --------------------------- Progress Select UI --------------------------- */
function OneSelectProgress({
  show, value, onConfirm, onPendingChange, requireConfirm = true, onChangeSelected
}:{show:any;value:any;onConfirm:(v:{s:number;e:number})=>void;onPendingChange?:(b:boolean)=>void;
  requireConfirm?: boolean; onChangeSelected?:(v:{s:number;e:number})=>void;
}){
  const opts = buildProgressOptions(show);
  const currentId = `${value?.s || 1}-${value?.e || 1}`;
  const [selectedId,setSelectedId]=useState(currentId);
  const [pending,setPending]=useState<{id:string;s:number;e:number}|null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(()=>{ setSelectedId(currentId); setPending(null); setConfirmOpen(false); onPendingChange?.(false); },[currentId]);

  function onSelect(ev: React.ChangeEvent<HTMLSelectElement>) {
  const nextId = String(ev.target.value);
  const [sStr, eStr] = nextId.split("-");
  const next = { id: nextId, s: Number(sStr), e: Number(eStr) };

  const curS = value?.s ?? 1;
  const curE = value?.e ?? 1;

  const backwards = (next.s < curS) || (next.s === curS && next.e < curE);
  if (backwards) {
    setSelectedId(`${curS}-${curE}`);
    return;
  }

  setSelectedId(nextId);
  setPending(next);
  onPendingChange?.(true);
  onChangeSelected?.({ s: next.s, e: next.e });
  if (requireConfirm) setConfirmOpen(true);
}
  function confirmSelection(){
    if(pending){
      onConfirm({s:pending.s,e:pending.e});
      window.dispatchEvent(new CustomEvent("dock:progress", { detail: { showId: "bb", s: pending.s, e: pending.e } }));
      setPending(null);
      onPendingChange?.(false);
      setConfirmOpen(false);
    }
  }
  function cancelSelection(){
    setSelectedId(currentId);
    setPending(null);
    onPendingChange?.(false);
    setConfirmOpen(false);
  }

  return (
    <>
      <div style={{display:"flex",alignItems:"center",gap:8,fontStyle:"italic",fontWeight:700,color:"var(--dos-cyan)"}}>
        <select className="badge h40" value={selectedId} onChange={onSelect}>
          {opts.map(o=>{
          const curS = value?.s ?? 1;
          const curE = value?.e ?? 1;
          const disabled = (o.s < curS) || (o.s === curS && o.e < curE);
          return (
            <option key={o.id} value={o.id} disabled={disabled}>
              {o.label}
            </option>
          );
        })}
        </select>
      </div>

      {requireConfirm && confirmOpen && (
        <Modal onClose={cancelSelection}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
            <h3 className="title" style={{fontSize:20,margin:0}}>Are you sure?</h3>
            <button className="btn" onClick={cancelSelection}>✕</button>
          </div>
          <p className="muted" style={{marginTop:0}}>
            Updating your watch progress will change which posts and replies you can see.
          </p>
          <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:16}}>
            <button className="btn btn-danger" onClick={cancelSelection}>No</button>
            <button className="btn btn-danger" onClick={confirmSelection}>Yes</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------ Mode Toggle ------------------------------ */
function ModeToggle({ value, onToggle, disabled=false }:{ value: "standard" | "risky"; onToggle: ()=>void; disabled?: boolean }){
  const isRisky = value === "risky";
  return (
    <button
      onClick={disabled ? undefined : onToggle}
      aria-label={`Toggle mode (currently ${isRisky ? "Risky" : "Standard"})`}
      aria-pressed={isRisky}
      className="btn modeToggle"
      style={{ position:"relative", display:"inline-flex", alignItems:"center", gap:0, borderRadius:0, padding:0,
        border:"1px solid var(--dos-border)", background:"transparent", overflow:"hidden", opacity: disabled ? .6 : 1 }}
      title={isRisky ? "Risky: show redacted stubs (click to reveal)" : "Standard: hide newer comments"}
      disabled={disabled}
    >
      <span style={{ flex:"1 1 0", textAlign:"center", fontWeight:700, fontSize:13, color: isRisky ? "var(--dos-gray)" : "var(--dos-light)", zIndex:2, padding:"0 8px" }}>Standard</span>
      <span style={{ flex:"1 1 0", textAlign:"center", fontWeight:700, fontSize:13, color: isRisky ? "var(--dos-light)" : "var(--dos-gray)", zIndex:2, padding:"0 8px" }}>Risky</span>
      <span className="modeKnob" style={{ position:"absolute", top:2, bottom:2, left: isRisky ? "calc(50% + 2px)" : "2px", width:"calc(50% - 4px)", background:"var(--dos-blue)", border:"1px solid var(--dos-border)" }} />
    </button>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App/>);
