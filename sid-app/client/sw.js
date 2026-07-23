const CACHE_NAME = 'sid-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/utils.js',
  '/js/auth.js',
  '/js/contacts.js',
  '/js/settings.js',
  '/js/chat.js',
  '/js/video-call.js',
  '/js/app.js'
];

// Install Event
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event (Network-first fallback to Cache)
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});

// Background Push Notification Event Listener
self.addEventListener('push', (e) => {
  let data = { title: 'Sid Messenger', body: 'New notification received' };
  try {
    data = e.data.json();
  } catch (err) {
    if (e.data) {
      data.body = e.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || 'https://api.dicebear.com/7.x/bottts/svg?seed=Sid',
    badge: 'https://api.dicebear.com/7.x/bottts/svg?seed=Sid',
    data: {
      url: data.url || '/'
    }
  };

  e.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Background Notification Click Event Listener
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const urlToOpen = new URL(e.notification.data.url, self.location.origin).href;

  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window client if open
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new tab window
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
