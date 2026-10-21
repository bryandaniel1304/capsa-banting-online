// Push notifications (table invites) for players who are not looking at the game right now.
// - Browsers (Chrome / Edge / Firefox, iPhone home-screen app): Web Push. The VAPID key pair is generated once
//   and kept in the database (app_settings), so nothing has to be configured by hand.
// - Android app: Firebase Cloud Messaging (HTTP v1). Needs FIREBASE_SERVICE_ACCOUNT (the service account JSON,
//   raw or base64) on the server; without it the app simply doesn't offer notifications.
const crypto = require('crypto');
const webpush = require('web-push');
const store = require('./store');

let vapid = null; // { publicKey, privateKey }
let fcm = null; // { projectId, clientEmail, privateKey }
let fcmToken = null; // { value, exp }
// test hooks: point FCM / Google OAuth at local mock servers
const FCM_BASE = process.env.FCM_API_BASE || 'https://fcm.googleapis.com';
const OAUTH_URL = process.env.GOOGLE_OAUTH_URL || 'https://oauth2.googleapis.com/token';

async function init() {
  try {
    vapid = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
      ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
      : JSON.parse((await store.getSetting('vapid')) || 'null');
    if (!vapid) {
      vapid = webpush.generateVAPIDKeys();
      await store.setSetting('vapid', JSON.stringify(vapid));
    }
    webpush.setVapidDetails('mailto:' + (process.env.CONTACT_EMAIL || 'admin@capsa-banting.local'), vapid.publicKey, vapid.privateKey);
  } catch (e) { console.error('push: web push disabled:', e.message); vapid = null; }
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (raw) {
      const sa = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
      if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error('incomplete service account');
      fcm = { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key };
    }
  } catch (e) { console.error('push: FCM disabled:', e.message); fcm = null; }
  console.log('push: web ' + (vapid ? 'on' : 'off') + ', android ' + (fcm ? 'on (' + fcm.projectId + ')' : 'off'));
}

const config = () => ({ web: !!vapid, vapidPublicKey: vapid ? vapid.publicKey : null, android: !!fcm });

// OAuth access token for FCM from the service account (signed JWT, cached ~55 minutes).
let fcmTokenReq = null; // one token request at a time (several devices are notified in parallel)
function fcmAccessToken() {
  if (fcmToken && fcmToken.exp > Date.now() + 60000) return Promise.resolve(fcmToken.value);
  fcmTokenReq = fcmTokenReq || fetchFcmToken().finally(() => { fcmTokenReq = null; });
  return fcmTokenReq;
}
async function fetchFcmToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: fcm.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  });
  const jwt = unsigned + '.' + crypto.createSign('RSA-SHA256').update(unsigned).sign(fcm.privateKey).toString('base64url');
  const r = await fetch(OAUTH_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(8000),
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt,
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error('FCM auth ' + r.status + ' ' + (d.error || ''));
  fcmToken = { value: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return fcmToken.value;
}

async function sendFcm(token, n) {
  const r = await fetch(FCM_BASE + '/v1/projects/' + fcm.projectId + '/messages:send', {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { Authorization: 'Bearer ' + (await fcmAccessToken()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: {
      token,
      notification: { title: n.title, body: n.body },
      data: Object.fromEntries(Object.entries(n.data || {}).map(([k, v]) => [k, String(v)])),
      android: { priority: 'HIGH', ttl: (n.ttl || 600) + 's', notification: { channel_id: 'invites', tag: n.tag, sound: 'default', default_vibrate_timings: true } },
    } }),
  });
  if (r.ok) return 'ok';
  const d = await r.json().catch(() => ({}));
  const code = ((d.error && d.error.details) || []).map((x) => x.errorCode).find(Boolean) || (d.error && d.error.status);
  if (r.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') return 'gone';
  throw new Error('FCM ' + r.status + ' ' + code);
}

// n: { title, body, tag, ttl, data: { url, room } }. Dead subscriptions are removed. Returns how many devices got it.
async function notify(userId, n) {
  const subs = await store.pushSubs(userId);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      let res;
      if (s.kind === 'web' && vapid) {
        res = await webpush.sendNotification(JSON.parse(s.data), JSON.stringify(n), { TTL: n.ttl || 600, urgency: 'high', topic: (n.tag || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined })
          .then(() => 'ok', (e) => (e.statusCode === 404 || e.statusCode === 410 ? 'gone' : Promise.reject(e)));
      } else if (s.kind === 'fcm' && fcm) res = await sendFcm(s.endpoint, n);
      else return;
      if (res === 'gone') await store.deletePushSub(s.endpoint);
      else sent++;
    } catch (e) { console.error('push', s.kind, e.message); }
  }));
  return sent;
}

module.exports = { init, config, notify };
