// Conservative, dependency-free shrinker for the board's inlined JS and CSS. It removes comments, leading
// indentation, trailing spaces and blank lines, and nothing else: every newline is kept (so automatic semicolon
// insertion behaves exactly as before and the page stays readable in line-sized chunks), and the text of strings,
// template literals, regular expressions and url() is never touched.

const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

export function minifyJs(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let lastTok = ''; // last significant token: a punctuator char, or a word / '0' for a value
  let lineStart = true; // only whitespace so far on this output line
  let pending = false; // whitespace seen since the last token
  const templateStack = []; // brace depth at which each open ${ started
  let braceDepth = 0;
  const emit = text => { out += text; lineStart = false; };
  const readTemplate = () => { // positioned just after the opening ` or after the } closing a ${
    while (i < n) {
      const c = src[i];
      if (c === '\\') { out += c + src[i + 1]; i += 2; continue; }
      if (c === '`') { out += c; i++; lastTok = '0'; return; }
      if (c === '$' && src[i + 1] === '{') { out += '${'; i += 2; templateStack.push(braceDepth); braceDepth++; lastTok = '{'; return; }
      out += c; i++;
    }
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { if (!lineStart) out += '\n'; lineStart = true; pending = false; i++; continue; }
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
      if (hadNewline && !lineStart) { out += '\n'; lineStart = true; pending = false; } else if (!lineStart) pending = true;
      continue;
    }
    if (pending) {
      // A space between two tokens is only needed where gluing them would make a different token.
      const last = out[out.length - 1];
      const word = ch => /[\w$\\]/.test(ch) || ch > '\x7f';
      if ((word(last) && word(c)) || (last === '+' && c === '+') || (last === '-' && c === '-') || (last === '/' && c === '/') || (/[0-9]/.test(last) && c === '.')) out += ' ';
      pending = false;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      emit(src.slice(i, j + 1)); i = j + 1; lastTok = '0'; continue;
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
        templateStack.pop(); out += '}'; lineStart = false; i++; readTemplate(); continue;
      }
    }
    emit(c); i++; lastTok = c;
  }
  return out.replace(/\n+$/, '') + '\n';
}

export function minifyCss(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let lineStart = true;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { if (!lineStart) out += '\n'; lineStart = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') {
      let j = i; while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r')) j++;
      const last = out[out.length - 1];
      if (!lineStart && src[j] !== '\n' && j < n && !'{;,:'.includes(last) && !'{};'.includes(src[j])) out += ' ';
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
      out += src.slice(i, j + 1); lineStart = false; i = j + 1; continue;
    }
    if (c === 'u' && src.startsWith('url(', i)) {
      const end = src.indexOf(')', i);
      const stop = end < 0 ? n : end + 1;
      out += src.slice(i, stop); lineStart = false; i = stop; continue;
    }
    out += c; lineStart = false; i++;
  }
  return out.replace(/ +\n/g, '\n').replace(/\n+$/, '') + '\n';
}
