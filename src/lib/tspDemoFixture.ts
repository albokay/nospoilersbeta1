/**
 * TSP onboarding demo — baked-in fixture (spec §6, §7).
 *
 * Fully in-memory: the guided sample-room tour reads ALL its content from
 * here — nothing is fetched from or written to the database. The mock
 * Maya/James/Sarah entries + replies are lifted verbatim from the parked
 * `tsp-seed-*` content (the seed is only the authoring source); the seven
 * instructional "Alborz" entries are the verbatim spec copy. The map is three
 * fixed seed columns (Maya E2 / James E4 / Sarah E6) — the viewer's own
 * growing column is added at runtime by the demo orchestrator.
 *
 * Gating (entry/reply visible iff `episode <= selectedEpisode`, episode 0
 * always visible) is applied by the consumer against modal-local state.
 */
import type { V2RoomFeedEntry } from "../components/v2/V2RoomFeed";
import type { V2RoomMapMember } from "../components/v2/V2RoomMap";
import type { Thread, Reply, ProgressEntry } from "../types";

export const TSP_DEMO_SHOW = { id: "tsp", name: "The Sidebar Protocol", seasons: [6] as number[] };
export const TSP_EPISODE_COUNT = 6;

const SHOW_ID = "tsp";
const U = {
  maya:   { id: "tsp-demo-maya",   name: "Maya" },
  james:  { id: "tsp-demo-james",  name: "James" },
  sarah:  { id: "tsp-demo-sarah",  name: "Sarah" },
  alborz: { id: "tsp-demo-alborz", name: "Alborz" },
};

// ── Replies (display-only, gated by episode) ────────────────────────────────
function reply(threadId: string, idx: number, e: number, author: { name: string }, body: string): Reply {
  const ts = e * 1000 + idx;
  return { id: `${threadId}-r${idx}`, threadId, showId: SHOW_ID, season: 1, episode: e, author: author.name, body, createdAt: ts, updatedAt: ts, likes: 0 };
}

export const tspDemoReplies: Record<string, Reply[]> = {
  "tsp-a": [
    reply("tsp-a", 1, 2, U.james, `The quietness of it is what got me. Any other show would have made that a big moment. This one just lets you sit with it. And the worst part is going back to episode one knowing what she is. She's so warm. She's so convincingly warm.`),
    reply("tsp-a", 2, 2, U.sarah, `I keep thinking about who Nadia is feeding the intelligence to. The show doesn't tell us yet. Reyes knows — you can see it in her face — but she doesn't say it out loud. That omission feels deliberate.`),
    reply("tsp-a", 3, 4, U.james, `Coming back to this after episode four. Sarah's question about who Nadia is feeding gets answered and it destroyed me. Everything in this thread looks different now.`),
    reply("tsp-a", 4, 4, U.sarah, `James. The answer to my own question broke me completely. I should have seen it.`),
    reply("tsp-a", 5, 6, U.sarah, `By episode six the Nadia reveal is just the first domino. The whole series is one long controlled fall and episode two is where it starts. Rewatch it.`),
  ],
  "tsp-b": [
    reply("tsp-b", 1, 2, U.maya, `"Quiet and then detonate" is exactly the grammar of it. And when we find out about Nadia, every quiet moment feels like it might be hiding another detonation.`),
    reply("tsp-b", 2, 4, U.sarah, `Speaking to you from the future — to bounce off of what Maya said, I can't wait for your reaction when you realize all the detonations were planned from the beginning. The quiet isn't just tone. It's structure.`),
  ],
  "tsp-c": [
    reply("tsp-c", 1, 4, U.sarah, `The Omar reveal reframes every scene with Reyes in episodes two and three. She was managing her own grief about him going dark while pretending to manage everyone else's. The performance within the performance. The show is doing something really precise about what it costs to hold that much information alone.`),
    reply("tsp-c", 2, 4, U.james, `Sarah — "the performance within the performance" is the whole show. Every character is performing for someone. The question is who's watching.`),
    reply("tsp-c", 3, 6, U.sarah, `By episode six the answer to James's question — who's watching — is so much more specific and devastating than I expected. The surveillance in this show is not metaphorical.`),
  ],
  "tsp-d": [
    reply("tsp-d", 1, 4, U.james, `Rewatched episode one after your entry and the door thing is everywhere. Also: Reyes is always lit slightly warmer than everyone else in group scenes. Like she's the only one who belongs there. Now I'm wondering if that's sinister rather than authoritative.`),
  ],
  "tsp-e": [
    reply("tsp-e", 1, 4, U.james, `The single operation reveal makes the Omar extraction make more sense. Reyes wasn't just protecting Omar — she was protecting a piece of the larger play. Which makes it more chilling, not less.`),
    reply("tsp-e", 2, 6, U.sarah, `Episode six answers the protecting vs. using question and the answer is that those were never opposites for Reyes. She was doing both simultaneously the whole time and she'd argue there was no other way.`),
  ],
  "tsp-f": [
    reply("tsp-f", 1, 6, U.sarah, `Writing a response to my own entry just to say: what I thought was coming did come. Episode six uses everything episode five built. The Elena thread in this show is the one that will stay with me longest.`),
  ],
  "tsp-g": [],
};

