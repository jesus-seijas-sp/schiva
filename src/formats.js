// Checks of the "format" keyword (JSON Schema) and of the `format` option of String, all of them for strings. Each
// check is a self-contained function, or one calling others of this file by name, as standalone code writes them
// out by their source (see standalone-helpers.js).

// RFC 3339 full-date, with the days of each month and leap years.
function isDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

// RFC 3339 full-time: a time with an offset. A leap second (60) is valid only at 23:59 UTC.
function isTime(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:([zZ])|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) {
    return false;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 60) {
    return false;
  }
  let offset = 0;
  if (!match[4]) {
    const offsetHour = Number(match[6]);
    const offsetMinute = Number(match[7]);
    if (offsetHour > 23 || offsetMinute > 59) {
      return false;
    }
    offset = (match[5] === '-' ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  }
  return second < 60 || (hour * 60 + minute - offset + 1440) % 1440 === 23 * 60 + 59;
}

// RFC 3339 date-time.
function isDateTime(value) {
  const match = /^(.{10})[tT](.+)$/.exec(value);
  return match !== null && isDate(match[1]) && isTime(match[2]);
}

// ISO 8601 duration, as RFC 3339 appendix A defines it.
function isDuration(value) {
  return /^P(?:(?:\d+Y(?:\d+M(?:\d+D)?)?|\d+M(?:\d+D)?|\d+D)(?:T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S))?|T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S)|\d+W)$/.test(
    value
  );
}

function isIpv4(value) {
  return /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(value);
}

// RFC 4291 text form: eight groups, "::" for one or more groups of zeros, and an IPv4 address as the last two.
function isIpv6(value) {
  if (!/^[0-9A-Fa-f:.]+$/.test(value)) {
    return false;
  }
  const halves = value.split('::');
  if (halves.length > 2) {
    return false;
  }
  const groups = halves.map((half) => (half === '' ? [] : half.split(':')));
  const all = groups[groups.length - 1];
  let count = 0;
  if (all.length > 0 && all[all.length - 1].includes('.')) {
    if (!isIpv4(all.pop())) {
      return false;
    }
    count = 2;
  }
  const hextets = [].concat(...groups);
  if (!hextets.every((group) => /^[0-9A-Fa-f]{1,4}$/.test(group))) {
    return false;
  }
  count += hextets.length;
  return halves.length === 2 ? count < 8 : count === 8;
}

// Punycode (RFC 3492): the bias adaptation, decoding (undefined when invalid) and encoding.
function punycodeAdapt(delta, points, isFirst) {
  let result = Math.floor(delta / (isFirst ? 700 : 2));
  result += Math.floor(result / points);
  let k = 0;
  while (result > 455) {
    result = Math.floor(result / 35);
    k += 36;
  }
  return k + Math.floor((36 * result) / (result + 38));
}

function punycodeDecode(input) {
  const output = [];
  const delimiter = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(delimiter, 0); j += 1) {
    if (input.charCodeAt(j) >= 0x80) {
      return undefined;
    }
    output.push(input.charCodeAt(j));
  }
  let n = 128;
  let bias = 72;
  let i = 0;
  for (let index = delimiter < 0 ? 0 : delimiter + 1; index < input.length;) {
    const old = i;
    let weight = 1;
    for (let k = 36; ; k += 36) {
      if (index >= input.length) {
        return undefined;
      }
      const code = input.charCodeAt(index);
      index += 1;
      let digit = 36;
      if (code >= 48 && code <= 57) {
        digit = code - 22;
      } else if (code >= 65 && code <= 90) {
        digit = code - 65;
      } else if (code >= 97 && code <= 122) {
        digit = code - 97;
      }
      if (digit >= 36 || digit > Math.floor((0x7fffffff - i) / weight)) {
        return undefined;
      }
      i += digit * weight;
      let t = k - bias;
      if (k <= bias) {
        t = 1;
      } else if (k >= bias + 26) {
        t = 26;
      }
      if (digit < t) {
        break;
      }
      weight *= 36 - t;
    }
    bias = punycodeAdapt(i - old, output.length + 1, old === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    if (n > 0x10ffff) {
      return undefined;
    }
    output.splice(i, 0, n);
    i += 1;
  }
  return String.fromCodePoint(...output);
}

