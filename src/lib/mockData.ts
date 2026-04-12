import type { Thread, Reply } from '../types';

// Stable base time so seed thread updatedAt values don't change on every refresh
const SEED_EPOCH = 1_700_000_000_000; // fixed: ~Nov 2023

/* ------------------------------ Catalog ------------------------------ */
export const seedShows = [
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
  { id: "tsp", name: "The Sidebar Protocol", seasons: [6] },
];

export const USERNAMES = [
  "hi_itsme",
  "BlueSkyChem","RVEnthusiast","LosPollos_99","Heisenfan","CactoidPrime",
  "BetterCallMe","PinkmanVibes","MineralCollector","FlyEpisodeDefender","FringWatch",
  "ABQLocal","CarWashOwner","SaulGoodDude","MadrigalEnjoyer","LydiaBean",
  "GusGusNoSpoils","GaleSingAlong","TucoRageQuit","HuellRules","MikeIsCalm"
];

// All seeded/fake authors across every pushPost call — used to block clickability
export const SEED_AUTHORS = new Set([
  ...USERNAMES,
  "PopcornTheory","SlateOrbit","LoomSignal","_quietloop","QuietLoop",
  "DeadFreight","DreamInReverse","EchoMoth","EchoMothFan","EmpireBusiness",
  "EndTimes","FiftyOneWatcher","GlidingOverAll","OzymandiasFan","ProblemDog",
  "SalamancaShrine","SayMyName","SkylerPointOfView","TheScheduleIsTheStory",
  // single/double-letter placeholder authors used in simshow
  "AA","BB","CC","DD","EE","FF","GG","HH","II","JJ","KK","LL","MM","NN","OO",
]);

const TITLES: Record<string,string[]> = {
  bb: [
    "Blue vs. purity chat","Desert as a character","Cold open masterclass","The fly episode appreciation",
    "Choices without saying them out loud","Phone call acting clinic","Green & purple color theory",
    "A certain bell… handled tastefully","Box cutter vibes (no details)","Car wash arc setup","Moral math done visually",
    "Silence and tension working together","The RV a moving stage","Cooking scenes as choreography","That one hallway shot"
  ],
  severance: ["Innie vs. Outie ethics (gentle)","Lumon's architecture as control","Wellness session cadence","Numbers that feel like feelings","Waffle party aesthetics","Hallway symmetry & dread","Corporate scripture tone study","Orientation theater beats","Break room pacing","Rival departments body language","Knickknacks as ritual","Elevator thresholds","Board as presence","Blue-white palette moods","Music cues and memory seams"],
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
    "Gotham's streets glisten like they're always mid-conversation with the rain.",
    "Power shifts are communicated by who's willing to wait in a room.",
    "The club lighting doesn't flatter; it interrogates.",
    "Cars feel weighty and slightly mean; the camera respects momentum.",
    "Everyone dresses like they've already chosen a side, even if they haven't.",
    "Dialog pauses are longer than is comfortable and that's the point.",
    "The sound of shoes on wet concrete is its own supporting character.",
    "Violence is implied by posture more than choreography.",
    "You can smell the leather and gasoline through the screen.",
  ],
};

const REPLIES_BANK: Record<string,string[]> = {
  bb: [
    "The blocking lets two people share the frame without sharing control.",
    "Loved how a practical object becomes a clock for the scene without announcing itself.",
    "That hallway conversation hit different when I noticed where their eyes were going.",
    "The humor never empties the tension; it just loosens the lid for a second.",
    "Wild how quiet the score goes when someone makes the bolder choice.",
    "The palette keeps drifting toward nausea then snaps back to normal—great trick.",
    "Even the establishing shots feel like moral weather reports.",
    "When the camera steps back, it isn't distance; it's judgment.",
    "Sound of a machine idling in the background made my shoulders tense.",
    "The cut to hands is doing more work than the dialogue and I adore it.",
    "Every time a door frame slices the screen, it feels like a tiny verdict."
  ],
  severance: [
    "The politeness lands like static; everyone is buzzed with manners.",
    "Hallways do geography and psychology at once—efficient and unnerving.",
    "The score nudges you sideways instead of forward, which fits.",
    "Paper textures make the tech feel ceremonial rather than modern.",
    "Actors deliver corporate lines like they're reading a map with no legend.",
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
    "Club scenes feel humid; the camera doesn't wipe the sweat.",
    "Loved a detail where a character fixes a sleeve as punctuation.",
    "Sound of money counting offscreen did more than an insert would.",
    "Coats hang like declarations; silhouette work is strong.",
    "The cut to a boot heel said everything.",
    "Low angles add weight without comic-book exaggeration.",
    "Quiet beats are allowed to smell like rain and metal."
  ],
};

/* --------------------------------- Utils --------------------------------- */
const randBetween = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]) => arr[randBetween(0, arr.length - 1)];
const pickMany = <T,>(arr: T[], n: number) => {
  const used = new Set<number>(); const out: T[] = [];
  while (out.length < Math.min(n, arr.length)) { const i = randBetween(0, arr.length - 1); if (!used.has(i)) { used.add(i); out.push(arr[i]); } }
  return out;
};

function composePreview(showId: string) {
  const bank = PREVIEW_BANK[showId] || [
    "The camera trusts the room to do some of the talking.",
    "Editing builds pressure without cutting the wick too short.",
    "Performances ask you to lean in instead of chase."
  ];
  const sentences = pickMany(bank, randBetween(2, 3));
  const cap = (s: string) => s.replace(/^\s*[a-z]/, c => c.toUpperCase());
  return `${cap(sentences[0])}${sentences.length > 1 ? " " + sentences.slice(1).join(" ") : ""}`;
}
function composeLongBody(showId: string) {
  const bank = PREVIEW_BANK[showId] || PREVIEW_BANK["bb"];
  const paraCount = randBetween(2, 3);
  const paras: string[] = [];
  for (let p = 0; p < paraCount; p++) {
    const sents = pickMany(bank, randBetween(2, 4));
    const cap = (s: string) => s.replace(/^\s*[a-z]/, c => c.toUpperCase());
    paras.push(`${cap(sents[0])}${sents.length > 1 ? " " + sents.slice(1).join(" ") : ""}`);
  }
  return paras.join("\n\n");
}
function composeReply(showId: string) {
  const bank = REPLIES_BANK[showId] || REPLIES_BANK["bb"];
  const sentences = pickMany(bank, randBetween(2, 3));
  return sentences.join(" ");
}

function makeThreads(showId: string, count: number): Thread[] {
  const show = seedShows.find(s => s.id === showId)!;
  const seasons = show.seasons;
  return Array.from({ length: count }).map((_, i) => {
    const season = randBetween(1, seasons.length);
    const eMax = seasons[season - 1] || 10;
    const episode = randBetween(1, eMax);
    const author = pick(USERNAMES.slice(1));
    const titleBase = pick(TITLES[showId] || ["Craft notes", "Tone & texture", "Blocking beats"]);
    const preview = composePreview(showId);
    const body = composeLongBody(showId);
    return {
      id: `${showId}-t${i + 1}`, showId, season, episode, author, titleBase, preview, body,
      updatedAt: SEED_EPOCH - (i + 1) * 3600000,
      likes: randBetween(0, 60)
    };
  });
}

/* ------------------------ Seed threads ------------------------- */
export const seedThreads: Thread[] = [];

function pushPost({
  showId = "bb", season, episode, author, title, body,
  updatedAtOffsetH = 0, likes = randBetween(0, 15), isPublic = true
}: {
  showId?: string; season: number; episode: number; author: string; title: string; body: string;
  updatedAtOffsetH?: number; likes?: number; isPublic?: boolean;
}) {
  const id = `${showId}-${author}-${season}-${episode}-${seedThreads.length}`;
  seedThreads.push({
    id, showId, season, episode, author, titleBase: title,
    preview: body.length > 240 ? body.slice(0, 240) + "…" : body,
    body, updatedAt: SEED_EPOCH - updatedAtOffsetH * 3_600_000, likes, isPublic
  });
}

function pushPostSev({
  showId = "severance", season, episode, author, title, body,
  updatedAtOffsetH = 0, likes = 0, isPublic = true
}: {
  showId?: string; season: number; episode: number; author: string; title: string; body: string;
  updatedAtOffsetH?: number; likes?: number; isPublic?: boolean;
}) {
  const id = `${showId}-${author}-${season}-${episode}-${seedThreads.length}`;
  seedThreads.push({
    id, showId, season, episode, author, titleBase: title,
    preview: body.length > 240 ? body.slice(0, 240) + "…" : body,
    body, updatedAt: SEED_EPOCH - updatedAtOffsetH * 3_600_000, likes, isPublic
  });
}

/* -------- BB curated posts -------- */