// ── Entries (mock + instructional), interleaved by episode ──────────────────
function entry(o: {
  id: string; e: number; author: { id: string; name: string };
  title: string; preview: string; body: string; isInstructional?: boolean;
}): V2RoomFeedEntry {
  // Sort key: by episode, instructional entry sits at the top of its episode.
  const updatedAt = o.e * 100 + (o.isInstructional ? 99 : 0) - (tspDemoReplies[o.id]?.length ?? 0);
  const thread: Thread = {
    id: o.id, showId: SHOW_ID, season: 1, episode: o.e, author: o.author.name,
    titleBase: o.title, preview: o.preview, body: o.body,
    createdAt: updatedAt, updatedAt, likes: 0, isPublic: false,
  };
  return {
    threadId: o.id, s: 1, e: o.e, title: o.title, body: o.body, preview: o.preview,
    authorId: o.author.id, authorUsername: o.author.name,
    isDeleted: false, updatedAt, replyCount: tspDemoReplies[o.id]?.length ?? 0,
    thread, isInstructional: o.isInstructional || undefined,
  };
}

const MOCK_ENTRIES: V2RoomFeedEntry[] = [
  entry({ id: "tsp-b", e: 1, author: U.james,
    title: "Episode 1 — this show refuses to be a normal spy show",
    preview: `It feels like Sidebar Protocol isn't doing the things spy shows do. No action, no gadgets — the Berlin asset spent most of episode one sitting in a café pretending to read a newspaper.`,
    body: `It feels like Sidebar Protocol isn't doing the things spy shows do. No action, no gadgets — the Berlin asset spent most of episode one sitting in a café pretending to read a newspaper. It was more tense than anything in the last three spy shows I watched. It seems like this show knows how to be quiet and exactly when to detonate something.` }),
  entry({ id: "tsp-a", e: 2, author: U.maya,
    title: "Episode 2 — Nadia is a double agent and I am on the floor",
    preview: `The reveal at the end of episode two that Nadia has been feeding Berlin intelligence to a third party this whole time — I did not see it coming and I feel genuinely betrayed. Not by the show. By Nadia.`,
    body: `The reveal at the end of episode two that Nadia has been feeding Berlin intelligence to a third party this whole time — I did not see it coming and I feel genuinely betrayed. Not by the show. By Nadia. I trusted her. The show made me trust her and then pulled it away so quietly. No dramatic music. Just Reyes reading a file and the camera on her face and I understood exactly what it meant.` }),
  entry({ id: "tsp-d", e: 2, author: U.sarah,
    title: "Episode 2 — when that safe house goes up in flames, remember where everyone was standing",
    preview: `The show hides its power dynamics in the architecture. The briefing rooms are always slightly too small. Reyes always has her back to something solid. The assets are always near the door.`,
    body: `The show hides its power dynamics in the architecture. The briefing rooms are always slightly too small. Reyes always has her back to something solid. The assets are always near the door. And now knowing that Nadia is a double agent, I keep thinking about how she always positioned herself closest to the exit. The show was telling us with blocking what it wasn't ready to say with dialogue.` }),
  entry({ id: "tsp-c", e: 4, author: U.james,
    title: "Episode 4 — Reyes pulled Omar out alive and didn't tell anyone",
    preview: `Omar didn't die in Beirut. Reyes extracted him herself, off the books, without telling the agency. She's been hiding him. I spent all of episode three grieving Omar and the entire time Reyes knew he was alive.`,
    body: `Omar didn't die in Beirut. Reyes extracted him herself, off the books, without telling the agency. She's been hiding him. I spent all of episode three grieving Omar and the entire time Reyes knew he was alive. The show made me feel that grief for a reason — it wanted me to understand what Reyes is willing to do unilaterally. She doesn't trust the agency with the people she runs. That changes everything about how I read her.` }),
  entry({ id: "tsp-e", e: 4, author: U.sarah,
    title: "Episode 4 — Elena figured out the three operations were never independent",
    preview: `Elena in Buenos Aires has been running the numbers and she's realized that Berlin, Beirut and Buenos Aires weren't three separate operations. They were one operation split into three parts and none of the assets knew they were connected.`,
    body: `Elena in Buenos Aires has been running the numbers and she's realized that Berlin, Beirut and Buenos Aires weren't three separate operations. They were one operation split into three parts and none of the assets knew they were connected. Which means Reyes knew the whole shape of it and gave each of them only the piece she wanted them to have. Elena is furious. I am furious on her behalf. And I can't decide if Reyes was protecting them or using them.` }),
  entry({ id: "tsp-f", e: 5, author: U.sarah,
    title: "Episode 5 — Elena is the emotional center of this show and I wasn't ready",
    preview: `I've been so focused on Reyes that I almost missed what's happening with Elena. Episode five is the first time we've really been with her and I was completely undone by the end of it.`,
    body: `I've been so focused on Reyes that I almost missed what's happening with Elena. Episode five is the first time we've really been with her and I was completely undone by the end of it. There's a scene where she describes what she gave up to do this work — her daughter's first years, her mother's last ones — and it lands harder than anything else in the show because it's the first time the cost of the work has been this specific and this personal. Reyes's operation used that sacrifice. I'm not sure I can forgive the show for making me love Elena right before what I think is coming.` }),
  entry({ id: "tsp-g", e: 6, author: U.sarah,
    title: "Episode 6 — Reyes defects and she was Nadia's handler all along",
    preview: `Reyes is the third party. She was the one Nadia was feeding Berlin intelligence to the whole time. She didn't discover the double agent — she created her.`,
    body: `Reyes is the third party. She was the one Nadia was feeding Berlin intelligence to the whole time. She didn't discover the double agent — she created her. The defection at the end of episode six reframes the entire series and I've changed my read on Reyes three times since finishing the episode. Is she a traitor? A whistleblower? Someone who built an operation inside an operation because she stopped believing in the institution? The show doesn't tell you. It just shows you her face as she crosses and leaves you with that.\n\nJames — your filter idea from the episode three thread means something very specific now. The filter was always her.` }),
];

