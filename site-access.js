export const SITE_ORIGINS = Object.freeze(['http://*/*', 'https://*/*']);

export function createSiteAccessController({ permissions, onChange }) {
  let revision = 0;
  let requesting = false;
  const publish = (status, message) => onChange({ status, message, canRequest: typeof permissions?.request === 'function' });

  async function refresh(message = '') {
    if (requesting) return false;
    const current = ++revision;
    publish('checking', 'Checking website access…');
    try {
      if (typeof permissions?.contains !== 'function') throw new Error('This browser does not expose permission checks.');
      const granted = await permissions.contains({ origins: [...SITE_ORIGINS] });
      if (current !== revision) return false;
      if (granted) publish('granted', 'Access to all HTTP/HTTPS websites is enabled.');
      else publish('missing', message || 'Allow access so DiArc can open on websites without a separate permission click.');
      return Boolean(granted);
    } catch (error) {
      if (current === revision) publish('error', `Could not check website access. ${error.message} Use Manage site access below.`);
      return false;
    }
  }

  async function requestAccess() {
    if (requesting) return false;
    if (typeof permissions?.request !== 'function') {
      publish('error', 'This browser cannot show a permission prompt here. Use Manage site access below.');
      return false;
    }
    requesting = true;
    revision++;
    publish('requesting', 'Confirm website access in your browser’s permission prompt.');
    let message = '';
    try {
      // Keep this call before any await so it retains the button's user gesture.
      const granted = await permissions.request({ origins: [...SITE_ORIGINS] });
      if (!granted) message = 'Access was not granted. Try again, or choose On All Sites in the browser’s site-access settings.';
    } catch (error) {
      message = `Could not request website access. ${error.message} Use Manage site access below.`;
    } finally {
      requesting = false;
    }
    return refresh(message);
  }

  return { refresh, requestAccess };
}
