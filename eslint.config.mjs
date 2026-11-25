import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', '.dist-wp-tmp/**/*', 'node_modules/**/*', 'wordpress/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