const INSTRUCTIONAL_ENTRIES: V2RoomFeedEntry[] = [
  entry({ id: "tsp-gate-0", e: 0, author: U.alborz, isInstructional: true,
    title: "Hello! Welcome to Sidebar.",
    preview: `This is a show room for a fake show called The Sidebar Protocol.`,
    body: `This is a show room for a fake show called The Sidebar Protocol. You can't write in here, but it's populated with mock entries to help you understand how the spoiler-gating works on the site. I'll guide you through the functions of the site with a few instructional entries like this one.\n\nSee that dropdown menu up top with "haven't started" selected? That means that you haven't watched any episodes of this show yet. This could still be a good time to start a conversation with your friends. You can write about why you're excited to start watching the show.\n\nNow open the dropdown above and tell Sidebar that you've watched Episode 1.` }),
  entry({ id: "tsp-gate-1", e: 1, author: U.alborz, isInstructional: true,
    title: "This appeared because you've now watched Episode 1",
    preview: `That's the whole idea of Sidebar. Nothing about an episode reaches you until you've actually seen it.`,
    body: `That's the whole idea of Sidebar. Nothing about an episode reaches you until you've actually seen it. You just crossed Episode 1, so your friends' Episode 1's entries become visible now. Everything written by anyone past here is still sealed.` }),
  entry({ id: "tsp-gate-2", e: 2, author: U.alborz, isInstructional: true,
    title: "See how the others' posts unlocked too?",
    preview: `You all watch at your own pace, you all update your progress after you watch, and the room only ever shows each person what they've earned.`,
    body: `You all watch at your own pace, you all update your progress after you watch, and the room only ever shows each person what they've earned. No one can spoil you, and you can't spoil anyone. This is also true for responses inside entries.` }),
  entry({ id: "tsp-gate-3", e: 3, author: U.alborz, isInstructional: true,
    title: "The map on the right is keeping score",
    preview: `Glance at the grid. Each row is an episode, each column is a person, and the little dice faces are ratings.`,
    body: `Take a look at the grid. Each row represents an episode, each column represents a friend, and the little dice faces are everyone's episode ratings. You can see the shape of everyone's journey at a glance. You can click on the map to navigate to entries available to you (the green cells) and also have an indication of what's waiting for you as you watch more (the grey cells). It's the spoiler-free way to know your friends are out there.\n\nTry clicking the edit button at the top of your column. That unlocks the cells so that you can leave ratings for the episodes you've watched.` }),
  entry({ id: "tsp-gate-4", e: 4, author: U.alborz, isInstructional: true,
    title: "You're ahead of someone now",
    preview: `Now that you're moving along, the room can tell you where you stand. Someone here is still back on an earlier episode.`,
    body: `Now that you're moving along, the room can tell you where you stand. Someone here is still back on an earlier episode — so anything you write about Episode 4 stays hidden from them until they catch up. You don't have to be careful. The spoiler-gate does the work. Write freely; it only opens for people who are ready to read.` }),
  entry({ id: "tsp-gate-5", e: 5, author: U.alborz, isInstructional: true,
    title: "This is basically what a real room feels like",
    preview: `By now it should be clicking: you update your progress, the room answers.`,
    body: `By now it should be clicking: you update your progress, the room answers. Entries arrive, the map fills in, conversations stay sealed until everyone's ready for them. This is exactly how your own rooms will work — except the people will be your friends, and the show will be one you chose. One episode left in The Sidebar Protocol.` }),
  entry({ id: "tsp-gate-6", e: 6, author: U.alborz, isInstructional: true,
    title: "Your turn.",
    preview: `That's the tour. You've experienced the main thing that makes Sidebar different: the spoiler-gate.`,
    body: `That's the tour. You've experienced the main thing that makes Sidebar unique: the spoiler-gate. I think it changes how you engage with your friends and the shows you're watching (in a good way!). I can't wait to hear how it works for you.\n\nThe next room is yours. Close this window when you're ready, and let's find a show you're actually watching.\n\n~ Alborz` }),
];

