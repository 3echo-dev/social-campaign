// Conservative, dependency-free shrinker for the board's JS and CSS. It removes comments, indentation, trailing
// spaces and blank lines, and joins a line to the next one only where the newline cannot matter (a statement that
// ends in `;`, a line that ends in `{`, `,`, `(` or an operator, a line whose next token continues the expression or
// closes it), up to a line length cap. The text of strings, template literals, regular expressions and url() is never
// touched, so automatic semicolon insertion behaves exactly as before. Every line stays well under the 2,000
// characters a Read of the file would cut off, and the file has few lines: each line costs its number in a Read.
// A very long string with no escapes (an inlined image) is cut into pieces on separate lines.

const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

// A built line never grows past this many characters by joining; a Read of a file shows at most 2,000 per line.
export const LINE_LIMIT = 1500;
// A string literal longer than this (with no escape in it) is written as pieces of STRING_PIECE characters.
const STRING_SPLIT_MIN = 1400;
const STRING_PIECE = 1000;
// After a line ends in one of these the next line can only continue it, so the newline may go.
const JOIN_AFTER = ';{,([:?=>&|';
// A line that starts with one of these continues or closes what came before, so the newline may go.
const JOIN_BEFORE = ')]},;.:?=*%<>&|^([`';
// A newline after these changes the meaning (a restricted production): `return` newline value, or `x++` newline `(y)`.
const KEEP_NEWLINE_AFTER = /(?:^|[^\w$.])(?:return|throw|break|continue|yield|async)$|\+\+$|--$/;

// tail: the last characters written; lineLength: how long the output line is so far.
function joinable(tail, lineLength, src, i, c) {
  if (!(JOIN_AFTER.includes(tail[tail.length - 1]) || (JOIN_BEFORE.includes(c) && !src.startsWith('...', i)))) return false;
  if (KEEP_NEWLINE_AFTER.test(tail)) return false;
  const eol = src.indexOf('\n', i);
  return lineLength + (eol < 0 ? src.length : eol) - i <= LINE_LIMIT;
}

function splitLiteral(literal) {
  if (literal.length <= STRING_SPLIT_MIN || literal.includes('\\')) return literal;
  const quote = literal[0];
  const body = literal.slice(1, -1);
  const pieces = [];
  for (let at = 0; at < body.length; at += STRING_PIECE) pieces.push(quote + body.slice(at, at + STRING_PIECE) + quote);
  return `(${pieces.join('+\n')})`;
}