function punycodeEncode(input) {
  const points = Array.from(input, (char) => char.codePointAt(0));
  const digit = (d) => String.fromCharCode(d < 26 ? 97 + d : 22 + d);
  let output = points
    .filter((point) => point < 128)
    .map((point) => String.fromCharCode(point))
    .join('');
  const basic = output.length;
  let handled = basic;
  if (basic > 0) {
    output += '-';
  }
  let n = 128;
  let delta = 0;
  let bias = 72;
  while (handled < points.length) {
    // The smallest code point not handled yet.
    let m = 0x10ffff;
    for (let i = 0; i < points.length; i += 1) {
      if (points[i] >= n && points[i] < m) {
        m = points[i];
      }
    }
    delta += (m - n) * (handled + 1);
    n = m;
    for (let i = 0; i < points.length; i += 1) {
      if (points[i] < n) {
        delta += 1;
      }
      if (points[i] === n) {
        let q = delta;
        for (let k = 36; ; k += 36) {
          let t = k - bias;
          if (k <= bias) {
            t = 1;
          } else if (k >= bias + 26) {
            t = 26;
          }
          if (q < t) {
            break;
          }
          output += digit(t + ((q - t) % (36 - t)));
          q = Math.floor((q - t) / (36 - t));
        }
        output += digit(q);
        bias = punycodeAdapt(delta, handled + 1, handled === basic);
        delta = 0;
        handled += 1;
      }
    }
    delta += 1;
    n += 1;
  }
  return output;
}

// Bidi class of a character, approximated from its script and category: L, R, AL, AN, EN, ES, CS, ET, NSM or ON.
function bidiClass(char) {
  if (/[\u0600-\u0605\u0660-\u0669\u066B\u066C\u06DD\u0890\u0891\u08E2]/u.test(char)) {
    return 'AN';
  }
  if (/[0-9\u06F0-\u06F9\u00B2\u00B3\u00B9\u2070-\u2079\u2080-\u2089\uFF10-\uFF19]/u.test(char)) {
    return 'EN';
  }
  if (/[\p{Mn}\p{Me}]/u.test(char)) {
    return 'NSM';
  }
  if (/[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}]/u.test(char)) {
    return 'AL';
  }
  if (/[\p{Script=Hebrew}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\u200F]/u.test(char)) {
    return 'R';
  }
  if (/[+-]/.test(char)) {
    return 'ES';
  }
  if (/[,./:\u00A0]/.test(char)) {
    return 'CS';
  }
  if (/[#$%\u00A2-\u00A5\u00B0\u00B1]/u.test(char)) {
    return 'ET';
  }
  return /[\p{L}\p{Mc}]/u.test(char) ? 'L' : 'ON';
}

// The Bidi rule of RFC 5893 for a label, in a name with right-to-left labels.
function hasValidBidi(label) {
  const classes = Array.from(label, bidiClass);
  const first = classes[0];
  const last = classes.filter((type) => type !== 'NSM').pop();
  if (first === 'R' || first === 'AL') {
    return (
      classes.every((type) => ['R', 'AL', 'AN', 'EN', 'ES', 'CS', 'ET', 'ON', 'NSM'].includes(type)) &&
      ['R', 'AL', 'EN', 'AN'].includes(last) &&
      !(classes.includes('EN') && classes.includes('AN'))
    );
  }
  if (first === 'L') {
    return (
      classes.every((type) => ['L', 'EN', 'ES', 'CS', 'ET', 'ON', 'NSM'].includes(type)) && ['L', 'EN'].includes(last)
    );
  }
  return false;
}

