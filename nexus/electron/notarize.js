// eslint-disable-next-line @typescript-eslint/no-var-requires
const { notarize } = require('@electron/notarize');

/**
 * Called by electron-builder after signing (via afterSign in electron-builder.yml).
 * Submits the app to Apple's notary service using notarytool.
 *
 * Required environment variables:
 *   APPLE_ID                   — your Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD — app-specific password from appleid.apple.com
 *   APPLE_TEAM_ID              — 10-character team ID from developer.apple.com
 *
 * Set SKIP_NOTARIZE=true to skip during local development builds.
 */
module.exports = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.SKIP_NOTARIZE === 'true') {
    console.log('[notarize] Skipping notarization (SKIP_NOTARIZE=true)');
    return;
  }

  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`[notarize] Notarizing ${appPath}…`);

  await notarize({
    tool: 'notarytool',
    appBundleId: 'com.nexus.app',
    appPath,
    appleId:           process.env.APPLE_ID,
    appleIdPassword:   process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId:            process.env.APPLE_TEAM_ID,
  });

  console.log('[notarize] Done.');
};
