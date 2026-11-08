const { withEntitlementsPlist } = require("expo/config-plugins");

// app.json holds the config. For a signed build on your own iPhone (free Apple ID or
// paid), pass your team and a bundle ID you own at build time, so neither is committed:
//   APPLE_TEAM_ID=XXXXXXXXXX IOS_BUNDLE_ID=com.you.spoken npx expo run:ios --device --configuration Release

// The app only uses local notifications (src/lib/notify.ts). expo-notifications still adds
// the push entitlement, which a free (personal) Apple team can't sign, so it's removed.
// Put it back when the server sends real push notifications (needs a paid Apple account).
const withoutPush = (config) =>
  withEntitlementsPlist(config, (c) => {
    delete c.modResults["aps-environment"];
    return c;
  });

module.exports = ({ config }) =>
  withoutPush({
    ...config,
    ios: {
      ...config.ios,
      bundleIdentifier: process.env.IOS_BUNDLE_ID || config.ios.bundleIdentifier,
      appleTeamId: process.env.APPLE_TEAM_ID || config.ios.appleTeamId,
    },
  });