// Whether a label (without "xn--" and already mapped) is a valid U-label: IDNA2008 (RFC 5891, 5892) code points,
// hyphens and contextual rules.
function isULabel(label) {
  const chars = Array.from(label);
  if (label.length === 0 || label.normalize('NFC') !== label || /^\p{M}/u.test(label)) {
    return false;
  }
  if (label.startsWith('-') || label.endsWith('-') || label.slice(2, 4) === '--') {
    return false;
  }
  const virama =
    /[\u094D\u09CD\u0A4D\u0ACD\u0B4D\u0BCD\u0C4D\u0CCD\u0D3B\u0D3C\u0D4D\u0DCA\u0E3A\u0F84\u1039\u103A\u1714\u1734\u17D2\u1A60\u1B44\u1BAA\u1BAB\u1BF2\u1BF3\u2D7F\uA806\uA8C4\uA953\uA9C0\uAAF6\uABED]/u;
  const joining = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}]/u;
  return chars.every((char, i) => {
    const before = chars[i - 1];
    const after = chars[i + 1];
    switch (char) {
      case '\u00DF':
      case '\u03C2':
      case '\u06FD':
      case '\u06FE':
      case '\u0F0B':
      case '\u3007':
        return true;
      case '\u00B7':
        return before === 'l' && after === 'l';
      case '\u0375':
        return after !== undefined && /\p{Script=Greek}/u.test(after);
      case '\u05F3':
      case '\u05F4':
        return before !== undefined && /\p{Script=Hebrew}/u.test(before);
      case '\u30FB':
        return chars.some(
          (other) => /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(other) && other !== '\u30FB'
        );
      case '\u200D':
        return before !== undefined && virama.test(before);
      case '\u200C': {
        if (before !== undefined && virama.test(before)) {
          return true;
        }
        // Joining letters on both sides, marks between them skipped.
        const left = chars
          .slice(0, i)
          .reverse()
          .find((other) => !/\p{Mn}/u.test(other));
        const right = chars.slice(i + 1).find((other) => !/\p{Mn}/u.test(other));
        return left !== undefined && right !== undefined && joining.test(left) && joining.test(right);
      }
      default:
        break;
    }
    if (/[\u0660-\u0669]/u.test(char)) {
      return !chars.some((other) => /[\u06F0-\u06F9]/u.test(other));
    }
    if (/[\u06F0-\u06F9]/u.test(char)) {
      return !chars.some((other) => /[\u0660-\u0669]/u.test(other));
    }
    // The code points RFC 5892 lists as DISALLOWED, marks among them.
    // eslint-disable-next-line no-misleading-character-class -- each one is a code point on its own
    if (/[\u0640\u07FA\u302E\u302F\u3031-\u3035\u303B]/u.test(char)) {
      return false;
    }
    return /[\p{Ll}\p{Lo}\p{Lm}\p{Mn}\p{Mc}\p{Nd}-]/u.test(char) && char.normalize('NFKC').toLowerCase() === char;
  });
}

// Whether a host name, after UTS 46 mapping when `isIdn`, is valid: labels of at most 63 octets (as A-labels), at most
// 253 octets in all, ASCII letters, digits and hyphens, and A-labels ("xn--") and U-labels that are valid.
function hasValidLabels(value, isIdn) {
  // A name of letter-digit-hyphen labels needs no mapping and has no right-to-left label: without "--" in the third and
  // fourth positions of a label (RFC 5891), which only a punycode label ("xn--") may have and the full check reads, it
  // only has to be at most 253 characters long.
  if (
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(value) &&
    !/(?:^|\.)[A-Za-z0-9-]{2}--/.test(value)
  ) {
    return value.length <= 253;
  }
  const mapped = isIdn
    ? value
        .normalize('NFKC')
        .replace(/[\u3002\uFF0E\uFF61]/gu, '.')
        // Code points the mapping removes (soft hyphen, zero width space, variation selectors...).
        // eslint-disable-next-line no-misleading-character-class -- each one is a code point on its own
        .replace(/[\u00AD\u200B\u2060\uFEFF\u180B-\u180D\uFE00-\uFE0F]/gu, '')
        .toLowerCase()
    : value;
  if (!isIdn && !/^[\x21-\x7E]*$/.test(mapped)) {
    return false;
  }
  const labels = mapped.split('.');
  const unicode = [];
  const ascii = [];
  const valid = labels.every((label) => {
    if (/^xn--/i.test(label)) {
      const decoded = punycodeDecode(label.slice(4).toLowerCase());
      if (
        decoded === undefined ||
        Array.from(decoded).every((char) => char.charCodeAt(0) < 0x80) ||
        punycodeEncode(decoded) !== label.slice(4).toLowerCase() ||
        !isULabel(decoded)
      ) {
        return false;
      }
      unicode.push(decoded);
      ascii.push(label);
      return label.length <= 63;
    }
    if (Array.from(label).every((char) => char.charCodeAt(0) < 0x80)) {
      unicode.push(label);
      ascii.push(label);
      return (
        /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label) &&
        !(label.slice(2, 4) === '--' && !/^xn--/i.test(label))
      );
    }
    if (!isIdn || !isULabel(label)) {
      return false;
    }
    unicode.push(label);
    ascii.push(`xn--${punycodeEncode(label)}`);
    return ascii[ascii.length - 1].length <= 63;
  });
  if (!valid || ascii.join('.').length > 253) {
    return false;
  }
  // With a right-to-left label, every label follows the Bidi rule.
  const isRtl = unicode.some((label) => Array.from(label).some((char) => ['R', 'AL', 'AN'].includes(bidiClass(char))));
  return !isRtl || unicode.every(hasValidBidi);
}

function isHostname(value) {
  return hasValidLabels(value, false);
}

// A host name up to draft-06: RFC 1123 labels, without the rules of IDNA that later drafts add.
function isRfc1123Hostname(value) {
  return (
    value.length <= 253 &&
    value.split('.').every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
  );
}

