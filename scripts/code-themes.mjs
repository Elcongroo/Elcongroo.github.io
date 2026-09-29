// TextMate scopes provide syntax meaning; plain text and terminal output stay neutral.
const scopes = {
  comment: ['comment', 'punctuation.definition.comment'],
  keyword: ['keyword', 'storage.modifier', 'storage.type'],
  string: ['string', 'punctuation.definition.string'],
  number: ['constant.numeric', 'constant.language', 'support.constant', 'variable.other.constant'],
  function: ['entity.name.function', 'support.function', 'variable.function'],
  type: ['entity.name.type', 'entity.name.class', 'entity.name.struct', 'entity.name.enum', 'support.type', 'support.class'],
  operator: ['keyword.operator', 'punctuation.accessor'],
  parameter: ['variable.parameter', 'entity.other.attribute-name'],
  tag: ['entity.name.tag', 'keyword.control.directive'],
};
const theme = (type, palette) => ({
  name: `congroo-${type}`, type,
  colors: { 'editor.foreground': palette.text, 'editor.background': palette.background },
  tokenColors: Object.entries(scopes).map(([role, scope]) => ({
    scope, settings: { foreground: palette[role] },
  })),
});
export const codeThemes = {
  light: theme('light', {
    text: '#293449', background: '#f5f7fb', comment: '#647087',
    keyword: '#7b35b4', string: '#28753d', number: '#b34b16',
    function: '#215fbd', type: '#956016', operator: '#087580',
    parameter: '#9b3987', tag: '#b42c50',
  }),
  dark: theme('dark', {
    text: '#dce4f2', background: '#202530', comment: '#a2adc2',
    keyword: '#cba6f7', string: '#a6d99a', number: '#fab387',
    function: '#89b4fa', type: '#f1d58a', operator: '#80d2d9',
    parameter: '#e7acd7', tag: '#f38ba8',
  }),
};
