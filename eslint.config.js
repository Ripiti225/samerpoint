// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      // App en français : les apostrophes (l', d', n'…) et guillemets dans le
      // texte JSX sont volontaires et sans risque. On évite le bruit permanent.
      'react/no-unescaped-entities': 'off',
    },
  },
]);
