// app.json holds the config. For a signed build on your own iPhone (free Apple ID or
// paid), pass your team and a bundle ID you own at build time, so neither is committed:
//   APPLE_TEAM_ID=XXXXXXXXXX IOS_BUNDLE_ID=com.you.spoken npx expo run:ios --device --configuration Release
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    bundleIdentifier: process.env.IOS_BUNDLE_ID || config.ios.bundleIdentifier,
    appleTeamId: process.env.APPLE_TEAM_ID || config.ios.appleTeamId,
  },
});
