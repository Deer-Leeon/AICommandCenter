// redirect.js — placed in <head> so it fires immediately during HTML parsing,
// before the browser renders any body content or Chrome's NTP UI has a chance
// to paint. This eliminates the visible flash of the dark newtab.html page.
//
// Only redirects when online. If offline, this script exits without doing
// anything and newtab.js (loaded in <body>) handles the offline UI.
if (navigator.onLine) {
  window.location.replace(
    'https://nexus.lj-buchmiller.com?source=extension&extid=' + chrome.runtime.id
  );
}
