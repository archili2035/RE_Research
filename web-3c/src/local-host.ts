/** Browser hostnames that reach the Vite reference middleware. location.hostname wraps IPv6 in brackets. */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export const isLocalHost = (hostname = window.location.hostname) => LOCAL_HOSTS.has(hostname);