function isIdnHostname(value) {
  return hasValidLabels(value, true);
}

// RFC 5321 address: a dot-atom or quoted local part, and a host name (that isHost checks) or an IP address literal.
function isEmailWith(value, isIdn, isHost) {
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) {
    return false;
  }
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  // Literals, which are compiled once (a RegExp made here would be compiled on every call).
  const dotAtom = isIdn
    ? /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~\u0080-\u{10FFFF}-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~\u0080-\u{10FFFF}-]+)*$/u
    : /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
  // A quoted local part: printable ASCII but '"' and '\', which are escaped, and in idn-email other characters too.
  const quoted = isIdn
    ? /^"(?:[\x20\x21\x23-\x5B\x5D-\x7E\u0080-\u{10FFFF}]|\\[\x20-\x7E])*"$/u
    : /^"(?:[\x20\x21\x23-\x5B\x5D-\x7E]|\\[\x20-\x7E])*"$/;
  if (!dotAtom.test(local) && !quoted.test(local)) {
    return false;
  }
  const literal = domain.charCodeAt(0) === 0x5b ? /^\[(?:IPv6:(.+)|(.+))\]$/i.exec(domain) : null;
  if (literal) {
    return literal[1] !== undefined ? isIpv6(literal[1]) : isIpv4(literal[2]);
  }
  return isHost(domain);
}

function isEmail(value) {
  return isEmailWith(value, false, isHostname);
}

function isIdnEmail(value) {
  return isEmailWith(value, true, isIdnHostname);
}

// ECMA-262 regular expression, as the u flag reads it.
function isRegex(value) {
  try {
    RegExp(value, 'u');
    return true;
  } catch (e) {
    return false;
  }
}

// URIs and IRIs (RFC 3986, 3987), built from the grammar of RFC 3986.
const PCT = '%[0-9A-Fa-f]{2}';
const SUB_DELIMS = "!$&'()*+,;=";
const UCSCHAR =
  '\\u00A0-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFEF\\u{10000}-\\u{1FFFD}\\u{20000}-\\u{2FFFD}\\u{30000}-\\u{3FFFD}\\u{40000}-\\u{4FFFD}' +
  '\\u{50000}-\\u{5FFFD}\\u{60000}-\\u{6FFFD}\\u{70000}-\\u{7FFFD}\\u{80000}-\\u{8FFFD}\\u{90000}-\\u{9FFFD}\\u{A0000}-\\u{AFFFD}' +
  '\\u{B0000}-\\u{BFFFD}\\u{C0000}-\\u{CFFFD}\\u{D0000}-\\u{DFFFD}\\u{E1000}-\\u{EFFFD}';
const IPRIVATE = '\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}';
const H16 = '[0-9A-Fa-f]{1,4}';
const DEC_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = `(?:${DEC_OCTET}\\.){3}${DEC_OCTET}`;
const LS32 = `(?:${H16}:${H16}|${IPV4})`;
const IPV6 = [
  `(?:${H16}:){6}${LS32}`,
  `::(?:${H16}:){5}${LS32}`,
  `(?:${H16})?::(?:${H16}:){4}${LS32}`,
  `(?:(?:${H16}:){0,1}${H16})?::(?:${H16}:){3}${LS32}`,
  `(?:(?:${H16}:){0,2}${H16})?::(?:${H16}:){2}${LS32}`,
  `(?:(?:${H16}:){0,3}${H16})?::${H16}:${LS32}`,
  `(?:(?:${H16}:){0,4}${H16})?::${LS32}`,
  `(?:(?:${H16}:){0,5}${H16})?::${H16}`,
  `(?:(?:${H16}:){0,6}${H16})?::`,
].join('|');