// PopcornTheory (watched S4E3)
pushPost({ season: 1, episode: 2, author: "PopcornTheory", title: "A Perfect Setup, a Disgusting Punchline", body: `That bathtub scene should be framed and hung in every film school classroom—preferably above a drain.\nIt's gross, funny, efficient storytelling. One bad decision, one literal meltdown. This show wastes zero time teaching its thesis: chemistry is consequence.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 1, episode: 6, author: "PopcornTheory", title: "Explosion as Character Arc", body: `That moment when Walt walks out and the building erupts behind him? That's the real ending of the pilot. The transformation is visual, silent, complete.\nYou can feel the show trusting the image to do what dialogue can't. If I wrote that scene in a script, I'd underline it twice and probably ruin it with too much description.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 2, episode: 3, author: "PopcornTheory", title: "The Bureaucracy of Lies", body: `Every episode is an administrative nightmare of cover stories. It's not a crime saga—it's a paperwork drama with corpses.\nFrom a structure standpoint, it's brilliant: every lie becomes a new obstacle, which becomes the next act. Walt isn't outsmarting anyone; he's just constantly re-applying for the same moral permit.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 2, episode: 10, author: "PopcornTheory", title: "The Dinner Scene That Turned Everything", body: `This might be my favorite kind of writing: nothing happens and yet everything changes. A small domestic moment—Walt pouring wine, talking about unfinished business—and the whole story tilts.\nIt's not the cancer that's killing him anymore, it's ambition. And you can see it flicker in his eyes like a pilot light catching again.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 3, episode: 1, author: "PopcornTheory", title: "No Más and the Gospel of Silence", body: `The opening with the crawling cousins is transcendent. The composition, the sound design, the refusal to explain itself—this is cinema using mystery instead of exposition.\nBreaking Bad feels like it just graduated from realism to myth.\nEvery frame looks like it was shot by someone who studied Sergio Leone and David Lynch at the same time.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 3, episode: 5, author: "PopcornTheory", title: "The Lab as a Love Story", body: `The new meth lab reveal feels almost erotic—Walt's face lit by fluorescent devotion. That sterile, Kubrick-clean environment is the most dangerous temptation in the series so far.\nFrom a design perspective, it's immaculate. From a character standpoint, it's poison wrapped in stainless steel.\nFilmmakers talk about "production design as character"—this is the best example I've seen on television. The set is seducing him.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 3, episode: 12, author: "PopcornTheory", title: "Half Measures, Whole Lesson", body: `Mike's story about the domestic violence case is so simple and so brutal that I had to pause it. It's not just exposition—it's thesis.\nIn one monologue, the show defines its moral world: you either commit fully or die trying to be decent.\nAs a screenwriter, I love how this scene uses anecdote as argument. It's not about plot; it's about philosophy.\nAnd the best part? The show immediately contradicts it. The next act is a full measure.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 4, episode: 1, author: "PopcornTheory", title: "Box Cutter and the Art of Stillness", body: `This might be the single most disciplined piece of television I've seen. No score. No quick cuts. Just the unbearable sound of fluorescent lighting and quiet breathing.\nIt's violence filmed with the patience of a nature documentary.\nEditors usually talk about pacing as rhythm—this scene treats pacing as oxygen control. You feel suffocated until the blade drops.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 4, episode: 3, author: "PopcornTheory", title: "Skyler's Moral Algebra", body: `Skyler's storyline is becoming the most fascinating thing about the show. She's solving an ethical equation in real time: how much wrong can one tolerate in the name of family?\nThere's something heartbreakingly pragmatic about her descent—it's not about power or thrill; it's about survival through rationalization.\nWhat kills me is how quiet her evolution is. Walt's transformation screams; hers whispers.\nIn a lesser show, she'd be written as resistance. Here, she's reflection—the only one honest enough to know she's lying.\nIf I ever get one of my scripts produced, I want a character half as layered as her.`, updatedAtOffsetH: randBetween(1, 24*14) });

// SlateOrbit (watched S3E2)
pushPost({ season: 1, episode: 1, author: "SlateOrbit", title: "The Medium Is the Meth", body: `It's good. But it's still TV.\nThat sounds snobby, but I mean it: everything is cut for rhythm, not for silence. The scenes end on beats that feel designed for ad breaks, not oxygen.\nStill, it's the cleanest pilot I've seen in years. Feels engineered. Like NASA made it. Which, for me, is both compliment and insult.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 1, episode: 2, author: "SlateOrbit", title: "A Bathtub Scene for Late Capitalism", body: `You can almost feel the guilt of the middle class melting through the ceiling.\nIt's a perfect metaphor for American labor—dissolving the evidence of your own exploitation and making a bigger mess in the process.\nAlso: I'm never letting my kid near hydrofluoric acid.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 2, episode: 5, author: "SlateOrbit", title: "The Show About Scheduling", body: `This show has a funny obsession with logistics. "How do we store this?" "Who's picking up the RV?" It's bureaucracy with blood pressure.\nI find that fascinating. Maybe it's the new-dad brain talking, but the most stressful part isn't the crime—it's the time management.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 2, episode: 10, author: "SlateOrbit", title: "Moral Physics and Baby Formula", body: `There's a moment when Walt's story stops being about cancer and becomes about control.\nI recognize the sickness. Directing has a version of it too—you start making choices because you can, not because you should.\nI keep wondering what this show would look like if told entirely from Skyler's point of view. Probably a short film. Probably better.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 3, episode: 1, author: "SlateOrbit", title: "A Desert, a Gun, a Man Explaining Himself", body: `I have a soft spot for stories that go back to the desert. It's like cinema's default setting for consequence.\nThat crawl sequence at the start was incredible—borderline spiritual—but then the show cut back to exposition and I sighed out loud.\nTV can't help itself; it wants to be mythic and explain the myth. Film would pick one.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 3, episode: 2, author: "SlateOrbit", title: "I Don't Trust the Camera", body: `The direction is immaculate, almost too immaculate. I keep waiting for the show to get sloppy—to let a shot breathe past the beat.\nYou can see every choice, every rack focus. It's good, but I miss accidents. The best shots in cinema happen when the director gets out of the way.\nStill… I watched two episodes back-to-back. So maybe it's working.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 3, episode: 2, author: "SlateOrbit", title: "I Don't Trust the Camera", body: `The direction is immaculate, almost too immaculate. I keep waiting for the show to get sloppy—to let a shot breathe past the beat.\nYou can see every choice, every rack focus. It's good, but I miss accidents. The best shots in cinema happen when the director gets out of the way.\nStill… I watched two episodes back-to-back. So maybe it's working.`, updatedAtOffsetH: randBetween(1, 24*14) });

// LoomSignal (mid-S2)
pushPost({ season: 1, episode: 1, author: "LoomSignal", title: "The Science Fair from Hell", body: `Loved the pilot. You can tell it was written by someone who understands curiosity — the way Walt's mind lights up when he finally applies his skills to something risky.\nIt's like every nerd fantasy flipped inside out: "What if I used my power for something terrible, just to feel alive again?"\nAlso, I've taught science outreach classes before… and I swear every teacher I know has had that same blank look he gives in class.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 1, episode: 2, author: "LoomSignal", title: "So... the Acid Goes Through the Ceiling?", body: `This was pure slapstick horror and I'm here for it.\nIt's nice when TV remembers that the laws of chemistry don't bend for plot convenience.\nMy whirlyball team once dissolved a trophy in acetone by accident — not the same, but same energy.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 1, episode: 6, author: "LoomSignal", title: "Walt's Midlife Patch Notes", body: `I can't decide if I like this guy or if he just triggers my allergy to men who mistake control for genius.\nThe show's smart, though — it never flatters him. You can see the insecurity driving every choice.\nAlso, that explosion was the exact moment he rebooted into "villain mode." I'm impressed and unsettled.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 2, episode: 3, author: "LoomSignal", title: "The Show About Cleaning Up", body: `Half of Breaking Bad is about mopping up evidence and pretending it's normal.\nIt's the weirdest domestic show I've ever seen — every scene is either in a kitchen or a crime scene, sometimes both.\nI like the rhythm of it. It's almost meditative. Like karate drills, but with corpses.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 2, episode: 11, author: "LoomSignal", title: "Desert Space", body: `There's something about this show's geography that reminds me of Deep Space Nine — the feeling that morality gets thinner the further you go from civilization.\nThe desert here is outer space. No law, no oversight, just people improvising ethics.\nIf DS9 had Walt, Odo would've arrested him by episode 2.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 3, episode: 6, author: "LoomSignal", title: "The Lab and the Temptation of Order", body: `That gleaming underground lab made my jaw drop. It's almost beautiful — like the architectural equivalent of a lie told perfectly.\nI get it, though. There's comfort in systems. Build something flawless and you forget what's rotten underneath it.\nI know people who build start-ups the same way: the more control they get, the smaller their world becomes.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 3, episode: 12, author: "LoomSignal", title: "Half Measures, Whole Truth", body: `Mike's story about the woman and the abuser was hard to listen to — because it's true, not just narratively, but emotionally.\nThe lesson isn't "be ruthless." It's "doing the right thing halfway doesn't count."\nThat's been rattling around my head all night. There's a weird overlap between martial arts and morality: you either commit to the move, or you get hit harder next time.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 4, episode: 1, author: "LoomSignal", title: "The Quiet Terror of Box Cutter", body: `The whole sequence was so calm it made me nauseous.\nNo music, no quick cuts — just that industrial hum. I don't even like gore, but the restraint made it unbearable in the best way.\nIt reminded me of how 2001: A Space Odyssey handles violence — measured, procedural, inevitable.\nI had to go stretch afterward.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 4, episode: 2, author: "LoomSignal", title: "Skyler's Firewall", body: `Skyler's turning into the only adult in the room, and it's fascinating. She's learning to play the system while pretending she's still outside it.\nThere's a quiet dignity in her moves — not pride, exactly, but survival.\nIt's refreshing watching a character who isn't driven by ego or chaos. Just calculation, instinct, and a little fear.\nAlso, if she took a day off to play whirlyball, she'd probably win.`, updatedAtOffsetH: randBetween(1, 24*14) });

// _quietloop (around S4E5)
pushPost({ season: 1, episode: 1, author: "_quietloop", title: "The Pilot Blew Me Away", body: `I'm late to this show but WHAT a first episode.\nIt's rare for TV to feel this cinematic — like, real framing, real silence, no filler dialogue.\nI get why people compare it to Mad Men or The Sopranos, but honestly, the energy feels closer to Moneyball — ordinary guys using math to break the world.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 1, episode: 2, author: "_quietloop", title: "The Bathtub Scene Is Still in My Head", body: `This show is so good at shifting tone. One minute you're laughing at the acid through the ceiling, and the next you're like, "Oh right, these are people's lives falling apart."\nI listen to The Watch podcast a lot, and Chris Ryan always talks about "tonal control" — this episode nails it.\nAlso: grossest sound design of all time, award unlocked.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 1, episode: 6, author: "_quietloop", title: "Okay, I Get the Hype Now", body: `I used to roll my eyes at people calling this the best show ever, but that explosion scene? I actually cheered.\nIt's not even the explosion itself — it's the confidence. The "I'm that guy now" moment.\nWalt has officially crossed into anti-hero land. I'm doomed.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 2, episode: 10, author: "_quietloop", title: "The Dinner Scene and the Horror of Normalcy", body: `I rewatched the dinner scene twice — the one where Walt basically confesses to ambition without saying it. It's shot like a home video, which makes it hit harder. No score, no tension tricks. Just the unbearable quiet of someone starting to believe their own lie.\nIt reminded me of something Joanna Robinson once said on Still Watching: that the scariest moments in prestige TV are the ordinary ones — because you can see yourself in them.\nThat's what's brilliant about this show. It's not about drugs or crime; it's about denial. Every person here has rewritten their "why" so many times they don't remember the original code.\nAnyway, my mom walked in while I was watching and said, "He's still lying to his wife?" and I was like, "That's the whole thing, mom."`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 3, episode: 6, author: "_quietloop", title: "Breaking Bad and the Math of Consequences", body: `I think I finally understand why critics call this show "mathematical." It's not about plot twists — it's about equations. Every episode adds or subtracts something from Walt's morality, and the total always balances out to regret.\nBut the lab reveal scene… I can't get over it. The production design is straight-up hypnotic — the light, the order, the hum. It's like a cathedral to ego.\nAnd yet, as a viewer, I felt weirdly proud of him? Like when your favorite athlete breaks a record, even though you know it's going to ruin them later.\nThat's what good TV does — it traps you inside someone else's delusion and makes you root for it.\nIf I ever start my podcast again (RIP "Quiet Takes," 2019–2020), this would be the first show I'd cover episode by episode. Because it's not about what happens, it's about what we justify.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 4, episode: 1, author: "_quietloop", title: "Box Cutter Is Pure Dread", body: `I actually had to pause halfway through because it was stressing me out so much.\nIt's so quiet. Like the show finally trusts you to panic on your own.\nI watched the BTS featurette and the director said they lit it like a surgery scene — totally tracks. The color green has never looked scarier.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 4, episode: 5, author: "_quietloop", title: "Skyler Might Be the Most Realistic Character on TV", body: `I used to hate Skyler when the internet told me to. Now I think she's the most human person on this show.\nShe's calculating but not manipulative, scared but not weak. Watching her plan things feels like watching someone build a new version of themselves from scraps.\nThere's this moment where she's talking to Walt and you can see the exact second she realizes she'll have to lie better than him to survive. It's devastating.\nAnyway, I'm fully obsessed. And yes, I'm reading essays about gender in Breaking Bad now. Someone stop me.`, updatedAtOffsetH: randBetween(1, 24*14) });

// DreamInReverse (S5E6 "Buyout")
pushPost({ season: 1, episode: 1, author: "DreamInReverse", title: "Yeah, It's Good", body: `Finally watched the pilot. It's solid.\nNot sure I buy the underwear-in-the-desert thing, but the setup's clear. Guy's life falls apart, guy makes bad choices. Feels familiar.\nI'll keep going, I guess.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 1, episode: 2, author: "DreamInReverse", title: "Acid Through the Ceiling", body: `Pretty disgusting. Also kind of funny.\nReminds me of some contractors I've worked with — always convinced they've found a "shortcut."\nThey hadn't.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 1, episode: 6, author: "DreamInReverse", title: "The Explosion Was Fine", body: `Everyone online calls this one iconic. Sure. It was okay.\nI liked that they didn't overshoot it. One shot, done.\nCould've used fewer close-ups before, though. Directors love their actors too much.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 2, episode: 10, author: "DreamInReverse", title: "Getting Tired of the Lies", body: `Halfway through Season 2 and I'm finding it repetitive.\nThere's only so many ways you can watch a man ruin his life and call it tension.\nThat said, there's something believable in how it's all small steps. Nobody decides to become awful. They just get used to making small bad choices.\nStill, I find myself checking the clock more than I used to.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 3, episode: 6, author: "DreamInReverse", title: "That Fancy Lab", body: `The new lab setup looks great. Too great, maybe. Everything's shiny now.\nI kind of miss the grimy stuff. It fit better.\nFeels like the show's getting comfortable — the same way people do right before things get dumb.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 4, episode: 1, author: "DreamInReverse", title: "Box Cutter", body: `That was rough. Not sure I liked it.\nViolence doesn't bother me, but this one felt... off. Like they were daring you to look away. I get it — tension, power, control.\nStill, there's a point where you stop being impressed and just feel tired.\nThe quiet parts before it were good, though. Reminded me of when people actually used silence instead of background music.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 5, episode: 6, author: "DreamInReverse", title: "Midway Through Season 5", body: `Half the characters look dead inside. Probably supposed to.\nThe writing's fine. Some shots are beautiful. Sometimes it feels like homework.\nI watch an episode before bed most nights. It's a good way to unwind — not great, not bad. Just steady.\nThat's more than I can say for most things.`, updatedAtOffsetH: randBetween(1, 24*14) });

// EchoMoth (S2E11 "Mandala")
pushPost({ season: 1, episode: 1, author: "EchoMoth", title: "Okay, I Finally Started It", body: `I caved. Everyone in my feed acts like this is a sacred text, so fine.\nThe pilot was good! Not great, not life-changing, but confident. I respect any show that opens in chaos and then works backward.\nI do wish it had a little more color. Everything looks sunburnt.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 1, episode: 2, author: "EchoMoth", title: "Acid in the Ceiling, Internet Going Nuts", body: `Watched the "melting bathtub" episode and immediately got five memes sent to me.\nIt's wild how this show has been meme-ified into slapstick when it's actually pretty bleak.\nThat said, props for practical effects. I've seen worse stuff at comic-con horror panels that cost more to make.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 1, episode: 6, author: "EchoMoth", title: "Walter White Is Every Tech Bro at a Panel", body: `I don't hate it, but Walt's speeches make me itchy.\nHe's the kind of guy who'd interrupt a science-fiction Q&A to "correct" the author on molecular accuracy.\nThere's a version of this story where Jesse starts a band instead and I'd probably like that one more.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 2, episode: 10, author: "EchoMoth", title: "The Dinner Scene, or: I've Had This Conversation in Real Life", body: `The dinner scene broke me a little. It's one of those moments where the show stops trying to be cool and just lets people be miserable together.\nYou can see the exact moment Skyler checks out — not dramatically, just that invisible flicker of "I'm not doing this again."\nI've been at that table before, metaphorically. When someone's performing their frustration instead of feeling it.\nWhat's weird is that I still don't like the show. I admire it, but I don't trust it. It keeps giving me pain dressed as profundity.\nBut I get why people love it. It's precise, like a watch. I just wish it had a little more heart — like Parks and Rec filtered through a meth lab.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 2, episode: 11, author: "EchoMoth", title: "Do People Actually Find This Fun?", body: `Maybe I'm watching it wrong, but I don't find Breaking Bad fun.\nIt's impressive, yes. The cinematography's gorgeous. But it's emotionally exhausting. Everyone's miserable, and the show treats misery like a flex.\nI'm big on stories that make you feel with the characters, not around them. Even when I read dark comics — Saga, Sandman, Monstress — there's empathy in the horror.\nHere, the empathy's cold. The show loves its own machinery more than its people.\nOn the other hand, I can't stop thinking about it. I walked my dog tonight and caught myself framing shots in my head — streetlights, long shadows, the whole Albuquerque color palette. Maybe that's the real trick: it doesn't want you to like it. It wants to live rent-free in your brain.\nI still prefer Better Call Saul's theme song, though.`, updatedAtOffsetH: randBetween(1, 24*14) });
pushPost({ season: 2, episode: 11, author: "EchoMoth", title: "Still Watching, Still Skeptical", body: `Everyone says "Season 3 is where it really starts cooking."\nSure. That's what they said about The Walking Dead, too.\nI'll keep going, mostly because my dog likes when I stay on the couch.`, updatedAtOffsetH: randBetween(1, 24*14) });

/* -------- Simshow threads -------- */
(function seedSimshowThreads() {
  const showId = "simshow";
  pushPost({ showId, season: 1, episode: 2, author: "AA", title: "AA's current progress is 01/02 - POST about 01/01", body: "Post about Season 01 Episode 01.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 1, episode: 7, author: "BB", title: "BB's current progress is 01/07 - POST is about 01/07", body: "Post about Season 01 Episode 07.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 2, episode: 7, author: "EE", title: "EE's current progress is 02/07 - POST is about 01/06", body: "Post about Season 01 Episode 06.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 3, episode: 6, author: "GG", title: "GG's current progress is 03/06 - POST is about 02/07", body: "Post about Season 02 Episode 07.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 3, episode: 2, author: "FF", title: "FF's current progress is 03/02 - POST is about 03/02", body: "Post about Season 03 Episode 02.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 3, episode: 8, author: "HH", title: "HH's current progress is 03/08 - POST is about 03/06", body: "Post about Season 03 Episode 06.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 4, episode: 1, author: "II", title: "II's current progress is 04/01 - POST is about 03/08", body: "Post about Season 03 Episode 08.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 4, episode: 1, author: "II", title: "II's current progress is 04/01 - POST is about 04/01", body: "Post about Season 04 Episode 01.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 5, episode: 8, author: "OO", title: "OO's current progress is 05/08 - POST is about 01/02", body: "Post about Season 01 Episode 02.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 5, episode: 5, author: "NN", title: "NN's current progress is 05/05 - POST is about 02/03", body: "Post about Season 02 Episode 03.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 1, episode: 7, author: "GG", title: "GG's current progress is 01/07 - POST is about 01/07", body: "Post about Season 01 Episode 07.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 3, episode: 2, author: "KK", title: "KK's current progress is 03/02 - POST is about 03/02", body: "Post about Season 03 Episode 02.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 2, episode: 7, author: "MM", title: "MM's current progress is 02/07 - POST is about 02/07", body: "Post about Season 02 Episode 07.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 3, episode: 6, author: "NN", title: "NN's current progress is 03/06 - POST is about 03/06", body: "Post about Season 03 Episode 06.", updatedAtOffsetH: randBetween(1, 24*14) });
  pushPost({ showId, season: 4, episode: 1, author: "OO", title: "OO's current progress is 04/01 - POST is about 03/08", body: "Post about Season 03 Episode 08.", updatedAtOffsetH: randBetween(1, 24*14) });
})();

/* -------- BB random threads for all non-curated shows -------- */
(function seedRandomThreads() {
  const shows = seedShows.filter(s => !["bb", "simshow", "severance", "penguin"].includes(s.id));
  for (const s of shows) {
    const threads = makeThreads(s.id, 8);
    seedThreads.push(...threads);
  }
  // Also seed some random threads for bb/severance/penguin to supplement curated ones
  seedThreads.push(...makeThreads("bb", 5));
  seedThreads.push(...makeThreads("severance", 8));
  seedThreads.push(...makeThreads("penguin", 8));
})();

/* --------------------- Seed replies (after threads exist) ------------------ */
export const repliesByThread: { [threadId: string]: Reply[] } = {};

(function seedReplies() {
  for (const t of seedThreads) {
    if (t.showId === "simshow") continue;
    const show = seedShows.find(s => s.id === t.showId)!;
    const count = randBetween(4, 12);
    const replies: Reply[] = [];
    for (let i = 0; i < count; i++) {
      const s = randBetween(1, show.seasons.length);
      const e = randBetween(1, show.seasons[s - 1] || 1);
      const id = `${t.id}-c${i + 1}`;
      const author = pick(USERNAMES.slice(1));
      const body = composeReply(t.showId);
      const updatedAt = t.updatedAt + (i + 1) * 15 * 60 * 1000;
      const maybeParent = i > 0 && Math.random() < 0.4 ? replies[randBetween(0, i - 1)].id : undefined;
      replies.push({ id, threadId: t.id, showId: t.showId, season: s, episode: e, author, body, updatedAt, replyToId: maybeParent, likes: randBetween(0, 35) });
    }
    repliesByThread[t.id] = replies;
  }
})();

/* -------- Simshow replies -------- */
(function seedSimshowReplies() {
  const showId = "simshow";
  const progress: Record<string, { season: number; episode: number }> = {
    AA: { season: 1, episode: 2 }, BB: { season: 1, episode: 7 },
    CC: { season: 2, episode: 3 }, DD: { season: 2, episode: 3 },
    EE: { season: 2, episode: 7 }, FF: { season: 3, episode: 2 },
    GG: { season: 3, episode: 6 }, HH: { season: 3, episode: 8 },
    II: { season: 4, episode: 1 }, JJ: { season: 4, episode: 4 },
    KK: { season: 4, episode: 5 }, LL: { season: 4, episode: 8 },
    MM: { season: 5, episode: 3 }, NN: { season: 5, episode: 5 },
    OO: { season: 5, episode: 8 },
  };
  type SimpleReplyDef = { author: keyof typeof progress };
  function findThread(author: string, season: number, episode: number, titleStart: string): Thread | undefined {
    return seedThreads.find(t => t.showId === showId && t.author === author && t.season === season && t.episode === episode && t.titleBase.startsWith(titleStart));
  }
  function setReplies(thread: Thread | undefined, subjectSeason: number, subjectEpisode: number, defs: SimpleReplyDef[]) {
    if (!thread) return;
    repliesByThread[thread.id] = defs.map((d, idx) => {
      const p = progress[d.author];
      return {
        id: `${thread.id}-sim-${idx + 1}`, threadId: thread.id, showId,
        season: p.season, episode: p.episode, author: d.author,
        body: `${d.author} — ${String(subjectSeason).padStart(2,"0")}/${String(subjectEpisode).padStart(2,"0")} - REPLY about ${String(subjectSeason).padStart(2,"0")}/${String(subjectEpisode).padStart(2,"0")}.`,
        updatedAt: thread.updatedAt + (idx + 1) * 15 * 60_000, likes: randBetween(0, 20),
      } as Reply;
    });
  }
  setReplies(findThread("AA", 1, 2, "AA — 01/02"), 1, 2, [{ author: "BB" },{ author: "CC" },{ author: "DD" },{ author: "EE" },{ author: "FF" },{ author: "GG" },{ author: "HH" },{ author: "II" }]);
  setReplies(findThread("BB", 1, 7, "BB's current progress"), 1, 7, [{ author: "CC" },{ author: "DD" },{ author: "EE" },{ author: "FF" },{ author: "GG" },{ author: "HH" },{ author: "II" },{ author: "JJ" },{ author: "KK" }]);
  setReplies(findThread("EE", 2, 7, "EE's current progress"), 2, 3, [{ author: "CC" },{ author: "DD" },{ author: "FF" },{ author: "GG" },{ author: "HH" },{ author: "II" },{ author: "JJ" },{ author: "KK" },{ author: "LL" }]);
  setReplies(findThread("GG", 3, 6, "GG's current progress"), 2, 7, [{ author: "EE" },{ author: "FF" },{ author: "HH" },{ author: "II" },{ author: "JJ" },{ author: "KK" },{ author: "LL" },{ author: "MM" },{ author: "NN" }]);
  setReplies(findThread("FF", 3, 2, "FF's current progress"), 3, 2, [{ author: "GG" },{ author: "HH" },{ author: "II" },{ author: "JJ" },{ author: "KK" },{ author: "LL" },{ author: "MM" },{ author: "NN" },{ author: "OO" }]);
  setReplies(findThread("HH", 3, 8, "HH's current progress"), 3, 6, [{ author: "GG" },{ author: "II" },{ author: "JJ" },{ author: "KK" },{ author: "LL" },{ author: "MM" },{ author: "NN" },{ author: "OO" }]);
  setReplies(findThread("II", 4, 1, "II's current progress is 04/01 - POST is about 03/08"), 3, 8, [{ author: "HH" },{ author: "JJ" },{ author: "KK" },{ author: "LL" },{ author: "MM" },{ author: "NN" },{ author: "OO" }]);
  setReplies(findThread("II", 4, 1, "II's current progress is 04/01 - POST is about 04/01"), 4, 1, [{ author: "JJ" },{ author: "KK" },{ author: "LL" },{ author: "MM" },{ author: "NN" },{ author: "OO" }]);
  setReplies(findThread("OO", 5, 8, "OO's current progress"), 1, 2, [{ author: "AA" },{ author: "CC" },{ author: "EE" },{ author: "GG" },{ author: "JJ" },{ author: "MM" },{ author: "NN" }]);
  setReplies(findThread("NN", 5, 5, "NN's current progress"), 2, 3, [{ author: "CC" },{ author: "DD" },{ author: "EE" },{ author: "FF" },{ author: "GG" },{ author: "HH" },{ author: "II" },{ author: "JJ" }]);
  setReplies(findThread("GG", 1, 7, "GG's current progress is 01/07"), 1, 7, [{ author: "CC" },{ author: "DD" },{ author: "EE" },{ author: "FF" },{ author: "HH" },{ author: "II" }]);
  setReplies(findThread("KK", 3, 2, "KK's current progress"), 3, 2, [{ author: "GG" },{ author: "HH" },{ author: "II" },{ author: "JJ" },{ author: "LL" },{ author: "MM" }]);
  setReplies(findThread("MM", 2, 7, "MM's current progress"), 2, 7, [{ author: "EE" },{ author: "FF" },{ author: "GG" },{ author: "HH" },{ author: "II" },{ author: "JJ" },{ author: "KK" }]);
  setReplies(findThread("NN", 3, 6, "NN's current progress is 03/06"), 3, 6, [{ author: "GG" },{ author: "HH" },{ author: "II" },{ author: "JJ" },{ author: "KK" },{ author: "LL" }]);
  setReplies(findThread("OO", 4, 1, "OO's current progress is 04/01"), 4, 1, [{ author: "JJ" },{ author: "KK" },{ author: "LL" },{ author: "MM" },{ author: "NN" },{ author: "OO" }]);
})();

/* -------- Curated replies: PopcornTheory -------- */
(function seedPopcornTheoryReplies() {
  function findPopcornThread(season: number, episode: number, titleStart: string) {
    return seedThreads.find(t => t.showId === "bb" && t.author === "PopcornTheory" && t.season === season && t.episode === episode && t.titleBase.startsWith(titleStart));
  }
  type ReplyDef = { author: string; season: number; episode: number; body: string };
  function setCuratedReplies(t: Thread | undefined, defs: ReplyDef[]) {
    if (!t) return;
    repliesByThread[t.id] = defs.map((d, idx) => ({
      id: `${t.id}-pc${idx + 1}`, threadId: t.id, showId: t.showId,
      season: d.season, episode: d.episode, author: d.author, body: d.body,
      updatedAt: t.updatedAt + (idx + 1) * 15 * 60_000, likes: randBetween(0, 28),
    }));
  }
  setCuratedReplies(findPopcornThread(1, 2, "A Perfect Setup"), [
    { author: "RVEnthusiast", season: 1, episode: 2, body: `What I love is how avoidable the whole thing is. Walt literally gives Jesse the correct instructions, and the show still sides with the bad decision because it's funnier and more honest. Gravity becomes a co-writer.` },
    { author: "BlueSkyChem", season: 2, episode: 3, body: `It's such a neat inversion of "clean crime" movies. Instead of a tidy cut to a barrel in the desert, we get structural damage and a hallway full of gore. The world refuses to keep their secret for them.` },
    { author: "FlyEpisodeDefender", season: 3, episode: 1, body: `Also wild that this is basically their first real "process" scene. It's project management gone to hell: bad materials, ignored safety notes, terrible communication, and then nature files the incident report.` },
  ]);
  setCuratedReplies(findPopcornThread(1, 6, "Explosion as Character Arc"), [
    { author: "LosPollos_99", season: 1, episode: 6, body: `The walk-out shot only works because we've seen Walt be so small for five episodes. It's not just "cool guy in front of fire," it's a guy realizing he can make the universe flinch for once.` },
    { author: "GusGusNoSpoils", season: 3, episode: 5, body: `My favorite part is how cheap the trick is on paper: throw rock, boom. But the framing treats it like a spiritual awakening. That's kind of the whole show—petty tools treated like holy relics.` },
    { author: "MineralCollector", season: 4, episode: 1, body: `You can almost see the future Heisenberg silhouette get born in that shot. Later, when the show goes much darker, this feels like the first time he tries on the costume and it accidentally fits.` },
  ]);
  setCuratedReplies(findPopcornThread(2, 3, "The Bureaucracy of Lies"), [
    { author: "BetterCallMe", season: 2, episode: 3, body: `The fugue state cover story is peak red tape. He literally invents a paperwork diagnosis for disappearing. It's like he's weaponizing the fact that hospitals and cops are buried in forms.` },
    { author: "SaulGoodDude", season: 3, episode: 1, body: `Every time Walt "resolves" a lie, he actually creates a new department. Skyler, Hank, the doctors, the school—everyone gets their own slightly different version of the memo. No wonder the admin load explodes.` },
    { author: "CarWashOwner", season: 4, episode: 3, body: `What kills me is that he still acts offended when people don't believe him. Like: sir, you have filled out sixteen contradictory forms about your own life. The system is working exactly as you designed it.` },
  ]);
  setCuratedReplies(findPopcornThread(2, 10, "The Dinner Scene That Turned Everything"), [
    { author: "PinkmanVibes", season: 2, episode: 10, body: `That tequila moment with Walt Jr. is so rough. You can feel the scene flip from "we're celebrating" to "something is broken here" without anyone saying it. The power trip leaks out of him by accident.` },
    { author: "ABQLocal", season: 3, episode: 1, body: `I love how the scene is staged around that table. Walt in host mode, Hank doing his usual bluster, Skyler watching the temperature rise. It's like a pressure cooker with nice stemware.` },
    { author: "Heisenfan", season: 4, episode: 1, body: `You're right that this is the pivot away from cancer. Once you've seen more of the show, it feels like the last time his illness is an excuse instead of a background condition for his ambition.` },
  ]);
  setCuratedReplies(findPopcornThread(3, 1, "No Más and the Gospel of Silence"), [
    { author: "CactoidPrime", season: 3, episode: 1, body: `The crawl sequence is so good because the show refuses to translate it for you. No subtitles, no exposition dump, just an image ritual that you're forced to sit with until the meaning clicks later.` },
    { author: "FringWatch", season: 3, episode: 6, body: `It's also the first time Albuquerque feels like part of a larger mythic landscape. Up to now we've mostly been in houses, schools, and junkyards. Suddenly there's this pilgrimage happening in the margins.` },
    { author: "MikeIsCalm", season: 4, episode: 1, body: `What I love is how quiet Walt's own scenes feel against that opener. The cousins are pure intention; Walt is pure noise. The silence belongs to the people who already know exactly what they're here to do.` },
  ]);
  setCuratedReplies(findPopcornThread(3, 5, "The Lab as a Love Story"), [
    { author: "GaleSingAlong", season: 3, episode: 5, body: `The way he walks into that lab is exactly how people shoot meet-cute scenes. Eye contact, slow walk, the little half-smile. It's a rom-com beat pointed at stainless steel.` },
    { author: "MadrigalEnjoyer", season: 4, episode: 3, body: `Production-design-as-character is right on. You can basically chart Walt's soul by his workspaces: RV chaos, makeshift basements, and then this cathedral where every surface says "you belong here."` },
    { author: "LydiaBean", season: 5, episode: 3, body: `What's really scary is how fast the lab normalizes everything. Once the environment looks legitimate, it's easier to pretend the work is legitimate too. The set is seducing us along with him.` },
  ]);
  setCuratedReplies(findPopcornThread(3, 12, "Half Measures, Whole Lesson"), [
    { author: "MikeIsCalm", season: 3, episode: 12, body: `As someone who loves good crime writing, that monologue feels like a mission statement and a resignation letter at the same time. Mike is telling Walt exactly how not to be him, and you know it won't land.` },
    { author: "TucoRageQuit", season: 4, episode: 2, body: `What gets me is the structure: calm story, simple rule, and then the show immediately breaks its own rule in the most shocking way possible. It's thesis, antithesis, and then a car coming out of nowhere.` },
    { author: "GusGusNoSpoils", season: 5, episode: 1, body: `You can watch the whole series through the lens of that speech. Every time someone tries a half measure, the universe eventually corrects it with something horrifying. Full measures are just the ones we notice more.` },
  ]);
  setCuratedReplies(findPopcornThread(4, 1, "Box Cutter and the Art of Stillness"), [
    { author: "MineralCollector", season: 4, episode: 1, body: `The part that wrecks me is Gus changing clothes twice. Suit → lab gear → suit. It's like the murder is just a brief task slotted between meetings. No music, no speech, just a calendar item.` },
    { author: "FringWatch", season: 4, episode: 7, body: `You're dead on about "oxygen control." The edit feels like someone slowly turning down the air in the room. By the time the box cutter actually moves, you're desperate for anything to break the tension.` },
    { author: "HuellRules", season: 5, episode: 2, body: `Also appreciate that the camera almost never flinches. No shaky coverage, no frantic cutting. It's weirdly respectful, which somehow makes it ten times more upsetting.` },
  ]);
  setCuratedReplies(findPopcornThread(4, 3, "Skyler's Moral Algebra"), [
    { author: "CarWashOwner", season: 4, episode: 3, body: `"Moral algebra" is such a good way to put it. You can see her trying to balance columns: kids, house, lies, money. She's not chasing a thrill, she's trying to make the numbers stop screaming.` },
    { author: "BlueSkyChem", season: 5, episode: 1, body: `What I love is how un-showy her turn is. No big villain monologue, just a series of tiny, awful compromises. She's basically doing forensic accounting on her own conscience.` },
    { author: "hi_itsme", season: 5, episode: 8, body: `In a lot of crime stories, the spouse either leaves or forgives. Skyler does neither. She stays, adapts, and never lets herself forget that what she's doing is wrong. That tension is what makes her so sharp.` },
  ]);
})();

/* -------- Curated replies: SlateOrbit -------- */
(function seedSlateOrbitReplies() {
  function findSlateThreads(season: number, episode: number, titleStart: string): Thread[] {
    return seedThreads.filter(t => t.showId === "bb" && t.author === "SlateOrbit" && t.season === season && t.episode === episode && t.titleBase.startsWith(titleStart));
  }
  type SlateReplyDef = { author: string; season: number; episode: number; body: string };
  function setSlateReplies(threads: Thread[], defs: SlateReplyDef[]) {
    if (!threads.length) return;
    for (const t of threads) {
      repliesByThread[t.id] = defs.map((d, idx) => ({
        id: `${t.id}-sc${idx + 1}`, threadId: t.id, showId: t.showId,
        season: d.season, episode: d.episode, author: d.author, body: d.body,
        updatedAt: t.updatedAt + (idx + 1) * 15 * 60_000, likes: randBetween(0, 28),
      }));
    }
  }
  setSlateReplies(findSlateThreads(1, 1, "The Medium Is the Meth"), [
    { author: "RVEnthusiast", season: 1, episode: 1, body: `I kind of like that it owns its TV bones. The cold open RV chaos feels like a teaser for a different show, and then the ad-break rhythms you're talking about lull you back into "normal life" between each escalation.` },
    { author: "BlueSkyChem", season: 2, episode: 13, body: `On a rewatch, those "engineered" beats hit different once we know the teddy bear isn't just an edgy flourish. It really does feel like the pilot is designing a controlled experiment that's going to blow apart the neighborhood.` },
    { author: "FlyEpisodeDefender", season: 4, episode: 11, body: `If you stick with it, I think the show slowly earns the silence you're missing here. By the time we get to things like the RV desert marathons and the almost-wordless stuff in the lab, it's like they've graduated from TV timing to something closer to what you're asking for.` },
  ]);
  setSlateReplies(findSlateThreads(1, 2, "A Bathtub Scene for Late Capitalism"), [
    { author: "CarWashOwner", season: 1, episode: 2, body: `Totally. The part that gets me is that they're trying to dispose of evidence like a company trying to manage waste off the books. It's not just a gross gag, it's industrial negligence happening in a hallway.` },
    { author: "PinkmanVibes", season: 3, episode: 6, body: `The ceiling giving out is such a good mission statement for the show's ethics. You can try to dissolve the problem in the back room, but sooner or later it crashes into the living space in front of people who had nothing to do with it.` },
    { author: "ABQLocal", season: 5, episode: 6, body: `I like your "middle class guilt" take, because so much later on is just fancier versions of this shot. Money laundering, shell companies, train heists—it's all different flavors of "maybe the mess will stay where we put it this time."` },
  ]);
  setSlateReplies(findSlateThreads(2, 5, "The Show About Scheduling"), [
    { author: "TheScheduleIsTheStory", season: 2, episode: 5, body: `Love this. It really is a show about task lists. Who's driving, who's holding, who's watching the stash. The panic is less "are we evil?" and more "do we have capacity this week?"` },
    { author: "GaleSingAlong", season: 3, episode: 6, body: `Once the RV becomes evidence, the logistics obsession turns into horror. It's not just a vehicle, it's a rolling hard drive of felonies, and the calendar suddenly includes things like "destroy our entire history by 3pm."` },
    { author: "MadrigalEnjoyer", season: 4, episode: 8, body: `What's funny is how far up the chain that scheduling anxiety travels. By the time we're watching multinational suits panic about distribution lanes and fronts, it's the same energy as Jesse trying to wrangle his tiny crew—just with nicer stationery.` },
  ]);
  setSlateReplies(findSlateThreads(2, 10, "Moral Physics and Baby Formula"), [
    { author: "Heisenfan", season: 2, episode: 10, body: `Yeah, this is the point where "providing for my family" starts to feel like a cover story even to him. The party scene plays like a failed experiment in being normal, and he hates the results.` },
    { author: "SkylerPointOfView", season: 3, episode: 1, body: `A Skyler-only version would be incredible. From her side, the pivot isn't cancer → control, it's "supportive wife" → "forensic accountant of this man's bullshit." She's doing moral physics while everyone else is doing vibes.` },
    { author: "EmpireBusiness", season: 5, episode: 6, body: `As someone who's seen the whole thing, this episode feels like the first time he really gets high on the idea of control for its own sake. The baby monitor and the hardware store aisle are just early prototypes of the empire pitch.` },
  ]);
  setSlateReplies(findSlateThreads(3, 1, "A Desert, a Gun, a Man Explaining Himself"), [
    { author: "CactoidPrime", season: 3, episode: 1, body: `I love that the desert here is doing three jobs at once: fallout from the sky, rehab processing, and that little roadside gun ritual. It's consequence, therapy, and performance all baked into the same location.` },
    { author: "FringWatch", season: 4, episode: 1, body: `I get what you mean about explanation sneaking in after the crawl, but I kind of like the whiplash. The show keeps bouncing between pure image (shrines, cousins, sky) and dudes trying to justify themselves, and the gap between those is where all the dread lives.` },
    { author: "OzymandiasFan", season: 5, episode: 14, body: `If you stick with it, the desert eventually gets the last word. All the explaining, all the myth-building, and you still end up back out there with a gun and a man who's out of stories. This episode feels like the first draft of that ending.` },
  ]);
  setSlateReplies(findSlateThreads(3, 2, "I Don't Trust the Camera"), [
    { author: "MikeIsCalm", season: 3, episode: 2, body: `I kind of love that you don't trust it yet. The precision is so showy you can see the storyboard. For me the fun is waiting for the moments when the blocking fails a little and you realize the characters have outgrown the frame they built for them.` },
    { author: "ProblemDog", season: 4, episode: 7, body: `Later on they start weaponizing that immaculate coverage. There are scenes where the camera is so composed it feels like a lie the show is telling you, and then some tiny "mistake" in the background is the thing that actually matters.` },
    { author: "FlyEpisodeDefender", season: 5, episode: 4, body: `If you're missing accidents, wait until you get to some of the long, static setups where the only "action" is an actor's face falling apart. It's still meticulous, but it stops feeling like demo reel material and starts feeling like surveillance.` },
  ]);
})();

/* -------- Curated replies: LoomSignal -------- */
(function seedLoomSignalReplies() {
  function findLoomThreads(season: number, episode: number, titleStart: string): Thread[] {
    return seedThreads.filter(t => t.showId === "bb" && t.author === "LoomSignal" && t.season === season && t.episode === episode && t.titleBase.startsWith(titleStart));
  }
  type LoomReplyDef = { author: string; season: number; episode: number; body: string };
  function setLoomReplies(threads: Thread[], defs: LoomReplyDef[]) {
    if (!threads.length) return;
    for (const t of threads) {
      repliesByThread[t.id] = defs.map((d, idx) => ({
        id: `${t.id}-lc${idx + 1}`, threadId: t.id, showId: t.showId,
        season: d.season, episode: d.episode, author: d.author, body: d.body,
        updatedAt: t.updatedAt + (idx + 1) * 15 * 60_000, likes: randBetween(0, 28),
      }));
    }
  }
  setLoomReplies(findLoomThreads(1, 1, "The Science Fair from Hell"), [
    { author: "BlueSkyChem", season: 1, episode: 1, body: `That's exactly why the RV scenes hit so hard for me. You can see the same guy who explains combustion to bored kids suddenly realizing he can run the wildest lab in town. It's a science fair where someone swapped out the baking soda volcano for actual stakes.` },
    { author: "PinkmanVibes", season: 2, episode: 6, body: `As someone who barely scraped through chemistry, it's both funny and sad that the first time Walt gets real engagement is from a former student who's now his partner in crime. All that potential, and the only hands-on learning is happening in a death van.` },
    { author: "EmpireBusiness", season: 5, episode: 3, body: `Rewatching after the whole empire speech, the pilot feels like a guy giving a TED Talk about change while secretly pitching himself on becoming the case study.` },
  ]);
  setLoomReplies(findLoomThreads(1, 2, "So... the Acid Goes Through the Ceiling?"), [
    { author: "CarWashOwner", season: 1, episode: 2, body: `I laughed way too hard at how matter-of-fact the house is about rejecting their plan. They try to outsource the mess to the bathtub and the building says "nope," and just drops the invoice into the hallway.` },
    { author: "TheScheduleIsTheStory", season: 2, episode: 11, body: `This episode is where I realized the show is obsessed with maintenance. Clean the evidence, mop the floor, fix the story. When the ceiling gives out, it feels like reality refusing to be one more thing they can tidy.` },
    { author: "ProblemDog", season: 4, episode: 7, body: `What kills me on a rewatch is how small this disaster is compared to later ones, but it's shot with the same sense of "you don't come back from this." The scale changes over the seasons, the feeling doesn't.` },
  ]);
  setLoomReplies(findLoomThreads(1, 6, "Walt's Midlife Patch Notes"), [
    { author: "LosPollos_99", season: 1, episode: 6, body: `That explosion honestly feels like a software update notification. "Heisenberg 1.0 is ready to install. Restart now?" And he hits yes without reading the changelog about side effects.` },
    { author: "GusGusNoSpoils", season: 3, episode: 1, body: `You're spot on about control vs. genius. Every time he pulls a stunt like this, he seems less interested in solving a problem and more interested in proving he's the smartest person in the room, even when the room is on fire.` },
    { author: "OzymandiasFan", season: 5, episode: 14, body: `By the time you get to the end, this moment reads like the first shaky monologue in a long villain audition. The bald head, the swagger, the chemistry trick—it's all there, just not calibrated yet for how much damage he's going to do.` },
  ]);
  setLoomReplies(findLoomThreads(2, 3, "The Show About Cleaning Up"), [
    { author: "TheScheduleIsTheStory", season: 2, episode: 3, body: `I love your "domestic show" read. Half the scenes really are about wiping surfaces and rehearsing stories. Every cook seems to come with a matching chore list.` },
    { author: "SaulGoodDude", season: 3, episode: 3, body: `Once Saul shows up, it becomes even more literal: he's basically a professional janitor for consequences. Paperwork, cover stories, disappearing acts—he just uses legal pads instead of mops.` },
    { author: "MikeIsCalm", season: 4, episode: 2, body: `By the time Mike is fully in the picture, the show has three separate cleanup departments: physical, legal, and emotional. What never really gets cleaned is the people doing all that work.` },
  ]);
  setLoomReplies(findLoomThreads(2, 11, "Desert Space"), [
    { author: "CactoidPrime", season: 2, episode: 11, body: `The DS9 comparison is so good. Every time they drive out past the city lights, you can feel the rules thinning out. The same people look different in that light, like they're stepping onto a different station.` },
    { author: "FringWatch", season: 3, episode: 1, body: `After the plane crash, the sky over that desert feels haunted. It's not just empty land anymore, it's airspace with ghosts, which makes every new "deal in the middle of nowhere" land a little heavier.` },
    { author: "SalamancaShrine", season: 4, episode: 1, body: `What I like is that the desert never picks a side. Cops, cartel, cooks—they all use it the same way: somewhere to hide things they can't face at home.` },
  ]);
  setLoomReplies(findLoomThreads(3, 6, "The Lab and the Temptation of Order"), [
    { author: "GaleSingAlong", season: 3, episode: 6, body: `Calling it "the architectural equivalent of a lie told perfectly" is perfect. Gale basically treats that place like a temple, and it's easy to see why Walt feels invited to become its high priest.` },
    { author: "MadrigalEnjoyer", season: 4, episode: 8, body: `The comfort in systems thing hits hard. Once the lab is running, the horror isn't loud anymore—it's scheduled. Six cooks a week, waste handled, product distributed. Evil with a maintenance contract.` },
    { author: "LydiaBean", season: 5, episode: 2, body: `As someone who works in spreadsheets all day, the scariest part for me is how scalable it looks. Swap in a new cook, swap in a new market, keep the shiny control panel.` },
  ]);
  setLoomReplies(findLoomThreads(3, 12, "Half Measures, Whole Truth"), [
    { author: "MikeIsCalm", season: 3, episode: 12, body: `You're right that the story lands because it feels stolen from real life. It's not a cool assassin anecdote, it's a cop admitting he tried to do the right thing in a way that let everyone down worse.` },
    { author: "ProblemDog", season: 4, episode: 7, body: `The martial arts overlap is such a good angle. Mike is basically describing bad form: you step in with doubt, you pull the punch, and the counter hit is twice as brutal. The show keeps proving him right.` },
    { author: "OzymandiasFan", season: 5, episode: 14, body: `On a full-series rewatch, that speech feels like the pivot away from pretending this can be done gently. Every "I'll fix this later" choice after this episode has a body count attached.` },
  ]);
  setLoomReplies(findLoomThreads(4, 1, "The Quiet Terror of Box Cutter"), [
    { author: "MineralCollector", season: 4, episode: 1, body: `The industrial hum wrecked me too. It sounds like the building is working overtime while everyone inside is trying very hard not to breathe too loud.` },
    { author: "FringWatch", season: 4, episode: 11, body: `I love the 2001 comparison. Gus walking around in that lab gear has the same "calm machine malfunctions a man" vibe. You get the sense he already decided what this scene was going to look like days ago.` },
    { author: "HuellRules", season: 5, episode: 8, body: `Knowing how their war ends, this feels like the lesson Walt never forgets: you don't have to shout to be terrifying. You just have to make the worst thing in the room feel like a routine procedure.` },
  ]);
  setLoomReplies(findLoomThreads(4, 2, "Skyler's Firewall"), [
    { author: "SkylerPointOfView", season: 4, episode: 2, body: `"Firewall" is exactly it. She's not out of the system anymore; she's the one setting up partitions and air gaps so the damage doesn't take everything down at once.` },
    { author: "CarWashOwner", season: 4, episode: 11, body: `Watching her rehearse phone calls and script cover stories is almost scarier than any gun scene. She's doing crisis management in real time.` },
    { author: "FiftyOneWatcher", season: 5, episode: 4, body: `When you get to the pool scene in "Fifty-One," this post feels prophetic. The firewall is still up, but she's burning out behind it.` },
  ]);
})();

/* -------- Curated replies: _quietloop -------- */
(function seedQuietloopReplies() {
  function findQuietThreads(season: number, episode: number, titleStart: string): Thread[] {
    return seedThreads.filter(t => t.showId === "bb" && t.author === "_quietloop" && t.season === season && t.episode === episode && t.titleBase.startsWith(titleStart));
  }
  type QuietReplyDef = { author: string; season: number; episode: number; body: string };
  function setQuietReplies(threads: Thread[], defs: QuietReplyDef[]) {
    if (!threads.length) return;
    for (const t of threads) {
      repliesByThread[t.id] = defs.map((d, idx) => ({
        id: `${t.id}-qc${idx + 1}`, threadId: t.id, showId: t.showId,
        season: d.season, episode: d.episode, author: d.author, body: d.body,
        updatedAt: t.updatedAt + (idx + 1) * 15 * 60_000, likes: randBetween(0, 28),
      }));
    }
  }
  setQuietReplies(findQuietThreads(1, 1, "The Pilot Blew Me Away"), [
    { author: "RVEnthusiast", season: 1, episode: 1, body: `Same. I was ready for "good cable show" vibes, not a full little movie. The pants falling from the sky into that wide frame is such a goofy image, but the way they shoot it tells you they're going to take even the dumb bits seriously.` },
    { author: "BlueSkyChem", season: 2, episode: 13, body: `On a rewatch, the pilot feels like the control group in an experiment. Ordinary house, ordinary job, and then one impossible variable gets added and the whole thing blows apart over Albuquerque.` },
    { author: "EmpireBusiness", season: 5, episode: 6, body: `The Moneyball comparison is so good because later the "math to break the world" stuff stops being cute. At first it's "what if I apply chemistry to this one little scam," and by the time he's talking about empires, you realize the pilot was his origin story pitch.` },
  ]);
  setQuietReplies(findQuietThreads(1, 2, "The Bathtub Scene Is Still in My Head"), [
    { author: "CarWashOwner", season: 1, episode: 2, body: `The sound of that sludge hitting the floor is honestly worse than anything we see. You're right, the tonal control is wild: it's a Looney Tunes gag that never lets you forget it used to be a person.` },
    { author: "ProblemDog", season: 3, episode: 12, body: `The show keeps finding new ways to stage "you can't just wash this away" — here it's the ceiling, later it's Jesse staring at kid-sized bike tracks in the dirt. The mess always escapes the container they try to put it in.` },
    { author: "DeadFreight", season: 5, episode: 5, body: `What's messed up is how this scene feels like training wheels for later. First it's acid and a bathtub, later it's a whole train job and that same whiplash from "we pulled it off" to "oh god what did we do" in about three seconds.` },
  ]);
  setQuietReplies(findQuietThreads(1, 6, "Okay, I Get the Hype Now"), [
    { author: "LosPollos_99", season: 1, episode: 6, body: `That walk out of the building is the first time the show lets him feel like the main character in his own life. It's ridiculous and earned at the same time, which is kind of the series in one shot.` },
    { author: "GusGusNoSpoils", season: 3, episode: 6, body: `I like how low-tech his "superpower" is here. It's just rocks and confidence. Later, when he's surrounded by stainless steel and real money, you can still see the guy who figured out he could scare a room with one good trick.` },
    { author: "SayMyName", season: 5, episode: 7, body: `Watching this after he starts demanding people say his name is brutal. This is the moment where blowing up a little office feels like the peak.` },
  ]);
  setQuietReplies(findQuietThreads(2, 10, "The Dinner Scene and the Horror of Normalcy"), [
    { author: "SkylerPointOfView", season: 2, episode: 10, body: `Love this read. The scene looks like every awkward family dinner ever, which makes the power imbalance feel worse. Nobody knows they're in a horror story yet except us and Walt's ego.` },
    { author: "Heisenfan", season: 4, episode: 3, body: `It's wild how much of the show's thesis is already there: control, denial, performance. Once you've seen Skyler doing her own careful lies with the car wash and Hank's bills, this little "non-confession" plays like the first bad draft of everyone's cover story.` },
    { author: "FiftyOneWatcher", season: 5, episode: 4, body: `If this dinner freaked you out, wait until you get to his birthday in Season 5. Same basic setup—table, cake, family—and everyone silently screaming for completely different reasons.` },
  ]);
  setQuietReplies(findQuietThreads(3, 6, "Breaking Bad and the Math of Consequences"), [
    { author: "GaleSingAlong", season: 3, episode: 6, body: `The "equations" thing really clicks for me here too. Gale is literally treating crime like a beautifully balanced formula, and Walt can't resist solving the hardest version of the problem even when the answer is clearly "everyone gets hurt."` },
    { author: "MadrigalEnjoyer", season: 4, episode: 8, body: `That lab really is a cathedral to ego. It's also a spreadsheet made out of steel: inputs, outputs, tolerances, margins. The terrifying part is how quickly the system makes monstrous choices feel like just another line item.` },
    { author: "GlidingOverAll", season: 5, episode: 8, body: `Once you've seen the montage of how far the business expands, posts like this hit even harder. The show keeps doing the math honestly: every improvement in the process gets matched by an equal and opposite disaster somewhere else.` },
  ]);
  setQuietReplies(findQuietThreads(4, 1, "Box Cutter Is Pure Dread"), [
    { author: "MineralCollector", season: 4, episode: 1, body: `The surgery-light comparison is perfect. Everything is too clean. Bright, sterile, nothing to hide behind. It feels less like a murder and more like someone performing a procedure they already rehearsed in their head a hundred times.` },
    { author: "FringWatch", season: 4, episode: 11, body: `What kills me is how mundane Gus makes it. Change clothes, do the unthinkable, change back, go to work. No speech, no gloating. For all of Walt's big monologues, this quiet little sequence ends up defining the whole season's vibe.` },
    { author: "EndTimes", season: 4, episode: 12, body: `Once you get closer to the finale, this scene feels like the moment Walt realizes what kind of story he's actually in. Gus shows him what "pure dread" really looks like, and Walt spends the rest of the season trying to learn that language.` },
  ]);
  setQuietReplies(findQuietThreads(4, 5, "Skyler Might Be the Most Realistic Character on TV"), [
    { author: "CarWashOwner", season: 4, episode: 5, body: `Totally with you. Watching her figure out the car wash numbers is somehow more stressful than half the gun scenes. She's doing risk assessment, cash flow, and emotional triage all at once.` },
    { author: "SkylerPointOfView", season: 5, episode: 1, body: `I like that she's allowed to be furious, smart, and wrong all at the same time. Her plans are "realistic" in the sense that they're messy and reactive.` },
    { author: "FiftyOneWatcher", season: 5, episode: 4, body: `By the time you hit the pool scene, your post basically turns into prophecy. She really is building a new version of herself out of scraps, and the show never pretends that process is noble or fun.` },
  ]);
})();

/* -------- Curated replies: DreamInReverse -------- */
(function seedDreamInReverseReplies() {
  function findDIRThreads(season: number, episode: number, titleStart: string): Thread[] {
    return seedThreads.filter(t => t.showId === "bb" && t.author === "DreamInReverse" && t.season === season && t.episode === episode && t.titleBase.startsWith(titleStart));
  }
  type DIRReplyDef = { author: string; season: number; episode: number; body: string };
  function setDIRReplies(threads: Thread[], defs: DIRReplyDef[]) {
    if (!threads.length) return;
    for (const t of threads) {
      repliesByThread[t.id] = defs.map((d, idx) => ({
        id: `${t.id}-dc${idx + 1}`, threadId: t.id, showId: t.showId,
        season: d.season, episode: d.episode, author: d.author, body: d.body,
        updatedAt: t.updatedAt + (idx + 1) * 15 * 60_000, likes: randBetween(0, 30),
      }));
    }
  }
  setDIRReplies(findDIRThreads(1, 1, "Yeah, It's Good"), [
    { author: "RVEnthusiast", season: 1, episode: 1, body: `The pilot really does toss you into chaos fast. I love that the RV somehow feels both slapstick and terrifying — it's a warning shot of how weird this show's tone can get.` },
    { author: "SlateOrbit", season: 2, episode: 3, body: `If this felt familiar, wait for how quickly the show starts peeling away Walt's "normal guy" layer. The pants flying through the desert reads like foreshadowing once you know how unhinged things get.` },
    { author: "QuietLoop", season: 4, episode: 1, body: `The moment you're like "yeah it's good" is exactly when the show starts tugging on the wire. Funny in hindsight knowing how far the desert and underwear imagery echo down the line.` },
  ]);
  setDIRReplies(findDIRThreads(1, 2, "Acid Through the Ceiling"), [
    { author: "LoomSignal", season: 1, episode: 2, body: `This episode nails the chaotic energy of two guys trying to solve a crisis with zero shared skillset. The ceiling gag is horrible and hilarious, which becomes kind of the show's signature.` },
    { author: "PopcornTheory", season: 2, episode: 11, body: `You're right to call out contractor energy — Jesse's shortcuts are basically a thesis statement for half the show. Every time he tries to "wing it," something collapses. Literally, here.` },
    { author: "ProblemDog", season: 4, episode: 7, body: `On a rewatch, this feels tiny compared to later disasters, but emotionally it's the same vibe: they try to hide a mess, and the universe says "absolutely not."` },
  ]);
  setDIRReplies(findDIRThreads(1, 6, "The Explosion Was Fine"), [
    { author: "QuietLoop", season: 1, episode: 6, body: `I get you — it's more muted than the hype suggested. But that weird restraint makes Walt's swagger afterwards land harder. He's trying on a persona he doesn't fit yet.` },
    { author: "SlateOrbit", season: 2, episode: 1, body: `Something I love is how "small" this moment feels compared to where Walt's confidence ends up. This is like his training wheels Heisenberg moment.` },
    { author: "LoomSignal", season: 3, episode: 3, body: `Later seasons make this one feel almost modest. It's funny watching him play it cool when you know he grows into the guy who uses fear as a second language.` },
  ]);
  setDIRReplies(findDIRThreads(2, 10, "Getting Tired of the Lies"), [
    { author: "PopcornTheory", season: 2, episode: 10, body: `Season 2 definitely leans into the "mess compounds slowly" vibe. It feels repetitive because Walt keeps thinking he's solving the problem when he's making it bigger.` },
    { author: "QuietLoop", season: 3, episode: 4, body: `You're not wrong — the show is doing incremental slippage on purpose. Every lie is a brick in a wall he won't admit he's building.` },
    { author: "SlateOrbit", season: 4, episode: 3, body: `The fatigue you're feeling becomes part of the emotional payoff. Later, you look back at this stretch as the last point where the damage was still containable.` },
  ]);
  setDIRReplies(findDIRThreads(3, 6, "That Fancy Lab"), [
    { author: "LoomSignal", season: 3, episode: 6, body: `The jump from RV grime to chrome perfection is jarring, and I think that's the point — it's seducing Walt. The lab is like a mirror reflecting back his idealized self.` },
    { author: "QuietLoop", season: 4, episode: 2, body: `The polish does make things feel less "fun," but it pays off because the tension shifts from survival chaos to controlled pressure. The walls themselves feel complicit.` },
    { author: "SlateOrbit", season: 5, episode: 1, body: `Wild how much the environment tracks his psychology. Gone is the scrappy desperation — now it's precision, pride, and a workspace that flatters his ego.` },
  ]);
  setDIRReplies(findDIRThreads(4, 1, "Box Cutter"), [
    { author: "RVEnthusiast", season: 4, episode: 1, body: `The quiet is the scariest part. Gus setting up his clothes with the slow patience of a surgeon made the whole room feel like it shrank.` },
    { author: "FringWatch", season: 4, episode: 11, body: `Totally agree — the violence lands because the buildup is suffocating. It's like the camera is afraid to make a sound.` },
    { author: "HuellRules", season: 5, episode: 2, body: `This scene ages weirdly well. It's less "shock moment" and more a thesis on Gus: efficiency, silence, and a controlled brutality Walt spends the season trying to imitate.` },
  ]);
  setDIRReplies(findDIRThreads(5, 6, "Midway Through Season 5"), [
    { author: "LoomSignal", season: 5, episode: 6, body: `I felt that emotional distance too. It's like everyone's running on fumes and self-preservation. The show leans into the exhaustion.` },
    { author: "PopcornTheory", season: 5, episode: 10, body: `This middle stretch is heavy, but it pays off. The mood you're feeling becomes part of the collapse the show is steering toward.` },
    { author: "QuietLoop", season: 5, episode: 14, body: `Funny reading this knowing what's coming. This is the last moment where anyone still thinks things are "manageable." The bottom falls out fast.` },
  ]);
})();

/* -------- Curated replies: EchoMoth -------- */
(function seedEchoMothReplies() {
  function findEchoThreads(season: number, episode: number, titleStart: string): Thread[] {
    return seedThreads.filter(t => t.showId === "bb" && t.author === "EchoMoth" && t.season === season && t.episode === episode && t.titleBase.startsWith(titleStart));
  }
  type EchoReplyDef = { author: string; season: number; episode: number; body: string };
  function setEchoReplies(threads: Thread[], defs: EchoReplyDef[]) {
    if (!threads.length) return;
    for (const t of threads) {
      repliesByThread[t.id] = defs.map((d, idx) => ({
        id: `${t.id}-ec${idx + 1}`, threadId: t.id, showId: t.showId,
        season: d.season, episode: d.episode, author: d.author, body: d.body,
        updatedAt: t.updatedAt + (idx + 1) * 15 * 60_000, likes: randBetween(0, 28),
      }));
    }
  }
  setEchoReplies(findEchoThreads(1, 1, "Okay, I Finally Started It"), [
    { author: "PopcornTheory", season: 1, episode: 1, body: `I like how you put it: "confident." The pilot isn't mind-blowing yet, but that calm swagger in how it jumps from chaos back to breakfast says a lot about the kind of story it wants to be.` },
    { author: "LoomSignal", season: 2, episode: 8, body: `The sunburnt look really grew on me once I realized how much they're using color as mood. The palette shifts a bit as things widen out beyond suburbia, but that baked, slightly sick feeling never totally leaves.` },
    { author: "QuietLoop", season: 4, episode: 1, body: `It's funny you mention wanting "more color" because later they start weaponizing it — bright fast-food logos, kids' bedrooms, the pool — against how bleak the choices are.` },
  ]);
  setEchoReplies(findEchoThreads(1, 2, "Acid in the Ceiling, Internet Going Nuts"), [
    { author: "RVEnthusiast", season: 1, episode: 2, body: `Same whiplash for me: the scene is memeable as hell, but in context it's just two deeply unqualified people failing at cleaning up a nightmare. The house basically files a complaint by dropping the mess in the hallway.` },
    { author: "LoomSignal", season: 2, episode: 11, body: `I like your "slapstick wrapped around bleak" read. Season 2 keeps pushing that line — the gag lands, but the emotional invoice arrives a couple of episodes later.` },
    { author: "ProblemDog", season: 4, episode: 7, body: `On a rewatch this feels like their training-wheels disaster. Later messes are bigger, but the pattern stays the same: try to dissolve the problem somewhere private, watch it bleed into the rest of the world anyway.` },
  ]);
  setEchoReplies(findEchoThreads(1, 6, "Walter White Is Every Tech Bro at a Panel"), [
    { author: "SlateOrbit", season: 1, episode: 6, body: `"Tech bro at a panel" is painfully accurate. Every time he slips into lecture mode you can see him enjoying that more than actually listening to anyone in the room.` },
    { author: "GaleSingAlong", season: 3, episode: 6, body: `The show leans into that dissonance later by giving us someone who actually loves the science and the work, and suddenly Walt's speeches feel way more like ego than curiosity.` },
    { author: "EmpireBusiness", season: 5, episode: 6, body: `Your alternate version where Jesse starts a band instead is hilarious because the series kind of keeps punishing Walt for wanting to be the guy onstage instead of the guy in the crowd.` },
  ]);
  setEchoReplies(findEchoThreads(2, 10, "The Dinner Scene, or: I've Had This Conversation in Real Life"), [
    { author: "SkylerPointOfView", season: 2, episode: 10, body: `Totally with you on the "invisible flicker" where Skyler checks out. It's such a small, real choice — no big blowup, just that quiet internal "I'm done" you only notice if you've lived through it.` },
    { author: "Heisenfan", season: 3, episode: 3, body: `I like that you don't quite trust the show yet. It really does walk a line between honest pain and flexing its own precision. For me this scene is one of the few places where the machinery steps back and lets the actors breathe.` },
    { author: "FiftyOneWatcher", season: 5, episode: 4, body: `If this dinner felt too much like real life, wait until you hit later family-table moments. The show keeps revisiting that "performed frustration" energy, but in weirder, sadder configurations.` },
  ]);
  setEchoReplies(findEchoThreads(2, 11, "Do People Actually Find This Fun?"), [
    { author: "LoomSignal", season: 2, episode: 11, body: `I don't really find it "fun" either, at least not in a comfort-watch way. It feels more like a long anxiety dream with really good blocking.` },
    { author: "QuietLoop", season: 3, episode: 5, body: `Your "empathy's cold" line hits. For me the show's empathy lives in negative space — in what it refuses to turn into a joke or an easy catharsis.` },
    { author: "EchoMothFan", season: 4, episode: 2, body: `The bit about framing shots on your dog walk is so real. I think that's the hook: even if you never fully warm to the characters, the way it teaches you to look at parking lots and streetlights is weirdly addictive.` },
  ]);
  setEchoReplies(findEchoThreads(2, 11, "Still Watching, Still Skeptical"), [
    { author: "PopcornTheory", season: 3, episode: 1, body: `"Season 3 is where it really starts cooking" made me laugh because that's exactly what people told me too. I don't know if it becomes more "fun," but the show definitely leans into its own weirdness a bit more.` },
    { author: "LoomSignal", season: 3, episode: 7, body: `Honestly, watching while skeptical might be the best way to do it. The show loves to be clever; side-eyeing it as you go keeps the hype at arm's length.` },
    { author: "DeadFreight", season: 5, episode: 5, body: `As someone who powered through on the promise that it would "start cooking," I kind of respect you for admitting you're here mostly because your dog likes the couch.` },
  ]);
})();

void pushPostSev; // suppress unused warning