// options.identifiers: a Set that collects every identifier that is not a property name after a dot, and
// options.declarations: an array that collects `{name, kind, exported}` for every top-level function, const, let and var,
// both for the module splitter (scripts/board-modules.mjs).
export function minifyJs(src, { identifiers = null, declarations = null, splitLongStrings = true } = {}) {
  // The output is kept as pieces with its last characters and the current line length on the side: indexing a long
  // concatenated string for the last character on every token would copy it each time.
  const pieces = [];
  let size = 0;
  let tail = '';
  let lineBegin = 0;
  const put = text => {
    if (!text) return;
    const newlineAt = text.lastIndexOf('\n');
    if (newlineAt >= 0) lineBegin = size + newlineAt + 1;
    pieces.push(text);
    size += text.length;
    tail = (tail + text).slice(-12);
  };
  let i = 0;
  const n = src.length;
  let lastTok = ''; // last significant token: a punctuator char, or a word / '0' for a value
  let lineStart = true; // only whitespace so far on this output line
  let pending = false; // whitespace seen since the last token
  let newline = false; // a newline seen since the last token, kept or joined when the next token starts
  const templateStack = []; // brace depth at which each open ${ started
  let braceDepth = 0;
  let exportSeen = false;
  let asyncSeen = false;
  let declWait = null; // set after `function`, `const`, `let` or `var` at the top level: the next word is the name
  const emit = text => { put(text); lineStart = false; };
  const readTemplate = () => { // positioned just after the opening ` or after the } closing a ${
    while (i < n) {
      const c = src[i];
      if (c === '\\') { put(c + src[i + 1]); i += 2; continue; }
      if (c === '`') { put(c); i++; lastTok = '0'; return; }
      if (c === '$' && src[i + 1] === '{') { put('${'); i += 2; templateStack.push(braceDepth); braceDepth++; lastTok = '{'; return; }
      let j = i + 1;
      while (j < n && src[j] !== '\\' && src[j] !== '`' && src[j] !== '$') j++;
      put(src.slice(i, j)); i = j;
    }
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { if (!lineStart) newline = true; lineStart = true; pending = false; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') {
      let j = i; while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r')) j++;
      if (!lineStart && src[j] !== '\n' && j < n) pending = true;
      i = j; continue;
    }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      const hadNewline = src.slice(i, stop).includes('\n');
      i = stop;
      if (hadNewline && !lineStart) { newline = true; lineStart = true; pending = false; } else if (!lineStart) pending = true;
      continue;
    }
    if (newline) {
      newline = false;
      if (joinable(tail, size - lineBegin, src, i, c)) pending = true; else put('\n');
    }
    if (pending) {
      // A space between two tokens is only needed where gluing them would make a different token.
      const last = tail[tail.length - 1];
      const word = ch => /[\w$\\]/.test(ch) || ch > '\x7f';
      if ((word(last) && word(c)) || (last === '+' && c === '+') || (last === '-' && c === '-') || (last === '/' && c === '/') || (/[0-9]/.test(last) && c === '.')) put(' ');
      pending = false;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      emit(splitLongStrings ? splitLiteral(src.slice(i, j + 1)) : src.slice(i, j + 1)); i = j + 1; lastTok = '0'; continue;
    }
    if (c === '`') { emit('`'); i++; readTemplate(); continue; }
    if (c === '/') {
      const regexAllowed = lastTok === '' || REGEX_AFTER_WORDS.has(lastTok) || (lastTok.length === 1 && !/[\w$)\]}]/.test(lastTok) && lastTok !== '0');
      if (regexAllowed) {
        let j = i + 1; let inClass = false;
        while (j < n && src[j] !== '\n') {
          const d = src[j];
          if (d === '\\') { j += 2; continue; }
          if (d === '[') inClass = true; else if (d === ']') inClass = false; else if (d === '/' && !inClass) break;
          j++;
        }
        if (src[j] === '/') {
          j++; while (j < n && /[a-z]/i.test(src[j])) j++;
          emit(src.slice(i, j)); i = j; lastTok = '0'; continue;
        }
      }
      emit('/'); i++; lastTok = '/'; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1; while (j < n && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (identifiers && !(lastTok === '.' && !tail.endsWith('...'))) identifiers.add(word);
      if (declarations && braceDepth === 0 && !templateStack.length) {
        if (declWait) { declarations.push({ name: word, kind: declWait.kind, exported: declWait.exported }); declWait = null; }
        else if (lastTok === '' || lastTok === ';' || lastTok === '}' || exportSeen || asyncSeen) {
          if (word === 'export') exportSeen = true;
          else if (word === 'async') asyncSeen = true;
          else if (word === 'function' || word === 'const' || word === 'let' || word === 'var') { declWait = { kind: word, exported: exportSeen }; exportSeen = false; asyncSeen = false; }
          else { exportSeen = false; asyncSeen = false; }
        }
      }
      emit(word); i = j; lastTok = REGEX_AFTER_WORDS.has(word) ? word : '0'; continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1; while (j < n && /[\w.]/.test(src[j])) j++;
      emit(src.slice(i, j)); i = j; lastTok = '0'; continue;
    }
    if (c === '{') braceDepth++;
    if (c === '}') {
      braceDepth--;
      if (templateStack.length && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop(); put('}'); lineStart = false; i++; readTemplate(); continue;
      }
    }
    emit(c); i++; lastTok = c;
  }
  return pieces.join('').replace(/\n+$/, '') + '\n';
}

export function minifyCss(src) {
  const pieces = [];
  let last = ''; // the last character written, kept on the side so a long output is never indexed
  const put = text => { pieces.push(text); last = text[text.length - 1]; };
  let i = 0;
  const n = src.length;
  let lineStart = true;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { if (!lineStart) put('\n'); lineStart = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') {
      let j = i; while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r')) j++;
      if (!lineStart && src[j] !== '\n' && j < n && !'{;,:'.includes(last) && !'{};'.includes(src[j])) put(' ');
      i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      put(src.slice(i, j + 1)); lineStart = false; i = j + 1; continue;
    }
    if (c === 'u' && src.startsWith('url(', i)) {
      const end = src.indexOf(')', i);
      const stop = end < 0 ? n : end + 1;
      put(src.slice(i, stop)); lineStart = false; i = stop; continue;
    }
    put(c); lineStart = false; i++;
  }
  return joinCssLines(pieces.join('').replace(/ +\n/g, '\n').replace(/\n+$/, '')) + '\n';
}

// CSS has no automatic semicolon insertion: a newline is plain space, so lines run together up to the line cap wherever
// the previous one ends in `}`, `;`, `{` or `,` (no space is needed there).
function joinCssLines(text) {
  const joined = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const last = joined.length - 1;
    if (last >= 0 && '};{,'.includes(joined[last][joined[last].length - 1]) && joined[last].length + line.length <= LINE_LIMIT) joined[last] += line;
    else joined.push(line);
  }
  return joined.join('\n');
}
