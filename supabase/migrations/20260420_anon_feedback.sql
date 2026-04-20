-- Allow anonymous (signed-out) users to submit feedback.
--
-- The existing "users insert own feedback" policy restricts INSERT to
-- authenticated users where auth.uid() = user_id. This migration adds a
-- parallel policy for anon users that only allows rows with user_id = NULL,
-- so a signed-out submitter can't impersonate someone else's account.
--
-- Context: feedback.user_id is already a nullable FK
--   (user_id uuid references auth.users(id) on delete set null)
-- so NULL values are schema-compatible. The FeedbackWidget writes
-- username = 'anon' on the row when the submitter isn't signed in; that
-- field is denormalized text and isn't constrained by the policy.

CREATE POLICY "anon insert feedback" ON public.feedback
  FOR INSERT TO anon
  WITH CHECK (user_id IS NULL);
