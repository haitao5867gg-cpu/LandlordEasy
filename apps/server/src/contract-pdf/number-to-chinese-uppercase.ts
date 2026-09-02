const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
const SMALL_UNITS = ['', '拾', '佰', '仟'];
const GROUP_UNITS = ['', '万', '亿', '兆'];

function convertFourDigitGroup(value: number): string {
  let result = '';
  let pendingZero = false;

  for (let position = 3; position >= 0; position--) {
    const divisor = 10 ** position;
    const digit = Math.floor(value / divisor) % 10;

    if (digit === 0) {
      if (result) pendingZero = true;
      continue;
    }

    if (pendingZero) {
      result += DIGITS[0];
      pendingZero = false;
    }
    result += `${DIGITS[digit]}${SMALL_UNITS[position]}`;
  }

  return result;
}

function convertInteger(value: number): string {
  if (value === 0) return DIGITS[0];

  const groups: number[] = [];
  let remaining = value;
  while (remaining > 0) {
    groups.push(remaining % 10_000);
    remaining = Math.floor(remaining / 10_000);
  }

  if (groups.length > GROUP_UNITS.length) {
    throw new RangeError('金额过大，最多支持到兆位');
  }

  let result = '';
  let pendingZero = false;
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index];
    if (group === 0) {
      if (result) pendingZero = true;
      continue;
    }

    if (result && (pendingZero || group < 1_000)) result += DIGITS[0];
    result += `${convertFourDigitGroup(group)}${GROUP_UNITS[index]}`;
    pendingZero = false;
  }

  return result;
}

/** 按人民币元、角、分规则把非负数字转换为中文大写金额。 */
export function numberToChineseUppercase(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError('金额必须是非负有限数字');
  }

  const cents = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError('金额超出安全计算范围');
  }

  const integer = Math.floor(cents / 100);
  const jiao = Math.floor((cents % 100) / 10);
  const fen = cents % 10;
  let result = `${convertInteger(integer)}元`;

  if (jiao === 0 && fen === 0) return `${result}整`;
  if (jiao > 0) result += `${DIGITS[jiao]}角`;
  if (fen > 0) {
    if (jiao === 0 && integer > 0) result += DIGITS[0];
    result += `${DIGITS[fen]}分`;
  }

  return result;
}