// The regular expression of a URI (or IRI) or of a reference to one.
function uriPattern(isIri, isReference) {
  const unreserved = `A-Za-z0-9\\-._~${isIri ? UCSCHAR : ''}`;
  const pchar = `(?:[${unreserved}${SUB_DELIMS}:@]|${PCT})`;
  const segmentNzNc = `(?:[${unreserved}${SUB_DELIMS}@]|${PCT})+`;
  const userinfo = `(?:[${unreserved}${SUB_DELIMS}:]|${PCT})*`;
  const ipLiteral = `\\[(?:${IPV6}|[vV][0-9A-Fa-f]+\\.[A-Za-z0-9\\-._~${SUB_DELIMS}:]+)\\]`;
  const regName = `(?:[${unreserved}${SUB_DELIMS}]|${PCT})*`;
  const authority = `(?:${userinfo}@)?(?:${ipLiteral}|${IPV4}|${regName})(?::\\d*)?`;
  const pathAbempty = `(?:/${pchar}*)*`;
  const pathAbsolute = `/(?:${pchar}+(?:/${pchar}*)*)?`;
  const pathRootless = `${pchar}+(?:/${pchar}*)*`;
  const pathNoscheme = `${segmentNzNc}(?:/${pchar}*)*`;
  const query = `(?:${pchar}|[/?${isIri ? IPRIVATE : ''}])*`;
  const fragment = `(?:${pchar}|[/?])*`;
  const tail = `(?:\\?${query})?(?:#${fragment})?`;
  const uri = `[A-Za-z][A-Za-z0-9+\\-.]*:(?://${authority}${pathAbempty}|${pathAbsolute}|${pathRootless}|)${tail}`;
  const relative = `(?://${authority}${pathAbempty}|${pathAbsolute}|${pathNoscheme}|)${tail}`;
  return new RegExp(isReference ? `^(?:${uri}|${relative})$` : `^${uri}$`, 'u');
}

// Built-in formats: a function, or a regular expression the string must match.
// Comparisons of two values of a format for formatMinimum, formatMaximum, formatExclusiveMinimum and
// formatExclusiveMaximum, as ajv-formats compares them: a negative number, 0 or a positive number, or undefined when
// either value cannot be compared (which passes the limit).
function compareDate(d1, d2) {
  if (!(d1 && d2)) {
    return undefined;
  }
  if (d1 > d2) {
    return 1;
  }
  return d1 < d2 ? -1 : 0;
}

function compareTime(t1, t2) {
  if (!(t1 && t2)) {
    return undefined;
  }
  const ms1 = new Date(`2020-01-01T${t1}`).valueOf();
  const ms2 = new Date(`2020-01-01T${t2}`).valueOf();
  return ms1 && ms2 ? ms1 - ms2 : undefined;
}

function compareDateTime(dt1, dt2) {
  if (!(dt1 && dt2)) {
    return undefined;
  }
  const ms1 = new Date(dt1).valueOf();
  const ms2 = new Date(dt2).valueOf();
  return ms1 && ms2 ? ms1 - ms2 : undefined;
}

// The built-in formats whose values can be compared, with their comparison.
const FORMAT_COMPARES = {
  date: compareDate,
  time: compareTime,
  'date-time': compareDateTime,
};

const FORMATS = {
  date: isDate,
  time: isTime,
  'date-time': isDateTime,
  duration: isDuration,
  email: isEmail,
  'idn-email': isIdnEmail,
  hostname: isHostname,
  'idn-hostname': isIdnHostname,
  ipv4: isIpv4,
  ipv6: isIpv6,
  uri: uriPattern(false, false),
  'uri-reference': uriPattern(false, true),
  iri: uriPattern(true, false),
  'iri-reference': uriPattern(true, true),
  uuid: /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/,
  // RFC 6570: literals are any character but controls, space and '"%<>\^`{|}'; variable names may have dots.
  /* eslint-disable no-control-regex -- the literals exclude the control characters */
  'uri-template':
    /^(?:[^\x00-\x20\x7F"%<>\\^`{|}]|%[0-9A-Fa-f]{2}|\{[+#./;?&=,!@|]?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})+(?:\.(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})+)*(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})+(?:\.(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})+)*(?::[1-9][0-9]{0,3}|\*)?)*\})*$/,
  /* eslint-enable no-control-regex */
  'json-pointer': /^(?:\/(?:[^~/]|~0|~1)*)*$/,
  'relative-json-pointer': /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
  regex: isRegex,
};

// The functions of the formats, and the ones they call, by name, for standalone code.
const FORMAT_FUNCTIONS = {
  isRfc1123Hostname,
  compareDate,
  compareTime,
  compareDateTime,
  isDate,
  isTime,
  isDateTime,
  isDuration,
  isIpv4,
  isIpv6,
  punycodeAdapt,
  punycodeDecode,
  punycodeEncode,
  bidiClass,
  hasValidBidi,
  isULabel,
  hasValidLabels,
  isHostname,
  isIdnHostname,
  isEmailWith,
  isEmail,
  isIdnEmail,
  isRegex,
};

// Whether `value` has the format `check` (a function or a regular expression).
function matchesFormat(check, value) {
  return typeof check === 'function' ? check(value) : check.test(value);
}

module.exports = {
  FORMATS,
  FORMAT_COMPARES,
  FORMAT_FUNCTIONS,
  isRfc1123Hostname,
  matchesFormat,
};
