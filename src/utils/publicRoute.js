// Public (no-login) pages are chosen by the URL: ?checkin=CODE (event check-in) or ?survey=CODE (event feedback).
// Read synchronously (pure function of the query string) so the very first render already knows whether the
// page is public - the authenticated UI (Header etc., which needs a logged-in user) must never render then.
export function getPublicCodes(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search);
  return { checkin: params.get('checkin') || null, survey: params.get('survey') || null };
}

export function isPublicRoute(search) {
  const { checkin, survey } = getPublicCodes(search);
  return !!(checkin || survey);
}