/** Full feed fixture — mock + instructional, interleaved (the feed sorts by episode). */
export const tspDemoFeedEntries: V2RoomFeedEntry[] = [...MOCK_ENTRIES, ...INSTRUCTIONAL_ENTRIES];

// ── Map seed columns (fixed; the mock users never advance) ──────────────────
const prog = (e: number): ProgressEntry => ({ s: 1, e, highestS: 1, highestE: e });
const rate = (e: number, rating: number) => ({ s: 1, e, rating });

export const tspDemoSeedMembers: V2RoomMapMember[] = [
  {
    userId: U.maya.id, username: U.maya.name, isDeparted: false, progress: prog(2),
    ratings: [rate(1, 4), rate(2, 5)],
    entries: [{ threadId: "tsp-a", s: 1, e: 2, title: "Episode 2 — Nadia is a double agent and I am on the floor" }],
  },
  {
    userId: U.james.id, username: U.james.name, isDeparted: false, progress: prog(4),
    ratings: [rate(1, 4), rate(2, 3), rate(3, 5), rate(4, 4)],
    entries: [
      { threadId: "tsp-b", s: 1, e: 1, title: "Episode 1 — this show refuses to be a normal spy show" },
      { threadId: "tsp-c", s: 1, e: 4, title: "Episode 4 — Reyes pulled Omar out alive and didn't tell anyone" },
    ],
  },
  {
    userId: U.sarah.id, username: U.sarah.name, isDeparted: false, progress: prog(6),
    ratings: [rate(1, 5), rate(2, 4), rate(3, 4), rate(4, 5), rate(5, 3), rate(6, 5)],
    entries: [
      { threadId: "tsp-d", s: 1, e: 2, title: "Episode 2 — when that safe house goes up in flames, remember where everyone was standing" },
      { threadId: "tsp-e", s: 1, e: 4, title: "Episode 4 — Elena figured out the three operations were never independent" },
      { threadId: "tsp-f", s: 1, e: 5, title: "Episode 5 — Elena is the emotional center of this show and I wasn't ready" },
      { threadId: "tsp-g", s: 1, e: 6, title: "Episode 6 — Reyes defects and she was Nadia's handler all along" },
    ],
  },
];
