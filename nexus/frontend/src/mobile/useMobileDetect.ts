/** Returns true if the current device should render the mobile experience. */
export function isMobileDevice(): boolean {
  const narrowViewport = window.innerWidth < 768;
  const touchUA = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
  return narrowViewport || touchUA;
}
