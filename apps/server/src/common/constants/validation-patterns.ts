/** 共享校验正则——身份证(15/18位含X)与手机号,DTO层统一引用,避免8处字面量漂移 */
export const ID_CARD_PATTERN = /^\d{17}[\dXx]$|^\d{15}$/;
export const PHONE_PATTERN = /^1[3-9]\d{9}$/;
