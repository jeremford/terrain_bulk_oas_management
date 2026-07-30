/**
 * Terrain REST client.
 *
 * Endpoints and payload shapes were derived from captured browser traffic; see
 * docs/API.md for the evidence behind each call and which ones are inferred.
 * This is an unofficial API with no stability guarantees.
 */

export const ACHIEVEMENTS = 'https://achievements.terrain.scouts.com.au';
export const MEMBERS      = 'https://members.terrain.scouts.com.au';
export const TEMPLATES    = 'https://templates.terrain.scouts.com.au';

export class TerrainClient {
  constructor(session) { this.session = session; }

  async request(method, url, body) {
    const authorization = await this.session.authorization();
    const res = await fetch(url, {
      method,
      headers: { authorization, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 240);
      const path = url.replace(ACHIEVEMENTS, '').replace(MEMBERS, '');
      throw new Error(`${method} ${path} -> ${res.status} ${detail}`.trim());
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  // ---- members service ----------------------------------------------------

  getProfiles() {
    return this.request('GET', `${MEMBERS}/profiles`);
  }

  getUnitMembers(unitId) {
    return this.request('GET', `${MEMBERS}/units/${unitId}/members`);
  }

  /** Assist mode. Only needed if direct writes to a member are rejected. */
  assumeProfile(memberId) {
    return this.request('POST', `${MEMBERS}/members/${memberId}/assume-profiles`, {});
  }

  revokeAssumedProfiles() {
    return this.request('POST', `${MEMBERS}/revoke-assumed-profiles`, {});
  }

  // ---- achievements service ----------------------------------------------

  getMemberAchievements(memberId, type = 'outdoor_adventure_skill') {
    return this.request('GET', `${ACHIEVEMENTS}/members/${memberId}/achievements?type=${type}`);
  }

  getUnitAchievements({ unitId, stream, stage }) {
    const q = new URLSearchParams({
      type: 'outdoor_adventure_skill',
      stream,
      branch: stream,
      stage: String(stage),
    });
    return this.request('GET', `${ACHIEVEMENTS}/units/${unitId}/achievements?${q}`);
  }

  getUnitSubmissions(unitId, status = 'pending') {
    return this.request('GET', `${ACHIEVEMENTS}/units/${unitId}/submissions?status=${status}`);
  }

  /** Creates a new record. Returns { id, status: 'draft_review', ... }. */
  createAchievement(memberId, document) {
    return this.request('POST', `${ACHIEVEMENTS}/members/${memberId}/achievements`, document);
  }

  /** Full-document replace. Send the merged answers map, not a partial one. */
  updateAchievement(memberId, achievementId, document) {
    return this.request('PUT', `${ACHIEVEMENTS}/members/${memberId}/achievements/${achievementId}`, document);
  }

  /**
   * Moves draft_review -> pending_review. The plain `/submit` endpoint 403s
   * for a leader token (even in assist mode); Terrain itself submits with
   * `/submit-on-behalf` plus the leader's own member id (captured July 2026).
   */
  submitAchievement(memberId, achievementId, unitId, submittedBy) {
    return this.request(
      'POST',
      `${ACHIEVEMENTS}/members/${memberId}/achievements/${achievementId}/submit-on-behalf`,
      { type: 'review', unit_id: unitId, submitted_by: submittedBy }
    );
  }
}
