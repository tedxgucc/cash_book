// Minimal service worker so the cashbook can be installed on a phone's home screen.
// It caches nothing: data always comes live from Supabase.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
