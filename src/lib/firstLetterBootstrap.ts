import {
  createPeopleGroup,
  startShowRoom,
  insertThread,
  addThreadToGroup,
  logThreadPrompt,
  createPeopleGroupInvite,
  sendGroupInviteEmail,
} from "./db";

// A new group from the dashboard starts with a letter (Alborz 2026-10-07):
// the onboarding's "we went ahead" bootstrap, ported. Nothing exists until
// the first letter is sent; then, in order: the group, the show room, the
// letter into it, one invite per friend CARRYING THE ROOM (a friend who
// accepts is enrolled in the room, so there is writing waiting for them —
// they still land on the dashboard like any invitee), and the emails. The
// email leg reports per friend so a refusal surfaces as a copy-the-link row,
// never a false "Invites sent!" — the same rows the dashboard shows today.

export type FirstLetter = {
  title: string; body: string; preview: string;
  season: number; episode: number;
  isRewatch: boolean; rewatchSeason?: number; rewatchEpisode?: number;
  insertedPromptIds: number[];
};

export type InviteLinkRow = { email: string; name?: string; link?: string; error?: string; emailFailed?: boolean };

export async function bootstrapGroupWithLetter(args: {
  userId: string;
  username: string;
  showId: string;
  friends: { name: string; email: string }[];
  letter: FirstLetter;
}): Promise<{ groupId: string; roomId: string; links: InviteLinkRow[] }> {
  const { userId, username, showId, friends, letter } = args;
  // Group — left unnamed: the contact-name default names it after the friends.
  const groupId = await createPeopleGroup();
  // The show room, already started.
  const { roomId } = await startShowRoom(groupId, showId);
  // The first letter, tagged exactly as the compose form would have tagged it.
  const thread = await insertThread({
    showId, season: letter.season, episode: letter.episode,
    authorId: userId, authorName: username,
    title: letter.title, preview: letter.preview, body: letter.body,
    isPublic: false,
    isRewatch: letter.isRewatch, rewatchSeason: letter.rewatchSeason, rewatchEpisode: letter.rewatchEpisode,
  });
  await addThreadToGroup(thread.id, roomId);
  for (const pid of letter.insertedPromptIds) logThreadPrompt(thread.id, pid).catch(() => {});
  // The invitations, in parallel, each awaiting its own email leg.
  const links = await Promise.all(friends.map(async (f): Promise<InviteLinkRow> => {
    try {
      const token = await createPeopleGroupInvite(groupId, f.email, f.name || undefined, roomId);
      const sent = await sendGroupInviteEmail(token);
      return { email: f.email, name: f.name || undefined, link: `${window.location.origin}/group-invite/${token}`, emailFailed: !sent.ok };
    } catch (e: any) {
      return { email: f.email, error: e?.message === "group_full" ? "This group is full (8 max)." : "Something went wrong. Please try again." };
    }
  }));
  return { groupId, roomId, links };
}
